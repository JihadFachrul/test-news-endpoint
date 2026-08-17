-- ===========================================================================
-- Skema database (PostgreSQL)
--
-- File ini adalah SATU-SATUNYA tempat bentuk tabel didefinisikan.
-- Dijalankan oleh: npm run db:setup
-- Tidak pernah dibuat lewat klik-klik di aplikasi GUI (syarat brief).
--
-- Semua perintah memakai "IF NOT EXISTS", jadi aman dijalankan berulang kali
-- dan tidak menghapus data yang sudah masuk.
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
-- Kalau nama mentah itu yang dihitung, endpoint
-- /mentions/stats?group_by=source akan melaporkan satu koran sebagai dua atau
-- tiga koran berbeda. Grafik dashboard-nya jadi salah.
--
-- Solusinya: nama mentah diterjemahkan SEKALI saja saat data masuk, jadi satu
-- "slug" yang tetap. Setiap berita cuma menunjuk ke baris di tabel ini.
CREATE TABLE IF NOT EXISTS sources (
    id           SERIAL PRIMARY KEY,

    -- Nama mesin yang tetap, mis. 'thestar'. Semua ejaan bermuara ke sini.
    slug         TEXT NOT NULL UNIQUE,

    -- Nama cantik untuk ditampilkan ke pengguna, mis. 'The Star'.
    display_name TEXT NOT NULL,

    -- Jenis kanalnya. CHECK dipakai supaya nilai ngawur ditolak database,
    -- bukan cuma diharapkan benar oleh kode program. 'other' adalah pintu
    -- keluar untuk sumber yang belum kita kenali.
    platform     TEXT NOT NULL
                 CHECK (platform IN ('news', 'twitter', 'facebook', 'instagram', 'other')),

    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- TABEL 2: mentions  ->  beritanya sendiri, sudah bersih
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mentions (
    id               BIGSERIAL PRIMARY KEY,

    -- Menunjuk ke tabel sources. Bukan menyimpan nama koran sebagai teks,
    -- supaya nama yang berantakan tidak bisa masuk dua kali.
    source_id        INTEGER NOT NULL REFERENCES sources (id),

    -- ID dari penyedia data. Disimpan hanya untuk pelacakan, TIDAK dipercaya
    -- sebagai identitas. Buktinya di data: record "nst-40021" punya ID
    -- berlabel NST, tapi URL-nya thestar.com.my. ID-nya bohong.
    external_id      TEXT,

    -- URL apa adanya, lalu versi yang sudah dirapikan (huruf kecil, tanpa
    -- "www.", tanpa parameter iklan seperti utm_source, tanpa garis miring di
    -- ujung) supaya dua link ke artikel yang sama jadi persis sama.
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

    -- Waktu terbit. TIMESTAMPTZ artinya PostgreSQL menyimpannya sebagai satu
    -- titik waktu absolut (dalam UTC), bukan sebagai "angka jam di dinding".
    --
    -- Ini penting karena data masuk dari TIGA zona waktu berbeda: ada yang
    -- pakai Z (UTC), ada +08:00, ada yang tanpa keterangan sama sekali. Kalau
    -- disimpan tanpa zona, tweet jam 14:02 WIB dan berita jam 08:00 UTC tidak
    -- bisa diurutkan dengan benar.
    --
    -- BOLEH KOSONG (NULL), dan itu penting: di data asli ada berita yang
    -- memang tidak punya tanggal (mkn-1201). Mengarang tanggal untuk berita
    -- itu akan merusak grafik "berita per hari" secara diam-diam.
    published_at     TIMESTAMPTZ,

    -- Nilai tanggal apa adanya sebelum diolah. Gunanya kalau nanti ada yang
    -- lapor "tanggalnya kok salah?", kita bisa lihat aslinya dikirim apa.
    published_at_raw TEXT,

    -- Di data asli, angka ini kadang dikirim sebagai teks: "1,204", "3,402".
    -- Disimpan sebagai bilangan supaya pengurutan benar. Kalau tetap teks,
    -- "9" akan dianggap lebih besar daripada "1,204".
    engagement       INTEGER CHECK (engagement IS NULL OR engagement >= 0),

    -- Sidik jari yang menentukan identitas satu berita.
    -- Cara menghitungnya dijelaskan di src/normalize/dedupe.ts.
    --
    -- UNIQUE di sini adalah kunci syarat "idempotent" dari brief: kalau file
    -- yang sama dikirim dua kali, database sendiri yang menolak salinannya.
    -- Penjaganya database, bukan pengecekan di kode program -- karena kalau
    -- dua permintaan datang bersamaan, pengecekan di kode bisa kebobolan
    -- (keduanya sama-sama melihat "belum ada", lalu keduanya menyimpan),
    -- sedangkan UNIQUE tidak bisa kebobolan.
    dedupe_key       TEXT NOT NULL UNIQUE,

    -- Berapa kali berita ini dikirim ke kita. Berguna untuk mendeteksi robot
    -- pengumpul data yang bermasalah.
    times_seen       INTEGER NOT NULL DEFAULT 1,

    first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- Kolom pencarian
-- ---------------------------------------------------------------------------
-- Ini keuntungan utama memakai PostgreSQL, bukan SQLite.
--
-- Cara kerjanya sederhana: PostgreSQL memecah judul + isi berita menjadi
-- daftar kata, dan menyimpannya di kolom ini. Kolomnya "GENERATED", artinya
-- PostgreSQL yang mengisi dan memperbaruinya SENDIRI setiap kali baris
-- berubah. Kita tidak pernah menulis ke kolom ini.
--
-- Kenapa dibuat begitu? Kalau kita mengisinya dari kode program, suatu hari
-- pasti ada jalur kode yang lupa memperbaruinya, dan hasil pencarian jadi
-- tidak cocok dengan isi datanya. Diserahkan ke database, itu mustahil.
--
-- setweight(..., 'A') memberi bobot lebih tinggi pada judul daripada isi,
-- supaya kata yang muncul di judul dianggap lebih relevan.
--
-- Kamus 'simple' dipilih, BUKAN 'english'. Alasannya: datanya campur Inggris
-- dan Melayu ("banjir", "kekal", "pinjaman rumah"). Kamus Inggris akan
-- memotong-motong kata Melayu secara ngawur sambil terlihat seolah-olah
-- paham. 'simple' hanya memecah kata apa adanya: jujur dan bisa ditebak.
--
-- Harga yang dibayar (ditulis di README): tanpa kamus bahasa, "flood" tidak
-- otomatis ketemu "floods".
ALTER TABLE mentions
    ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(content_clean, '')), 'B')
    ) STORED;


