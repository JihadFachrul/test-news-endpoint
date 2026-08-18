/** Menyalakan server. Dipisah dari server.ts supaya tes tidak ikut buka port. */
import { buildServer } from './server.js';

const app = buildServer();
const port = Number(process.env['PORT'] ?? 3000);

/** 127.0.0.1 supaya server pengembangan tidak terbuka ke jaringan sekitar.
 *  Isi HOST=0.0.0.0 kalau di-deploy. */
const host = process.env['HOST'] ?? '127.0.0.1';

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
