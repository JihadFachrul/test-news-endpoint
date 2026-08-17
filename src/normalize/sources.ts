/**
 * Menyeragamkan nama koran / platform.
 *
 * Di data feed, satu koran ditulis bermacam-macam:
 *     "The Star"  /  "thestar"
 *     "Malaysiakini"  /  "malaysiakini "   <- ada spasi di ujung
 *     "twitter"  /  "TWITTER"
 *
 * Kalau dibiarkan, endpoint /mentions/stats?group_by=source akan melaporkan
 * satu koran sebagai dua koran, dan grafik dashboard-nya jadi salah.
 */
import { getHost } from './url.js';

export type Platform = 'news' | 'twitter' | 'facebook' | 'instagram' | 'other';

export interface Source {
  slug: string;
  displayName: string;
  platform: Platform;
}

/** Daftar koran/platform yang sudah kita kenali. */
const KNOWN: Record<string, Source> = {
  thestar: { slug: 'thestar', displayName: 'The Star', platform: 'news' },
  nst: { slug: 'nst', displayName: 'New Straits Times', platform: 'news' },
  malaysiakini: { slug: 'malaysiakini', displayName: 'Malaysiakini', platform: 'news' },
  bernama: { slug: 'bernama', displayName: 'Bernama', platform: 'news' },
  twitter: { slug: 'twitter', displayName: 'Twitter / X', platform: 'twitter' },
  facebook: { slug: 'facebook', displayName: 'Facebook', platform: 'facebook' },
  instagram: { slug: 'instagram', displayName: 'Instagram', platform: 'instagram' },
};

/**
 * Dari nama host link -> koran mana.
 * Nama host itu BUKTI (link-nya benar-benar ke situ), sedangkan kolom "source"
 * hanya PENGAKUAN yang ditulis penyedia data.
 */
const BY_HOST: Record<string, string> = {
  'thestar.com.my': 'thestar',
  'nst.com.my': 'nst',
  'malaysiakini.com': 'malaysiakini',
  'bernama.com': 'bernama',
  'twitter.com': 'twitter',
  'x.com': 'twitter',
  'facebook.com': 'facebook',
  'instagram.com': 'instagram',
};

/** Dari tulisan bebas di kolom "source" -> koran mana. */
const BY_LABEL: Record<string, string> = {
  'the star': 'thestar',
  thestar: 'thestar',
  'new straits times': 'nst',
  nst: 'nst',
  malaysiakini: 'malaysiakini',
  'malaysia kini': 'malaysiakini',
  bernama: 'bernama',
  twitter: 'twitter',
  x: 'twitter',
  facebook: 'facebook',
  fb: 'facebook',
  instagram: 'instagram',
  ig: 'instagram',
};

/**
 * Menyamakan bentuk tulisan sebelum dicocokkan: huruf kecil semua, tanda baca
 * jadi spasi, spasi berlebih dirapatkan.
 *
 * Ini yang membuat "malaysiakini " (dengan spasi di ujung), "Malaysiakini",
 * dan "MALAYSIAKINI" semuanya cocok ke satu baris yang sama.
 */
function simplify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Menentukan koran/platform dari sebuah record.
 *
 * URUTAN PENGECEKAN: nama host link DULU, baru tulisan di kolom "source".
 *
 * Alasannya ada di datanya: record "nst-40021" punya ID berlabel NST dan
 * kolom source berisi "thestar", tapi URL-nya thestar.com.my. Keterangan dari
 * penyedia data bisa keliru; alamat tempat artikelnya benar-benar tinggal
 * tidak bisa keliru.
 *
 * Keterbatasan yang kita terima: kalau link-nya berasal dari situs pengumpul
 * berita (misalnya news.google.com), yang terbaca adalah si pengumpul, bukan
 * korannya. Tidak ada kasus seperti itu di data ini.
 */
export function normalizeSource(label: unknown, url: unknown): Source {
  const host = getHost(url);
  if (host) {
    // Dicocokkan juga untuk subdomain, mis. "amp.thestar.com.my".
    const match = Object.keys(BY_HOST).find((known) => host === known || host.endsWith(`.${known}`));
    const known = match ? KNOWN[BY_HOST[match] as string] : undefined;
    if (known) return known;
  }

  if (typeof label === 'string' && label.trim().length > 0) {
    const simple = simplify(label);
    const known = KNOWN[BY_LABEL[simple] ?? ''];
    if (known) return known;

    // Belum dikenali, tapi jelas ada namanya: dijadikan koran tersendiri.
    //
    // Sengaja TIDAK dilempar ke satu keranjang "lain-lain", karena itu akan
    // menggabungkan koran-koran yang sebenarnya berbeda dan membuat laporan
    // jangkauan berita jadi lebih kecil dari kenyataan.
    if (simple.length > 0) {
      return {
        slug: simple.replace(/\s+/g, '-'),
        displayName: label.trim().replace(/\s+/g, ' '),
        platform: 'other',
      };
    }
  }

  return { slug: 'unknown', displayName: 'Tidak diketahui', platform: 'other' };
}
