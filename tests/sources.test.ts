/**
 * Semua record di seed_mentions.json punya URL yang hostnya kita kenali, jadi
 * jalur "baca dari nama sumber" tidak pernah dipakai di sana. Padahal jalur
 * itulah yang menangani nama berantakan seperti "malaysiakini " (dengan spasi).
 *
 * Tanpa tes ini, bagian tersebut jadi kode yang tidak pernah teruji dan baru
 * pertama kali berjalan nanti, di data yang belum pernah kita lihat.
 */
import { describe, expect, it } from 'vitest';
import { normalizeSource } from '../src/normalize/sources.js';

describe('menentukan koran dari namanya saja (tanpa URL)', () => {
  it('berbagai ejaan koran yang sama menyatu', () => {
    for (const nama of ['The Star', 'thestar', 'THE STAR', '  the   star  ']) {
      expect(normalizeSource(nama, null).slug, `ejaan ${JSON.stringify(nama)}`).toBe('thestar');
    }
  });

  it('spasi di ujung nama tidak berpengaruh', () => {
    // Bentuk ini benar-benar ada di data: "malaysiakini " dengan spasi.
    expect(normalizeSource('malaysiakini ', null).slug).toBe('malaysiakini');
    expect(normalizeSource('Malaysiakini', null).slug).toBe('malaysiakini');
  });

  it('huruf besar-kecil platform sosmed tidak berpengaruh', () => {
    expect(normalizeSource('twitter', null).slug).toBe('twitter');
    expect(normalizeSource('TWITTER', null).slug).toBe('twitter');
    expect(normalizeSource('TWITTER', null).platform).toBe('twitter');
  });

  it('koran yang belum terdaftar tetap jadi korannya sendiri', () => {
    // Kalau semua yang belum dikenal dilempar ke satu keranjang, koran-koran
    // berbeda akan tergabung dan laporan jangkauan berita jadi terlalu kecil.
    const hasil = normalizeSource('Berita Harian', null);
    expect(hasil.slug).toBe('berita-harian');
    expect(hasil.displayName).toBe('Berita Harian');
  });

  it('hanya jatuh ke "unknown" kalau benar-benar tidak ada petunjuk', () => {
    expect(normalizeSource(null, null).slug).toBe('unknown');
    expect(normalizeSource('', null).slug).toBe('unknown');
  });
});

describe('menentukan koran kalau ada URL', () => {
  it('URL lebih dipercaya daripada nama yang bertentangan', () => {
    const hasil = normalizeSource(
      'New Straits Times',
      'https://www.thestar.com.my/business/2026/08/10/ringgit-strengthens',
    );
    expect(hasil.slug).toBe('thestar');
  });

  it('subdomain koran yang dikenal tetap terbaca', () => {
    expect(normalizeSource(null, 'https://amp.thestar.com.my/news/1').slug).toBe('thestar');
  });

  it('kalau host-nya tidak dikenal, baru pakai namanya', () => {
    expect(normalizeSource('The Star', 'https://situs-lain.example.org/x').slug).toBe('thestar');
  });
});
