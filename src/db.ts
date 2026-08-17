/**
 * Sambungan ke database PostgreSQL.
 */
import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';

/**
 * Saat dijalankan oleh tes, TEST_DATABASE_URL dipakai kalau tersedia.
 *
 * Kenapa perlu? Karena tes integrasi mengosongkan tabel sebelum bekerja. Tanpa
 * pemisahan ini, siapa pun yang menjalankan `npm test` setelah memasukkan data
 * akan kehilangan datanya -- kejutan yang tidak menyenangkan. Kalau
 * TEST_DATABASE_URL tidak diisi, tes memakai database biasa dan itu tetap
 * aman, hanya saja tabelnya jadi kosong setelah tes selesai.
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
