/**
 * GET /mentions. Yang diuji dipilih dari "kalau ini salah, apakah kelihatan?":
 * urutan yang tidak stabil, batas "to" yang salah baca, dan berita tanpa
 * tanggal -- ketiganya salah tanpa melempar error apa pun.
 *
 * Prasyarat: `npm run db:setup` sudah pernah dijalankan.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { prepareMentions, storeMentions } from '../src/ingest.js';
import { parseSearchQuery, searchMentions, SORT_ORDER } from '../src/search.js';

const seed = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed_mentions.json', import.meta.url)), 'utf8'),
) as unknown[];

// searchMentions() memakai pool, bukan satu client tetap, jadi datanya harus
// benar-benar tersimpan dan pola ROLLBACK per tes tidak bisa dipakai di sini.
// Gantinya tabel dibersihkan sebelum dan sesudah seluruh berkas.
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

/** Jalan pintas: cari dengan parameter berbentuk seperti di URL. */
async function cari(query: Record<string, string> = {}) {
  const { params, errors } = parseSearchQuery(query);
  expect(errors, `parameter ditolak: ${errors.join(', ')}`).toHaveLength(0);
  return searchMentions(params);
}

describe('tanpa saringan', () => {
  it('mengembalikan seluruh 12 berita', async () => {
    const hasil = await cari();
    expect(hasil.pagination.total).toBe(12);
    expect(hasil.data).toHaveLength(12);
  });

  it('urutan tampilannya diberitahukan di dalam respon', async () => {
    const hasil = await cari();
    expect(hasil.sort).toBe(SORT_ORDER);
    expect(hasil.sort).toContain('id DESC');
  });

  it('berita terbaru di atas, dan berita tanpa tanggal tidak nyelip ke awal', async () => {
    const hasil = await cari();
    const tanggal = hasil.data.map((d) => d.published_at);

    // Semua yang punya tanggal harus urut menurun.
    const adaTanggal = tanggal.filter((t): t is string => t !== null);
    const urutMenurun = [...adaTanggal].sort().reverse();
    expect(adaTanggal).toEqual(urutMenurun);

    // Dan yang tanggalnya kosong harus berada di bagian akhir, bukan awal.
    const indeksKosong = tanggal.findIndex((t) => t === null);
    if (indeksKosong !== -1) {
      expect(tanggal.slice(indeksKosong).every((t) => t === null)).toBe(true);
    }
  });
});

describe('paginasi', () => {
  it('halaman demi halaman tidak melewatkan dan tidak menggandakan satu pun', async () => {
    // Inilah tes yang gagal kalau pemecah seri "id DESC" dihapus dari urutan.
    const semuaId: number[] = [];
    for (let offset = 0; offset < 12; offset += 5) {
      const halaman = await cari({ limit: '5', offset: String(offset) });
      semuaId.push(...halaman.data.map((d) => d.id));
    }

    const unik = new Set(semuaId);
    expect(semuaId).toHaveLength(12);
    expect(unik.size).toBe(12);

    // Dan urutan gabungannya harus sama dengan mengambil sekaligus.
    const sekaligus = await cari({ limit: '100' });
    expect(semuaId).toEqual(sekaligus.data.map((d) => d.id));
  });

  it('has_more menunjukkan masih ada halaman berikutnya', async () => {
    const awal = await cari({ limit: '5', offset: '0' });
    expect(awal.pagination.has_more).toBe(true);
    expect(awal.pagination.returned).toBe(5);
    expect(awal.pagination.total).toBe(12);

    const akhir = await cari({ limit: '5', offset: '10' });
    expect(akhir.pagination.has_more).toBe(false);
    expect(akhir.pagination.returned).toBe(2);
  });

  it('total tetap benar walau offset melewati baris terakhir', async () => {
    // Ini kasus yang bikin cara "count(*) OVER ()" salah: tidak ada baris yang
    // kembali, sehingga totalnya ikut hilang dan terbaca 0.
    const hasil = await cari({ offset: '999' });
    expect(hasil.data).toHaveLength(0);
    expect(hasil.pagination.total).toBe(12);
  });

  it('limit di luar batas ditolak dengan pesan yang jelas', async () => {
    const terlaluBesar = parseSearchQuery({ limit: '5000' });
    expect(terlaluBesar.errors[0]).toContain('di luar rentang');

    const bukanAngka = parseSearchQuery({ limit: 'banyak' });
    expect(bukanAngka.errors[0]).toContain('bilangan bulat');
  });
});

