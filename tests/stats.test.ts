/**
 * GET /mentions/stats. Dua kesalahan paling berbahaya di sini tidak memunculkan
 * error apa pun: baris tanpa tanggal dibuang diam-diam, dan hari dihitung
 * memakai zona waktu yang salah. Keduanya diuji eksplisit di bawah.
 *
 * Prasyarat: `npm run db:setup` sudah pernah dijalankan.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { prepareMentions, storeMentions } from '../src/ingest.js';
import {
  getStats,
  parseStatsQuery,
  ZONA_WAKTU_LAPORAN,
  type BarisHari,
  type BarisSumber,
} from '../src/stats.js';

const seed = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed_mentions.json', import.meta.url)), 'utf8'),
) as unknown[];

beforeAll(async () => {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    throw new Error(
      'Tidak bisa menyambung ke database. Pastikan PostgreSQL menyala dan ' +
        '`npm run db:setup` sudah dijalankan. Pesan aslinya: ' +
        String(error),
    );
  }

  await pool.query('TRUNCATE mentions, sources RESTART IDENTITY CASCADE');

  const siap = prepareMentions(seed);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await storeMentions(client, siap.valid);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await pool.query('TRUNCATE mentions, sources RESTART IDENTITY CASCADE');
  await pool.end();
});

/** Jalan pintas: minta statistik dengan parameter berbentuk seperti di URL. */
async function statistik(query: Record<string, string>) {
  const { params, errors } = parseStatsQuery(query);
  expect(params, `parameter ditolak: ${errors.join(', ')}`).not.toBeNull();
  return getStats(params!);
}

describe('group_by=source', () => {
  it('menghitung per koran, dan totalnya cocok dengan jumlah berita', async () => {
    const hasil = await statistik({ group_by: 'source' });
    const data = hasil.data as BarisSumber[];

    expect(hasil.total).toBe(12);
    expect(data.reduce((n, b) => n + b.total, 0)).toBe(12);
    expect(data).toHaveLength(6);
  });

  it('nama koran yang ejaannya berbeda-beda tidak terpecah jadi beberapa baris', async () => {
    // Di data, The Star ditulis "The Star" dan "thestar"; Malaysiakini punya
    // versi berspasi di ujung. Kalau penyeragaman gagal, di sini akan muncul
    // baris ganda dengan nama yang mirip.
    const hasil = await statistik({ group_by: 'source' });
    const data = hasil.data as BarisSumber[];

    const slugs = data.map((b) => b.source);
    expect(slugs).toEqual([...new Set(slugs)]);
    expect(slugs.sort()).toEqual([
      'facebook',
      'instagram',
      'malaysiakini',
      'nst',
      'thestar',
      'twitter',
    ]);
  });

  it('urutannya terbanyak dulu, dengan pemecah seri supaya tidak berubah-ubah', async () => {
    const hasil = await statistik({ group_by: 'source' });
    const data = hasil.data as BarisSumber[];

    for (let i = 1; i < data.length; i += 1) {
      const sebelum = data[i - 1]!;
      const sekarang = data[i]!;
      expect(sebelum.total).toBeGreaterThanOrEqual(sekarang.total);
      // Kalau jumlahnya seri, slug harus urut A-Z. Inilah yang mencegah batang
      // grafik bertukar tempat setiap halaman disegarkan.
      if (sebelum.total === sekarang.total) {
        expect(sebelum.source < sekarang.source).toBe(true);
      }
    }
  });

  it('menyertakan nama tampilan dan jenis kanal, bukan cuma slug', async () => {
    const hasil = await statistik({ group_by: 'source' });
    const thestar = (hasil.data as BarisSumber[]).find((b) => b.source === 'thestar');
    expect(thestar).toEqual({ source: 'thestar', name: 'The Star', platform: 'news', total: 3 });
  });
});

