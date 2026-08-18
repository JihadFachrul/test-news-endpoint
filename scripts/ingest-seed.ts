/**
 * Memasukkan seed_mentions.json. Jalankan: npm run ingest
 *
 * Jalan pintas untuk mencoba tanpa curl. Memanggil ingestMentions() yang sama
 * dengan endpoint, jadi tidak ada jalur kode kedua yang bisa berbeda.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';
import { ingestMentions } from '../src/ingest.js';

const SEED_PATH = fileURLToPath(new URL('../seed_mentions.json', import.meta.url));

async function main(): Promise<void> {
  const records = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as unknown[];
  const laporan = await ingestMentions(records);

  console.log('');
  console.log(`  Diterima         : ${laporan.received} record`);
  console.log(`  Baris baru       : ${laporan.inserted}`);
  console.log(`  Duplikat digabung: ${laporan.merged}`);
  console.log(`  Bentuknya rusak  : ${laporan.invalid}`);

  if (laporan.warnings.length > 0) {
    console.log('');
    console.log(`  Peringatan (${laporan.warnings.length} record):`);
    for (const w of laporan.warnings) {
      console.log(`    [${w.index}] ${w.externalId ?? '(tanpa id)'}`);
      for (const pesan of w.messages) console.log(`         - ${pesan}`);
    }
  }

  console.log('');
  console.log('  Coba jalankan lagi perintah ini: jumlah baris tidak akan bertambah.');
  console.log('');
}

main()
  .catch((error: unknown) => {
    console.error('Gagal memasukkan data:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
