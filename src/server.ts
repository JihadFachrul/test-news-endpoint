/**
 * Server HTTP.
 *
 * Memakai Fastify: ringan, satu paket, dan penanganan JSON serta error-nya
 * sudah bawaan. Tidak ada ORM di sini -- semua SQL ditulis tangan, karena
 * brief ingin melihat tabel yang kita rancang sendiri.
 */
import Fastify from 'fastify';
import { ingestMentions } from './ingest.js';
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

  // Menutup pool sambungan database saat server dimatikan, supaya proses
  // tidak menggantung.
  app.addHook('onClose', async () => {
    await pool.end();
  });

  return app;
}
