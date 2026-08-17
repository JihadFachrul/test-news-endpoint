/**
 * ATURAN DUPLIKAT  <- bagian terpenting dari tes ini
 *
 * Brief sengaja TIDAK memberi tahu apa itu "duplikat". Mereka ingin lihat cara
 * kita berpikir. Ini keputusannya, beserta alasannya.
 *
 * ---------------------------------------------------------------------------
 * DI DATA ADA EMPAT TINGKAT KEMIRIPAN
 * ---------------------------------------------------------------------------
 *
 *   Tingkat 1  ID dan koran sama persis          str-99120 muncul 2x
 *   Tingkat 2  URL sama, ID & nama koran beda    str-99120 vs nst-40021
 *   Tingkat 3  Isi sama, koran sama, URL beda    mkn-1201 vs mkn-1202
 *   Tingkat 4  Berita sama, KORAN BEDA           The Star vs NST soal turis
 *
 * Tingkat 1-3 dianggap SATU berita.  Tingkat 4 dianggap DUA berita.
 *
 * Tingkat 4 adalah garis merahnya. Godaannya besar untuk menggabungkan, tapi
 * justru di situ nilai produknya: alat pemantau media ada supaya analis PR
 * tahu BERAPA KORAN yang mengangkat beritanya. Kalau digabung, metrik paling
 * penting bagi pengguna malah terhapus.
 *
 * Prinsipnya: duplikat yang lolos itu cuma berisik, tapi data yang hilang itu
 * bohong. Kita pilih berisik.
 *
 * ---------------------------------------------------------------------------
 * ATURANNYA
 * ---------------------------------------------------------------------------
 *
 *   dedupe_key = sha256( slug_koran + "|" + sidik_jari(judul atau isi) )
 *
 * Memasukkan slug_koran ke dalam hash adalah pengaman utamanya: dua koran
 * berbeda jadi MUSTAHIL tergabung, sedekat apa pun tulisannya.
 *
 * ---------------------------------------------------------------------------
 * KENAPA BUKAN external_id?
 * ---------------------------------------------------------------------------
 * Karena terbukti bohong. Record "nst-40021" punya ID berlabel NST, padahal
 * URL-nya thestar.com.my.
 *
 * ---------------------------------------------------------------------------
 * KENAPA BUKAN URL?
 * ---------------------------------------------------------------------------
 * Karena mkn-1201 dan mkn-1202 itu artikel yang sama di dua URL berbeda
 * (/news/1201 dan /news/1202). URL itu ALAMAT, bukan IDENTITAS, dan sistem
 * penerbitan berita rutin mengganti alamat. Judul + nama koran lebih stabil.
 *
 * URL tetap disimpan di database (kolom canonical_url) untuk penelusuran.
 * Memakainya sebagai pemeriksa kedua -- untuk kasus sebaliknya, yaitu URL sama
 * tapi judulnya diedit redaksi -- sengaja BELUM dikerjakan supaya aturannya
 * tetap satu dan mudah dijelaskan. Itu masuk daftar "kalau ada waktu seminggu
 * lagi" di README.
 */
import { createHash } from 'node:crypto';

/**
 * Berapa banyak huruf teks yang dipakai untuk sidik jari.
 *
 * Cukup panjang supaya dua artikel berbeda hampir mustahil kebetulan sama;
 * cukup pendek supaya tambahan kecil di ujung (misalnya "...kata Tourism
 * Malaysia.") tidak melahirkan berita "baru" yang sebenarnya sama.
 */
const FINGERPRINT_LENGTH = 300;

/**
 * Menyisakan bagian teks yang membawa makna saja: huruf kecil semua, tanda
 * baca dan emoji dibuang, spasi dirapatkan.
 *
 * Inilah yang menutup kasus-kasus "beda tipis" di data:
 *
 *   "Ringgit strengthens against US dollar in early trade"
 *   "Ringgit Strengthens Against US Dollar In Early Trade"   -> jadi sama
 *
 *   "Analysts split on second-half GDP outlook"
 *   "Analysts split on second half GDP outlook"              -> jadi sama
 *                     ^ bedanya cuma satu tanda hubung
 */
export function fingerprint(text: string): string {
  return (
    text
      .toLowerCase()
      // \p{L} = huruf apa pun, \p{N} = angka apa pun. Berlaku untuk semua
      // bahasa, jadi teks Melayu tetap utuh dan emoji tidak ikut dihitung.
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .slice(0, FINGERPRINT_LENGTH)
      .trim()
  );
}

export interface DedupeInput {
  sourceSlug: string;
  title: string | null;
  contentClean: string;
  canonicalUrl: string | null;
  externalId: string | null;
}

/**
 * Menghitung kunci identitas satu berita.
 *
 * Judul dipakai lebih dulu, karena judul adalah ringkasan paling stabil dari
 * sebuah artikel dan tidak berubah walau isinya disunting.
 *
 * Postingan media sosial tidak punya judul, jadi untuk mereka isi postingan
 * itulah judulnya.
 *
 * Kalau tidak punya judul MAUPUN isi -- tidak ada di data ini, tapi pipeline
 * sungguhan pasti akan mengalaminya -- baru jatuh ke URL, lalu ke ID penyedia.
 * Tanpa cadangan ini, semua record tanpa teks akan punya kunci yang sama
 * (hash dari teks kosong) dan saling menghapus satu sama lain.
 */
export function buildDedupeKey(input: DedupeInput): string {
  const fromTitle = input.title ? fingerprint(input.title) : '';
  if (fromTitle.length > 0) return hash(input.sourceSlug, fromTitle);

  const fromContent = fingerprint(input.contentClean);
  if (fromContent.length > 0) return hash(input.sourceSlug, fromContent);

  if (input.canonicalUrl) return hash(input.sourceSlug, `url:${input.canonicalUrl}`);

  return hash(input.sourceSlug, `id:${input.externalId ?? ''}`);
}

function hash(sourceSlug: string, material: string): string {
  return createHash('sha256').update(`${sourceSlug}|${material}`).digest('hex');
}
