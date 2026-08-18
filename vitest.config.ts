import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Dua berkas tes menyentuh database yang sama, dan salah satunya memegang
    // kunci tabel di dalam transaksi. Kalau berjalan berbarengan, keduanya
    // saling menunggu dan tesnya menggantung.
    fileParallelism: false,
  },
});
