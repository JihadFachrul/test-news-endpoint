import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * Berkas tes dijalankan SATU PER SATU, tidak berbarengan.
     *
     * Alasannya bukan gaya, tapi keharusan: dua berkas tes menyentuh database
     * yang sama. Salah satunya menjalankan TRUNCATE di dalam transaksi, yang
     * mengunci tabel sampai transaksinya selesai. Kalau berkas lain berjalan
     * berbarengan, keduanya akan saling menunggu, dan tesnya menggantung.
     *
     * Seluruh rangkaian tes cuma beberapa detik, jadi tidak ada yang hilang.
     */
    fileParallelism: false,
  },
});
