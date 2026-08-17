/**
 * Menggabungkan semua langkah pembersihan menjadi satu baris siap simpan.
 *
 * Fungsi di file ini TIDAK menyentuh database sama sekali. Masuk data mentah,
 * keluar data bersih. Dua keuntungannya:
 *   1. gampang diuji (tidak perlu database untuk mengetesnya)
 *   2. kalau aturan pembersihan ternyata salah, kita bisa menjalankannya ulang
 *      atas kolom content_raw yang tersimpan, tanpa minta data dikirim ulang
 */
import { buildDedupeKey } from './dedupe.js';
import { parsePublishedAt } from './dates.js';
import { parseEngagement } from './numbers.js';
import { normalizeSource, type Source } from './sources.js';
import { emptyToNull, htmlToText } from './text.js';
import { canonicalizeUrl } from './url.js';

export interface NormalizedMention {
  source: Source;
  externalId: string | null;
  url: string | null;
  canonicalUrl: string | null;
  title: string | null;
  contentRaw: string | null;
  contentClean: string;
  author: string | null;
  /** Waktu terbit sebagai teks ISO UTC, atau null kalau tidak diketahui. */
  publishedAt: string | null;
  publishedAtRaw: string | null;
  engagement: number | null;
  dedupeKey: string;
  /**
   * Catatan tentang record ini yang tidak sampai menggagalkannya. Dikembalikan
   * oleh endpoint ingest, supaya data yang bermasalah kelihatan dan tidak
   * hilang tanpa jejak.
   */
  warnings: string[];
}

export class InvalidMentionError extends Error {}

export function normalizeMention(input: unknown): NormalizedMention {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new InvalidMentionError('setiap mention harus berupa objek JSON');
  }
  const raw = input as Record<string, unknown>;
  const warnings: string[] = [];

  // --- koran / platform ----------------------------------------------------
  const url = emptyToNull(raw['url']);
  const source = normalizeSource(raw['source'], url);
  if (source.slug === 'unknown') {
    warnings.push('sumber tidak bisa dikenali, baik dari nama maupun dari URL');
  } else if (source.platform === 'other') {
    warnings.push(`sumber "${String(raw['source'])}" belum ada di daftar, dicatat sebagai "${source.slug}"`);
  }

  // --- alamat link ---------------------------------------------------------
  const canonicalUrl = canonicalizeUrl(url);
  if (url !== null && canonicalUrl === null) {
    warnings.push('url bukan alamat http/https yang bisa dipakai');
  }

  // --- judul dan isi -------------------------------------------------------
  const title = emptyToNull(htmlToText(raw['title']));

  const contentRaw = typeof raw['content'] === 'string' ? raw['content'] : null;
  const contentClean = htmlToText(contentRaw);
  if (contentRaw !== null && contentRaw !== contentClean) {
    warnings.push('isi berita mengandung HTML atau kode entity, sudah dibersihkan');
  }
  if (title === null && contentClean.length === 0) {
    warnings.push('mention tidak punya judul maupun isi');
  }

  // --- tanggal terbit ------------------------------------------------------
  const rawDate = raw['published_at'];
  const date = parsePublishedAt(rawDate);
  if (date.format === 'tidak-ada') {
    warnings.push('published_at kosong; mention tetap disimpan tapi tidak ikut saringan tanggal');
  } else if (date.format === 'gagal-dibaca') {
    warnings.push(`published_at "${String(rawDate)}" tidak bisa dibaca; disimpan sebagai kosong`);
  }

  // --- angka engagement ----------------------------------------------------
  const rawEngagement = raw['engagement'];
  const engagement = parseEngagement(rawEngagement);
  if (rawEngagement !== null && rawEngagement !== undefined && engagement === null) {
    warnings.push(`engagement "${String(rawEngagement)}" bukan angka yang bisa dipakai; disimpan sebagai kosong`);
  }

  // --- kunci duplikat ------------------------------------------------------
  const externalId = emptyToNull(raw['external_id']);
  const dedupeKey = buildDedupeKey({
    sourceSlug: source.slug,
    title,
    contentClean,
    canonicalUrl,
    externalId,
  });

  return {
    source,
    externalId,
    url,
    canonicalUrl,
    title,
    contentRaw,
    contentClean,
    author: emptyToNull(raw['author']),
    publishedAt: date.iso,
    publishedAtRaw: rawDate === null || rawDate === undefined ? null : String(rawDate),
    engagement,
    dedupeKey,
    warnings,
  };
}
