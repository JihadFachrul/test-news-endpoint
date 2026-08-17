/**
 * Bagian paling berisiko di proyek ini: menentukan mana yang dianggap berita
 * yang sama.
 *
 * Tes di sini diuji langsung ke seed_mentions.json yang asli, bukan ke contoh
 * karangan. Jadi kalau aturannya bergeser, yang gagal adalah data yang memang
 * jadi alasan aturan ini dibuat.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeMention, type NormalizedMention } from '../src/normalize/mention.js';

const seed = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed_mentions.json', import.meta.url)), 'utf8'),
) as unknown[];

const hasil: NormalizedMention[] = seed.map(normalizeMention);

/** Mencari satu mention berdasarkan external_id aslinya. */
function cari(externalId: string): NormalizedMention {
  const ketemu = hasil.find((m) => m.externalId === externalId);
  if (!ketemu) throw new Error(`tidak ada record dengan external_id ${externalId}`);
  return ketemu;
}

describe('menyeragamkan nama koran di seluruh file data', () => {
  it('semua ejaan satu koran menyatu jadi satu slug', () => {
    const slugs = new Set(hasil.map((m) => m.source.slug));
    expect([...slugs].sort()).toEqual([
      'facebook',
      'instagram',
      'malaysiakini',
      'nst',
      'thestar',
      'twitter',
    ]);
  });

  it('"The Star" dan "thestar" jadi koran yang sama', () => {
    expect(cari('str-99120').source.slug).toBe('thestar');
    expect(cari('nst-40021').source.slug).toBe('thestar');
  });

  it('URL lebih dipercaya daripada ID penyedia yang bertentangan', () => {
    // nst-40021 punya ID berlabel NST tapi URL-nya thestar.com.my.
    expect(cari('nst-40021').source.slug).toBe('thestar');
  });
});

describe('mendeteksi duplikat di seluruh file data', () => {
  it('15 record mentah menyusut jadi 12 berita', () => {
    const kunci = new Set(hasil.map((m) => m.dedupeKey));
    expect(hasil).toHaveLength(15);
    expect(kunci.size).toBe(12);
  });

  it('kiriman ulang yang isinya sama persis dianggap satu berita', () => {
    const salinan = hasil.filter((m) => m.externalId === 'str-99120');
    expect(salinan).toHaveLength(2);
    expect(salinan[0]?.dedupeKey).toBe(salinan[1]?.dedupeKey);
  });

  it('artikel sama dengan ID dan huruf besar-kecil berbeda dianggap satu', () => {
    expect(cari('nst-40021').dedupeKey).toBe(cari('str-99120').dedupeKey);
  });

  it('artikel sama di URL berbeda dianggap satu', () => {
    // mkn-1201 dan mkn-1202: isi sama, penulis sama, URL /news/1201 vs
    // /news/1202, judulnya cuma beda satu tanda hubung.
    expect(cari('mkn-1202').dedupeKey).toBe(cari('mkn-1201').dedupeKey);
  });

  it('berita sama dari DUA KORAN tetap dihitung dua', () => {
    // Ini pengaman yang melindungi nilai produknya: analis harus tetap melihat
    // bahwa The Star DAN NST sama-sama mengangkat data pariwisata itu.
    expect(cari('str-99502').dedupeKey).not.toBe(cari('nst-40199').dedupeKey);
  });

  it('berita koran dan postingan sosmed tentangnya tetap dihitung dua', () => {
    expect(cari('nst-40088').dedupeKey).not.toBe(cari('tw-8812340091').dedupeKey);
    expect(cari('str-99341').dedupeKey).not.toBe(cari('fb_772341').dedupeKey);
  });

  it('postingan tanpa judul memakai isi postingannya sebagai identitas', () => {
    // Tweet judulnya null; postingan Facebook judulnya "" (teks kosong).
    // Keduanya harus lewat jalur yang sama, bukan dihitung dari judul kosong.
    expect(cari('tw-8812340091').title).toBeNull();
    expect(cari('fb_772341').title).toBeNull();
    // Kalau judul kosong tidak ditangani, dua record ini akan bertabrakan
    // gara-gara sama-sama berjudul kosong. Pastikan tidak.
    expect(cari('tw-8812340091').dedupeKey).not.toBe(cari('fb_772341').dedupeKey);
  });
});

describe('merapikan isi kolom di seluruh file data', () => {
  it('semua bentuk tanggal terbaca, dan yang kosong ditandai', () => {
    expect(cari('nst-40088').publishedAt).toBe('2026-08-11T08:00:00.000Z');
    expect(cari('mkn-1202').publishedAt).toBe('2026-08-10T16:00:00.000Z');
    expect(cari('mkn-1201').publishedAt).toBeNull();
    expect(cari('mkn-1201').warnings.join(' ')).toContain('published_at kosong');
  });

  it('angka engagement berbentuk teks jadi bilangan', () => {
    expect(cari('nst-40021').engagement).toBe(1204);
    expect(cari('fb_772341').engagement).toBe(3402);
  });

  it('isi asli disimpan, salinan bersih disimpan berdampingan', () => {
    const banjir = cari('nst-40130');
    expect(banjir.contentRaw).toContain('<script>');
    expect(banjir.contentClean).not.toContain('script');
    expect(banjir.contentClean).toBe(
      'Several roads in Shah Alam were impassable after two hours of heavy rain.',
    );
  });
});
