/**
 * Idempotency, diuji ke database sungguhan karena yang diuji justru jaminan
 * dari database (UNIQUE + ON CONFLICT), bukan logika di kode.
 *
 * Semuanya dijalankan di dalam transaksi yang selalu dibatalkan, jadi tidak
 * meninggalkan satu baris pun. Prasyarat: `npm run db:setup` sudah dijalankan.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { prepareMentions, storeMentions } from '../src/ingest.js';

const seed = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed_mentions.json', import.meta.url)), 'utf8'),
) as unknown[];

let client: PoolClient;

beforeAll(async () => {
  try {
    client = await pool.connect();
  } catch (error) {
    throw new Error(
      'Tidak bisa menyambung ke database. Pastikan PostgreSQL menyala dan ' +
        '`npm run db:setup` sudah dijalankan. Pesan aslinya: ' +
        String(error),
    );
  }
});

afterAll(async () => {
  client?.release();
  await pool.end();
});

beforeEach(async () => {
  await client.query('BEGIN');
  // Mulai dari kondisi bersih supaya hasil hitungannya pasti. Aman, karena
  // seluruhnya berada di dalam transaksi yang akan dibatalkan.
  await client.query('TRUNCATE mentions, sources RESTART IDENTITY CASCADE');
});

afterEach(async () => {
  await client.query('ROLLBACK');
});

/** Menghitung jumlah baris di tabel mentions. */
async function jumlahMentions(): Promise<number> {
  const { rows } = await client.query<{ n: string }>('SELECT count(*) AS n FROM mentions');
  return Number(rows[0]!.n);
}

describe('memasukkan data massal', () => {
  it('15 record mentah jadi 12 baris', async () => {
    const siap = prepareMentions(seed);
    const hasil = await storeMentions(client, siap.valid);

    expect(siap.errors).toHaveLength(0);
    expect(hasil.inserted).toBe(12);
    expect(hasil.merged).toBe(3);
    expect(await jumlahMentions()).toBe(12);
  });

  it('IDEMPOTENT: kirim file yang sama dua kali, jumlah baris tidak berubah', async () => {
    const siap = prepareMentions(seed);

    const pertama = await storeMentions(client, siap.valid);
    const setelahSekali = await jumlahMentions();

    const kedua = await storeMentions(client, siap.valid);
    const setelahDuaKali = await jumlahMentions();

    expect(pertama.inserted).toBe(12);
    expect(setelahSekali).toBe(12);

    // Inilah intinya: kiriman kedua TIDAK membuat baris baru sama sekali.
    expect(kedua.inserted).toBe(0);
    expect(kedua.merged).toBe(15);
    expect(setelahDuaKali).toBe(12);
  });

  it('IDEMPOTENT juga untuk kiriman kelima', async () => {
    const siap = prepareMentions(seed);
    for (let i = 0; i < 5; i += 1) {
      await storeMentions(client, siap.valid);
    }
    expect(await jumlahMentions()).toBe(12);
  });

  it('koran hanya didaftarkan sekali, walau data dikirim berulang', async () => {
    const siap = prepareMentions(seed);
    await storeMentions(client, siap.valid);
    await storeMentions(client, siap.valid);

    const { rows } = await client.query<{ slug: string }>('SELECT slug FROM sources ORDER BY slug');
    expect(rows.map((r) => r.slug)).toEqual([
      'facebook',
      'instagram',
      'malaysiakini',
      'nst',
      'thestar',
      'twitter',
    ]);
  });
});