-- ---------------------------------------------------------------------------
-- Index: mempercepat pencarian yang memang kita layani
-- ---------------------------------------------------------------------------

-- Persis mengikuti urutan tampilan resmi kita:
--     ORDER BY published_at DESC NULLS LAST, id DESC
-- Index harus cocok dengan urutan yang dipakai, kalau tidak ya tidak terpakai.
CREATE INDEX IF NOT EXISTS mentions_published_at_idx
    ON mentions (published_at DESC NULLS LAST, id DESC);

-- Untuk GET /mentions?source=thestar : urutan sama, tapi disaring per koran.
CREATE INDEX IF NOT EXISTS mentions_source_idx
    ON mentions (source_id, published_at DESC NULLS LAST, id DESC);

-- Untuk mencari berita berdasarkan URL saat menelusuri data yang aneh.
-- Sebagian (WHERE ... IS NOT NULL) supaya baris tanpa URL tidak ikut
-- membebani index.
CREATE INDEX IF NOT EXISTS mentions_canonical_url_idx
    ON mentions (canonical_url)
    WHERE canonical_url IS NOT NULL;

-- Index khusus untuk pencarian kata. GIN adalah jenis index yang dirancang
-- untuk "satu baris berisi banyak kata" -- persis kasus kita.
CREATE INDEX IF NOT EXISTS mentions_search_idx
    ON mentions USING GIN (search_tsv);
