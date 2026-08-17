/**
 * Membersihkan teks: HTML -> teks biasa.
 *
 * Kotoran yang ditangani di sini (semuanya benar-benar ada di data):
 *   <p>...</p>                      tag pembungkus
 *   <div class="article">...        tag dengan atribut
 *   &nbsp;  &quot;                  kode entity HTML
 *   <script>alert(1)</script>       kode berbahaya yang diselipkan
 *
 * Semua bagian lain program membaca hasil dari file ini, jadi di sinilah
 * diputuskan "sebenarnya teks berita ini apa".
 */

/**
 * Tag yang ISINYA bukan teks bacaan, melainkan kode.
 * Isinya ikut dibuang, bukan cuma tag pembukanya.
 */
const DANGEROUS_TAG = /<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** Tag berbahaya yang tidak punya penutup (potongan kode yang terputus). */
const DANGEROUS_TAG_OPEN = /<\/?(script|style|iframe)\b[^>]*>/gi;

/**
 * Tag pemisah paragraf. Diganti SPASI, bukan dihapus, supaya
 * "<p>satu</p><p>dua</p>" terbaca "satu dua" dan bukan "satudua".
 */
const PARAGRAPH_TAG = /<\/?(p|div|br|li|tr|td|h[1-6]|blockquote)\b[^>]*>/gi;

/**
 * Sisa tag apa pun. Harus ada huruf tepat setelah "<", supaya tulisan biasa
 * seperti "5 < 10 > 3" tidak ikut terhapus.
 */
const OTHER_TAG = /<\/?[a-z][a-z0-9-]*\b[^>]*>/gi;

/**
 * Semua jenis spasi, termasuk yang tidak kelihatan di editor:
 * U+00A0 (hasil terjemahan &nbsp;), U+200B (spasi tanpa lebar), U+FEFF (BOM).
 */
const ALL_WHITESPACE = /[\s ​﻿]+/g;

/** Terjemahan kode entity HTML yang benar-benar muncul di data feed. */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

/** Mengubah &nbsp; &quot; &#39; &#x27; menjadi karakter aslinya. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (original, body: string) => {
    if (!body.startsWith('#')) {
      return ENTITIES[body.toLowerCase()] ?? original;
    }

    const isHex = body[1]?.toLowerCase() === 'x';
    const code = isHex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);

    // Angka di luar jangkauan membuat String.fromCodePoint melempar error.
    // Satu entity rusak tidak boleh menggagalkan seluruh proses impor data.
    const isSurrogate = code >= 0xd800 && code <= 0xdfff;
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || isSurrogate) {
      return original;
    }
    return String.fromCodePoint(code);
  });
}

/** Merapatkan spasi berlebih menjadi satu spasi, lalu memangkas ujungnya. */
export function cleanWhitespace(text: string): string {
  return text.replace(ALL_WHITESPACE, ' ').trim();
}

/**
 * Mengubah potongan HTML (atau teks biasa) menjadi teks bersih yang aman
 * ditampilkan.
 *
 * Urutannya penting: buang tag -> terjemahkan entity -> BUANG TAG SEKALI LAGI.
 *
 * Kenapa dibuang dua kali? Karena teks seperti
 *     &lt;script&gt;alert(1)&lt;/script&gt;
 * saat datang masih jinak (cuma tulisan biasa), tapi begitu entity-nya
 * diterjemahkan ia BERUBAH menjadi tag <script> yang hidup. Dan hasil fungsi
 * inilah yang nanti ditampilkan di halaman dashboard.
 */
export function htmlToText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '';

  let text = value
    .replace(DANGEROUS_TAG, ' ')
    .replace(DANGEROUS_TAG_OPEN, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(PARAGRAPH_TAG, ' ')
    .replace(OTHER_TAG, '');

  text = decodeEntities(text);

  // Penjagaan kedua, untuk kode berbahaya yang tadinya bersembunyi di balik
  // entity HTML.
  text = text.replace(DANGEROUS_TAG, ' ').replace(DANGEROUS_TAG_OPEN, ' ').replace(OTHER_TAG, '');

  return cleanWhitespace(text);
}

/**
 * Menganggap null, undefined, "" dan "   " sebagai hal yang sama: tidak ada.
 *
 * Data feed memakai keempatnya. Judul tweet berisi null, tapi judul postingan
 * Facebook berisi "" (teks kosong). Keduanya sama-sama berarti "tidak ada
 * judul", jadi hanya satu bentuk yang boleh masuk database: NULL.
 */
export function emptyToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = cleanWhitespace(value);
  return cleaned.length > 0 ? cleaned : null;
}
