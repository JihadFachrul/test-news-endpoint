-- Skema database. Satu-satunya tempat bentuk tabel didefinisikan.
-- Dijalankan oleh: npm run db:setup
--
-- Semua perintah memakai IF NOT EXISTS, jadi aman dijalankan berulang dan
-- tidak menghapus data yang sudah masuk.


-- Daftar koran/platform yang sudah diseragamkan.
--
-- Di data feed satu koran ditulis bermacam ejaan: "The Star"/"thestar",
-- "malaysiakini " berspasi, "twitter"/"TWITTER". Kalau nama mentah itu yang
-- dihitung, group_by=source melaporkan satu koran sebagai dua atau tiga. Jadi
-- nama mentah diterjemahkan sekali saat data masuk, dan setiap berita cuma
-- menunjuk ke baris di sini.
CREATE TABLE IF NOT EXISTS sources (
    id           SERIAL PRIMARY KEY,
    slug         TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    -- CHECK, bukan sekadar diharapkan benar oleh kode aplikasi.
    platform     TEXT NOT NULL
                 CHECK (platform IN ('news', 'twitter', 'facebook', 'instagram', 'other')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS mentions (
    id               BIGSERIAL PRIMARY KEY,
    source_id        INTEGER NOT NULL REFERENCES sources (id),

    -- Disimpan untuk pelacakan, tidak dipercaya sebagai identitas: nst-40021
    -- punya ID berlabel NST tapi URL-nya thestar.com.my.
    external_id      TEXT,

    url              TEXT,
    -- URL tanpa parameter iklan, www., dan garis miring di ujung, supaya dua
    -- link ke artikel yang sama jadi persis sama.
    canonical_url    TEXT,

    title            TEXT,

    -- Disimpan dua kali dengan sengaja. Membersihkan itu menghapus informasi;
    -- kalau aturannya ternyata salah, content_clean bisa dihitung ulang dari
    -- content_raw tanpa minta data dikirim ulang.
    content_raw      TEXT,
    content_clean    TEXT NOT NULL DEFAULT '',

    author           TEXT,

    -- TIMESTAMPTZ karena data masuk dari tiga kebiasaan zona waktu (Z, +08:00,
    -- dan tanpa keterangan). Boleh kosong: data feed memang mengirim berita
    -- tanpa tanggal, dan mengarangnya akan merusak grafik harian diam-diam.
    published_at     TIMESTAMPTZ,
    -- Nilai mentahnya, untuk menelusuri laporan "tanggalnya salah".
    published_at_raw TEXT,

    -- Di data kadang dikirim sebagai teks ("1,204"). Disimpan sebagai bilangan
    -- supaya pengurutan benar.
    engagement       INTEGER CHECK (engagement IS NULL OR engagement >= 0),

    -- Identitas berita; cara menghitungnya di src/normalize/dedupe.ts.
    --
    -- UNIQUE inilah inti syarat idempotent, dan penjaganya database bukan kode:
    -- pengecekan "SELECT dulu, INSERT kemudian" bisa kebobolan kalau dua
    -- permintaan datang bersamaan, index unik tidak bisa.
    dedupe_key       TEXT NOT NULL UNIQUE,

    -- Berapa kali berita ini dikirim ke kita.
    times_seen       INTEGER NOT NULL DEFAULT 1,

    first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Kolom pencarian, diisi dan diperbarui PostgreSQL sendiri setiap baris
-- berubah, sehingga index pencarian mustahil melenceng dari isinya.
--
-- Kamus 'simple', bukan 'english': datanya campur Inggris-Melayu, dan kamus
-- Inggris akan memotong kata Melayu secara ngawur. Harganya, "flood" tidak
-- otomatis menemukan "floods".
ALTER TABLE mentions
    ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(content_clean, '')), 'B')
    ) STORED;


-- Persis mengikuti urutan tampilan resmi; kalau tidak cocok, index tidak dipakai.
CREATE INDEX IF NOT EXISTS mentions_published_at_idx
    ON mentions (published_at DESC NULLS LAST, id DESC);

-- Urutan yang sama, disaring per koran: GET /mentions?source=...
CREATE INDEX IF NOT EXISTS mentions_source_idx
    ON mentions (source_id, published_at DESC NULLS LAST, id DESC);

-- Sebagian, supaya postingan sosmed tanpa URL tidak ikut membebani.
CREATE INDEX IF NOT EXISTS mentions_canonical_url_idx
    ON mentions (canonical_url)
    WHERE canonical_url IS NOT NULL;

-- GIN dirancang untuk "satu baris berisi banyak kata".
CREATE INDEX IF NOT EXISTS mentions_search_idx
    ON mentions USING GIN (search_tsv);
