/**
 * Saringan yang dipakai bersama oleh GET /mentions dan GET /mentions/stats.
 *
 * Disatukan bukan demi kerapian: di dashboard, grafik dan daftarnya harus
 * mencerminkan saringan yang sama. Kalau ditulis dua kali, suatu hari salah
 * satunya diubah dan yang lain lupa diikutkan.
 */
import { parsePublishedAt } from './normalize/dates.js';
import { normalizeSource } from './normalize/sources.js';

export interface MentionFilters {
  q: string | null;
  /** Slug sumber yang sudah diseragamkan, mis. 'thestar'. */
  source: string | null;
  /** Teks ISO UTC. from inklusif, to eksklusif. */
  from: string | null;
  to: string | null;
}

export const CATATAN_TANGGAL_KOSONG =
  'Berita yang tidak punya tanggal terbit tidak ikut dalam hasil bersaringan tanggal, ' +
  'karena tidak bisa dipastikan berada di dalam rentangnya. Lepas saringan tanggal untuk melihatnya.';

export function ambilTeks(nilai: unknown): string | null {
  if (typeof nilai !== 'string') return null;
  const bersih = nilai.trim();
  return bersih.length > 0 ? bersih : null;
}

/** Dibatasi supaya satu permintaan tidak bisa meminta sejuta baris sekaligus. */
export function parseAngka(
  nilai: string,
  nama: string,
  min: number,
  max: number,
): { angka: number | null; error: string | null } {
  if (!/^\d+$/.test(nilai.trim())) {
    return { angka: null, error: `${nama}="${nilai}" harus berupa bilangan bulat.` };
  }
  const angka = Number(nilai);
  if (angka < min || angka > max) {
    return {
      angka: null,
      error: `${nama}=${angka} di luar rentang yang diizinkan (${min}-${max}).`,
    };
  }
  return { angka, error: null };
}

/**
 * Memakai pembaca tanggal yang sama dengan saat data masuk, jadi "2026-08-11"
 * berarti hal yang sama di kedua tempat.
 *
 * Khusus "to": kalau diisi tanggal tanpa jam, batasnya digeser ke tengah malam
 * berikutnya. Kalau tidak, from=11 dan to=11 menghasilkan nol baris -- benar
 * secara harfiah, salah secara maksud.
 */
function parseBatasTanggal(
  nilai: string,
  jenis: 'from' | 'to',
): { iso: string | null; error: string | null } {
  const hasil = parsePublishedAt(nilai);

  if (hasil.iso === null) {
    return {
      iso: null,
      error: `${jenis}="${nilai}" bukan tanggal yang bisa dibaca. Contoh yang benar: 2026-08-11 atau 2026-08-11T00:00:00Z`,
    };
  }

  if (jenis === 'to' && hasil.format === 'tanggal-saja') {
    const akhirHari = new Date(new Date(hasil.iso).getTime() + 24 * 60 * 60 * 1000);
    return { iso: akhirHari.toISOString(), error: null };
  }

  return { iso: hasil.iso, error: null };
}

export function parseFilters(query: Record<string, unknown>): {
  filters: MentionFilters;
  errors: string[];
} {
  const errors: string[] = [];

  const q = ambilTeks(query['q']);

  // Dilewatkan penyeragam yang sama dengan saat data masuk, jadi ?source=The Star
  // dan ?source=thestar menemukan koran yang sama. Tanpa ini, pemakai API harus
  // tahu slug internal kita.
  const sourceRaw = ambilTeks(query['source']);
  const source = sourceRaw === null ? null : normalizeSource(sourceRaw, null).slug;

  let from: string | null = null;
  const fromRaw = ambilTeks(query['from']);
  if (fromRaw !== null) {
    const hasil = parseBatasTanggal(fromRaw, 'from');
    if (hasil.error) errors.push(hasil.error);
    else from = hasil.iso;
  }

  let to: string | null = null;
  const toRaw = ambilTeks(query['to']);
  if (toRaw !== null) {
    const hasil = parseBatasTanggal(toRaw, 'to');
    if (hasil.error) errors.push(hasil.error);
    else to = hasil.iso;
  }

  if (from !== null && to !== null && from > to) {
    errors.push(
      `rentang tanggalnya terbalik: from (${fromRaw}) lebih baru daripada to (${toRaw}).`,
    );
  }

  return { filters: { q, source, from, to }, errors };
}

/**
 * Menyusun bagian WHERE. Semua nilai lewat parameter bernomor, tidak pernah
 * ditempel ke teks SQL, jadi SQL injection mustahil.
 *
 * Mengandaikan tabelnya diberi alias `m` dan `s`.
 */
export function buildWhere(filters: MentionFilters): { sql: string; values: unknown[] } {
  const syarat: string[] = [];
  const values: unknown[] = [];

  if (filters.q !== null) {
    // websearch_to_tsquery, bukan to_tsquery: perilakunya sudah dikenal orang
    // (kutip = frasa, minus = kecuali) dan tidak melempar error kalau pemakai
    // mengetik tanda baca sembarangan.
    values.push(filters.q);
    syarat.push(`m.search_tsv @@ websearch_to_tsquery('simple', $${values.length})`);
  }

  if (filters.source !== null) {
    values.push(filters.source);
    syarat.push(`s.slug = $${values.length}`);
  }

  // Berita tanpa tanggal otomatis tidak ikut, karena perbandingan dengan NULL
  // tidak pernah benar. Itu memang yang diinginkan: kita tidak bisa
  // membuktikan berita tanpa tanggal ada di dalam rentangnya.
  if (filters.from !== null) {
    values.push(filters.from);
    syarat.push(`m.published_at >= $${values.length}`);
  }

  if (filters.to !== null) {
    values.push(filters.to);
    syarat.push(`m.published_at < $${values.length}`);
  }

  return { sql: syarat.length > 0 ? `WHERE ${syarat.join(' AND ')}` : '', values };
}
