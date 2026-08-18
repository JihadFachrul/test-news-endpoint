/**
 * Menyeragamkan nama koran. Di data feed satu koran ditulis bermacam ejaan
 * ("The Star"/"thestar", "malaysiakini " berspasi, "twitter"/"TWITTER"), dan
 * kalau dibiarkan, group_by=source akan menghitungnya sebagai beberapa koran.
 */
import { getHost } from './url.js';

export type Platform = 'news' | 'twitter' | 'facebook' | 'instagram' | 'other';

export interface Source {
  slug: string;
  displayName: string;
  platform: Platform;
}

const KNOWN: Record<string, Source> = {
  thestar: { slug: 'thestar', displayName: 'The Star', platform: 'news' },
  nst: { slug: 'nst', displayName: 'New Straits Times', platform: 'news' },
  malaysiakini: { slug: 'malaysiakini', displayName: 'Malaysiakini', platform: 'news' },
  bernama: { slug: 'bernama', displayName: 'Bernama', platform: 'news' },
  twitter: { slug: 'twitter', displayName: 'Twitter / X', platform: 'twitter' },
  facebook: { slug: 'facebook', displayName: 'Facebook', platform: 'facebook' },
  instagram: { slug: 'instagram', displayName: 'Instagram', platform: 'instagram' },
};

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

/** Huruf kecil, tanda baca jadi spasi. Ini yang menutup ejaan berspasi/kapital. */
function simplify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Host URL dicek DULU, baru kolom source. Record nst-40021 punya ID berlabel
 * NST dan source "thestar" tapi URL-nya thestar.com.my: keterangan penyedia
 * data bisa keliru, alamat tempat artikelnya tinggal tidak.
 *
 * Keterbatasan: untuk link dari situs pengumpul berita (news.google.com), yang
 * terbaca si pengumpul. Tidak ada kasus itu di data ini.
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

    // Belum dikenali tapi jelas ada namanya: jadi koran tersendiri. Kalau
    // semuanya dilempar ke satu keranjang, koran yang berbeda akan tergabung
    // dan laporan jangkauan jadi lebih kecil dari kenyataan.
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
