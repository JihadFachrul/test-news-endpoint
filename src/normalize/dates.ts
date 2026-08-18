/**
 * Merapikan published_at. Data feed mengirimnya dalam enam bentuk berbeda;
 * semuanya jadi satu titik waktu UTC, atau null. Tidak pernah jadi tebakan.
 */

/** Malaysia UTC+8, tanpa daylight saving, jadi selisih tetap sudah tepat. */
export const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Di luar rentang ini berarti salah baca, bukan tanggal terbit berita. */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

export type DateFormat =
  | 'iso-dengan-zona'
  | 'iso-tanpa-zona'
  | 'angka-unix'
  | 'tanggal-saja'
  | 'hari-bulan-tahun'
  | 'tidak-ada'
  | 'gagal-dibaca';

export interface ParsedDate {
  /** Teks ISO UTC, mis. '2026-08-10T08:15:00.000Z'. */
  iso: string | null;
  /** Bentuk mana yang cocok. Dipakai untuk pesan peringatan. */
  format: DateFormat;
}

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})$/i;
const ISO_NO_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const SLASHED = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;
const ONLY_DIGITS = /^\d{10,13}$/;

function accept(date: Date, format: DateFormat): ParsedDate {
  if (Number.isNaN(date.getTime())) return { iso: null, format: 'gagal-dibaca' };

  const year = date.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) return { iso: null, format: 'gagal-dibaca' };

  return { iso: date.toISOString(), format };
}

/** Tengah malam kalender Malaysia, sebagai titik waktu UTC. */
function malaysiaMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - MALAYSIA_OFFSET_MS);
}

function fromUnix(value: number): ParsedDate {
  if (!Number.isFinite(value)) return { iso: null, format: 'gagal-dibaca' };
  const isMillis = Math.abs(value) > 1e11; // di atas 100 miliar pasti milidetik
  return accept(new Date(isMillis ? value : value * 1000), 'angka-unix');
}

export function parsePublishedAt(value: unknown): ParsedDate {
  if (value === null || value === undefined) return { iso: null, format: 'tidak-ada' };
  if (typeof value === 'number') return fromUnix(value);
  if (typeof value !== 'string') return { iso: null, format: 'gagal-dibaca' };

  const text = value.trim();
  if (text.length === 0) return { iso: null, format: 'tidak-ada' };

  if (ONLY_DIGITS.test(text)) return fromUnix(Number(text));

  if (ISO_WITH_ZONE.test(text)) {
    return accept(new Date(text.replace(' ', 'T')), 'iso-dengan-zona');
  }

  // Tanpa zona dibaca UTC, bukan waktu Malaysia. Buktinya di data: nst-40021
  // "2026-08-10 08:20:00" adalah artikel yang sama dengan str-99120
  // "2026-08-10T08:15:00Z". Dibaca UTC jaraknya 5 menit; dibaca UTC+8
  // salinannya terbit 8 jam sebelum aslinya.
  if (ISO_NO_ZONE.test(text)) {
    return accept(new Date(`${text.replace(' ', 'T')}Z`), 'iso-tanpa-zona');
  }

  // Tanggal tanpa jam itu nilai untuk manusia, jadi dibaca di zona penerbitnya.
  // Dibaca UTC, berita subuh di Malaysia tercatat di hari sebelumnya.
  if (DATE_ONLY.test(text)) {
    const [year, month, day] = text.split('-').map(Number) as [number, number, number];
    return accept(malaysiaMidnight(year, month, day), 'tanggal-saja');
  }

  const parts = SLASHED.exec(text);
  if (parts) {
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    const year = Number(parts[3]);

    // "11/08/2026" dibaca hari-dulu: penerbitnya Malaysia, dan seluruh data di
    // file ini berkumpul di 10-15 Agustus. Kalau salah satu angka di atas 12,
    // angka itu yang menentukan, bukan kebiasaan penulisan.
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

    // Menolak tanggal mustahil seperti 31/02, yang oleh JavaScript diam-diam
    // digeser ke bulan berikutnya.
    const check = new Date(result.getTime() + MALAYSIA_OFFSET_MS);
    if (check.getUTCDate() !== day || check.getUTCMonth() + 1 !== month) {
      return { iso: null, format: 'gagal-dibaca' };
    }

    return accept(result, 'hari-bulan-tahun');
  }

  return { iso: null, format: 'gagal-dibaca' };
}
