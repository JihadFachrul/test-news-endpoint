/**
 * Merapikan tanggal.
 *
 * Di seed_mentions.json, kolom published_at datang dalam ENAM bentuk berbeda:
 *
 *   "2026-08-10T08:15:00Z"        ISO, jelas UTC (huruf Z)
 *   "2026-08-10 08:20:00"         tanpa keterangan zona waktu sama sekali
 *   1786435200                    angka detik Unix
 *   "2026-08-11T14:02:33+08:00"   ISO, dengan selisih zona +08:00
 *   "11/08/2026"                  gaya lokal, ambigu
 *   null                          memang tidak ada
 *
 * Semuanya harus jadi SATU titik waktu yang pasti, atau jadi null.
 * Tidak boleh jadi tebakan yang penampakannya seperti data asli.
 */

/**
 * Malaysia itu UTC+8 dan tidak pernah punya daylight saving (sejak 1935).
 * Jadi selisih tetap 8 jam sudah tepat, dan kita tidak perlu memasang library
 * zona waktu tambahan.
 */
export const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Di luar rentang ini berarti hasil salah baca, bukan tanggal terbit berita. */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** Keterangan bentuk mana yang cocok. Dipakai untuk pesan peringatan. */
export type DateFormat =
  | 'iso-dengan-zona'
  | 'iso-tanpa-zona'
  | 'angka-unix'
  | 'tanggal-saja'
  | 'hari-bulan-tahun'
  | 'tidak-ada'
  | 'gagal-dibaca';

export interface ParsedDate {
  /** Hasil dalam bentuk teks ISO UTC, mis. '2026-08-10T08:15:00.000Z'. */
  iso: string | null;
  format: DateFormat;
}

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})$/i;
const ISO_NO_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const SLASHED = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;
const ONLY_DIGITS = /^\d{10,13}$/;

/** Menerima hasil hanya kalau tanggalnya masih masuk akal. */
function accept(date: Date, format: DateFormat): ParsedDate {
  const time = date.getTime();
  if (Number.isNaN(time)) return { iso: null, format: 'gagal-dibaca' };

  const year = date.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) return { iso: null, format: 'gagal-dibaca' };

  return { iso: date.toISOString(), format };
}

/** Tengah malam menurut kalender Malaysia, diubah jadi titik waktu UTC. */
function malaysiaMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - MALAYSIA_OFFSET_MS);
}

/** Mengubah angka detik/milidetik Unix menjadi tanggal. */
function fromUnix(value: number): ParsedDate {
  if (!Number.isFinite(value)) return { iso: null, format: 'gagal-dibaca' };
  // Angka di atas 100 miliar sudah pasti milidetik, bukan detik.
  const isMillis = Math.abs(value) > 1e11;
  return accept(new Date(isMillis ? value : value * 1000), 'angka-unix');
}

export function parsePublishedAt(value: unknown): ParsedDate {
  if (value === null || value === undefined) return { iso: null, format: 'tidak-ada' };

  if (typeof value === 'number') return fromUnix(value);

  if (typeof value !== 'string') return { iso: null, format: 'gagal-dibaca' };

  const text = value.trim();
  if (text.length === 0) return { iso: null, format: 'tidak-ada' };

  // --- angka Unix yang dikirim sebagai teks --------------------------------
  if (ONLY_DIGITS.test(text)) return fromUnix(Number(text));

  // --- ISO dengan keterangan zona waktu -----------------------------------
  if (ISO_WITH_ZONE.test(text)) {
    return accept(new Date(text.replace(' ', 'T')), 'iso-dengan-zona');
  }

  // --- ISO TANPA keterangan zona waktu ------------------------------------
  // Dibaca sebagai UTC, BUKAN sebagai waktu Malaysia.
  //
  // Buktinya ada di datanya sendiri: "2026-08-10 08:20:00" (nst-40021) itu
  // artikel yang sama dengan "2026-08-10T08:15:00Z" (str-99120).
  //   - Kalau dibaca UTC     -> jaraknya 5 menit. Wajar, tanda data ditarik
  //                             ulang oleh robot pengumpul.
  //   - Kalau dibaca UTC+8   -> salinannya terbit 8 jam SEBELUM aslinya.
  //                             Mustahil.
  if (ISO_NO_ZONE.test(text)) {
    return accept(new Date(`${text.replace(' ', 'T')}Z`), 'iso-tanpa-zona');
  }

  // --- tanggal tanpa jam ---------------------------------------------------
  // Tanggal tanpa jam itu nilai untuk dibaca manusia, jadi dibaca menurut zona
  // waktu penerbitnya: tengah malam Malaysia, bukan tengah malam UTC. Kalau
  // dibaca UTC, berita subuh di Malaysia akan tercatat di hari sebelumnya.
  if (DATE_ONLY.test(text)) {
    const [year, month, day] = text.split('-').map(Number) as [number, number, number];
    return accept(malaysiaMidnight(year, month, day), 'tanggal-saja');
  }

  // --- tanggal bergaris miring, mis. "11/08/2026" -------------------------
  const parts = SLASHED.exec(text);
  if (parts) {
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    const year = Number(parts[3]);

    // "11/08/2026" itu benar-benar ambigu: 11 Agustus atau 8 November?
    // Diputuskan HARI DULU (11 Agustus), dengan dua alasan:
    //   1. penerbitnya Malaysia, dan Malaysia menulis hari dulu
    //   2. seluruh data di file ini berkumpul di 10-15 Agustus 2026; kalau
    //      dibaca bulan-dulu jadi November, melompat jauh keluar rombongan
    //
    // Tapi kalau salah satu angkanya di atas 12, ambiguitasnya hilang dengan
    // sendirinya dan angka itulah yang menentukan, bukan kebiasaan penulisan.
    let day = first;
    let month = second;
    if (second > 12 && first <= 12) {
      day = second;
      month = first;
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { iso: null, format: 'gagal-dibaca' };
    }

    const result = malaysiaMidnight(year, month, day);

    // Menolak tanggal yang tidak mungkin seperti 31/02. JavaScript tidak
    // menganggapnya error, tapi diam-diam menggesernya ke bulan berikutnya.
    const check = new Date(result.getTime() + MALAYSIA_OFFSET_MS);
    if (check.getUTCDate() !== day || check.getUTCMonth() + 1 !== month) {
      return { iso: null, format: 'gagal-dibaca' };
    }

    return accept(result, 'hari-bulan-tahun');
  }

  return { iso: null, format: 'gagal-dibaca' };
}
