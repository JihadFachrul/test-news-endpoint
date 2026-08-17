# Media Monitoring — Ingest, Search, Stats

A small slice of a media-monitoring backend: a bulk ingestion endpoint, a search
endpoint, and a stats endpoint, backed by PostgreSQL.

> 🇮🇩 **Versi Bahasa Indonesia: [README.id.md](README.id.md)**
>
> **A note on language:** the inline code comments are written in Indonesian, my
> working language — that is where the reasoning behind each decision lives, and
> writing it in my own language kept it precise. Written Bahasa Indonesia and
> Bahasa Melayu are largely mutually intelligible, so I hope it reads fine; if
> you would prefer English comments, I am happy to translate them.

---

## Contents

- [Requirements](#requirements)
- [How to run it](#how-to-run-it)
- [API](#api)
- [The schema, and why](#the-schema-and-why)
- [Duplicate detection, and why](#duplicate-detection-and-why)
- [Assumptions I made](#assumptions-i-made)
- [Trade-offs I knowingly accepted](#trade-offs-i-knowingly-accepted)
- [Tests](#tests)
- [Time spent](#time-spent)
- [With another week, I would…](#with-another-week-i-would)
- [Deliberately not built](#deliberately-not-built)

---

## Requirements

| | Version | Why this minimum |
|---|---|---|
| Node.js | **20.11+** | Developed and tested on 20.11.0 |
| PostgreSQL | **12+** | `GENERATED ALWAYS AS … STORED` columns (12+) and `websearch_to_tsquery` (11+). Tested on 17.2 |

No Docker, no ORM, no build step required to run it.

---

## How to run it

### 1. Install

```bash
git clone <repo-url>
cd <folder>
npm install
```

### 2. Create the database

```bash
createdb media_monitoring
```

<details>
<summary>…or from inside <code>psql</code>, if <code>createdb</code> is not on your PATH</summary>

```sql
CREATE DATABASE media_monitoring;
```
</details>

### 3. Point the app at it

```bash
cp .env.example .env      # Windows: copy .env.example .env
```

Then open `.env` and set `DATABASE_URL` to match your PostgreSQL:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/media_monitoring
PORT=3000
```

### 4. Create the tables

```bash
npm run db:setup
```

```
Database siap.
Tabel yang ada: mentions, sources
```

This reads [`db/schema.sql`](db/schema.sql) — the single committed file that
defines the schema. It is safe to run repeatedly; every statement uses
`IF NOT EXISTS`, and the whole file runs in one transaction so a failure cannot
leave half-created tables behind.

### 5. Start the server

```bash
npm run dev
```

The server listens on `http://127.0.0.1:3000`. Open it in a browser and you get
a list of the available endpoints.

<details>
<summary>Production-style run (compiled)</summary>

```bash
npm run build
npm start
```
</details>

### 6. Load the seed data

Either through the endpoint:

```bash
curl -X POST http://127.0.0.1:3000/internal/mentions/bulk \
  -H "Content-Type: application/json" \
  --data-binary @seed_mentions.json
```

…or with the shortcut script, which needs no server and no curl:

```bash
npm run ingest
```

```
  Diterima         : 15 record        (received)
  Baris baru       : 12               (inserted)
  Duplikat digabung: 3                (merged as duplicates)
  Bentuknya rusak  : 0                (malformed)
```

**Run it a second time — the row count does not change.** That is the
idempotency requirement, and it is enforced by the database, not by application
code. Both the endpoint and the script call the same `ingestMentions()`
function, so there is no second code path that could behave differently.

### 7. Try it

```bash
curl "http://127.0.0.1:3000/mentions?q=ringgit"
curl "http://127.0.0.1:3000/mentions?source=The%20Star&limit=5"
curl "http://127.0.0.1:3000/mentions?from=2026-08-13&to=2026-08-13"
curl "http://127.0.0.1:3000/mentions/stats?group_by=source"
curl "http://127.0.0.1:3000/mentions/stats?group_by=day"
```

---

## API

### `POST /internal/mentions/bulk`

Accepts a bare JSON array of raw records — exactly the shape of
`seed_mentions.json`.

**Idempotent.** Posting the same file any number of times produces the same
rows.

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

Returns **200**, not 201: a repeat post creates nothing, so `201 Created` would
be misleading.

Records that are structurally unusable (not a JSON object) are **skipped and
reported**, not treated as fatal. A malformed record will still be malformed on
every retry, so failing the batch would let one bad record hold 14 good ones
hostage forever. A *database* error, by contrast, rolls the whole batch back —
that is usually transient and safe to retry.

Every questionable-but-usable value produces a warning rather than silence, so
a degrading upstream feed is visible instead of quietly absorbed.

### `GET /mentions`

| Param | Meaning |
|---|---|
| `q` | Keyword search across title and content |
| `source` | Filter by outlet. Accepts the slug (`thestar`) **or** the human name (`The Star`, `THE STAR`) |
| `from` | Start of date range, inclusive |
| `to` | End of date range. A bare date includes **that whole day** |
| `limit` | Rows per page, 1–100, default 20 |
| `offset` | Rows to skip, default 0 |

`GET /mentions?q=ringgit`, after loading the seed file once:

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

One row, not three. The three copies of this article — `str-99120` twice plus
`nst-40021` — merged into it: `engagement` took the highest of 412 / 415 /
`"1,204"`, `published_at` took the earliest of 08:15 and 08:20, the author was
filled in from the copy that had one, and `times_seen` counts all three
deliveries.

`content` is the **cleaned** text. The raw HTML is kept in the database but
never leaves through the API — one seed record ships a live
`<script>alert(1)</script>` payload.

Invalid parameters return **400** with *all* the problems listed at once, so the
caller does not have to discover them one request at a time:

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

#### Sort order

```
ORDER BY published_at DESC NULLS LAST, id DESC
```

It is returned in every response as `sort`, so a client never has to guess.
Three parts, three reasons:

- **`published_at DESC`** — newest first, which is what an analyst wants.
- **`NULLS LAST`** must be explicit. On a `DESC` sort PostgreSQL treats `NULL`
  as the *largest* value, so without it the undated mentions would sit at the
  top of page 1.
- **`id DESC` is the tie-breaker, and it is the important part.** Several
  mentions can share an identical `published_at`. When the sort ties, PostgreSQL
  is free to return any order, and that order may differ between requests — so
  page 2 can repeat a row from page 1 while some other row is **never returned
  on any page**. Because `id` is unique, appending it makes the order total.
  There is a test that walks three consecutive pages and asserts 12 unique ids
  with no gaps; it fails if the tie-breaker is removed.

### `GET /mentions/stats`

`?group_by=source` — count per outlet:

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

Ordered by count descending, then slug ascending. The tie-breaker matters here
too: several outlets can share a count, and without it the bars would swap
places on every refresh and the tool would look broken.

`?group_by=day` — count per day:

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

Mentions with no date are **not dropped**. They are collected into their own
bucket at the end of the list:

```json
{ "day": null, "label": "tanpa tanggal", "total": 1 }
```

Both forms accept the same `q` / `source` / `from` / `to` filters as
`GET /mentions`, so a dashboard chart can follow whatever filter is active.

`group_by` is required; anything other than `source` or `day` returns 400 and
names the valid options.

#### Filters are shared code, not duplicated code

`q`, `source`, `from` and `to` are parsed and compiled to SQL in one module,
[`src/filters.ts`](src/filters.ts), used by all three endpoints.

This is a correctness concern, not a tidiness one. On a dashboard, the chart and
the list must reflect the same filter. Written twice, one copy eventually gets
changed and the other is forgotten — the chart says 8 while the list holds 12,
and the analyst stops trusting the whole tool. With one source of truth that
mismatch is impossible.

Verified across seven filter combinations — `/mentions`, `stats=source` and
`stats=day` agree on the total every time:

| Filter | `/mentions` | `stats=source` | `stats=day` |
|---|---|---|---|
| *(none)* | 12 | 12 | 12 |
| `q=tourism` | 2 | 2 | 2 |
| `source=The Star` | 3 | 3 | 3 |
| `from=2026-08-13&to=2026-08-13` | 2 | 2 | 2 |
| `q=banjir` | 1 | 1 | 1 |
| `q=flood&source=malaysiakini` | 1 | 1 | 1 |
| `from=2026-08-11&to=2026-08-15` | 11 | 11 | 11 |

---

## The schema, and why

Defined in one committed file: [`db/schema.sql`](db/schema.sql). No ORM, no
GUI-created tables. The file itself carries the full reasoning inline; this is
the summary.

### `sources` — one row per outlet

```sql
id · slug (UNIQUE) · display_name · platform (CHECK) · created_at
```

The feed spells the same outlet several ways: `"The Star"` / `"thestar"`,
`"Malaysiakini"` / `"malaysiakini "` (trailing space), `"twitter"` / `"TWITTER"`.

Counting on that raw string would report one outlet as two or three in
`group_by=source`, and the dashboard would simply be wrong. So the raw label is
resolved **once, at ingest time**, to a stable slug, and every mention points at
that row instead of carrying a free-text name.

`platform` uses a `CHECK` constraint rather than trusting the application: a
nonsense value is rejected by the database, not merely hoped against.

### `mentions` — one row per mention

```sql
id · source_id → sources(id) · external_id · url · canonical_url · title
content_raw · content_clean · author
published_at (TIMESTAMPTZ, nullable) · published_at_raw
engagement (INTEGER, CHECK ≥ 0) · dedupe_key (UNIQUE)
times_seen · first_seen_at · updated_at · search_tsv (GENERATED)
```

The six decisions worth defending:

**1. `content` is stored twice — `content_raw` and `content_clean`.**
Cleaning is a lossy operation. If the cleaning rules turn out to be wrong next
month, keeping the original means the derived column can be recomputed from
what we already have, with no request back to the provider. Without it, a
cleaning bug becomes permanent. This is also the answer to *"your dedupe rule
merged two different articles — how do you fix it?"*: recompute `dedupe_key`
from `content_raw` in a migration. No re-ingestion.

**2. `published_at` is nullable, on purpose.**
The feed genuinely ships a mention with no date (`mkn-1201`). Inventing one
would silently corrupt the day chart, and a wrong value that looks plausible is
worse than an admitted gap.

**3. `published_at_raw` keeps the original string.**
When someone reports "this date is wrong", we can see what the provider actually
sent. It is the difference between a system you can debug and one you can only
guess at.

**4. `TIMESTAMPTZ`, not `TIMESTAMP`.**
Data arrives from three different timezone conventions — `Z`, `+08:00`, and no
marker at all. Stored as an absolute instant, cross-timezone ordering is
guaranteed by the database rather than by convention.

**5. `UNIQUE (dedupe_key)` is what makes ingestion idempotent.**
The guard is the database, not the application. A check-then-insert in code has
a race: two concurrent requests both see "not present", and both insert. A
unique index cannot be raced.

**6. `search_tsv` is a `GENERATED` column.**
PostgreSQL fills and maintains it itself, on every write, so the search index
can never drift from the row it describes. Maintained from application code,
some future write path would eventually forget to update it and search would
start lying. Handing it to the database makes that impossible.

The dictionary is **`simple`**, not `english`. The corpus mixes English and
Malay — *banjir*, *kekal*, *pinjaman rumah*. An English stemmer would mangle
Malay tokens while appearing to understand them. `simple` just splits on word
boundaries: honest and predictable. The cost is listed under
[trade-offs](#trade-offs-i-knowingly-accepted).

### Indexes

Each one exists for a query this service actually serves:

| Index | Serves |
|---|---|
| `(published_at DESC NULLS LAST, id DESC)` | the documented sort order, exactly |
| `(source_id, published_at DESC NULLS LAST, id DESC)` | `?source=…` with the same order |
| `(canonical_url) WHERE canonical_url IS NOT NULL` | tracing a mention by its URL. Partial, so URL-less social posts do not bloat it |
| `GIN (search_tsv)` | `?q=…` keyword search |

---

## Duplicate detection, and why

The brief deliberately leaves this open, so here is the rule and the reasoning.

### The rule

```
dedupe_key = sha256( source_slug + "|" + fingerprint(title or content) )
```

`fingerprint()` lowercases, drops punctuation and emoji, collapses whitespace,
and keeps the first 300 characters. Implemented in
[`src/normalize/dedupe.ts`](src/normalize/dedupe.ts).

Enforced by `UNIQUE (dedupe_key)` plus `ON CONFLICT DO UPDATE`.

### Four degrees of sameness — and where I stop

The seed data contains all four:

| | Example | Same mention? |
|---|---|---|
| 1. Identical id and outlet | `str-99120` twice | **Yes** |
| 2. Same URL, different id and label | `str-99120` vs `nst-40021` | **Yes** |
| 3. Same text, same outlet, new URL | `mkn-1201` vs `mkn-1202` | **Yes** |
| 4. Same story, **different outlet** | The Star vs NST on tourism | **No — two mentions** |

**Case 4 is the line, and it is a product decision, not a technical one.** It is
tempting to merge: same figures, same day, nearly the same headline. But a media
monitoring tool exists to tell a PR analyst *how many outlets carried their
story*. Merging across outlets deletes the single most valuable metric in the
product.

Including `source_slug` in the hash makes that merge **structurally
impossible**, which is the safety property worth having. The underlying
principle: a duplicate that slips through is noise, but a data point that
disappears is a lie. I chose noise.

### Why the fingerprint closes cases 1–3

| Seed values | After `fingerprint()` |
|---|---|
| `Ringgit strengthens against US dollar in early trade` | `ringgit strengthens against us dollar in early trade` |
| `Ringgit Strengthens Against US Dollar In Early Trade` | ← identical |
| `Analysts split on second-half GDP outlook` | `analysts split on second half gdp outlook` |
| `Analysts split on second half GDP outlook` | ← identical (the hyphen is dropped) |

Title first, because a headline is the most stable summary of an article and
survives body edits. Social posts have no headline, so their body text *is* the
headline. If a record has neither — absent from this feed, but inevitable in a
real pipeline — it falls back to the canonical URL, then to the provider id, so
that text-less records get distinct keys instead of all colliding on the hash of
the empty string.

### Why not `external_id`

It lies. Record `nst-40021` carries an NST-shaped id (`nst-`) while pointing at
`thestar.com.my`. Provider metadata is a claim; it is not evidence.

### Why not the URL

`mkn-1201` and `mkn-1202` are the same article under `/news/1201` and
`/news/1202`. A URL is an *address*, not an *identity*, and CMSs reissue
addresses routinely.

`canonical_url` is still stored and indexed — with tracking parameters, `www.`,
trailing slashes and fragments removed so two links to one article compare
equal. Using it as a *second* check, for the inverse case (same URL, headline
reworded by the desk), is listed under
[with another week](#with-another-week-i-would).

### How duplicates are merged

Not discarded — merged, each rule for a reason:

| Field | Rule | Why |
|---|---|---|
| `engagement` | **highest** | Likes and shares only grow, so the largest value is the most recent measurement. In the data: 412 → 415 → 1204 |
| `published_at` | **earliest** | An article has one real publication time; minutes of difference between copies is crawler jitter, not republication |
| `published_at_raw` | the one **matching** the chosen `published_at` | Otherwise the audit column shows a raw value from a different copy and actively misleads whoever is debugging |
| `author`, `title`, `url`, `external_id` | keep existing, **fill if missing** | `str-99120` has author "Aisyah Rahman"; its copy `nst-40021` has `null` |
| `content` | the **longer** one wins | Usually the more complete body. `str-99120` ends "…buoyed by improved sentiment"; the copy is truncated |
| `times_seen` | **+1** | Useful for spotting a misbehaving crawler |

`GREATEST` and `LEAST` in PostgreSQL ignore `NULL` and return `NULL` only when
every argument is `NULL`, which is exactly the "fill from whichever copy has a
value" behaviour needed here.

`times_seen` also serves as the new-vs-merged signal, with no system columns
involved: a fresh row starts at the column default of 1, and every merge
increments it.

### Result

15 raw records → **12 mentions**, asserted in the test suite against
`seed_mentions.json` itself rather than against invented fixtures.

---

## Assumptions I made

Where the brief was silent, these are the calls I made. Each is documented at
the point in the code where it takes effect.

**1. A timestamp with no timezone is UTC** — not Malaysian local time.

The evidence is in the data. `"2026-08-10 08:20:00"` (`nst-40021`) is the same
article as `"2026-08-10T08:15:00Z"` (`str-99120`).

- Read as UTC → the copies sit 5 minutes apart. That is what a re-crawl looks
  like.
- Read as UTC+8 → the copy predates the original by nearly 8 hours. Impossible.

**2. A bare date is a local Malaysian date**, stored as midnight UTC+8.

A date with no time is a human-facing value written in the publisher's own
calendar. Read as UTC midnight, an early-morning Malaysian article would be
filed under the previous day.

**3. `"11/08/2026"` is 11 August, not 8 November.**

Two reasons: the publishers are Malaysian and Malaysia writes day-first; and the
entire feed clusters in 10–15 August 2026, so a month-first reading jumps to
November, far outside the cluster. Where one number exceeds 12 the ambiguity
resolves itself and the convention is overridden rather than trusted.

**4. Days are bucketed in `Asia/Kuala_Lumpur`.**

A "day" is not absolute; it depends on where you stand. The GDP mention is
stored as `2026-08-10 16:00 UTC` — bucket 10 August in UTC, bucket **11 August**
in Malaysian time. 11 August is correct: the feed's own raw value is
`"11/08/2026"`, and the user of this tool is a PR analyst in Malaysia who thinks
in local days. Written explicitly in the query rather than relying on the
server's timezone setting, so the result is identical on any machine.

**5. The same story from two outlets is two mentions.** See
[duplicate detection](#duplicate-detection-and-why).

**6. `to=2026-08-11` includes all of 11 August.**

If an analyst enters `from=2026-08-11&to=2026-08-11` they plainly mean "the 11th".
Reading `to` literally as 00:00 on the 11th returns zero rows — correct to the
letter, wrong to the intent, and the user concludes the data is missing. A bare
date in `to` is therefore shifted to the following midnight.

**7. Undated mentions are excluded when a date filter is active.**

We cannot prove a mention with no date falls inside the requested range;
including it would be invention. The reason is returned in the response as a
note rather than left as a mystery, and the mention is still stored and still
findable without the date filter. In `group_by=day` it gets its own bucket
instead, because a chart that silently drops rows is a chart that lies.

**8. The URL host identifies the outlet, in preference to the `source` label.**

`nst-40021` carries an NST-shaped id and the label `"thestar"` while pointing at
`thestar.com.my`. The label is free text a provider types; the host is where the
article actually lives. Known limitation: for an aggregator link
(`news.google.com/…`) the host would be the aggregator — not present in this
feed, and it would need a redirect-resolving step to handle properly.

**9. An unrecognised outlet becomes its own slug**, not a shared "other" bucket.
Pooling unknowns would merge genuinely distinct publishers and understate
coverage.

**10. `title: ""` means the same as `title: null`.** The feed uses `null` for
tweet titles and `""` for the Facebook post. Both mean "no headline", so only
one form reaches the database.

**11. The bulk endpoint takes a bare JSON array**, matching the brief's wording
that it accepts "the array of records in `seed_mentions.json`".

**12. Unparseable values become `NULL` plus a warning** — never a plausible
guess. An engagement value of `"many"` is not a number; a date of `"last
tuesday"` is not a date.

**13. `npm test` uses the same database unless told otherwise.** The integration
tests truncate tables, so `TEST_DATABASE_URL` can point them at a separate
database (see `.env.example`). Without it, tests still pass but leave the tables
empty — re-run `npm run ingest`.

---

## Trade-offs I knowingly accepted

**1. `simple` dictionary means no word-form matching.**
`flood` does not find "Flash floods". This is the price of a dictionary that is
safe for mixed English–Malay text. It is written **as a test**, so the
limitation is recorded rather than discovered later by a user — and if anyone
switches the dictionary, that test fails and says so. Proof the choice was
right: `q=banjir` works.

**2. `LIMIT`/`OFFSET` pagination.**
Simple, gives an exact total, and correct because the sort order is total. It
degrades on deep pages, because the database must still walk the skipped rows.
Keyset pagination would fix that at the cost of losing "jump to page N".

**3. One insert statement per mention.**
Clear and easy to follow, and fine for a 15-record file. A 10,000-record batch
would be visibly slow — a single multi-row `INSERT` would be far better.

**4. The total in `/mentions` costs a second query.**
`count(*) OVER ()` would fold it into one statement, but has a hole: when
`offset` runs past the last row, nothing comes back and the total silently reads
0. Two statements are always right, for one extra round trip. There is a test
for exactly that case.

**5. One duplicate rule, not two.**
The URL-based second pass is deliberately not implemented, to keep the rule
single and explainable.

**6. `group_by=day` omits days with zero mentions.**
Filling gaps would require the API to decide the date range itself, which
belongs to the caller. A chart drawing a line across the gap is the caller's
problem to solve — or mine, next week.

**7. Schema as one idempotent SQL file, not numbered migrations.**
Right for a project with one schema version, and it keeps the tables visible in
a single readable file. It does not scale: real schema evolution needs ordered,
forward-only migrations with an applied-log.

**8. The outlet alias table is hand-maintained.**
[`src/normalize/sources.ts`](src/normalize/sources.ts) carries an explicit map
of hosts and labels. Explicit and auditable, but a new outlet needs a code
change. At a larger scale this belongs in the `sources` table with an
`aliases` table beside it.

**9. Warnings are returned in full.**
Fine for 15 records; a 10,000-record batch with a broken date column would
return an enormous response. It should be capped with a count of the remainder.

**10. Ingestion is a single transaction.**
Correct — no half-stored batch — but a very large file would hold a long
transaction open. Chunking would trade a little atomicity for a lot of
concurrency.

**11. Test files run sequentially** (`fileParallelism: false` in
[`vitest.config.ts`](vitest.config.ts)). Two test files touch the same database
and one holds a table lock inside a transaction, so running them concurrently
deadlocks. The whole suite takes about 5 seconds, so nothing is lost.

---

## Tests

```bash
npm test        # 98 tests, 7 files
npm run typecheck
```

The brief asks for a few meaningful tests over the riskiest logic rather than
broad coverage. These target the places where a wrong answer is both likely and
**invisible**:

| File | What it protects |
|---|---|
| `tests/dedupe.test.ts` | The duplicate rule, asserted against `seed_mentions.json` itself: 15 records → 12 mentions, the three known duplicate groups merge, and the two outlets covering the same tourism story stay separate |
| `tests/ingest.test.ts` | Idempotency against a real database — 1, 2 and 5 consecutive posts all leave 12 rows — plus every merge rule |
| `tests/search.test.ts` | That three consecutive pages yield 12 unique ids with no gaps (this fails if the sort tie-breaker is removed); that `to=<date>` covers the whole day; that undated rows drop out under a date filter |
| `tests/stats.test.ts` | That the day bucket is Malaysian, not UTC; that undated rows are **counted** in their own bucket rather than silently dropped; that totals equal the sum of the rows |
| `tests/dates.test.ts` | All six date shapes, the ambiguous `11/08/2026`, and that garbage becomes `null` instead of a guess |
| `tests/text.test.ts` | That `<script>alert(1)</script>` cannot reach a browser — including the entity-encoded form, which is inert on arrival and live one decode later |
| `tests/sources.test.ts` | The label-matching path. Every seed record has a recognisable host, so that path never runs there; without these tests it would be untested code first executing on a feed nobody has seen |

The database tests run against real PostgreSQL rather than a fake, because what
is being tested *is* the guarantee the database provides. `tests/ingest.test.ts`
wraps everything in a transaction and always rolls back, so it exercises the
real thing without leaving a single row behind.

---

## Time spent

Roughly **7–8 hours**, in **one extended session** on 17 August 2026.

Approximately: 1h reading the brief and cataloguing exactly what is dirty in
`seed_mentions.json` record by record; 1h on schema and the duplicate rule
(the most re-thought part, and the one I changed my mind about most); 2h on
normalisation and its tests; 2h on the three endpoints; 1h on the integration
tests; the remainder on this README.

One detour worth mentioning: I built the first version on SQLite for setup
simplicity, then moved to PostgreSQL once it was clear that three things this
task actually needs — `TIMESTAMPTZ` across three timezone conventions, an
indexed generated search column, and database-enforced constraints — are exactly
what SQLite does not give. The commit history shows that reversal and the
reasoning behind it.

---

## With another week, I would…

**1. Add the URL-based second duplicate check.** The current rule catches the
same article under different URLs; it does not catch the inverse — same URL,
headline reworded by the desk. `canonical_url` is already stored and indexed for
it. This is the first thing I would do.

**2. Switch to keyset pagination** for `/mentions`, keeping `LIMIT`/`OFFSET`
only for the "jump to page N" case. The current approach slows down on deep
pages.

**3. Batch the inserts.** One statement per mention is clear but does not scale;
a multi-row `INSERT … ON CONFLICT` would handle a large file far better.

**4. Add a raw-payload table and numbered migrations.** Storing every payload
exactly as received, keyed by batch, would make the whole normalisation layer
replayable — recompute derived columns from the raw archive without touching the
provider. That, plus ordered forward-only migrations, is what makes a schema
safe to evolve.

**5. Improve search.** Add `pg_trgm` for prefix and fuzzy matching, and pick the
dictionary per detected language instead of settling for `simple` everywhere.
Return a relevance score so `q=` results can be ranked, not just filtered.

**6. Fill zero-count days in `group_by=day`,** driven by an explicit range
parameter so the API is not guessing what the caller wants.

**7. Watch the feed's health.** The ingest endpoint already reports warnings per
record. Aggregating them over time — "Malaysiakini's date field has been
unparseable for three days" — turns a debugging aid into monitoring. A
degrading upstream feed is the most likely real-world failure here, and right
now nobody would notice until a chart looked wrong.

**8. Cap the warnings array** with a count of the remainder, so a large broken
batch cannot return a huge response.

---

## Deliberately not built

Per the brief, these earn no points and are absent: authentication or user
accounts, CI pipelines, Kubernetes, sentiment analysis or any ML, and exhaustive
test coverage.

Docker Compose is not included either — it is optional in the brief, and since
the service needs only Node and a PostgreSQL connection string, adding it would
have made setup longer rather than shorter.

The optional read-only dashboard page is not built. Happy to add one; it was
below the required work in priority.
