/**
 * Titik masuk aplikasi: menyalakan server.
 *
 * Dipisah dari server.ts supaya tes bisa membuat server sendiri (memakai
 * buildServer()) tanpa ikut membuka port jaringan.
 */
import { buildServer } from './server.js';

const app = buildServer();
const port = Number(process.env['PORT'] ?? 3000);

/**
 * Bawaannya 127.0.0.1, artinya hanya bisa diakses dari komputer ini sendiri.
 * Sengaja begitu supaya server pengembangan tidak ikut terbuka ke jaringan
 * Wi-Fi sekitar. Kalau nanti di-deploy (misalnya ke Render), isi HOST=0.0.0.0.
 */
const host = process.env['HOST'] ?? '127.0.0.1';

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