describe('group_by=day', () => {
  it('menghitung per hari, dan totalnya cocok dengan jumlah berita', async () => {
    const hasil = await statistik({ group_by: 'day' });
    const data = hasil.data as BarisHari[];

    expect(hasil.total).toBe(12);
    expect(data.reduce((n, b) => n + b.total, 0)).toBe(12);
  });

  it('zona waktu yang dipakai diberitahukan di dalam respon', async () => {
    const hasil = await statistik({ group_by: 'day' });
    expect(hasil.timezone).toBe(ZONA_WAKTU_LAPORAN);
    expect(hasil.timezone).toBe('Asia/Kuala_Lumpur');
  });

  it('zona waktu tidak disebut untuk group_by=source, karena tidak berpengaruh', async () => {
    const hasil = await statistik({ group_by: 'source' });
    expect(hasil.timezone).toBeUndefined();
  });

  it('HARI DIHITUNG MENURUT WAKTU MALAYSIA, bukan UTC', async () => {
    // Ini tes yang paling penting di berkas ini.
    //
    // Berita GDP Malaysiakini tersimpan sebagai 2026-08-10 16:00 UTC, yang
    // sama dengan 2026-08-11 00:00 waktu Malaysia. Nilai aslinya di data feed
    // memang "11/08/2026".
    //
    // Jadi ia HARUS masuk ember 11 Agustus. Kalau perhitungannya memakai UTC,
    // ia akan masuk ember 10 Agustus dan tidak ada error apa pun yang muncul.
    const hasil = await statistik({ group_by: 'day', q: 'GDP' });
    const data = hasil.data as BarisHari[];

    expect(data).toHaveLength(1);
    expect(data[0]!.day).toBe('2026-08-11');
    expect(data[0]!.total).toBe(1);
  });

  it('urutannya dari hari terbaru', async () => {
    const hasil = await statistik({ group_by: 'day' });
    const hari = (hasil.data as BarisHari[]).map((b) => b.day).filter((d): d is string => d !== null);
    expect(hari).toEqual([...hari].sort().reverse());
  });

  it('BERITA TANPA TANGGAL DIHITUNG di ember sendiri, tidak dibuang', async () => {
    // Kalau baris tanpa tanggal dibuang diam-diam, jumlah batang di grafik jadi
    // lebih kecil daripada jumlah berita yang ada, dan tidak ada apa pun di
    // layar yang memberi tahu bahwa ada yang hilang.
    await pool.query(
      `INSERT INTO mentions (source_id, title, content_clean, dedupe_key, published_at)
       VALUES ((SELECT id FROM sources WHERE slug = 'thestar'),
               'Berita uji tanpa tanggal', 'isi uji', 'kunci-uji-stats', NULL)`,
    );

    try {
      const hasil = await statistik({ group_by: 'day' });
      const data = hasil.data as BarisHari[];

      // Totalnya sekarang 13, dan seluruh berita tetap terhitung.
      expect(hasil.total).toBe(13);
      expect(data.reduce((n, b) => n + b.total, 0)).toBe(13);

      const emberKosong = data.find((b) => b.day === null);
      expect(emberKosong).toBeDefined();
      expect(emberKosong!.total).toBe(1);
      expect(emberKosong!.label).toBe('tanpa tanggal');

      // Dan embernya berada di AKHIR daftar, bukan di awal, supaya tidak
      // mengacaukan urutan grafik.
      expect(data[data.length - 1]!.day).toBeNull();
    } finally {
      await pool.query(`DELETE FROM mentions WHERE dedupe_key = 'kunci-uji-stats'`);
    }
  });
});

describe('statistik mengikuti saringan yang sama dengan daftar berita', () => {
  it('saringan sumber diterapkan', async () => {
    const hasil = await statistik({ group_by: 'source', source: 'The Star' });
    const data = hasil.data as BarisSumber[];
    expect(data).toHaveLength(1);
    expect(data[0]!.source).toBe('thestar');
    expect(hasil.total).toBe(3);
  });

  it('saringan kata kunci diterapkan', async () => {
    const hasil = await statistik({ group_by: 'source', q: 'tourism' });
    const data = hasil.data as BarisSumber[];
    expect(hasil.total).toBe(2);
    expect(data.map((b) => b.source).sort()).toEqual(['nst', 'thestar']);
  });

  it('saringan rentang tanggal diterapkan, dan seluruh hari terakhir ikut', async () => {
    const hasil = await statistik({ group_by: 'day', from: '2026-08-13', to: '2026-08-13' });
    const data = hasil.data as BarisHari[];
    expect(data).toHaveLength(1);
    expect(data[0]!.day).toBe('2026-08-13');
    expect(hasil.total).toBe(2);
  });

  it('saringan yang diterapkan dikembalikan di dalam respon', async () => {
    const hasil = await statistik({ group_by: 'source', q: 'ringgit', source: 'thestar' });
    expect(hasil.filters.q).toBe('ringgit');
    expect(hasil.filters.source).toBe('thestar');
  });

  it('saringan yang tidak menemukan apa pun menghasilkan daftar kosong, bukan error', async () => {
    const hasil = await statistik({ group_by: 'day', q: 'xyzzytidakada' });
    expect(hasil.data).toHaveLength(0);
    expect(hasil.total).toBe(0);
  });
});

describe('parameter group_by', () => {
  it('wajib diisi', async () => {
    const hasil = parseStatsQuery({});
    expect(hasil.params).toBeNull();
    expect(hasil.errors[0]).toContain('group_by wajib diisi');
  });

  it('nilai yang tidak dikenali ditolak dengan menyebutkan pilihannya', async () => {
    const hasil = parseStatsQuery({ group_by: 'bulan' });
    expect(hasil.params).toBeNull();
    expect(hasil.errors[0]).toContain('source atau day');
  });

  it('huruf besar-kecil tidak jadi masalah', async () => {
    expect(parseStatsQuery({ group_by: 'SOURCE' }).params?.groupBy).toBe('source');
    expect(parseStatsQuery({ group_by: ' Day ' }).params?.groupBy).toBe('day');
  });

  it('saringan yang salah juga dilaporkan, bukan cuma group_by', async () => {
    const hasil = parseStatsQuery({ group_by: 'day', from: 'besok' });
    expect(hasil.params).toBeNull();
    expect(hasil.errors.join(' ')).toContain('bukan tanggal');
  });
});