describe('menggabungkan data duplikat', () => {
  it('engagement diambil yang tertinggi', async () => {
    // Tiga salinan berita ringgit: 412, 415, dan "1,204".
    const siap = prepareMentions(seed);
    await storeMentions(client, siap.valid);

    const { rows } = await client.query<{ engagement: number; times_seen: number }>(
      "SELECT engagement, times_seen FROM mentions WHERE title ILIKE 'Ringgit strengthens%'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.engagement).toBe(1204);
    expect(rows[0]!.times_seen).toBe(3);
  });

  it('waktu terbit diambil yang paling awal', async () => {
    // str-99120 terbit 08:15:00Z, salinannya nst-40021 tercatat 08:20:00.
    const siap = prepareMentions(seed);
    await storeMentions(client, siap.valid);

    const { rows } = await client.query<{ published_at: Date; published_at_raw: string }>(
      "SELECT published_at, published_at_raw FROM mentions WHERE title ILIKE 'Ringgit strengthens%'",
    );
    expect(rows[0]!.published_at.toISOString()).toBe('2026-08-10T08:15:00.000Z');
    // Nilai mentahnya harus sepadan dengan tanggal yang dipilih, bukan diambil
    // dari salinan lain -- kalau tidak, kolom audit ini menyesatkan.
    expect(rows[0]!.published_at_raw).toBe('2026-08-10T08:15:00Z');
  });

  it('penulis yang kosong diisi dari salinannya', async () => {
    // str-99120 punya penulis "Aisyah Rahman"; salinannya nst-40021 null.
    const siap = prepareMentions(seed);
    await storeMentions(client, siap.valid);

    const { rows } = await client.query<{ author: string | null }>(
      "SELECT author FROM mentions WHERE title ILIKE 'Ringgit strengthens%'",
    );
    expect(rows[0]!.author).toBe('Aisyah Rahman');
  });

  it('isi berita yang lebih lengkap yang dipertahankan', async () => {
    const siap = prepareMentions(seed);
    await storeMentions(client, siap.valid);

    const { rows } = await client.query<{ content_clean: string }>(
      "SELECT content_clean FROM mentions WHERE title ILIKE 'Ringgit strengthens%'",
    );
    // Versi The Star lebih panjang: "...buoyed by improved sentiment."
    expect(rows[0]!.content_clean).toContain('buoyed by improved sentiment');
  });

  it('berita sama dari dua koran tetap jadi dua baris', async () => {
    const siap = prepareMentions(seed);
    await storeMentions(client, siap.valid);

    const { rows } = await client.query<{ slug: string }>(
      `SELECT s.slug FROM mentions m JOIN sources s ON s.id = m.source_id
       WHERE m.title ILIKE 'Tourism arrivals up 12%' ORDER BY s.slug`,
    );
    expect(rows.map((r) => r.slug)).toEqual(['nst', 'thestar']);
  });

  it('berita tanpa tanggal tetap tersimpan, tanggalnya kosong', async () => {
    const siap = prepareMentions(seed);
    await storeMentions(client, siap.valid);

    const { rows } = await client.query<{ published_at: Date | null }>(
      "SELECT published_at FROM mentions WHERE title ILIKE 'Analysts split%'",
    );
    // mkn-1201 tidak punya tanggal, tapi salinannya mkn-1202 punya, jadi
    // setelah digabung tanggalnya terisi.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.published_at?.toISOString()).toBe('2026-08-10T16:00:00.000Z');
  });
});

describe('menangani data yang rusak', () => {
  it('record yang bukan objek dilewati, sisanya tetap masuk', async () => {
    const rusak = [seed[0], 'ini bukan objek', 42, null, seed[3]];
    const siap = prepareMentions(rusak);

    expect(siap.errors).toHaveLength(3);
    expect(siap.errors.map((e) => e.index)).toEqual([1, 2, 3]);

    const hasil = await storeMentions(client, siap.valid);
    expect(hasil.inserted).toBe(2);
    expect(await jumlahMentions()).toBe(2);
  });

  it('peringatan dilaporkan, bukan disembunyikan', async () => {
    const siap = prepareMentions(seed);
    const semuaPesan = siap.warnings.flatMap((w) => w.messages).join(' | ');

    expect(semuaPesan).toContain('published_at kosong');
    expect(semuaPesan).toContain('HTML');
  });
});
