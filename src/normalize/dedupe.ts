/**
 * Aturan duplikat.
 *
 *   dedupe_key = sha256( slug_koran + "|" + sidik_jari(judul atau isi) )
 *
 * Di data ada empat tingkat kemiripan, dan aturan ini berhenti di tingkat 3:
 *
 *   1. ID dan koran sama persis         str-99120 dua kali      -> satu berita
 *   2. URL sama, ID & nama beda         str-99120 vs nst-40021  -> satu berita
 *   3. isi sama, koran sama, URL beda   mkn-1201 vs mkn-1202    -> satu berita
 *   4. berita sama, KORAN BEDA          thestar vs nst          -> DUA berita
 *
 * Tingkat 4 adalah garisnya: alat pemantau media ada supaya analis tahu berapa
 * koran yang mengangkat beritanya, jadi menggabungkan antar koran menghapus
 * metrik utamanya. Memasukkan slug koran ke dalam hash membuat itu mustahil.
 *
 * external_id tidak dipakai karena terbukti keliru (nst-40021 sebenarnya
 * artikel The Star). URL tidak dipakai karena mkn-1201 dan mkn-1202 satu
 * artikel di dua URL; URL itu alamat, bukan identitas. Alasan lengkapnya ada
 * di README.
 */
import { createHash } from 'node:crypto';

/**
 * Cukup panjang supaya dua artikel berbeda tidak kebetulan sama, cukup pendek
 * supaya tambahan di ujung ("...kata Tourism Malaysia") tidak dianggap baru.
 */
const FINGERPRINT_LENGTH = 300;

/**
 * Menyisakan bagian yang membawa makna. Ini yang menutup beda tipis di data:
 * "second-half" dan "second half" jadi sama, begitu juga judul yang bedanya
 * cuma huruf besar-kecil.
 */
export function fingerprint(text: string): string {
  return (
    text
      .toLowerCase()
      // \p{L} huruf apa pun, \p{N} angka apa pun: teks Melayu utuh, emoji tidak
      // ikut menentukan identitas.
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
 * Judul dipakai lebih dulu karena paling stabil terhadap penyuntingan isi.
 * Postingan sosmed tidak punya judul, jadi isinya yang dipakai.
 *
 * Cadangan URL dan ID untuk record tanpa teks sama sekali: tanpa itu semuanya
 * akan berbagi kunci yang sama (hash teks kosong) dan saling menghapus.
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
