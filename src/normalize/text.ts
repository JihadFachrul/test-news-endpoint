/**
 * HTML -> teks biasa. Data feed mengirim tag pembungkus, entity (&nbsp;,
 * &quot;), dan satu record menyelipkan <script>alert(1)</script>.
 */

/** Tag yang isinya kode, bukan teks bacaan. Isinya ikut dibuang. */
const DANGEROUS_TAG = /<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const DANGEROUS_TAG_OPEN = /<\/?(script|style|iframe)\b[^>]*>/gi;

/** Diganti spasi, bukan dihapus, supaya "<p>a</p><p>b</p>" tidak jadi "ab". */
const PARAGRAPH_TAG = /<\/?(p|div|br|li|tr|td|h[1-6]|blockquote)\b[^>]*>/gi;

/** Harus ada huruf setelah "<", supaya "5 < 10 > 3" tidak ikut terhapus. */
const OTHER_TAG = /<\/?[a-z][a-z0-9-]*\b[^>]*>/gi;

/** Termasuk yang tak terlihat di editor: NBSP, zero-width space, BOM. */
const ALL_WHITESPACE = /[\s ​﻿]+/g;

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

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (original, body: string) => {
    if (!body.startsWith('#')) {
      return ENTITIES[body.toLowerCase()] ?? original;
    }

    const isHex = body[1]?.toLowerCase() === 'x';
    const code = isHex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);

    // Angka di luar jangkauan membuat String.fromCodePoint melempar error, dan
    // satu entity rusak tidak boleh menggagalkan seluruh impor.
    const isSurrogate = code >= 0xd800 && code <= 0xdfff;
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || isSurrogate) {
      return original;
    }
    return String.fromCodePoint(code);
  });
}

export function cleanWhitespace(text: string): string {
  return text.replace(ALL_WHITESPACE, ' ').trim();
}

export function htmlToText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '';

  let text = value
    .replace(DANGEROUS_TAG, ' ')
    .replace(DANGEROUS_TAG_OPEN, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(PARAGRAPH_TAG, ' ')
    .replace(OTHER_TAG, '');

  text = decodeEntities(text);

  // Tag dibuang lagi setelah entity diterjemahkan: teks
  // "&lt;script&gt;" masih jinak saat datang, tapi berubah jadi tag hidup
  // begitu diterjemahkan, dan hasil inilah yang ditampilkan di dashboard.
  text = text.replace(DANGEROUS_TAG, ' ').replace(DANGEROUS_TAG_OPEN, ' ').replace(OTHER_TAG, '');

  return cleanWhitespace(text);
}

/**
 * null, undefined, "" dan "   " sama-sama berarti tidak ada. Data feed memakai
 * keempatnya: judul tweet null, judul Facebook "".
 */
export function emptyToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = cleanWhitespace(value);
  return cleaned.length > 0 ? cleaned : null;
}
