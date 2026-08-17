/**
 * Memasukkan data massal (bulk ingest).
 *
 * Inilah tempat syarat paling keras dari brief dipenuhi: ENDPOINT INI HARUS
 * IDEMPOTENT. Kirim file yang sama dua kali, sepuluh kali, jumlah baris di
 * database tidak boleh bertambah. Pipeline asli mereka suka mencoba ulang
 * kalau gagal di tengah jalan, jadi ini bukan syarat teoretis.
 *
 * Prosesnya dipisah dua tahap, dan pemisahan itu disengaja:
 *
 *   TAHAP 1  prepareMentions()  membersihkan data, TIDAK menyentuh database
 *   TAHAP 2  storeMentions()    menyimpan, butuh sambungan database
 *
 * Kenapa dipisah? Karena tahap 1 jadi bisa diuji tanpa database sama sekali,
 * dan tahap 2 bisa diuji di dalam transaksi yang lalu dibatalkan, sehingga
 * tes tidak meninggalkan sampah di database.
 */
import type { PoolClient } from 'pg';
import { withTransaction } from './db.js';
import {
  InvalidMentionError,
  normalizeMention,
  type NormalizedMention,
} from './normalize/mention.js';

/** Catatan tentang satu record yang tidak sampai menggagalkannya. */
export interface RecordWarning {
  /** Posisi record di dalam array yang dikirim (mulai dari 0). */
  index: number;
  externalId: string | null;
  messages: string[];
}

/** Record yang bentuknya rusak sehingga tidak bisa diproses sama sekali. */
export interface RecordError {
  index: number;
  message: string;
}

export interface PreparedBatch {
  valid: NormalizedMention[];
  errors: RecordError[];
  warnings: RecordWarning[];
}

export interface IngestReport {
  /** Berapa record yang kami terima. */
  received: number;
  /** Berapa yang jadi baris BARU. */
  inserted: number;
  /** Berapa yang ternyata duplikat, jadi digabung ke baris yang sudah ada. */
  merged: number;
  /** Berapa yang bentuknya rusak sehingga dilewati. */
  invalid: number;
  errors: RecordError[];
  warnings: RecordWarning[];
}

// ===========================================================================
// TAHAP 1 - membersihkan (tanpa database)
// ===========================================================================

/**
 * Membersihkan seluruh record, dan memisahkan yang rusak.
 *
 * Record yang bentuknya rusak DILEWATI, bukan membatalkan seluruh kiriman.
 * Alasannya praktis: record rusak akan tetap rusak berapa kali pun dicoba
 * ulang, jadi kalau ia membatalkan seluruh kiriman, satu record busuk bisa
 * menyandera 14 record sehat selamanya. Yang rusak dilaporkan balik supaya
 * kelihatan, tidak hilang tanpa jejak.
 */
export function prepareMentions(records: unknown[]): PreparedBatch {
  const valid: NormalizedMention[] = [];
  const errors: RecordError[] = [];
  const warnings: RecordWarning[] = [];

  records.forEach((record, index) => {
    try {
      const bersih = normalizeMention(record);
      valid.push(bersih);
      if (bersih.warnings.length > 0) {
        warnings.push({ index, externalId: bersih.externalId, messages: bersih.warnings });
      }
    } catch (error) {
      const message = error instanceof InvalidMentionError ? error.message : String(error);
      errors.push({ index, message });
    }
  });

  return { valid, errors, warnings };
}

// ===========================================================================
// TAHAP 2 - menyimpan ke database
// ===========================================================================

/**
 * Mendaftarkan koran/platform, lalu mengembalikan id-nya.
 *
 * Dipakai "ON CONFLICT ... DO UPDATE", bukan "DO NOTHING". Alasannya teknis:
 * DO NOTHING tidak mengembalikan baris apa pun kalau datanya sudah ada,
 * sehingga kita tidak dapat id-nya. DO UPDATE selalu mengembalikan baris.
 */
const SQL_UPSERT_SOURCE = `
  INSERT INTO sources (slug, display_name, platform)
  VALUES ($1, $2, $3)
  ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id
`;

/**
 * Menyimpan satu mention.
 *
 * "ON CONFLICT (dedupe_key)" inilah jantung syarat idempotent. Kalau sidik
 * jarinya sudah ada, database TIDAK membuat baris baru, tapi menggabungkan
 * data ke baris yang sudah ada.
 *
 * ATURAN PENGGABUNGANNYA, beserta alasan masing-masing:
 *
 * - engagement: diambil yang TERBESAR.
 *   Jumlah like/share hanya bertambah seiring waktu, jadi angka tertinggi
 *   adalah pengukuran terbaru. Di data: 412 -> 415 -> 1204.
 *
 * - published_at: diambil yang PALING AWAL.
 *   Waktu terbit asli sebuah artikel cuma satu. Selisih beberapa menit antar
 *   salinan itu cuma jeda robot pengumpul data, bukan penerbitan ulang.
 *
 * - published_at_raw: diambil yang SEPADAN dengan published_at yang dipilih.
 *   Kalau tidak dijaga, kolom audit ini bisa berisi nilai mentah dari salinan
 *   lain, dan justru menyesatkan orang yang sedang menelusuri masalah.
 *
 * - author, title, url, external_id: yang lama dipertahankan, yang kosong
 *   DIISI dari salinan. Contoh nyatanya di data: str-99120 punya penulis
 *   "Aisyah Rahman", sedangkan salinannya nst-40021 penulisnya null.
 *
 * - isi berita: yang LEBIH PANJANG yang menang, karena biasanya lebih
 *   lengkap. Bandingkan str-99120 ("...buoyed by improved sentiment.")
 *   dengan nst-40021 yang isinya terpotong.
 *
 * - times_seen: ditambah satu.
 *
 * CATATAN tentang GREATEST dan LEAST di PostgreSQL: keduanya MENGABAIKAN
 * nilai NULL, dan hanya menghasilkan NULL kalau semua isinya NULL. Jadi
 * GREATEST(412, NULL) = 412. Itu persis yang kita butuhkan: kalau salah satu
 * salinan tidak punya nilai, nilai dari salinan lain yang dipakai.
 */
