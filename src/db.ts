/** Sambungan ke PostgreSQL. */
import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';

/**
 * Tes integrasi mengosongkan tabel, jadi TEST_DATABASE_URL dipakai kalau ada.
 * Tanpa itu tesnya tetap jalan, hanya saja database biasa ikut terkosongkan.
 */
const sedangDitest = process.env['VITEST'] === 'true';
const connectionString = sedangDitest
  ? (process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'])
  : process.env['DATABASE_URL'];

if (!connectionString) {
  throw new Error(
    'DATABASE_URL belum diisi. Salin file .env.example menjadi .env dulu (lihat README).',
  );
}

export const pool = new Pool({ connectionString, max: 10 });

/** Kalau ada satu perintah yang gagal, semuanya dibatalkan. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hasil = await fn(client);
    await client.query('COMMIT');
    return hasil;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    // Wajib walau terjadi error, kalau tidak pool habis dan aplikasi menggantung.
    client.release();
  }
}
