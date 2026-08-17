/**
 * Sambungan ke database PostgreSQL.
 */
import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';

const connectionString = process.env['DATABASE_URL'];

if (!connectionString) {
  throw new Error(
    'DATABASE_URL belum diisi. Salin file .env.example menjadi .env dulu (lihat README).',
  );
}

/**
 * Pool = kumpulan sambungan yang dipakai bergantian.
 *
 * Membuka sambungan baru ke PostgreSQL itu mahal (ada proses jabat tangan
 * jaringan setiap kali). Pool membuka beberapa sekali saja, lalu meminjamkannya
 * bergantian ke setiap permintaan yang masuk.
 */
export const pool = new Pool({ connectionString, max: 10 });

/**
 * Menjalankan beberapa perintah SQL sebagai satu paket: kalau ada satu yang
 * gagal, SEMUANYA dibatalkan dan database kembali seperti sebelum dimulai.
 *
 * Dipakai saat memasukkan data massal, supaya tidak ada kiriman yang tersimpan
 * setengah jadi.
 */
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
    // Sambungannya dikembalikan ke pool, bukan ditutup. Wajib dilakukan walau
    // terjadi error, kalau tidak pool akan habis dan aplikasi menggantung.
    client.release();
  }
}