const SQL_UPSERT_MENTION = `
  INSERT INTO mentions (
    source_id, external_id, url, canonical_url, title,
    content_raw, content_clean, author, published_at, published_at_raw,
    engagement, dedupe_key
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (dedupe_key) DO UPDATE SET
    engagement       = GREATEST(mentions.engagement, EXCLUDED.engagement),
    published_at     = LEAST(mentions.published_at, EXCLUDED.published_at),
    published_at_raw = CASE
                         WHEN EXCLUDED.published_at IS NOT NULL
                          AND (mentions.published_at IS NULL
                               OR EXCLUDED.published_at < mentions.published_at)
                         THEN EXCLUDED.published_at_raw
                         ELSE COALESCE(mentions.published_at_raw, EXCLUDED.published_at_raw)
                       END,
    author           = COALESCE(mentions.author, EXCLUDED.author),
    title            = COALESCE(mentions.title, EXCLUDED.title),
    url              = COALESCE(mentions.url, EXCLUDED.url),
    canonical_url    = COALESCE(mentions.canonical_url, EXCLUDED.canonical_url),
    external_id      = COALESCE(mentions.external_id, EXCLUDED.external_id),
    content_raw      = CASE
                         WHEN length(EXCLUDED.content_clean) > length(mentions.content_clean)
                         THEN EXCLUDED.content_raw ELSE mentions.content_raw
                       END,
    content_clean    = CASE
                         WHEN length(EXCLUDED.content_clean) > length(mentions.content_clean)
                         THEN EXCLUDED.content_clean ELSE mentions.content_clean
                       END,
    times_seen       = mentions.times_seen + 1,
    updated_at       = now()
  RETURNING times_seen
`;

/**
 * Menyimpan hasil pembersihan ke database.
 *
 * Menerima `client` dari luar, bukan mengambil sendiri dari pool. Ini supaya
 * pemanggilnya yang menentukan batas transaksinya: endpoint membungkusnya
 * dalam transaksi yang di-commit, sedangkan tes membungkusnya dalam transaksi
 * yang dibatalkan, jadi tes tidak meninggalkan data sampah.
 */
export async function storeMentions(
  client: PoolClient,
  mentions: NormalizedMention[],
): Promise<{ inserted: number; merged: number }> {
  // Koran didaftarkan sekali per koran, bukan sekali per berita. Untuk 15
  // berita dari 6 koran, ini 6 perintah SQL, bukan 15.
  const sourceIds = new Map<string, number>();
  for (const mention of mentions) {
    if (sourceIds.has(mention.source.slug)) continue;
    const { rows } = await client.query<{ id: number }>(SQL_UPSERT_SOURCE, [
      mention.source.slug,
      mention.source.displayName,
      mention.source.platform,
    ]);
    sourceIds.set(mention.source.slug, rows[0]!.id);
  }

  let inserted = 0;
  let merged = 0;

  for (const mention of mentions) {
    const { rows } = await client.query<{ times_seen: number }>(SQL_UPSERT_MENTION, [
      sourceIds.get(mention.source.slug),
      mention.externalId,
      mention.url,
      mention.canonicalUrl,
      mention.title,
      mention.contentRaw,
      mention.contentClean,
      mention.author,
      mention.publishedAt,
      mention.publishedAtRaw,
      mention.engagement,
      mention.dedupeKey,
    ]);

    // Cara mengetahui baris ini baru atau hasil penggabungan:
    // baris baru selalu mulai dengan times_seen = 1 (nilai bawaan kolomnya),
    // sedangkan penggabungan selalu menaikkannya jadi 2 atau lebih.
    if (rows[0]!.times_seen === 1) inserted += 1;
    else merged += 1;
  }

  return { inserted, merged };
}

// ===========================================================================
// Gabungan keduanya, dipakai oleh endpoint
// ===========================================================================

/**
 * Membersihkan lalu menyimpan satu kiriman, dalam SATU transaksi.
 *
 * Kenapa satu transaksi? Supaya tidak ada kiriman yang tersimpan setengah
 * jadi. Kalau database bermasalah di record ke-9, sembilan record pertama
 * ikut dibatalkan, dan pihak pengirim boleh mencoba ulang seluruh file dengan
 * tenang -- yang justru aman, karena endpoint ini idempotent.
 */
export async function ingestMentions(records: unknown[]): Promise<IngestReport> {
  const prepared = prepareMentions(records);

  const { inserted, merged } = await withTransaction((client) =>
    storeMentions(client, prepared.valid),
  );

  return {
    received: records.length,
    inserted,
    merged,
    invalid: prepared.errors.length,
    errors: prepared.errors,
    warnings: prepared.warnings,
  };
}