describe('pencarian kata kunci', () => {
  it('menemukan kata di dalam judul', async () => {
    const hasil = await cari({ q: 'ringgit' });
    expect(hasil.data).toHaveLength(1);
    expect(hasil.data[0]!.title).toContain('Ringgit');
  });

  it('menemukan kata di dalam isi berita, bukan hanya judul', async () => {
    // Kata "drainage" hanya ada di isi tulisan opini, tidak ada di judulnya.
    const hasil = await cari({ q: 'drainage' });
    expect(hasil.data).toHaveLength(1);
    expect(hasil.data[0]!.title).toContain('flood problem');
  });

  it('tidak peduli huruf besar-kecil', async () => {
    const kecil = await cari({ q: 'banjir' });
    const besar = await cari({ q: 'BANJIR' });
    expect(kecil.data.map((d) => d.id)).toEqual(besar.data.map((d) => d.id));
    expect(kecil.data.length).toBeGreaterThan(0);
  });

  it('dua kata berarti keduanya harus ada', async () => {
    const hasil = await cari({ q: 'flash floods' });
    expect(hasil.data).toHaveLength(1);
    expect(hasil.data[0]!.title).toBe('Flash floods hit parts of Klang Valley');
  });

  it('tanda kutip mencari frasa utuh', async () => {
    const frasa = await cari({ q: '"Bank Negara"' });
    expect(frasa.data).toHaveLength(1);
  });

  it('tanda baca ngawur tidak membuat pencarian error', async () => {
    // Kalau memakai to_tsquery, masukan seperti ini melempar error dan
    // pencariannya gagal total. Pencarian tidak boleh rusak karena hal ini.
    const hasil = await cari({ q: 'ringgit!!! &&& ???' });
    expect(hasil.data).toHaveLength(1);
  });

  it('kata yang tidak ada menghasilkan nol, bukan error', async () => {
    const hasil = await cari({ q: 'xyzzytidakada' });
    expect(hasil.data).toHaveLength(0);
    expect(hasil.pagination.total).toBe(0);
  });

  it('kata bahasa Melayu ikut terjaring', async () => {
    // Bukti kamus 'simple' memang aman untuk teks campur: tanpa kamus bahasa,
    // kata Melayu tidak dipotong-potong dan tetap bisa dicari.
    const hasil = await cari({ q: 'banjir' });
    expect(hasil.data).toHaveLength(1);
    expect(hasil.data[0]!.source.slug).toBe('twitter');
  });

  it('KETERBATASAN YANG DISADARI: bentuk kata tidak dicocokkan', async () => {
    // Kamus 'simple' tidak mengenal tata bahasa, jadi "flood" tidak menemukan
    // "floods". Ditulis sebagai tes supaya keterbatasannya tercatat, dan supaya
    // ada yang gagal kalau kamusnya nanti diganti.
    //
    // Dibandingkan per dokumen, bukan per jumlah: keduanya kebetulan
    // sama-sama menemukan satu berita, tapi berita yang berbeda.
    const tunggal = await cari({ q: 'flood' });
    const jamak = await cari({ q: 'floods' });

    expect(tunggal.data.map((d) => d.title)).toEqual([
      'Opinion: The flood problem is a planning problem',
    ]);
    expect(jamak.data.map((d) => d.title)).toEqual(['Flash floods hit parts of Klang Valley']);
    expect(tunggal.data.some((d) => d.title?.includes('Flash floods'))).toBe(false);
  });
});

