/**
 * Merapikan alamat link, supaya dua link ke artikel yang sama jadi persis
 * sama.
 */

/**
 * Parameter yang menandai asal klik/kampanye iklan, bukan menandai artikelnya.
 * Dua link yang bedanya hanya di sini sebenarnya link ke artikel yang sama.
 */
const TRACKING_PARAM = /^(utm_|fb_)|^(fbclid|gclid|igshid|ref|ref_src|source)$/i;

/**
 * Mengembalikan bentuk link yang sudah seragam, atau null kalau bukan link
 * http/https yang layak.
 *
 * Yang dirapikan: nama host jadi huruf kecil, "www." dibuang, tanda pagar
 * (#bagian) dibuang, parameter iklan dibuang, parameter sisanya diurutkan,
 * dan garis miring di ujung dibuang.
 *
 * Huruf besar-kecil di BAGIAN JALUR sengaja dibiarkan, karena sebagian server
 * membedakannya, dan menyeragamkannya bisa menggabungkan dua artikel yang
 * sebenarnya berbeda.
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

/** Mengambil nama host dari sebuah link, mis. "thestar.com.my". */
export function getHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value.trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
