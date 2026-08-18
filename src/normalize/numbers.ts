/**
 * engagement kadang datang sebagai angka (412), kadang sebagai teks berkoma
 * ("1,204"). Disimpan sebagai bilangan, karena sebagai teks "9" akan dianggap
 * lebih besar daripada "1,204".
 */
export function parseEngagement(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value);
  }

  if (typeof value === 'string') {
    // Titik sengaja tidak dibuang: "1.204" bisa berarti seribu dua ratus empat
    // atau satu koma dua nol empat, dan menebaknya meleset seribu kali lipat.
    const cleaned = value.replace(/[\s,_']/g, '');
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
    return Math.round(Number(cleaned));
  }

  return null;
}
