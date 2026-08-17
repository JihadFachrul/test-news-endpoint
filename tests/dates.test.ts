import { describe, expect, it } from 'vitest';
import { parsePublishedAt } from '../src/normalize/dates.js';

/** Pembantu: ambil hasil tanggalnya saja. */
function baca(nilai: unknown): string | null {
  return parsePublishedAt(nilai).iso;
}

describe('membaca tanggal', () => {
  it('bentuk ISO dengan huruf Z (sudah jelas UTC)', () => {
    expect(baca('2026-08-10T08:15:00Z')).toBe('2026-08-10T08:15:00.000Z');
  });

  it('bentuk ISO dengan selisih zona, diubah ke UTC', () => {
    // Jam 14:02:33 di zona UTC+8 sama dengan jam 06:02:33 UTC.
    expect(baca('2026-08-11T14:02:33+08:00')).toBe('2026-08-11T06:02:33.000Z');
  });

  it('bentuk tanpa zona waktu dibaca sebagai UTC', () => {
    // Aturan inilah yang membuat nst-40021 tercatat 5 menit SETELAH kembarannya
    // str-99120, bukan 8 jam sebelumnya.
    expect(baca('2026-08-10 08:20:00')).toBe('2026-08-10T08:20:00.000Z');
    expect(parsePublishedAt('2026-08-10 08:20:00').format).toBe('iso-tanpa-zona');
  });

  it('angka detik Unix', () => {
    expect(baca(1786435200)).toBe('2026-08-11T08:00:00.000Z');
  });

  it('angka milidetik Unix', () => {
    expect(baca(1786435200000)).toBe('2026-08-11T08:00:00.000Z');
  });

  it('tanggal ambigu dibaca hari-dulu, menurut waktu Malaysia', () => {
    // "11/08/2026" = 11 Agustus, bukan 8 November.
    // Tengah malam di UTC+8 sama dengan jam 16:00 UTC hari sebelumnya.
    expect(baca('11/08/2026')).toBe('2026-08-10T16:00:00.000Z');
    expect(parsePublishedAt('11/08/2026').format).toBe('hari-bulan-tahun');
  });

  it('kebiasaan hari-dulu dikalahkan kalau angkanya sudah menentukan sendiri', () => {
    // 25 tidak mungkin nama bulan, jadi keduanya berarti 25 Desember.
    expect(baca('25/12/2026')).toBe('2026-12-24T16:00:00.000Z');
    expect(baca('12/25/2026')).toBe('2026-12-24T16:00:00.000Z');
  });

  it('tanggal yang memang tidak ada dilaporkan kosong, bukan dikarang', () => {
    expect(parsePublishedAt(null)).toEqual({ iso: null, format: 'tidak-ada' });
    expect(parsePublishedAt(undefined)).toEqual({ iso: null, format: 'tidak-ada' });
    expect(parsePublishedAt('   ')).toEqual({ iso: null, format: 'tidak-ada' });
  });

  it('tulisan ngawur dan tanggal mustahil ditolak, tidak ditebak', () => {
    expect(parsePublishedAt('minggu lalu')).toEqual({ iso: null, format: 'gagal-dibaca' });
    // 31 Februari tidak ada. JavaScript diam-diam menggesernya ke 2 Maret.
    expect(parsePublishedAt('31/02/2026')).toEqual({ iso: null, format: 'gagal-dibaca' });
    expect(baca('2026-13-01T00:00:00Z')).toBeNull();
  });

  it('tanggal di luar rentang masuk akal ditolak', () => {
    // Angka detik yang salah dibaca sebagai milidetik akan mendarat di 1970.
    expect(baca(1786435)).toBeNull();
  });
});
