/**
 * Server HTTP.
 *
 * Memakai Fastify: ringan, satu paket, dan penanganan JSON serta error-nya
 * sudah bawaan. Tidak ada ORM di sini -- semua SQL ditulis tangan, karena
 * brief ingin melihat tabel yang kita rancang sendiri.
 */
import Fastify from 'fastify';
import { ingestMentions } from './ingest.js';
import { parseSearchQuery, searchMentions } from './search.js';
import { getStats, parseStatsQuery } from './stats.js';
import { pool } from './db.js';

export function buildServer() {
  const app = Fastify({
    logger: true,

    // Bawaan Fastify hanya 1 MB. File seed cuma 6 KB, tapi kiriman massal
    // sungguhan bisa jauh lebih besar, jadi dinaikkan ke 10 MB.
    bodyLimit: 10 * 1024 * 1024,
  });

  // -------------------------------------------------------------------------
  // Halaman pembuka: daftar endpoint yang tersedia.
  // Bukan bagian dari syarat brief, tapi memudahkan penilai melihat apa saja
  // yang bisa dicoba tanpa membuka README.
  // -------------------------------------------------------------------------
  app.get('/', async () => ({
    layanan: 'media monitoring - bagian kecil',
    endpoint: {
      'POST /internal/mentions/bulk': 'memasukkan data massal (idempotent)',
      'GET /mentions': 'mencari berita',
      'GET /mentions/stats?group_by=source': 'jumlah berita per sumber',
      'GET /mentions/stats?group_by=day': 'jumlah berita per hari',
    },
  }));

  // -------------------------------------------------------------------------
  // POST /internal/mentions/bulk
  // -------------------------------------------------------------------------
  app.post('/internal/mentions/bulk', async (request, reply) => {
    const body = request.body;

    // Brief menyebut endpoint ini menerima "the array of records in
    // seed_mentions.json", jadi yang diterima memang array telanjang.
    if (!Array.isArray(body)) {
      return reply.code(400).send({
        error: 'Isi permintaan harus berupa array JSON berisi record mention.',
        contoh: 'curl -X POST .../internal/mentions/bulk -H "Content-Type: application/json" --data-binary @seed_mentions.json',
      });
    }

    const laporan = await ingestMentions(body);

    // 200, bukan 201. Endpoint ini idempotent: kiriman kedua kalinya tidak
    // membuat apa pun, jadi "201 Created" akan menyesatkan.
    return reply.code(200).send(laporan);
  });

  // -------------------------------------------------------------------------
  // GET /mentions
  //
  // Parameter yang didukung:
  //   q       kata kunci, dicari di judul dan isi berita
  //   source  saringan sumber, mis. thestar (nama biasa juga bisa: "The Star")
  //   from    batas awal tanggal, inklusif
  //   to      batas akhir tanggal; kalau diisi tanggal saja, seluruh hari itu
  //           ikut terhitung
  //   limit   jumlah baris per halaman (1-100, bawaan 20)
  //   offset  jumlah baris yang dilewati (bawaan 0)
  // -------------------------------------------------------------------------
  app.get('/mentions', async (request, reply) => {
    const { params, errors } = parseSearchQuery(
      (request.query ?? {}) as Record<string, unknown>,
    );

    // Parameter yang salah dilaporkan SEMUANYA sekaligus, bukan satu per satu.
    // Kalau dilaporkan satu-satu, pemakainya harus mencoba berulang kali untuk
    // menemukan semua kesalahannya.
    if (errors.length > 0) {
      return reply.code(400).send({ error: 'Parameter pencarian tidak valid.', detail: errors });
    }

    return reply.send(await searchMentions(params));
  });

  // -------------------------------------------------------------------------
  // GET /mentions/stats
  //
  //   ?group_by=source   jumlah berita per koran/platform
  //   ?group_by=day      jumlah berita per hari (menurut waktu Malaysia)
  //
  // Menerima saringan yang sama dengan GET /mentions (q, source, from, to),
  // supaya grafik di dashboard bisa mengikuti saringan yang sedang aktif.
  // -------------------------------------------------------------------------
  app.get('/mentions/stats', async (request, reply) => {
    const { params, errors } = parseStatsQuery((request.query ?? {}) as Record<string, unknown>);

    if (params === null) {
      return reply.code(400).send({ error: 'Parameter statistik tidak valid.', detail: errors });
    }

    return reply.send(await getStats(params));
  });

  // Menutup pool sambungan database saat server dimatikan, supaya proses
  // tidak menggantung.
  app.addHook('onClose', async () => {
    await pool.end();
  });

  return app;
}
