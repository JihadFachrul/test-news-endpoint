/**
 * Angka untuk grafik dashboard: GET /mentions/stats
 *
 * Dua bentuk:
 *   ?group_by=source   jumlah berita per koran/platform
 *   ?group_by=day      jumlah berita per hari
 *
 * Saringannya (q, source, from, to) sama persis dengan GET /mentions, karena
 * memakai kode yang sama dari filters.ts. Itu penting: di dashboard, angka di
 * grafik harus cocok dengan jumlah baris di daftarnya.
 */
import { pool } from './db.js';
import { buildWhere, CATATAN_TANGGAL_KOSONG, parseFilters, type MentionFilters } from './filters.js';

/**
 * ZONA WAKTU UNTUK MENGHITUNG "HARI".
 *
 * Ini keputusan yang perlu dijelaskan, bukan bawaan yang kebetulan terpakai.
 *
 * Sebuah "hari" bukan besaran mutlak -- ia tergantung berdiri di mana. Berita
 * yang terbit jam 02:00 UTC itu masih hari yang sama di London, tapi sudah
 * jam 10:00 di Kuala Lumpur.
 *
 * Contoh nyata dari data kita: berita GDP Malaysiakini tersimpan sebagai
 * 2026-08-10 16:00 UTC.
 *   - dihitung UTC       -> masuk ember 10 Agustus
 *   - dihitung Malaysia  -> masuk ember 11 Agustus
 *
 * Yang benar adalah 11 Agustus, karena nilai aslinya di data feed memang
 * "11/08/2026", dan karena pemakai alat ini adalah analis PR di Malaysia yang
 * berpikir dalam hari lokal. Grafik yang menaruhnya di 10 Agustus akan tidak
 * cocok dengan apa yang dia baca di korannya pagi itu.
 *
 * Ditulis eksplisit, bukan mengandalkan pengaturan zona waktu server, supaya
 * hasilnya sama di laptop siapa pun dan di server mana pun.
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
  /** Tanggal 'YYYY-MM-DD' menurut waktu Malaysia, atau null untuk yang tanpa tanggal. */
  day: string | null;
  /** Keterangan yang bisa langsung ditampilkan, terutama untuk ember tanpa tanggal. */
  label: string;
  total: number;
}

export interface StatsResult {
  group_by: GroupBy;
  /** Hanya diisi untuk group_by=day, karena hanya di situ zona waktu berpengaruh. */
  timezone?: string;
  filters: MentionFilters & { catatan?: string };
  /** Jumlah seluruh berita yang lolos saringan. Harus sama dengan jumlah semua baris. */
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
 * Jumlah berita per koran/platform.
 *
 * Urutannya: yang terbanyak dulu, lalu slug sebagai pemecah seri.
 *
 * Pemecah seri itu perlu di sini karena beberapa koran bisa punya jumlah yang
 * sama, dan tanpa pemecah seri urutannya bisa berubah-ubah antar permintaan.
 * Akibatnya batang-batang di grafik akan bertukar tempat setiap kali halaman
 * disegarkan, dan pemakainya menyangka alatnya rusak.
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
 * Jumlah berita per hari.
 *
 * Dua hal yang membuat ini tidak sesederhana "GROUP BY tanggal":
 *
 * 1. "AT TIME ZONE 'Asia/Kuala_Lumpur'" mengubah titik waktu absolut menjadi
 *    jam dinding Malaysia, baru kemudian diambil tanggalnya. Lihat penjelasan
 *    di ZONA_WAKTU_LAPORAN di atas.
 *
 * 2. Berita yang tanggalnya kosong TIDAK dibuang, tapi dikumpulkan di embernya
 *    sendiri (day = null).
 *
 *    Ini bagian yang paling mudah salah. Kalau baris tanpa tanggal dibuang
 *    diam-diam, jumlah seluruh batang di grafik akan LEBIH KECIL daripada
 *    jumlah berita yang sebenarnya ada -- dan tidak ada apa pun di layar yang
 *    memberi tahu bahwa ada yang hilang. Grafik yang menghilangkan data tanpa
 *    bilang-bilang itu grafik yang berbohong.
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

  // Total dihitung dari hasilnya sendiri, bukan lewat perintah SQL terpisah.
  //
  // Dengan begitu total DIJAMIN sama dengan jumlah semua baris. Kalau dihitung
  // terpisah, dua perintah SQL bisa saja tidak sepakat -- misalnya karena ada
  // data baru masuk di antara keduanya -- dan pemakainya melihat grafik yang
  // batangnya tidak berjumlah sama dengan angka totalnya.
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

  // Zona waktu hanya disebutkan pada group_by=day, karena hanya di situ ia
  // berpengaruh pada angkanya.
  if (params.groupBy === 'day') hasil.timezone = ZONA_WAKTU_LAPORAN;

  return hasil;
}
