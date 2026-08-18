/**
 * Memasukkan data massal. Endpoint ini wajib idempotent: kirim file yang sama
 * berkali-kali, jumlah barisnya tidak boleh bertambah.
 *
 * Dipisah dua tahap supaya tahap pembersihan bisa diuji tanpa database, dan
 * tahap penyimpanan bisa diuji di dalam transaksi yang lalu dibatalkan.
 */
import type { PoolClient } from 'pg';
import { withTransaction } from './db.js';
import {
  InvalidMentionError,
  normalizeMention,
  type NormalizedMention,
} from './normalize/mention.js';

export interface RecordWarning {
  /** Posisi record di dalam array yang dikirim, mulai dari 0. */
  index: number;
  externalId: string | null;
  messages: string[];
}

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
  received: number;
  /** Jadi baris baru. */
  inserted: number;
  /** Ternyata duplikat, digabung ke baris yang sudah ada. */
  merged: number;
  /** Bentuknya rusak, dilewati. */
  invalid: number;
  errors: RecordError[];
  warnings: RecordWarning[];
}

/**
 * Membersihkan seluruh record dan memisahkan yang rusak.
 *
 * Record rusak dilewati, bukan membatalkan kiriman: dia akan tetap rusak
 * berapa kali pun dicoba ulang, jadi kalau membatalkan semuanya, satu record
 * busuk menyandera 14 yang sehat selamanya.
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

/** DO UPDATE, bukan DO NOTHING: DO NOTHING tidak mengembalikan id kalau sudah ada. */
const SQL_UPSERT_SOURCE = `
  INSERT INTO sources (slug, display_name, platform)
  VALUES ($1, $2, $3)
  ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id
`;

/**
 * ON CONFLICT (dedupe_key) inilah jantung syarat idempotent. Aturan
 * penggabungan per kolom:
 *
 *   engagement       terbesar     like/share hanya bertambah (412 -> 415 -> 1204)
 *   published_at     paling awal  waktu terbit asli cuma satu; selisih menit
 *                                 antar salinan itu jeda robot pengumpul
 *   published_at_raw yang sepadan dengan published_at terpilih, supaya kolom
 *                    audit tidak menampilkan nilai dari salinan lain
 *   author/title/url yang lama dipertahankan, yang kosong diisi dari salinan
 *   isi berita       yang lebih panjang, karena biasanya lebih lengkap
 *
 * GREATEST dan LEAST di PostgreSQL mengabaikan NULL, jadi GREATEST(412, NULL)
 * hasilnya 412 -- persis perilaku "isi dari salinan yang punya nilai".
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
 * Menerima client dari luar, bukan mengambil sendiri dari pool, supaya
 * pemanggilnya yang menentukan batas transaksi: endpoint meng-commit, tes
 * membatalkan sehingga tidak meninggalkan data sampah.
 */
export async function storeMentions(
  client: PoolClient,
  mentions: NormalizedMention[],
): Promise<{ inserted: number; merged: number }> {
  // Sekali per koran, bukan sekali per berita: 6 perintah untuk 15 berita.
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

    // Baris baru mulai dari nilai bawaan kolomnya, yaitu 1; penggabungan
    // selalu menaikkannya.
    if (rows[0]!.times_seen === 1) inserted += 1;
    else merged += 1;
  }

  return { inserted, merged };
}

/**
 * Satu transaksi untuk seluruh kiriman, supaya tidak ada yang tersimpan
 * setengah jadi. Kalau gagal di tengah, pengirim boleh mencoba ulang seluruh
 * file -- yang aman, karena endpoint ini idempotent.
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