describe('saringan sumber', () => {
  it('menyaring berdasarkan slug', async () => {
    const hasil = await cari({ source: 'thestar' });
    expect(hasil.data.length).toBeGreaterThan(0);
    expect(hasil.data.every((d) => d.source.slug === 'thestar')).toBe(true);
  });

  it('nama biasa juga diterima, tidak harus tahu slug internal', async () => {
    const pakaiSlug = await cari({ source: 'thestar' });
    for (const tulisan of ['The Star', 'THE STAR', '  the star  ']) {
      const hasil = await cari({ source: tulisan });
      expect(hasil.data.map((d) => d.id), `tulisan: ${tulisan}`).toEqual(
        pakaiSlug.data.map((d) => d.id),
      );
    }
  });

  it('sumber yang tidak ada menghasilkan nol, bukan error', async () => {
    const hasil = await cari({ source: 'koran-yang-tidak-ada' });
    expect(hasil.data).toHaveLength(0);
  });
});

describe('saringan rentang tanggal', () => {
  it('"to" berisi tanggal saja berarti SELURUH hari itu ikut', async () => {
    // Berita banjir NST terbit 2026-08-13 11:20 UTC.
    // Kalau "to=2026-08-13" dibaca apa adanya sebagai jam 00:00, hasilnya nol.
    const hasil = await cari({ from: '2026-08-13', to: '2026-08-13' });
    expect(hasil.data.length).toBeGreaterThan(0);
    expect(hasil.data.some((d) => d.title === 'Flash floods hit parts of Klang Valley')).toBe(true);
  });

  it('menyaring rentang beberapa hari', async () => {
    const hasil = await cari({ from: '2026-08-14', to: '2026-08-15' });
    const tanggal = hasil.data.map((d) => d.published_at!);
    expect(tanggal.length).toBeGreaterThan(0);
    // Semua hasil harus berada di dalam rentangnya (dihitung waktu Malaysia).
    expect(tanggal.every((t) => t >= '2026-08-13T16:00:00.000Z')).toBe(true);
    expect(tanggal.every((t) => t < '2026-08-15T16:00:00.000Z')).toBe(true);
  });

  it('berita tanpa tanggal TIDAK ikut saat ada saringan tanggal', async () => {
    // Di database sudah tidak ada berita tanpa tanggal setelah penggabungan
    // (mkn-1201 terisi dari mkn-1202), jadi diuji langsung dengan satu baris
    // buatan yang tanggalnya sengaja dikosongkan.
    await pool.query(
      `INSERT INTO mentions (source_id, title, content_clean, dedupe_key, published_at)
       VALUES ((SELECT id FROM sources WHERE slug = 'thestar'),
               'Berita uji tanpa tanggal', 'isi uji', 'kunci-uji-tanpa-tanggal', NULL)`,
    );

    try {
      const tanpaSaringan = await cari({ q: 'uji' });
      expect(tanpaSaringan.data).toHaveLength(1);

      const denganSaringan = await cari({ q: 'uji', from: '2026-08-01', to: '2026-12-31' });
      expect(denganSaringan.data).toHaveLength(0);

      // Dan alasannya diberitahukan, bukan dibiarkan jadi misteri.
      expect(denganSaringan.filters.catatan).toContain('tidak punya tanggal terbit');
    } finally {
      await pool.query(`DELETE FROM mentions WHERE dedupe_key = 'kunci-uji-tanpa-tanggal'`);
    }
  });

  it('tanggal ngawur dan rentang terbalik ditolak dengan pesan jelas', async () => {
    expect(parseSearchQuery({ from: 'besok' }).errors[0]).toContain('bukan tanggal');
    expect(
      parseSearchQuery({ from: '2026-08-20', to: '2026-08-10' }).errors[0],
    ).toContain('terbalik');
  });
});

describe('bentuk data yang dikembalikan', () => {
  it('yang dikirim adalah teks bersih, bukan HTML mentah', async () => {
    const hasil = await cari({ q: 'Shah Alam' });
    for (const baris of hasil.data) {
      expect(baris.content).not.toContain('<script');
      expect(baris.content).not.toContain('<p>');
    }
  });

  it('semua saringan bisa dipakai bersamaan', async () => {
    const hasil = await cari({
      q: 'tourism',
      source: 'The Star',
      from: '2026-08-15',
      to: '2026-08-15',
      limit: '10',
    });
    expect(hasil.data).toHaveLength(1);
    expect(hasil.data[0]!.source.slug).toBe('thestar');
    expect(hasil.data[0]!.title).toContain('Tourism arrivals');
  });
});
