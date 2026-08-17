/**
 * Membuat database dari db/schema.sql.
 *
 * Jalankan: npm run db:setup
 *
 * Aman dijalankan berulang kali: semua perintah di schema.sql memakai
 * "IF NOT EXISTS", jadi menjalankannya dua kali tidak merusak apa pun dan
 * tidak menghapus data yang sudah masuk.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DB_PATH, openDb } from '../src/db.js';

const SCHEMA_PATH = fileURLToPath(new URL('../db/schema.sql', import.meta.url));

function main(): void {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const db = openDb();

  // Dibungkus satu transaksi: kalau ada satu perintah SQL yang gagal, tidak
  // ada tabel setengah jadi yang tertinggal.
  db.exec('BEGIN');
  try {
    db.exec(schema);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const tables = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);

  console.log(`Database siap: ${DB_PATH}`);
  console.log(`Tabel yang ada: ${tables.join(', ')}`);
  db.close();
}

try {
  main();
} catch (error) {
  console.error('Gagal menyiapkan database:', error);
  process.exit(1);
}
