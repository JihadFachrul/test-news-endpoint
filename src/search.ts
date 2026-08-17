/**
 * Mencari berita: GET /mentions
 *
 * Brief meminta minimal: pencarian kata kunci, saringan sumber, rentang
 * tanggal, paginasi, dan "urutan yang stabil dan terdokumentasi".
 *
 * Empat keputusan di file ini yang perlu bisa dijelaskan:
 *   1. urutan tampilan dan kenapa ada pemecah seri
 *   2. bentuk paginasi yang dipilih
 *   3. apa yang terjadi pada berita tanpa tanggal saat ada saringan tanggal
 *   4. "to=2026-08-11" berhenti kapan
 */
import { pool } from './db.js';
import { parsePublishedAt } from './normalize/dates.js';
import { normalizeSource } from './normalize/sources.js';

/**
 * URUTAN TAMPILAN RESMI. Ini yang dimaksud brief dengan "documented, stable
 * sort order", dan nilainya dikembalikan di setiap respon supaya tidak perlu
 * ditebak oleh pemakai API.
 *
 *   published_at DESC   berita terbaru di atas -- yang diinginkan analis
 *   NULLS LAST          berita tanpa tanggal ditaruh di akhir, bukan di awal.
 *                       PostgreSQL secara bawaan menganggap NULL paling besar
 *                       pada urutan DESC, jadi tanpa ini berita tanpa tanggal
 *                       justru nangkring di halaman pertama.
 *   id DESC             PEMECAH SERI, dan ini bagian terpentingnya.
 *
 * Kenapa pemecah seri wajib ada? Karena beberapa berita bisa punya
 * published_at yang sama persis. Kalau urutannya seri, PostgreSQL bebas
 * memilih urutan mana pun, dan urutannya boleh berbeda antar permintaan.
 * Akibatnya di halaman 2 bisa muncul berita yang sudah tampil di halaman 1,
 * sementara berita lain TIDAK PERNAH muncul di halaman mana pun.
 *
 * Karena id itu unik, menambahkannya di akhir membuat urutannya pasti.
 */
export const SORT_ORDER = 'published_at DESC NULLS LAST, id DESC';

const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 100;

export interface SearchParams {
  /** Kata kunci, dicari di judul dan isi berita. */
  q: string | null;
  /** Slug sumber yang sudah diseragamkan, mis. 'thestar'. */
  source: string | null;
  /** Batas awal rentang tanggal (inklusif), sebagai teks ISO UTC. */
  from: string | null;
  /** Batas akhir rentang tanggal (eksklusif), sebagai teks ISO UTC. */
  to: string | null;
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
  filters: {
    q: string | null;
    source: string | null;
    from: string | null;
    to: string | null;
    catatan?: string;
  };
  data: SearchRow[];
}

// ===========================================================================
// Membaca dan memeriksa parameter dari URL
// ===========================================================================

/**
 * Membaca satu batas tanggal.
 *
 * Menggunakan ulang parsePublishedAt(), pembaca tanggal yang sama dengan yang
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

/**
 * Membaca satu parameter angka, dengan batas bawah dan atas.
 * Dibatasi supaya satu permintaan tidak bisa meminta sejuta baris sekaligus
 * dan membuat server kepayahan.
 */
function parseAngka(
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
    return { angka: null, error: `${nama}=${angka} di luar rentang yang diizinkan (${min}-${max}).` };
  }
  return { angka, error: null };
}

/** Mengambil satu nilai teks dari parameter URL, atau null kalau kosong. */
function ambilTeks(nilai: unknown): string | null {
  if (typeof nilai !== 'string') return null;
  const bersih = nilai.trim();
  return bersih.length > 0 ? bersih : null;
}

export function parseSearchQuery(query: Record<string, unknown>): {
  params: SearchParams;
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
    errors.push(`rentang tanggalnya terbalik: from (${fromRaw}) lebih baru daripada to (${toRaw}).`);
  }

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

  return { params: { q, source, from, to, limit, offset }, errors };
}

// ===========================================================================
// Menjalankan pencarian
// ===========================================================================

/**
 * Menyusun bagian WHERE beserta nilai-nilainya.
 *
 * Semua nilai dimasukkan sebagai parameter bernomor ($1, $2, ...), TIDAK
 * pernah ditempel langsung ke dalam teks SQL. Itu yang membuat SQL injection
 * mustahil: PostgreSQL menerima nilainya sebagai data, bukan sebagai perintah.
 */
function buildWhere(params: SearchParams): { sql: string; values: unknown[] } {
  const syarat: string[] = [];
  const values: unknown[] = [];

  if (params.q !== null) {
    // websearch_to_tsquery membuat kotak pencarian kita berperilaku seperti
    // mesin pencari yang sudah dikenal orang: beberapa kata berarti "semuanya
    // harus ada", tanda kutip berarti frasa utuh, tanda minus berarti kecuali.
    //
    // Dipilih daripada to_tsquery karena to_tsquery melempar error kalau
    // pemakai mengetik tanda baca sembarangan. Pencarian tidak boleh error
    // hanya karena orang mengetik "ringgit!!".
    values.push(params.q);
    syarat.push(`m.search_tsv @@ websearch_to_tsquery('simple', $${values.length})`);
  }

  if (params.source !== null) {
    values.push(params.source);
    syarat.push(`s.slug = $${values.length}`);
  }

  // Saringan tanggal: batas awal inklusif, batas akhir eksklusif.
  //
  // Berita yang published_at-nya NULL otomatis TIDAK ikut, karena
  // perbandingan apa pun dengan NULL hasilnya bukan "benar".
  //
  // Itu memang yang kita inginkan, dan alasannya: kita tidak bisa membuktikan
  // berita tanpa tanggal berada di dalam rentang yang diminta. Memasukkannya
  // berarti mengarang. Berita itu tetap ada di database dan tetap ketemu
  // kalau saringan tanggalnya dilepas.
  if (params.from !== null) {
    values.push(params.from);
    syarat.push(`m.published_at >= $${values.length}`);
  }

  if (params.to !== null) {
    values.push(params.to);
    syarat.push(`m.published_at < $${values.length}`);
  }

  return {
    sql: syarat.length > 0 ? `WHERE ${syarat.join(' AND ')}` : '',
    values,
  };
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

  // Dua perintah SQL: satu untuk mengambil isi halaman, satu untuk menghitung
  // totalnya.
  //
  // Sebenarnya bisa jadi satu perintah dengan count(*) OVER (), tapi cara itu
  // punya lubang: kalau offset-nya melewati baris terakhir, tidak ada baris
  // yang kembali, sehingga totalnya ikut hilang dan terbaca 0. Dua perintah
  // selalu benar, dengan harga satu perjalanan tambahan ke database.
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
    // Yang dikirim adalah content_clean, BUKAN content_raw. Data mentah masih
    // berisi HTML dan pernah berisi kode berbahaya, jadi tidak pernah
    // dikeluarkan lewat API. Aslinya tetap tersimpan di database untuk
    // keperluan penelusuran.
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
    filters.catatan =
      'Berita yang tidak punya tanggal terbit tidak ikut dalam hasil bersaringan tanggal, ' +
      'karena tidak bisa dipastikan berada di dalam rentangnya. Lepas saringan tanggal untuk melihatnya.';
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
