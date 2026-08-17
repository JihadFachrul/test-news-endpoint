/**
 * Saringan yang dipakai BERSAMA oleh GET /mentions dan GET /mentions/stats.
 *
 * Kenapa disatukan di sini, bukan ditulis dua kali?
 *
 * Karena di sebuah dashboard, daftar berita dan grafik jumlahnya harus
 * mencerminkan saringan yang sama. Kalau kodenya ditulis dua kali, suatu hari
 * salah satunya akan diubah dan yang lain lupa diikutkan. Hasilnya: grafik
 * menunjukkan 8 berita sementara daftarnya memuat 12, dan analis kehilangan
 * kepercayaan pada seluruh alatnya.
 *
 * Dengan satu sumber kebenaran, ketidakcocokan itu mustahil terjadi.
 */
import { parsePublishedAt } from './normalize/dates.js';
import { normalizeSource } from './normalize/sources.js';

export interface MentionFilters {
  /** Kata kunci, dicari di judul dan isi berita. */
  q: string | null;
  /** Slug sumber yang sudah diseragamkan, mis. 'thestar'. */
  source: string | null;
  /** Batas awal rentang tanggal (inklusif), sebagai teks ISO UTC. */
  from: string | null;
  /** Batas akhir rentang tanggal (eksklusif), sebagai teks ISO UTC. */
  to: string | null;
}

/** Penjelasan yang dikirim balik kalau saringan tanggal sedang aktif. */
export const CATATAN_TANGGAL_KOSONG =
  'Berita yang tidak punya tanggal terbit tidak ikut dalam hasil bersaringan tanggal, ' +
  'karena tidak bisa dipastikan berada di dalam rentangnya. Lepas saringan tanggal untuk melihatnya.';

/** Mengambil satu nilai teks dari parameter URL, atau null kalau kosong. */
export function ambilTeks(nilai: unknown): string | null {
  if (typeof nilai !== 'string') return null;
  const bersih = nilai.trim();
  return bersih.length > 0 ? bersih : null;
}

/**
 * Membaca satu parameter angka, dengan batas bawah dan atas.
 * Dibatasi supaya satu permintaan tidak bisa meminta sejuta baris sekaligus
 * dan membuat server kepayahan.
 */
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
 * Membaca satu batas tanggal.
 *
 * Menggunakan ulang parsePublishedAt(), pembaca tanggal yang SAMA dengan yang
 * dipakai saat memasukkan data. Jadi "2026-08-11" berarti hal yang sama di
 * kedua tempat: tengah malam menurut waktu Malaysia.
 *
 * KHUSUS UNTUK BATAS AKHIR (to): kalau yang diisi hanya tanggal tanpa jam,
 * batasnya digeser ke tengah malam HARI BERIKUTNYA.
 *
 * Kenapa? Karena kalau analis mengisi from=2026-08-11 dan to=2026-08-11, yang
 * dia maksud jelas "berita tanggal 11 Agustus". Kalau to dibaca apa adanya
 * sebagai jam 00:00 tanggal 11, hasilnya nol berita -- benar secara harfiah,
 * tapi salah secara maksud, dan pemakainya akan menyangka datanya hilang.
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

/** Membaca q, source, from, to dari parameter URL. */
export function parseFilters(query: Record<string, unknown>): {
  filters: MentionFilters;
  errors: string[];
} {
  const errors: string[] = [];

  const q = ambilTeks(query['q']);

  // Nama sumber dilewatkan lewat penyeragam yang SAMA dengan saat data masuk.
  // Jadi ?source=thestar, ?source=The Star, dan ?source=THE STAR semuanya
  // menemukan koran yang sama. Kalau tidak begini, pemakai API harus tahu
  // slug internal kita, padahal yang dia lihat di layar adalah nama aslinya.
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
 * Menyusun bagian WHERE beserta nilai-nilainya.
 *
 * Semua nilai dimasukkan sebagai parameter bernomor ($1, $2, ...), TIDAK
 * pernah ditempel langsung ke dalam teks SQL. Itu yang membuat SQL injection
 * mustahil: PostgreSQL menerima nilainya sebagai data, bukan sebagai perintah.
 *
 * Mengandaikan tabelnya diberi alias `m` (mentions) dan `s` (sources).
 */
export function buildWhere(filters: MentionFilters): { sql: string; values: unknown[] } {
  const syarat: string[] = [];
  const values: unknown[] = [];

  if (filters.q !== null) {
    // websearch_to_tsquery membuat kotak pencarian kita berperilaku seperti
    // mesin pencari yang sudah dikenal orang: beberapa kata berarti "semuanya
    // harus ada", tanda kutip berarti frasa utuh, tanda minus berarti kecuali.
    //
    // Dipilih daripada to_tsquery karena to_tsquery melempar error kalau
    // pemakai mengetik tanda baca sembarangan. Pencarian tidak boleh error
    // hanya karena orang mengetik "ringgit!!".
    values.push(filters.q);
    syarat.push(`m.search_tsv @@ websearch_to_tsquery('simple', $${values.length})`);
  }

  if (filters.source !== null) {
    values.push(filters.source);
    syarat.push(`s.slug = $${values.length}`);
  }

  // Saringan tanggal: batas awal inklusif, batas akhir eksklusif.
  //
  // Berita yang published_at-nya NULL otomatis TIDAK ikut, karena perbandingan
  // apa pun dengan NULL hasilnya bukan "benar".
  //
  // Itu memang yang kita inginkan, dan alasannya: kita tidak bisa membuktikan
  // berita tanpa tanggal berada di dalam rentang yang diminta. Memasukkannya
  // berarti mengarang. Berita itu tetap ada di database dan tetap ketemu kalau
  // saringan tanggalnya dilepas.
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
