/**
 * Membuat tabel dari db/schema.sql. Jalankan: npm run db:setup
 * Aman diulang: semua perintah di schema.sql memakai IF NOT EXISTS.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from '../src/db.js';

const SCHEMA_PATH = fileURLToPath(new URL('../db/schema.sql', import.meta.url));

async function main(): Promise<void> {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');

  // Satu transaksi, supaya tidak ada tabel setengah jadi kalau ada yang gagal.
  await withTransaction(async (client) => {
    await client.query(schema);
  });

  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
  );

  console.log('Database siap.');
  console.log(`Tabel yang ada: ${rows.map((r) => r.table_name).join(', ')}`);
}

main()
  .catch((error: unknown) => {
    console.error('Gagal menyiapkan database:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
