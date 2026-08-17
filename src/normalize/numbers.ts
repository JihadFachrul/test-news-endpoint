/**
 * Merapikan angka.
 *
 * Kolom engagement di data feed kadang berupa angka (412), kadang berupa teks
 * bertanda koma ribuan ("1,204", "3,402"), kadang tidak ada.
 *
 * Harus disimpan sebagai bilangan asli, karena kalau tetap teks maka
 * pengurutan jadi salah: sebagai teks, "9" dianggap LEBIH BESAR daripada
 * "1,204" (karena huruf "9" datang setelah "1").
 */
export function parseEngagement(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value);
  }

  if (typeof value === 'string') {
    // Membuang pemisah ribuan: "1,204" -> "1204", "1 204" -> "1204".
    //
    // Titik SENGAJA tidak dibuang. "1.204" bisa berarti seribu dua ratus empat
    // (gaya Indonesia) atau satu koma dua nol empat (gaya Inggris), dan
    // menebaknya berisiko mengubah angka seribu kali lipat.
    const cleaned = value.replace(/[\s,_']/g, '');
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
    return Math.round(Number(cleaned));
  }

  return null;
}
