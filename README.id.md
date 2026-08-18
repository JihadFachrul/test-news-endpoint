# Media Monitoring — Masukkan Data, Cari, Hitung

Sepotong kecil sistem pemantauan media: satu endpoint untuk memasukkan data
massal, satu untuk mencari, satu untuk menghitung, dengan database PostgreSQL.

> 🇬🇧 **English version: [README.md](README.md)** — versi itulah yang dibaca
> penilai. Halaman ini terjemahannya, isinya sama.

---

## Isi

- [Yang dibutuhkan](#yang-dibutuhkan)
- [Cara menjalankan](#cara-menjalankan)
- [Halaman dashboard](#halaman-dashboard)
- [Daftar endpoint](#daftar-endpoint)
- [Bentuk tabel, dan alasannya](#bentuk-tabel-dan-alasannya)
- [Aturan duplikat, dan alasannya](#aturan-duplikat-dan-alasannya)
- [Asumsi yang saya ambil](#asumsi-yang-saya-ambil)
- [Pertukaran yang saya terima sadar](#pertukaran-yang-saya-terima-sadar)
- [Tes](#tes)
- [Waktu yang dipakai](#waktu-yang-dipakai)
- [Kalau ada seminggu lagi](#kalau-ada-seminggu-lagi)
- [Yang sengaja tidak dibuat](#yang-sengaja-tidak-dibuat)

---

## Yang dibutuhkan

| | Versi | Kenapa minimal segitu |
|---|---|---|
| Node.js | **20.11+** | Dikembangkan dan diuji di 20.11.0 |
| PostgreSQL | **12+** | Kolom `GENERATED ALWAYS AS … STORED` butuh 12+, dan `websearch_to_tsquery` butuh 11+. Diuji di 17.2 |

Tanpa Docker, tanpa ORM, dan tidak perlu proses build untuk menjalankannya.

---

## Cara menjalankan

### 1. Pasang

```bash
git clone <alamat-repo>
cd <nama-folder>
npm install
```

### 2. Buat databasenya

```bash
createdb media_monitoring
```

Atau dari dalam `psql`, kalau `createdb` tidak ada di PATH:

```sql
CREATE DATABASE media_monitoring;
```

### 3. Arahkan aplikasi ke database itu

```bash
copy .env.example .env      # Windows
cp .env.example .env        # Mac / Linux
```

Lalu buka `.env` dan sesuaikan `DATABASE_URL` dengan PostgreSQL Anda:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/media_monitoring
PORT=3000
```

### 4. Buat tabelnya

```bash
npm run db:setup
```

```
Database siap.
Tabel yang ada: mentions, sources
```

Perintah ini membaca [`db/schema.sql`](db/schema.sql) — satu-satunya file yang
mendefinisikan bentuk tabel, dan file itu ikut di-commit. Aman dijalankan
berulang kali: semua perintah memakai `IF NOT EXISTS`, dan seluruh isinya
dijalankan dalam satu transaksi sehingga kegagalan tidak meninggalkan tabel
setengah jadi.

### 5. Nyalakan server

```bash
npm run dev
```

Server mendengarkan di `http://127.0.0.1:3000`. Buka di browser, dan Anda akan
melihat daftar endpoint yang tersedia.

Versi hasil build (seperti di produksi):

```bash
npm run build
npm start
```

### 6. Masukkan data seed

Lewat endpoint:

```bash
curl -X POST http://127.0.0.1:3000/internal/mentions/bulk \
  -H "Content-Type: application/json" \
  --data-binary @seed_mentions.json
```

Atau lewat skrip jalan pintas, yang tidak butuh server maupun curl:

```bash
npm run ingest
```

```
  Diterima         : 15 record
  Baris baru       : 12
  Duplikat digabung: 3
  Bentuknya rusak  : 0
```

**Jalankan kedua kali — jumlah barisnya tidak berubah.** Itulah syarat
*idempotent*, dan yang menjaganya adalah database, bukan kode program. Endpoint
dan skrip sama-sama memanggil fungsi `ingestMentions()` yang sama, jadi tidak
ada jalur kode kedua yang bisa berbeda perilakunya.

### 7. Coba

Cara tercepat: **buka <http://127.0.0.1:3000> di browser** — di situ ada halaman
dashboard baca-saja, dijelaskan [di bawah](#halaman-dashboard).

Atau lewat curl:

```bash
curl "http://127.0.0.1:3000/mentions?q=ringgit"
curl "http://127.0.0.1:3000/mentions?source=The%20Star&limit=5"
curl "http://127.0.0.1:3000/mentions?from=2026-08-13&to=2026-08-13"
curl "http://127.0.0.1:3000/mentions/stats?group_by=source"
curl "http://127.0.0.1:3000/mentions/stats?group_by=day"
```

---

## Halaman dashboard

![Halaman dashboard](docs/dashboard.png)

Opsional menurut brief dan tidak dinilai — gunanya supaya API ini bisa dilihat
bekerja tanpa membuka curl atau Postman. Alamatnya `/`; daftar endpoint dalam
bentuk JSON dipindah ke `/api`.

Satu berkas, [`public/index.html`](public/index.html): tanpa proses build, tanpa
framework, dan tidak memuat apa pun dari internet, jadi tetap jalan walau
sedang offline. Dilayani dengan `readFile`, tanpa memasang paket pelayan berkas
statis — untuk satu berkas, satu paket tambahan tidak sepadan.

Halaman ini hanya memanggil endpoint milik layanan ini sendiri, dan
menunjukkan yang mana saja:

- **Alamat permintaan yang sedang dipakai ditampilkan** dan berubah mengikuti
  saringan, jadi bisa langsung disalin ke `curl`.
- **Urutan tampilan ditampilkan** sesuai yang dikembalikan API, bukan ditulis
  ulang di halaman.
- **Grafik harian menyebut zona waktunya**, dan daftar beritanya menampilkan jam
  dalam waktu Malaysia supaya daftar dan grafiknya sepakat.
- **Berita tanpa tanggal tetap muncul** — sebagai baris miring `no date` di
  bagian bawah daftar, dan sebagai ember `tanpa tanggal` di ujung grafik.
- **Kolom `Seen`** menampilkan `times_seen`, jadi duplikat yang sudah digabung
  kelihatan: artikel ringgit menunjukkan 3, artikel GDP menunjukkan 2.
- **Kesalahan parameter ditampilkan lengkap**, termasuk pesan rinci per
  parameter — justru bagian paling berguna saat sedang mencoba-coba API.

Setiap teks dari API masuk ke halaman lewat `textContent`, bukan `innerHTML`.
Servernya sudah membuang kode berbahaya, jadi ini lapis kedua: seandainya ada
yang lolos, ia akan tampil sebagai tulisan biasa alih-alih dijalankan. Satu
record di data seed memang menyelipkan `<script>alert(1)</script>` yang hidup,
jadi kekhawatirannya bukan mengada-ada.

---

## Daftar endpoint

### `POST /internal/mentions/bulk`

Menerima array JSON telanjang berisi record mentah — persis bentuk
`seed_mentions.json`.

**Idempotent.** Mengirim file yang sama berapa kali pun menghasilkan baris yang
sama.

```json
{
  "received": 15,
  "inserted": 12,
  "merged": 3,
  "invalid": 0,
  "errors": [],
  "warnings": [
    {
      "index": 5,
      "externalId": "mkn-1201",
      "messages": ["published_at kosong; mention tetap disimpan tapi tidak ikut saringan tanggal"]
    }
  ]
}
```

Mengembalikan **200**, bukan 201: kiriman kedua tidak membuat apa pun, jadi
`201 Created` akan menyesatkan.

Record yang bentuknya tidak bisa dipakai (bukan objek JSON) **dilewati dan
dilaporkan**, tidak dianggap fatal. Record rusak akan tetap rusak berapa kali
pun dicoba ulang, jadi kalau ia membatalkan seluruh kiriman, satu record busuk
bisa menyandera 14 record sehat selamanya. Sebaliknya, kalau **database**-nya
yang bermasalah, seluruh kiriman dibatalkan — itu biasanya sementara dan aman
untuk dicoba ulang.

Setiap nilai yang meragukan tapi masih bisa dipakai menghasilkan peringatan,
bukan kesunyian, supaya sumber data yang mulai rusak kelihatan alih-alih
terserap diam-diam.

### `GET /mentions`

| Parameter | Artinya |
|---|---|
| `q` | Cari kata kunci di judul dan isi berita |
| `source` | Saring per koran. Menerima slug (`thestar`) **atau** nama biasa (`The Star`, `THE STAR`) |
| `from` | Batas awal tanggal, termasuk hari itu |
| `to` | Batas akhir tanggal. Kalau diisi tanggal saja, **seluruh hari itu** ikut |
| `limit` | Baris per halaman, 1–100, bawaan 20 |
| `offset` | Baris yang dilewati, bawaan 0 |

`GET /mentions?q=ringgit`, setelah data seed dimasukkan satu kali:

```json
{
  "pagination": { "limit": 20, "offset": 0, "total": 1, "returned": 1, "has_more": false },
  "sort": "published_at DESC NULLS LAST, id DESC",
  "filters": { "q": "ringgit", "source": null, "from": null, "to": null },
  "data": [
    {
      "id": 1,
      "source": { "slug": "thestar", "name": "The Star", "platform": "news" },
      "external_id": "str-99120",
      "title": "Ringgit strengthens against US dollar in early trade",
      "content": "The ringgit opened higher against the greenback on Monday, buoyed by improved sentiment.",
      "url": "https://www.thestar.com.my/business/2026/08/10/ringgit-strengthens",
      "author": "Aisyah Rahman",
      "published_at": "2026-08-10T08:15:00.000Z",
      "engagement": 1204,
      "times_seen": 3
    }
  ]
}
```

Satu baris, bukan tiga. Ketiga salinan artikel ini — `str-99120` dua kali
ditambah `nst-40021` — menyatu ke dalamnya: `engagement` mengambil yang
tertinggi dari 412 / 415 / `"1,204"`, `published_at` mengambil yang paling awal
antara 08:15 dan 08:20, penulisnya diisi dari salinan yang punya, dan
`times_seen` menghitung ketiga kiriman itu.

`content` adalah teks yang **sudah bersih**. HTML aslinya tetap tersimpan di
database tapi tidak pernah keluar lewat API — salah satu record seed menyelipkan
kode `<script>alert(1)</script>` yang hidup.

Parameter yang salah mengembalikan **400** dengan *seluruh* masalahnya
disebutkan sekaligus, supaya pemakainya tidak perlu mencoba berulang kali untuk
menemukannya satu per satu:

```json
{
  "error": "Parameter pencarian tidak valid.",
  "detail": [
    "from=\"besok\" bukan tanggal yang bisa dibaca. Contoh yang benar: 2026-08-11 atau 2026-08-11T00:00:00Z",
    "limit=9999 di luar rentang yang diizinkan (1-100).",
    "offset=\"abc\" harus berupa bilangan bulat."
  ]
}
```

#### Urutan tampilan

```
ORDER BY published_at DESC NULLS LAST, id DESC
```

Nilainya dikembalikan di setiap respon sebagai `sort`, jadi pemakai API tidak
perlu menebak. Tiga bagian, tiga alasan:

- **`published_at DESC`** — terbaru di atas, itu yang diinginkan analis.
- **`NULLS LAST` harus ditulis eksplisit.** Pada urutan `DESC`, PostgreSQL
  menganggap `NULL` sebagai nilai *terbesar*, jadi tanpa ini berita tanpa
  tanggal justru nangkring di atas halaman pertama.
- **`id DESC` adalah pemecah seri, dan ini bagian terpentingnya.** Beberapa
  berita bisa punya `published_at` sama persis. Kalau urutannya seri, PostgreSQL
  bebas mengembalikan urutan mana pun, dan urutannya boleh berbeda antar
  permintaan — sehingga halaman 2 bisa mengulang baris dari halaman 1 sementara
  baris lain **tidak pernah muncul di halaman mana pun**. Karena `id` unik,
  menambahkannya membuat urutannya pasti. Ada tesnya: menyusuri tiga halaman
  berturut-turut dan memastikan 12 id unik tanpa celah. Tes itu gagal kalau
  pemecah serinya dihapus.

### `GET /mentions/stats`

`?group_by=source` — jumlah per koran:

```json
{
  "group_by": "source",
  "filters": { "q": null, "source": null, "from": null, "to": null },
  "total": 12,
  "data": [
    { "source": "nst", "name": "New Straits Times", "platform": "news", "total": 3 },
    { "source": "thestar", "name": "The Star", "platform": "news", "total": 3 },
    { "source": "malaysiakini", "name": "Malaysiakini", "platform": "news", "total": 2 },
    { "source": "twitter", "name": "Twitter / X", "platform": "twitter", "total": 2 },
    { "source": "facebook", "name": "Facebook", "platform": "facebook", "total": 1 },
    { "source": "instagram", "name": "Instagram", "platform": "instagram", "total": 1 }
  ]
}
```

Diurutkan dari yang terbanyak, lalu slug secara A–Z. Pemecah serinya penting di
sini juga: beberapa koran bisa punya jumlah yang sama, dan tanpa itu batang
grafiknya akan bertukar tempat setiap halaman disegarkan, lalu alatnya terlihat
rusak.

`?group_by=day` — jumlah per hari:

```json
{
  "group_by": "day",
  "timezone": "Asia/Kuala_Lumpur",
  "total": 12,
  "data": [
    { "day": "2026-08-15", "label": "2026-08-15", "total": 3 },
    { "day": "2026-08-14", "label": "2026-08-14", "total": 1 },
    { "day": "2026-08-13", "label": "2026-08-13", "total": 2 },
    { "day": "2026-08-12", "label": "2026-08-12", "total": 2 },
    { "day": "2026-08-11", "label": "2026-08-11", "total": 3 },
    { "day": "2026-08-10", "label": "2026-08-10", "total": 1 }
  ]
}
```

Berita tanpa tanggal **tidak dibuang**. Mereka dikumpulkan di ember sendiri di
akhir daftar:

```json
{ "day": null, "label": "tanpa tanggal", "total": 1 }
```

Kedua bentuk menerima saringan `q` / `source` / `from` / `to` yang sama dengan
`GET /mentions`, supaya grafik dashboard bisa mengikuti saringan yang aktif.

`group_by` wajib diisi; selain `source` atau `day` akan ditolak dengan 400 dan
disebutkan pilihan yang benar.

#### Saringannya kode bersama, bukan kode kembar

`q`, `source`, `from`, dan `to` dibaca dan diubah menjadi SQL di satu modul,
[`src/filters.ts`](src/filters.ts), yang dipakai ketiga endpoint.

Ini soal kebenaran, bukan kerapian. Di sebuah dashboard, grafik dan daftarnya
harus mencerminkan saringan yang sama. Kalau ditulis dua kali, suatu hari satu
salinan diubah dan yang lain lupa diikutkan — grafik menunjukkan 8 sementara
daftarnya memuat 12, dan analis berhenti mempercayai seluruh alatnya. Dengan
satu sumber kebenaran, ketidakcocokan itu mustahil.

Diperiksa untuk tujuh kombinasi saringan — `/mentions`, `stats=source`, dan
`stats=day` selalu sepakat soal totalnya:

| Saringan | `/mentions` | `stats=source` | `stats=day` |
|---|---|---|---|
| *(tanpa saringan)* | 12 | 12 | 12 |
| `q=tourism` | 2 | 2 | 2 |
| `source=The Star` | 3 | 3 | 3 |
| `from=2026-08-13&to=2026-08-13` | 2 | 2 | 2 |
| `q=banjir` | 1 | 1 | 1 |
| `q=flood&source=malaysiakini` | 1 | 1 | 1 |
| `from=2026-08-11&to=2026-08-15` | 11 | 11 | 11 |

---

## Bentuk tabel, dan alasannya

Didefinisikan di satu file yang ikut di-commit: [`db/schema.sql`](db/schema.sql).
Tanpa ORM, tanpa tabel buatan GUI. File itu sendiri memuat alasan lengkapnya di
dalam komentar; ini ringkasannya.

### `sources` — satu baris per koran/platform

```sql
id · slug (UNIQUE) · display_name · platform (CHECK) · created_at
```

Data feed menulis satu koran dengan bermacam ejaan: `"The Star"` / `"thestar"`,
`"Malaysiakini"` / `"malaysiakini "` (spasi di ujung), `"twitter"` / `"TWITTER"`.

Menghitung berdasarkan teks mentah itu akan melaporkan satu koran sebagai dua
atau tiga di `group_by=source`, dan dashboard-nya jadi salah. Jadi nama mentah
diterjemahkan **sekali saja, saat data masuk**, menjadi slug yang tetap, dan
setiap berita menunjuk ke baris itu alih-alih membawa nama bebas.

`platform` memakai `CHECK`, bukan mengandalkan kode program: nilai ngawur
ditolak oleh database, bukan sekadar diharapkan tidak terjadi.

### `mentions` — satu baris per berita

```sql
id · source_id → sources(id) · external_id · url · canonical_url · title
content_raw · content_clean · author
published_at (TIMESTAMPTZ, boleh kosong) · published_at_raw
engagement (INTEGER, CHECK ≥ 0) · dedupe_key (UNIQUE)
times_seen · first_seen_at · updated_at · search_tsv (GENERATED)
```

Enam keputusan yang perlu bisa dibela:

**1. Isi berita disimpan dua kali — `content_raw` dan `content_clean`.**
Membersihkan itu operasi yang menghapus informasi. Kalau bulan depan aturan
pembersihannya ternyata salah, dengan menyimpan aslinya kolom turunannya bisa
dihitung ulang dari yang sudah ada, tanpa perlu minta data dikirim ulang. Tanpa
itu, kesalahan pembersihan jadi permanen. Ini juga jawaban untuk *"aturan
duplikatmu salah menggabungkan dua artikel — bagaimana memperbaikinya?"*: hitung
ulang `dedupe_key` dari `content_raw` lewat satu migration. Tanpa memasukkan
data ulang.

**2. `published_at` boleh kosong, dan itu disengaja.**
Data feed memang mengirim berita tanpa tanggal (`mkn-1201`). Mengarang tanggal
akan merusak grafik harian secara diam-diam, dan nilai salah yang tampak
meyakinkan itu lebih buruk daripada kekosongan yang diakui.

**3. `published_at_raw` menyimpan teks aslinya.**
Kalau ada yang lapor "tanggalnya salah", kita bisa lihat penyedia data
sebenarnya mengirim apa. Itu yang membedakan sistem yang bisa ditelusuri dari
sistem yang hanya bisa ditebak.

**4. `TIMESTAMPTZ`, bukan `TIMESTAMP`.**
Data datang dari tiga kebiasaan zona waktu berbeda — `Z`, `+08:00`, dan tanpa
keterangan sama sekali. Disimpan sebagai titik waktu absolut, pengurutan lintas
zona dijamin oleh database, bukan oleh kesepakatan tak tertulis.

**5. `UNIQUE (dedupe_key)` inilah yang membuat pemasukan data idempotent.**
Penjaganya database, bukan aplikasi. Pengecekan "SELECT dulu, INSERT kemudian"
di kode punya celah: dua permintaan bersamaan sama-sama melihat "belum ada", lalu
keduanya menyimpan. Index unik tidak bisa dikelabui begitu.

**6. `search_tsv` adalah kolom `GENERATED`.**
PostgreSQL sendiri yang mengisi dan memeliharanya setiap kali baris berubah,
sehingga index pencarian mustahil melenceng dari baris yang diwakilinya. Kalau
diisi dari kode program, suatu hari akan ada jalur kode baru yang lupa
memperbaruinya, dan pencariannya mulai berbohong. Diserahkan ke database, itu
mustahil terjadi.

Kamusnya **`simple`**, bukan `english`. Datanya campur Inggris dan Melayu —
*banjir*, *kekal*, *pinjaman rumah*. Kamus Inggris akan memotong-motong kata
Melayu sambil tampak seolah memahaminya. `simple` hanya memecah pada batas kata:
jujur dan bisa ditebak. Harganya ada di
[bagian pertukaran](#pertukaran-yang-saya-terima-sadar).

### Index

Masing-masing dibuat untuk permintaan yang benar-benar dilayani layanan ini:

| Index | Untuk apa |
|---|---|
| `(published_at DESC NULLS LAST, id DESC)` | urutan tampilan resmi, persis |
| `(source_id, published_at DESC NULLS LAST, id DESC)` | `?source=…` dengan urutan yang sama |
| `(canonical_url) WHERE canonical_url IS NOT NULL` | menelusuri berita lewat URL-nya. Sebagian, supaya postingan sosmed tanpa URL tidak membebani |
| `GIN (search_tsv)` | pencarian kata `?q=…` |

---

## Aturan duplikat, dan alasannya

Brief sengaja membiarkan ini terbuka, jadi ini aturannya beserta alasannya.

### Aturannya

```
dedupe_key = sha256( slug_koran + "|" + sidik_jari(judul atau isi) )
```

`sidik_jari()` mengecilkan semua huruf, membuang tanda baca dan emoji,
merapatkan spasi, lalu mengambil 300 huruf pertama. Ada di
[`src/normalize/dedupe.ts`](src/normalize/dedupe.ts).

Ditegakkan oleh `UNIQUE (dedupe_key)` ditambah `ON CONFLICT DO UPDATE`.

### Empat tingkat kemiripan — dan di mana saya berhenti

Data seed memuat keempatnya:

| | Contoh | Berita yang sama? |
|---|---|---|
| 1. ID dan koran sama persis | `str-99120` dua kali | **Ya** |
| 2. URL sama, ID dan nama berbeda | `str-99120` vs `nst-40021` | **Ya** |
| 3. Isi sama, koran sama, URL baru | `mkn-1201` vs `mkn-1202` | **Ya** |
| 4. Berita sama, **koran berbeda** | The Star vs NST soal turis | **Tidak — dua berita** |

**Tingkat 4 itu garisnya, dan ini keputusan produk, bukan keputusan teknis.**
Godaannya besar untuk menggabungkan: angkanya sama, harinya sama, judulnya
nyaris sama. Tapi alat pemantau media ada untuk memberi tahu analis PR *berapa
koran yang mengangkat beritanya*. Menggabungkan antar koran menghapus satu
metrik paling bernilai di produk itu.

Memasukkan `slug_koran` ke dalam hash membuat penggabungan itu **mustahil secara
struktur**, dan itulah pengaman yang layak dimiliki. Prinsipnya: duplikat yang
lolos itu cuma berisik, tapi data yang hilang itu bohong. Saya pilih berisik.

### Kenapa sidik jarinya menutup tingkat 1–3

| Nilai di data | Setelah `sidik_jari()` |
|---|---|
| `Ringgit strengthens against US dollar in early trade` | `ringgit strengthens against us dollar in early trade` |
| `Ringgit Strengthens Against US Dollar In Early Trade` | ← sama persis |
| `Analysts split on second-half GDP outlook` | `analysts split on second half gdp outlook` |
| `Analysts split on second half GDP outlook` | ← sama persis (tanda hubungnya dibuang) |

Judul dipakai lebih dulu, karena judul adalah ringkasan paling stabil dari
sebuah artikel dan tidak berubah walau isinya disunting. Postingan sosmed tidak
punya judul, jadi isi postingannya *itulah* judulnya. Kalau tidak punya judul
maupun isi — tidak ada di data ini, tapi pipeline sungguhan pasti akan
mengalaminya — baru jatuh ke URL, lalu ke ID penyedia, supaya record tanpa teks
mendapat kunci masing-masing alih-alih semuanya bertabrakan di hash teks kosong.

### Kenapa bukan `external_id`

Karena bohong. Record `nst-40021` punya ID berlabel NST (`nst-`) padahal URL-nya
`thestar.com.my`. Keterangan penyedia data itu pengakuan, bukan bukti.

### Kenapa bukan URL

`mkn-1201` dan `mkn-1202` adalah artikel yang sama di `/news/1201` dan
`/news/1202`. URL itu *alamat*, bukan *identitas*, dan sistem penerbitan berita
rutin mengganti alamat.

`canonical_url` tetap disimpan dan diberi index — dengan parameter iklan,
`www.`, garis miring di ujung, dan tanda pagar dibuang, supaya dua link ke satu
artikel jadi persis sama. Memakainya sebagai pemeriksa *kedua*, untuk kasus
sebaliknya (URL sama, judul diedit redaksi), ada di
[daftar seminggu lagi](#kalau-ada-seminggu-lagi).

### Bagaimana duplikat digabung

Bukan dibuang — digabung, masing-masing dengan alasannya:

| Kolom | Aturan | Kenapa |
|---|---|---|
| `engagement` | **tertinggi** | Like dan share hanya bertambah, jadi angka terbesar adalah pengukuran terbaru. Di data: 412 → 415 → 1204 |
| `published_at` | **paling awal** | Sebuah artikel punya satu waktu terbit asli; selisih beberapa menit antar salinan itu jeda robot pengumpul, bukan penerbitan ulang |
| `published_at_raw` | yang **sepadan** dengan `published_at` yang dipilih | Kalau tidak, kolom audit ini menampilkan nilai mentah dari salinan lain dan justru menyesatkan orang yang sedang menelusuri masalah |
| `author`, `title`, `url`, `external_id` | pertahankan yang ada, **isi kalau kosong** | `str-99120` penulisnya "Aisyah Rahman"; salinannya `nst-40021` penulisnya `null` |
| isi berita | yang **lebih panjang** menang | Biasanya lebih lengkap. `str-99120` berakhir "…buoyed by improved sentiment"; salinannya terpotong |
| `times_seen` | **+1** | Berguna untuk mendeteksi robot pengumpul yang bermasalah |

`GREATEST` dan `LEAST` di PostgreSQL mengabaikan `NULL` dan hanya menghasilkan
`NULL` kalau semua isinya `NULL` — persis perilaku "ambil dari salinan yang
punya nilai" yang dibutuhkan di sini.

`times_seen` sekaligus jadi penanda baru-atau-gabungan, tanpa memakai kolom
sistem apa pun: baris baru dimulai dari nilai bawaan kolomnya yaitu 1, dan
setiap penggabungan menaikkannya.

### Hasilnya

15 record mentah → **12 berita**, dan itu diuji langsung terhadap
`seed_mentions.json` yang asli, bukan terhadap contoh karangan.

---

## Asumsi yang saya ambil

Di tempat brief tidak menyebutkan apa pun, ini keputusan saya. Masing-masing
didokumentasikan di titik kode tempat ia berlaku.

**1. Tanggal tanpa keterangan zona waktu dibaca sebagai UTC** — bukan waktu
Malaysia.

Buktinya ada di datanya. `"2026-08-10 08:20:00"` (`nst-40021`) adalah artikel
yang sama dengan `"2026-08-10T08:15:00Z"` (`str-99120`).

- Dibaca UTC → kedua salinan berjarak 5 menit. Itu memang bentuk penarikan
  ulang oleh robot.
- Dibaca UTC+8 → salinannya terbit nyaris 8 jam **sebelum** aslinya. Mustahil.

**2. Tanggal tanpa jam dibaca sebagai tanggal lokal Malaysia**, disimpan sebagai
tengah malam UTC+8.

Tanggal tanpa jam itu nilai untuk dibaca manusia, ditulis menurut kalender
penerbitnya. Dibaca sebagai tengah malam UTC, berita subuh di Malaysia akan
tercatat di hari sebelumnya.

**3. `"11/08/2026"` adalah 11 Agustus, bukan 8 November.**

Dua alasan: penerbitnya Malaysia dan Malaysia menulis hari lebih dulu; dan
seluruh data di file ini berkumpul di 10–15 Agustus 2026, jadi bacaan bulan-dulu
melompat ke November, jauh di luar rombongan. Kalau salah satu angkanya di atas
12, ambiguitasnya hilang dengan sendirinya dan angka itu yang menentukan, bukan
kebiasaan penulisan.

**4. Hari dihitung menurut `Asia/Kuala_Lumpur`.**

Sebuah "hari" bukan besaran mutlak; ia tergantung berdiri di mana. Berita GDP
tersimpan sebagai `2026-08-10 16:00 UTC` — masuk ember 10 Agustus kalau dihitung
UTC, dan ember **11 Agustus** kalau dihitung waktu Malaysia. Yang benar 11
Agustus: nilai asli di data feed memang `"11/08/2026"`, dan pemakai alat ini
adalah analis PR di Malaysia yang berpikir dalam hari lokal. Ditulis eksplisit
di dalam perintah SQL, bukan mengandalkan pengaturan zona waktu server, supaya
hasilnya sama di komputer mana pun.

**5. Berita sama dari dua koran dihitung dua berita.** Lihat
[aturan duplikat](#aturan-duplikat-dan-alasannya).

**6. `to=2026-08-11` mencakup seluruh tanggal 11 Agustus.**

Kalau analis mengisi `from=2026-08-11&to=2026-08-11`, yang dia maksud jelas
"tanggal 11". Membaca `to` apa adanya sebagai jam 00:00 tanggal 11 menghasilkan
nol baris — benar secara harfiah, salah secara maksud, dan pemakainya menyimpulkan
datanya hilang. Karena itu, `to` yang berisi tanggal saja digeser ke tengah
malam berikutnya.

**7. Berita tanpa tanggal tidak ikut kalau saringan tanggal aktif.**

Kita tidak bisa membuktikan berita tanpa tanggal berada di dalam rentang yang
diminta; memasukkannya berarti mengarang. Alasannya dikembalikan di dalam respon
sebagai catatan, bukan dibiarkan jadi misteri, dan beritanya tetap tersimpan
serta tetap ketemu tanpa saringan tanggal. Di `group_by=day` ia justru mendapat
embernya sendiri, karena grafik yang membuang baris diam-diam adalah grafik yang
berbohong.

**8. Nama host URL yang menentukan koran, lebih dipercaya daripada kolom
`source`.**

`nst-40021` punya ID berlabel NST dan kolom source berisi `"thestar"`, padahal
URL-nya `thestar.com.my`. Kolom source itu teks bebas yang ditulis penyedia
data; nama host adalah tempat artikelnya benar-benar tinggal. Keterbatasan yang
diketahui: untuk link dari situs pengumpul berita (`news.google.com/…`), yang
terbaca adalah si pengumpul — tidak ada kasus seperti itu di data ini, dan
menanganinya dengan benar butuh langkah penelusuran pengalihan.

**9. Koran yang belum dikenali menjadi slug-nya sendiri**, bukan dilempar ke
satu keranjang "lain-lain". Menumpuk yang tidak dikenal akan menggabungkan
koran-koran yang sebenarnya berbeda dan membuat laporan jangkauan lebih kecil
dari kenyataan.

**10. `title: ""` berarti sama dengan `title: null`.** Data feed memakai `null`
untuk judul tweet dan `""` untuk postingan Facebook. Keduanya berarti "tidak ada
judul", jadi hanya satu bentuk yang masuk database.

**11. Endpoint massal menerima array JSON telanjang**, mengikuti kalimat brief
bahwa ia menerima "the array of records in `seed_mentions.json`".

**12. Nilai yang gagal dibaca jadi `NULL` ditambah peringatan** — bukan tebakan
yang meyakinkan. `"many"` bukan angka; `"last tuesday"` bukan tanggal.

**13. `npm test` memakai database yang sama kecuali diberi tahu sebaliknya.**
Tes integrasi mengosongkan tabel, jadi `TEST_DATABASE_URL` bisa mengarahkannya
ke database lain (lihat `.env.example`). Tanpa itu tesnya tetap lulus, tapi
tabelnya jadi kosong — jalankan `npm run ingest` lagi.

---

## Pertukaran yang saya terima sadar

**1. Kamus `simple` berarti bentuk kata tidak dicocokkan.**
`flood` tidak menemukan "Flash floods". Itu harga dari kamus yang aman untuk
teks campur Inggris–Melayu. Ditulis **sebagai tes**, jadi keterbatasannya
tercatat alih-alih ditemukan mendadak oleh pemakai — dan kalau ada yang mengganti
kamusnya, tes itu gagal dan memberi tahu. Bukti pilihan ini tepat: `q=banjir`
berhasil.

**2. Paginasi memakai `LIMIT`/`OFFSET`.**
Sederhana, memberi total yang tepat, dan benar karena urutannya sudah pasti.
Melambat di halaman yang jauh, karena database tetap harus melewati baris-baris
yang dilompati. Paginasi berbasis kunci akan memperbaikinya, dengan harga
kehilangan kemampuan "langsung ke halaman N".

**3. Satu perintah INSERT per berita.**
Jelas dan mudah diikuti, dan cukup untuk file 15 record. Untuk 10.000 record
akan terasa lambat — satu `INSERT` banyak baris jauh lebih baik.

**4. Total di `/mentions` memakai perintah SQL kedua.**
`count(*) OVER ()` bisa menyatukannya jadi satu perintah, tapi punya lubang:
kalau `offset` melewati baris terakhir, tidak ada baris yang kembali dan
totalnya diam-diam terbaca 0. Dua perintah selalu benar, dengan harga satu
perjalanan tambahan. Ada tesnya untuk kasus itu.

**5. Satu aturan duplikat, bukan dua.**
Pemeriksa kedua berbasis URL sengaja tidak dikerjakan, supaya aturannya tetap
tunggal dan mudah dijelaskan.

**6. `group_by=day` tidak memunculkan hari yang jumlahnya nol.**
Mengisi hari kosong berarti API harus memutuskan sendiri rentang tanggalnya,
padahal itu wewenang pemanggilnya.

**7. Skema sebagai satu file SQL, bukan migration bernomor.**
Tepat untuk proyek dengan satu versi skema, dan membuat tabelnya terlihat utuh
di satu file yang bisa dibaca. Tapi tidak berskala: evolusi skema sungguhan
butuh migration berurutan satu arah dengan catatan apa saja yang sudah
diterapkan.

**8. Daftar alias koran diurus manual.**
[`src/normalize/sources.ts`](src/normalize/sources.ts) memuat peta host dan nama
secara eksplisit. Jelas dan bisa diaudit, tapi koran baru butuh perubahan kode.
Pada skala lebih besar ini seharusnya berada di tabel `sources` dengan tabel
`aliases` di sampingnya.

**9. Peringatan dikembalikan seluruhnya.**
Cukup untuk 15 record; untuk 10.000 record dengan kolom tanggal rusak, responnya
akan sangat besar. Seharusnya dibatasi dengan penghitung sisanya.

**10. Pemasukan data adalah satu transaksi.**
Benar — tidak ada kiriman setengah jadi — tapi file yang sangat besar akan
menahan transaksi terbuka lama. Memecahnya per potongan menukar sedikit
keutuhan dengan banyak keleluasaan berbarengan.

**11. Berkas tes dijalankan berurutan** (`fileParallelism: false` di
[`vitest.config.ts`](vitest.config.ts)). Dua berkas tes menyentuh database yang
sama dan salah satunya memegang kunci tabel di dalam transaksi, jadi kalau
berjalan berbarengan keduanya saling menunggu. Seluruh rangkaiannya sekitar 5
detik, jadi tidak ada yang hilang.

---

## Tes

```bash
npm test        # 98 tes, 7 berkas
npm run typecheck
```

Brief meminta beberapa tes yang berarti atas bagian paling berisiko, bukan
cakupan yang lebar. Tes ini mengarah ke tempat-tempat di mana jawaban yang salah
sekaligus **tidak kelihatan**:

| Berkas | Yang dijaga |
|---|---|
| `tests/dedupe.test.ts` | Aturan duplikat, diuji terhadap `seed_mentions.json` sendiri: 15 record → 12 berita, tiga kelompok duplikat yang diketahui menyatu, dan dua koran yang mengangkat berita pariwisata yang sama tetap terpisah |
| `tests/ingest.test.ts` | Idempotency terhadap database sungguhan — kiriman ke-1, ke-2, dan ke-5 semuanya menyisakan 12 baris — plus setiap aturan penggabungan |
| `tests/search.test.ts` | Bahwa tiga halaman berturut-turut menghasilkan 12 id unik tanpa celah (gagal kalau pemecah seri dihapus); bahwa `to=<tanggal>` mencakup seluruh hari; bahwa baris tanpa tanggal keluar dari hasil saat disaring tanggal |
| `tests/stats.test.ts` | Bahwa ember hari memakai waktu Malaysia, bukan UTC; bahwa baris tanpa tanggal **dihitung** di ember sendiri alih-alih dibuang diam-diam; bahwa total sama dengan jumlah semua baris |
| `tests/dates.test.ts` | Keenam bentuk tanggal, `11/08/2026` yang ambigu, dan bahwa nilai ngawur jadi `null` bukan tebakan |
| `tests/text.test.ts` | Bahwa `<script>alert(1)</script>` tidak bisa sampai ke browser — termasuk bentuk yang disembunyikan di balik entity HTML, yang jinak saat datang dan hidup satu langkah kemudian |
| `tests/sources.test.ts` | Jalur pencocokan nama koran. Semua record seed punya host yang dikenali, jadi jalur itu tidak pernah berjalan di sana; tanpa tes ini ia jadi kode yang baru pertama kali dieksekusi di data yang belum pernah dilihat siapa pun |

Tes database dijalankan terhadap PostgreSQL sungguhan, bukan tiruan, karena yang
diuji justru jaminan yang diberikan database itu sendiri. `tests/ingest.test.ts`
membungkus semuanya dalam satu transaksi dan selalu membatalkannya, jadi ia
menguji hal yang sebenarnya tanpa meninggalkan satu baris pun.

---

## Waktu yang dipakai

Sekitar **3 jam**, dalam **dua sesi di dua hari** (17–18 Agustus 2026).

Sesi pertama habis untuk membaca brief, menyusuri `seed_mentions.json` record
per record untuk mendata persis apa saja yang kotor di dalamnya, lalu menetapkan
skema dan aturan duplikat — bagian yang paling banyak dipikir ulang, dan yang
membuat saya mengubah pendirian. Sesi kedua untuk ketiga endpoint, tesnya, dan
README ini.

Satu jalan memutar yang perlu disebut: versi pertama saya bangun di atas SQLite
demi kemudahan pemasangan, lalu pindah ke PostgreSQL setelah jelas bahwa tiga
hal yang justru dibutuhkan soal ini — `TIMESTAMPTZ` untuk tiga kebiasaan zona
waktu, kolom pencarian ber-index yang dikelola sendiri oleh database, dan aturan
yang ditegakkan database — adalah persis yang tidak diberikan SQLite. Riwayat
commit-nya memuat perubahan pendirian itu beserta alasannya.

---

## Kalau ada seminggu lagi

**1. Menambah pemeriksa duplikat kedua berbasis URL.** Aturan sekarang menangkap
artikel yang sama di URL berbeda; ia belum menangkap kebalikannya — URL sama,
judul diedit ulang oleh redaksi. `canonical_url` sudah disimpan dan diberi index
untuk itu. Ini yang pertama saya kerjakan.

**2. Pindah ke paginasi berbasis kunci** untuk `/mentions`, menyisakan
`LIMIT`/`OFFSET` hanya untuk kasus "langsung ke halaman N". Cara sekarang
melambat di halaman yang jauh.

**3. Menggabungkan perintah INSERT.** Satu perintah per berita itu jelas tapi
tidak berskala; satu `INSERT … ON CONFLICT` banyak baris akan jauh lebih tahan
untuk file besar.

**4. Menambah tabel data mentah dan migration bernomor.** Menyimpan setiap
kiriman apa adanya, ditandai per batch, akan membuat seluruh lapisan pembersihan
bisa dijalankan ulang — menghitung kembali kolom turunan dari arsip mentah tanpa
menyentuh penyedia data. Itu, ditambah migration berurutan satu arah, yang
membuat skema aman untuk berkembang.

**5. Memperbaiki pencarian.** Menambah `pg_trgm` untuk pencocokan awalan kata
dan kemiripan, dan memilih kamus sesuai bahasa yang terdeteksi alih-alih puas
dengan `simple` untuk semuanya. Mengembalikan nilai relevansi supaya hasil `q=`
bisa diperingkat, bukan cuma disaring.

**6. Mengisi hari berjumlah nol di `group_by=day`,** digerakkan oleh parameter
rentang yang eksplisit supaya API tidak menebak keinginan pemanggilnya.

**7. Memantau kesehatan sumber data.** Endpoint pemasukan data sudah melaporkan
peringatan per record. Mengumpulkannya sepanjang waktu — "kolom tanggal
Malaysiakini gagal dibaca selama tiga hari" — mengubah alat bantu penelusuran
menjadi pemantauan. Sumber data yang perlahan rusak adalah kegagalan yang paling
mungkin terjadi di dunia nyata di sini, dan sekarang tidak ada yang akan sadar
sampai ada grafik yang terlihat aneh.

**8. Membatasi panjang daftar peringatan** dengan penghitung sisanya, supaya
kiriman besar yang rusak tidak menghasilkan respon raksasa.

---

## Yang sengaja tidak dibuat

Sesuai brief, hal-hal ini tidak menambah nilai dan memang tidak ada: autentikasi
atau akun pengguna, pipeline CI, Kubernetes, analisis sentimen atau ML apa pun,
dan cakupan tes yang berlebihan.

Docker Compose juga tidak disertakan — brief menyebutnya opsional, dan karena
layanan ini hanya butuh Node ditambah satu alamat sambungan PostgreSQL,
menambahkannya akan membuat pemasangan lebih panjang, bukan lebih singkat.

Halaman dashboard baca-saja yang opsional **disertakan** — lihat
[halaman dashboard](#halaman-dashboard). Dibuat paling akhir, setelah semua yang
diwajibkan brief selesai, dan sengaja tidak memuat logika sendiri sedikit pun:
setiap angka di sana berasal dari API, termasuk urutan tampilan dan zona
waktunya.
