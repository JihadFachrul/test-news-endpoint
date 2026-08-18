/**
 * GET /mentions/stats — angka untuk grafik dashboard.
 * Saringannya sama persis dengan GET /mentions karena memakai filters.ts.
 */
import { pool } from './db.js';
import { buildWhere, CATATAN_TANGGAL_KOSONG, parseFilters, type MentionFilters } from './filters.js';

/**
 * Zona waktu untuk menghitung "hari". Ditulis eksplisit, bukan mengandalkan
 * pengaturan server, supaya hasilnya sama di komputer mana pun.
 *
 * Sebuah hari tergantung berdiri di mana. Berita GDP tersimpan sebagai
 * 2026-08-10 16:00 UTC: dihitung UTC masuk 10 Agustus, dihitung waktu Malaysia
 * masuk 11 Agustus. Yang benar 11 Agustus, karena nilai asli di data feed
 * memang "11/08/2026" dan pemakainya analis PR yang berpikir dalam hari lokal.
 */
export const ZONA_WAKTU_LAPORAN = 'Asia/Kuala_Lumpur';

export type GroupBy = 'source' | 'day';

export interface StatsParams extends MentionFilters {
  groupBy: GroupBy;
}

export interface BarisSumber {
  source: string;
  name: string;
  platform: string;
  total: number;
}

export interface BarisHari {
  /** 'YYYY-MM-DD' waktu Malaysia, atau null untuk yang tanpa tanggal. */
  day: string | null;
  label: string;
  total: number;
}

export interface StatsResult {
  group_by: GroupBy;
  /** Hanya untuk group_by=day, karena hanya di situ zona waktu berpengaruh. */
  timezone?: string;
  filters: MentionFilters & { catatan?: string };
  total: number;
  data: BarisSumber[] | BarisHari[];
}

export function parseStatsQuery(query: Record<string, unknown>): {
  params: StatsParams | null;
  errors: string[];
} {
  const { filters, errors } = parseFilters(query);

  const groupByRaw = query['group_by'];
  const groupBy = typeof groupByRaw === 'string' ? groupByRaw.trim().toLowerCase() : '';

  if (groupBy !== 'source' && groupBy !== 'day') {
    errors.push(
      groupBy.length === 0
        ? 'group_by wajib diisi. Pilihannya: group_by=source atau group_by=day.'
        : `group_by="${String(groupByRaw)}" tidak dikenali. Pilihannya: source atau day.`,
    );
  }

  if (errors.length > 0) return { params: null, errors };

  return { params: { ...filters, groupBy: groupBy as GroupBy }, errors: [] };
}

/**
 * Pemecah seri s.slug perlu karena beberapa koran bisa punya jumlah yang sama;
 * tanpa itu batang grafiknya bertukar tempat setiap halaman disegarkan.
 */
async function statistikPerSumber(params: StatsParams): Promise<BarisSumber[]> {
  const where = buildWhere(params);
  const { rows } = await pool.query<{
    slug: string;
    display_name: string;
    platform: string;
    total: string;
  }>(
    `SELECT s.slug, s.display_name, s.platform, count(*) AS total
     FROM mentions m JOIN sources s ON s.id = m.source_id
     ${where.sql}
     GROUP BY s.slug, s.display_name, s.platform
     ORDER BY count(*) DESC, s.slug ASC`,
    where.values,
  );

  return rows.map((row) => ({
    source: row.slug,
    name: row.display_name,
    platform: row.platform,
    total: Number(row.total),
  }));
}

/**
 * Berita tanpa tanggal tidak dibuang, tapi masuk ember sendiri (day = null).
 * Kalau dibuang diam-diam, jumlah batang di grafik jadi lebih kecil daripada
 * jumlah berita yang ada, tanpa apa pun di layar yang memberi tahu.
 */
async function statistikPerHari(params: StatsParams): Promise<BarisHari[]> {
  const where = buildWhere(params);
  const { rows } = await pool.query<{ day: string | null; total: string }>(
    `SELECT to_char((m.published_at AT TIME ZONE $${where.values.length + 1})::date, 'YYYY-MM-DD') AS day,
            count(*) AS total
     FROM mentions m JOIN sources s ON s.id = m.source_id
     ${where.sql}
     GROUP BY day
     ORDER BY day DESC NULLS LAST`,
    [...where.values, ZONA_WAKTU_LAPORAN],
  );

  return rows.map((row) => ({
    day: row.day,
    label: row.day ?? 'tanpa tanggal',
    total: Number(row.total),
  }));
}

export async function getStats(params: StatsParams): Promise<StatsResult> {
  const data =
    params.groupBy === 'source'
      ? await statistikPerSumber(params)
      : await statistikPerHari(params);

  // Dihitung dari hasilnya sendiri, bukan query terpisah, supaya total dijamin
  // sama dengan jumlah semua baris.
  const total = data.reduce((jumlah, baris) => jumlah + baris.total, 0);

  const filters: StatsResult['filters'] = {
    q: params.q,
    source: params.source,
    from: params.from,
    to: params.to,
  };
  if (params.from !== null || params.to !== null) {
    filters.catatan = CATATAN_TANGGAL_KOSONG;
  }

  const hasil: StatsResult = { group_by: params.groupBy, filters, total, data };
  if (params.groupBy === 'day') hasil.timezone = ZONA_WAKTU_LAPORAN;

  return hasil;
}
