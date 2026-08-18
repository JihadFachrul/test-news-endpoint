/** Menyeragamkan alamat link, supaya dua link ke artikel yang sama jadi sama. */

/** Parameter yang menandai kampanye iklan, bukan artikelnya. */
const TRACKING_PARAM = /^(utm_|fb_)|^(fbclid|gclid|igshid|ref|ref_src|source)$/i;

/**
 * Host jadi huruf kecil, "www." dibuang, tanda pagar dibuang, parameter iklan
 * dibuang, sisanya diurutkan, garis miring di ujung dibuang.
 *
 * Huruf besar-kecil di jalur dibiarkan: sebagian server membedakannya, dan
 * menyeragamkannya bisa menggabungkan dua artikel yang berbeda.
 */
export function canonicalizeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '');

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAM.test(key))
    .sort(([a], [b]) => a.localeCompare(b));

  const query = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : '';

  return `${host}${path}${query}`;
}

export function getHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value.trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
