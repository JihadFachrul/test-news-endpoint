/** GET /mentions. Saringannya ada di filters.ts, dipakai bersama dengan stats. */
import { pool } from './db.js';
import {
  ambilTeks,
  buildWhere,
  CATATAN_TANGGAL_KOSONG,
  parseAngka,
  parseFilters,
  type MentionFilters,
} from './filters.js';

/**
 * Urutan tampilan resmi, dikembalikan di setiap respon supaya tidak ditebak.
 *
 * NULLS LAST harus eksplisit: pada urutan DESC, PostgreSQL menganggap NULL
 * sebagai nilai terbesar, jadi tanpa itu berita tanpa tanggal nangkring di
 * halaman pertama.
 *
 * id DESC adalah pemecah seri. Beberapa berita bisa punya published_at sama
 * persis; kalau seri, PostgreSQL bebas memilih urutan dan boleh berbeda antar
 * permintaan -- sehingga halaman 2 mengulang isi halaman 1 sementara baris
 * lain tidak pernah muncul di halaman mana pun.
 */
export const SORT_ORDER = 'published_at DESC NULLS LAST, id DESC';

const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 100;

export interface SearchParams extends MentionFilters {
  limit: number;
  offset: number;
}

export interface SearchRow {
  id: number;
  source: { slug: string; name: string; platform: string };
  external_id: string | null;
  title: string | null;
  content: string;
  url: string | null;
  author: string | null;
  published_at: string | null;
  engagement: number | null;
  times_seen: number;
}

export interface SearchResult {
  pagination: {
    limit: number;
    offset: number;
    total: number;
    returned: number;
    has_more: boolean;
  };
  sort: string;
  /** Saringan yang benar-benar diterapkan, dikembalikan supaya mudah diperiksa. */
  filters: MentionFilters & { catatan?: string };
  data: SearchRow[];
}

export function parseSearchQuery(query: Record<string, unknown>): {
  params: SearchParams;
  errors: string[];
} {
  const { filters, errors } = parseFilters(query);

  let limit = LIMIT_DEFAULT;
  const limitRaw = ambilTeks(query['limit']);
  if (limitRaw !== null) {
    const hasil = parseAngka(limitRaw, 'limit', 1, LIMIT_MAX);
    if (hasil.error) errors.push(hasil.error);
    else limit = hasil.angka!;
  }

  let offset = 0;
  const offsetRaw = ambilTeks(query['offset']);
  if (offsetRaw !== null) {
    const hasil = parseAngka(offsetRaw, 'offset', 0, Number.MAX_SAFE_INTEGER);
    if (hasil.error) errors.push(hasil.error);
    else offset = hasil.angka!;
  }

  return { params: { ...filters, limit, offset }, errors };
}

interface DbRow {
  id: string;
  external_id: string | null;
  title: string | null;
  content_clean: string;
  url: string | null;
  author: string | null;
  published_at: Date | null;
  engagement: number | null;
  times_seen: number;
  slug: string;
  display_name: string;
  platform: string;
}

export async function searchMentions(params: SearchParams): Promise<SearchResult> {
  const where = buildWhere(params);

  // Dua perintah, bukan satu dengan count(*) OVER (). Cara itu punya lubang:
  // kalau offset melewati baris terakhir, tidak ada baris yang kembali
  // sehingga totalnya ikut hilang dan terbaca 0.
  const hitung = await pool.query<{ total: string }>(
    `SELECT count(*) AS total
     FROM mentions m JOIN sources s ON s.id = m.source_id
     ${where.sql}`,
    where.values,
  );
  const total = Number(hitung.rows[0]!.total);

  const nilaiHalaman = [...where.values, params.limit, params.offset];
  const isi = await pool.query<DbRow>(
    `SELECT m.id, m.external_id, m.title, m.content_clean, m.url, m.author,
            m.published_at, m.engagement, m.times_seen,
            s.slug, s.display_name, s.platform
     FROM mentions m JOIN sources s ON s.id = m.source_id
     ${where.sql}
     ORDER BY m.published_at DESC NULLS LAST, m.id DESC
     LIMIT $${nilaiHalaman.length - 1} OFFSET $${nilaiHalaman.length}`,
    nilaiHalaman,
  );

  const data: SearchRow[] = isi.rows.map((row) => ({
    id: Number(row.id),
    source: { slug: row.slug, name: row.display_name, platform: row.platform },
    external_id: row.external_id,
    title: row.title,
    // content_clean, bukan content_raw: data mentah masih berisi HTML dan
    // pernah berisi kode berbahaya, jadi tidak pernah keluar lewat API.
    content: row.content_clean,
    url: row.url,
    author: row.author,
    published_at: row.published_at === null ? null : row.published_at.toISOString(),
    engagement: row.engagement,
    times_seen: row.times_seen,
  }));

  const filters: SearchResult['filters'] = {
    q: params.q,
    source: params.source,
    from: params.from,
    to: params.to,
  };
  if (params.from !== null || params.to !== null) {
    filters.catatan = CATATAN_TANGGAL_KOSONG;
  }

  return {
    pagination: {
      limit: params.limit,
      offset: params.offset,
      total,
      returned: data.length,
      has_more: params.offset + data.length < total,
    },
    sort: SORT_ORDER,
    filters,
    data,
  };
}
