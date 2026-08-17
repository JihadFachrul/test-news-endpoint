-- ===========================================================================
-- Skema database (SQLite)
--
-- File ini adalah SATU-SATUNYA tempat bentuk tabel didefinisikan.
-- Dijalankan oleh: npm run db:setup
-- Tidak pernah dibuat lewat klik-klik di aplikasi GUI (syarat brief).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- TABEL 1: sources  ->  daftar nama koran/platform yang sudah diseragamkan
-- ---------------------------------------------------------------------------
-- Masalah yang dipecahkan tabel ini:
-- Di seed_mentions.json, satu koran ditulis bermacam-macam:
--     "The Star"  dan  "thestar"
--     "Malaysiakini"  dan  "malaysiakini "   <- ada spasi di ujung
--     "twitter"  dan  "TWITTER"
--
-- Kalau nama mentah itu dipakai untuk menghitung, endpoint
-- /mentions/stats?group_by=source akan melaporkan satu koran sebagai dua atau
-- tiga koran berbeda. Grafik dashboard-nya jadi salah.
--
-- Solusinya: nama mentah diterjemahkan SEKALI saja saat data masuk, menjadi
-- satu "slug" yang tetap. Setiap berita cuma menunjuk ke baris di tabel ini.
CREATE TABLE IF NOT EXISTS sources (
    id           INTEGER PRIMARY KEY,

    -- Nama mesin yang tetap, mis. 'thestar'. Semua ejaan bermuara ke sini.
    slug         TEXT NOT NULL UNIQUE,

    -- Nama cantik untuk ditampilkan ke pengguna, mis. 'The Star'.
    display_name TEXT NOT NULL,

    -- Jenis kanalnya: 'news', 'twitter', 'facebook', 'instagram', atau
    -- 'other' untuk sumber yang belum kita kenali.
    platform     TEXT NOT NULL
);


-- ---------------------------------------------------------------------------
-- TABEL 2: mentions  ->  beritanya sendiri, sudah bersih
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mentions (
    id               INTEGER PRIMARY KEY,

    -- Menunjuk ke tabel sources. Bukan menyimpan nama koran sebagai teks,
    -- supaya nama yang berantakan tidak bisa masuk dua kali.
    source_id        INTEGER NOT NULL REFERENCES sources (id),

    -- ID dari penyedia data. Disimpan hanya untuk pelacakan, TIDAK dipercaya
    -- sebagai identitas. Buktinya di data: record "nst-40021" punya ID
    -- berlabel NST, tapi URL-nya thestar.com.my. ID-nya bohong.
    external_id      TEXT,

    -- URL apa adanya, lalu versi yang sudah dirapikan (huruf kecil, tanpa
    -- "www.", tanpa parameter iklan seperti utm_source, tanpa garis miring
    -- di ujung) supaya dua link ke artikel yang sama jadi persis sama.
    url              TEXT,
    canonical_url    TEXT,

    title            TEXT,

    -- Kontennya disimpan DUA KALI, dan ini disengaja:
    --   content_raw   = persis seperti yang dikirim, termasuk tag HTML-nya
    --   content_clean = teks bersih, yang dipakai untuk pencarian & tampilan
    --
    -- Alasannya: membersihkan data itu MENGHAPUS informasi. Kalau bulan depan
    -- ternyata aturan pembersihan kita salah, dengan menyimpan aslinya kita
    -- bisa menghitung ulang tanpa perlu minta data dikirim ulang. Kalau
    -- aslinya tidak disimpan, kesalahan jadi permanen.
    content_raw      TEXT,
    content_clean    TEXT NOT NULL DEFAULT '',

    author           TEXT,

    -- Waktu terbit, disimpan sebagai teks ISO 8601 dalam zona UTC, misalnya
    -- '2026-08-10T08:15:00.000Z'.
    --
    -- Kenapa teks, bukan angka? Karena format ini kalau diurutkan sebagai teks
    -- (A-Z) hasilnya sama dengan diurutkan sebagai waktu. Jadi ORDER BY tetap
    -- benar, dan isi kolomnya masih bisa dibaca mata manusia saat debugging.
    --
    -- BOLEH KOSONG (NULL), dan itu penting: di data asli ada berita yang
    -- memang tidak punya tanggal (mkn-1201). Mengarang tanggal untuk berita
    -- itu akan merusak grafik "berita per hari" secara diam-diam.
    published_at     TEXT,

    -- Nilai tanggal apa adanya sebelum diolah. Gunanya kalau nanti ada yang
    -- lapor "tanggalnya kok salah?", kita bisa lihat aslinya dikirim apa.
    published_at_raw TEXT,

    -- Di data asli, angka ini kadang dikirim sebagai teks: "1,204", "3,402".
    -- Disimpan sebagai bilangan supaya pengurutan benar. Kalau tetap teks,
    -- "9" akan dianggap lebih besar daripada "1,204".
    engagement       INTEGER,

    -- Sidik jari yang menentukan identitas satu berita.
    -- Cara menghitungnya dijelaskan di src/normalize/dedupe.ts.
    --
    -- UNIQUE di sini adalah kunci syarat "idempotent" dari brief: kalau file
    -- yang sama dikirim dua kali, database sendiri yang menolak salinannya.
    -- Penjaganya database, bukan pengecekan di kode program -- karena kalau
    -- dua permintaan datang bersamaan, pengecekan di kode bisa kebobolan,
    -- sedangkan UNIQUE tidak bisa.
    dedupe_key       TEXT NOT NULL UNIQUE,

    -- Berapa kali berita ini dikirim ke kita. Berguna untuk mendeteksi robot
    -- pengumpul data yang bermasalah.
    times_seen       INTEGER NOT NULL DEFAULT 1,

    first_seen_at    TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);


-- ---------------------------------------------------------------------------
-- Index: mempercepat pencarian yang memang kita layani
-- ---------------------------------------------------------------------------

-- Persis mengikuti urutan tampilan resmi kita:
--     ORDER BY published_at DESC, id DESC
-- Index harus cocok dengan urutan yang dipakai, kalau tidak ya tidak terpakai.
CREATE INDEX IF NOT EXISTS mentions_published_at_idx
    ON mentions (published_at DESC, id DESC);

-- Untuk GET /mentions?source=thestar : urutan sama, tapi disaring per koran.
CREATE INDEX IF NOT EXISTS mentions_source_idx
    ON mentions (source_id, published_at DESC, id DESC);

-- Untuk mencari berita berdasarkan URL saat menelusuri data yang aneh.
CREATE INDEX IF NOT EXISTS mentions_canonical_url_idx
    ON mentions (canonical_url);
