/** Definisi endpoint HTTP. Logikanya ada di modul lain supaya bisa diuji. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { ingestMentions } from './ingest.js';
import { parseSearchQuery, searchMentions } from './search.js';
import { getStats, parseStatsQuery } from './stats.js';
import { pool } from './db.js';

/** Benar untuk src/ (npm run dev) maupun dist/ (npm start): sama-sama satu tingkat. */
const DASHBOARD_PATH = fileURLToPath(new URL('../public/index.html', import.meta.url));

export function buildServer() {
  const app = Fastify({
    logger: true,
    // Bawaan Fastify 1 MB; kiriman massal sungguhan bisa jauh lebih besar.
    bodyLimit: 10 * 1024 * 1024,
  });

  // Halaman dashboard. Dibaca setiap permintaan, bukan sekali saat server
  // menyala, supaya menyunting HTML tidak perlu menyalakan ulang server.
  app.get('/', async (_request, reply) => {
    const html = await readFile(DASHBOARD_PATH, 'utf8');
    return reply.type('text/html; charset=utf-8').send(html);
  });

  app.get('/api', async () => ({
    layanan: 'media monitoring - bagian kecil',
    endpoint: {
      'POST /internal/mentions/bulk': 'memasukkan data massal (idempotent)',
      'GET /mentions': 'mencari berita',
      'GET /mentions/stats?group_by=source': 'jumlah berita per sumber',
      'GET /mentions/stats?group_by=day': 'jumlah berita per hari',
    },
  }));

  app.post('/internal/mentions/bulk', async (request, reply) => {
    const body = request.body;

    // Brief menyebut endpoint ini menerima "the array of records in
    // seed_mentions.json", jadi yang diterima array telanjang.
    if (!Array.isArray(body)) {
      return reply.code(400).send({
        error: 'Isi permintaan harus berupa array JSON berisi record mention.',
        contoh: 'curl -X POST .../internal/mentions/bulk -H "Content-Type: application/json" --data-binary @seed_mentions.json',
      });
    }

    const laporan = await ingestMentions(body);

    // 200, bukan 201: kiriman kedua tidak membuat apa pun.
    return reply.code(200).send(laporan);
  });

  /**
   * GET /mentions
   *   q       kata kunci di judul dan isi
   *   source  slug atau nama biasa ("The Star")
   *   from    batas awal tanggal, inklusif
   *   to      batas akhir; kalau diisi tanggal saja, seluruh hari itu ikut
   *   limit   1-100, bawaan 20
   *   offset  bawaan 0
   */
  app.get('/mentions', async (request, reply) => {
    const { params, errors } = parseSearchQuery(
      (request.query ?? {}) as Record<string, unknown>,
    );

    // Semua kesalahan dilaporkan sekaligus, supaya pemakainya tidak perlu
    // mencoba berulang kali untuk menemukannya satu per satu.
    if (errors.length > 0) {
      return reply.code(400).send({ error: 'Parameter pencarian tidak valid.', detail: errors });
    }

    return reply.send(await searchMentions(params));
  });

  /** GET /mentions/stats?group_by=source|day, saringannya sama dengan /mentions. */
  app.get('/mentions/stats', async (request, reply) => {
    const { params, errors } = parseStatsQuery((request.query ?? {}) as Record<string, unknown>);

    if (params === null) {
      return reply.code(400).send({ error: 'Parameter statistik tidak valid.', detail: errors });
    }

    return reply.send(await getStats(params));
  });

  app.addHook('onClose', async () => {
    await pool.end();
  });

  return app;
}
