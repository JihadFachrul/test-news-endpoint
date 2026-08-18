# Media Monitoring — Ingest, Search, Stats

Bulk ingest, search and stats endpoints over deliberately messy data.
Node 20 + TypeScript + Fastify + PostgreSQL. Hand-written SQL, no ORM.

**15 raw records in `seed_mentions.json` become 12 mentions.** That gap is the
exercise.

> Indonesian version: [README.id.md](README.id.md). Code comments are in
> Indonesian, my working language — happy to translate if you'd prefer English.

---

## Requirements

Node **20.11+** · PostgreSQL **12+** (needs `GENERATED` columns and
`websearch_to_tsquery`). Tested on Node 20.11 and PostgreSQL 17.2.
No Docker, no build step needed to run it.

---

## How to run it

```bash
git clone <repo-url>
cd <folder>
npm install

createdb media_monitoring

cp .env.example .env        # Windows: copy .env.example .env
# then edit DATABASE_URL in .env if your Postgres differs from the default

npm run db:setup            # creates the tables from db/schema.sql
npm run dev                 # server on http://127.0.0.1:3000
```

`npm run db:setup` prints:

```
Database siap.
Tabel yang ada: mentions, sources
```

**Load the seed data** — either the shortcut script, or the endpoint itself:

```bash
npm run ingest

# or
curl -X POST http://127.0.0.1:3000/internal/mentions/bulk \
  -H "Content-Type: application/json" --data-binary @seed_mentions.json
```

```
  Diterima         : 15 record      (received)
  Baris baru       : 12             (inserted)
  Duplikat digabung: 3              (merged as duplicates)
  Bentuknya rusak  : 0              (malformed)
```

**Run it a second time: `Baris baru: 0`, and the row count does not move.**
Both paths call the same `ingestMentions()`, so there is no second code path.

**Then open <http://127.0.0.1:3000>** — a read-only dashboard that calls only
this service's own endpoints and shows the request URLs it uses, so you can copy
them straight into `curl`. Optional per the brief; the JSON endpoint index is at
`/api`.

```bash
npm test          # 98 tests
npm run typecheck
```

> `npm test` truncates the tables. Re-run `npm run ingest` afterwards, or point
> `TEST_DATABASE_URL` at a separate database (see `.env.example`).

---

## API

| Endpoint | Notes |
|---|---|
| `POST /internal/mentions/bulk` | Bare JSON array, exactly the shape of `seed_mentions.json`. Idempotent. Returns **200**, not 201 — a repeat post creates nothing. Reports `inserted` / `merged` / `invalid` plus per-record warnings. |
| `GET /mentions` | `q`, `source`, `from`, `to`, `limit` (1–100, default 20), `offset` |
| `GET /mentions/stats?group_by=source` | count per outlet |
| `GET /mentions/stats?group_by=day` | count per day, bucketed in `Asia/Kuala_Lumpur` |

`source` accepts the slug (`thestar`) **or** the human name (`The Star`) — it
runs through the same normaliser as ingest. `to=2026-08-11` covers **all of**
11 August. Bad parameters return **400** listing every problem at once.

`q`, `source`, `from`, `to` are parsed and compiled to SQL in one shared module
([`src/filters.ts`](src/filters.ts)) used by all three endpoints, so the chart
and the list can never disagree. Verified: across seven filter combinations,
`/mentions`, `stats=source` and `stats=day` return the same total every time.

**Sort order** — returned in every response as `sort`:

```
ORDER BY published_at DESC NULLS LAST, id DESC
```

`NULLS LAST` is explicit because on a `DESC` sort PostgreSQL treats `NULL` as
the largest value. `id DESC` is the tie-breaker and the important part: mentions
can share an identical `published_at`, and when the sort ties PostgreSQL may
return a different order per request — so page 2 repeats a row from page 1 while
another row is never returned at all. A test walks three consecutive pages and
asserts 12 unique ids with no gaps.

---

## Schema, and why

One committed file: [`db/schema.sql`](db/schema.sql). No ORM, no GUI.

```sql
sources   id · slug (UNIQUE) · display_name · platform (CHECK) · created_at

mentions  id · source_id → sources(id) · external_id · url · canonical_url
          title · content_raw · content_clean · author
          published_at (TIMESTAMPTZ, nullable) · published_at_raw
          engagement (INTEGER) · dedupe_key (UNIQUE)
          times_seen · first_seen_at · updated_at · search_tsv (GENERATED)
```

**`sources` is a separate table** because the feed spells one outlet several
ways — `"The Star"` / `"thestar"`, `"malaysiakini "` with a trailing space,
`"twitter"` / `"TWITTER"`. Counting the raw string would report one outlet as
three in `group_by=source`. The label is resolved to a stable slug once, at
ingest.

**Content is stored twice.** Cleaning is lossy. Keeping `content_raw` means a
wrong cleaning rule — or a wrong dedupe rule — can be fixed by recomputing the
derived columns in a migration, with no request back to the provider.

**`published_at` is nullable on purpose.** The feed ships a mention with no date
(`mkn-1201`). Inventing one would silently corrupt the day chart, and a
plausible wrong value is worse than an admitted gap. `published_at_raw` keeps
the original string so "this date is wrong" is traceable.

**`TIMESTAMPTZ`, not `TIMESTAMP`** — data arrives from three timezone
conventions (`Z`, `+08:00`, none at all), so ordering must be guaranteed by the
database.

**`UNIQUE (dedupe_key)` is what makes ingest idempotent**, and the guard is the
database rather than the application: a check-then-insert races, two concurrent
requests both see "not present" and both insert. A unique index cannot be raced.

**`search_tsv` is `GENERATED`**, so PostgreSQL maintains it on every write and
the search index can never drift from the row. Dictionary is `simple`, not
`english`: the corpus mixes English and Malay, and an English stemmer would
mangle Malay tokens while appearing to understand them.

Indexes match the queries actually served: the documented sort order exactly,
the same order scoped by source, a partial index on `canonical_url`, and GIN on
`search_tsv`.

---

## Duplicate-detection rule, and why

```
dedupe_key = sha256( source_slug + "|" + fingerprint(title or content) )
```

`fingerprint()` lowercases, drops punctuation and emoji, collapses whitespace,
keeps the first 300 characters. Enforced by `UNIQUE (dedupe_key)` +
`ON CONFLICT DO UPDATE`.

The seed data contains four degrees of sameness. The rule stops after the third:

| | Example | Same mention? |
|---|---|---|
| 1. Identical id and outlet | `str-99120` twice | Yes |
| 2. Same URL, different id and label | `str-99120` vs `nst-40021` | Yes |
| 3. Same text, same outlet, new URL | `mkn-1201` vs `mkn-1202` | Yes |
| 4. Same story, **different outlet** | The Star vs NST on tourism | **No — two mentions** |

**Case 4 is the line, and it is a product decision.** A media-monitoring tool
exists to tell a PR analyst how many outlets carried their story; merging across
outlets deletes the most valuable metric in the product. Including `source_slug`
in the hash makes that merge structurally impossible. The principle: a duplicate
that slips through is noise, but a data point that disappears is a lie.

**Not `external_id`** — it lies. `nst-40021` carries an NST-shaped id while
pointing at `thestar.com.my`. **Not the URL** — `mkn-1201` and `mkn-1202` are
one article under two URLs; a URL is an address, not an identity. `canonical_url`
is still stored and indexed for a second check I did not build (see below).

Title first, because a headline is the most stable summary of an article. Social
posts have no headline, so their body text is the headline; a record with
neither falls back to URL, then provider id, so text-less records don't all
collide on the hash of the empty string.

**Duplicates are merged, not discarded:**

| Field | Rule | Why |
|---|---|---|
| `engagement` | highest | Likes only grow, so the largest is the newest measurement (412 → 415 → 1204) |
| `published_at` | earliest | An article has one publication time; minutes apart is crawler jitter |
| `published_at_raw` | the one matching the chosen `published_at` | Otherwise the audit column misleads |
| `author`, `title`, `url` | keep existing, fill if missing | `str-99120` has an author; its copy has `null` |
| `content` | the longer one | Usually the more complete body |
| `times_seen` | +1 | Spots a misbehaving crawler; also the new-vs-merged signal |

`GREATEST`/`LEAST` ignore `NULL` in PostgreSQL, which is exactly "fill from
whichever copy has a value".

---

## Assumptions I made

1. **A timestamp with no timezone is UTC.** Evidence from the data: `nst-40021`
   `"2026-08-10 08:20:00"` is the same article as `str-99120`
   `"2026-08-10T08:15:00Z"`. Read as UTC they sit 5 minutes apart — a re-crawl.
   Read as UTC+8 the copy predates the original by 8 hours, which is impossible.
2. **A bare date is a local Malaysian date**, stored as midnight UTC+8. A date
   with no time is a human-facing value in the publisher's own calendar.
3. **`"11/08/2026"` is 11 August.** Malaysian publishers write day-first, and
   the whole feed clusters in 10–15 August. Where a number exceeds 12 the
   ambiguity resolves itself and overrides the convention.
4. **Days are bucketed in `Asia/Kuala_Lumpur`**, written explicitly in the query
   rather than relying on the server. The GDP mention is stored as
   `2026-08-10 16:00 UTC` — 10 August in UTC, **11 August** in Malaysian time.
   11 August is right: the feed's own raw value is `"11/08/2026"`, and the user
   is an analyst who thinks in local days.
5. **Undated mentions are excluded when a date filter is active** — we cannot
   prove they fall inside the range. The response says so rather than leaving it
   a mystery. In `group_by=day` they get their own bucket instead, because a
   chart that silently drops rows is a chart that lies.
6. **The URL host identifies the outlet**, in preference to the `source` label,
   which is free text a provider types. Known limitation: an aggregator link
   would resolve to the aggregator.
7. **`title: ""` means the same as `title: null`** — the feed uses `null` for
   tweets and `""` for the Facebook post.
8. **Unparseable values become `NULL` plus a warning**, never a plausible guess.

---

## Trade-offs I knowingly accepted

1. **`simple` dictionary means no word-form matching** — `flood` does not find
   "Flash floods". The price of a dictionary safe for mixed English–Malay text.
   Written as a test so the limitation is recorded, not discovered later.
2. **`LIMIT`/`OFFSET` pagination.** Exact totals and correct because the sort is
   total, but it degrades on deep pages. Keyset pagination would fix that at the
   cost of "jump to page N".
3. **One `INSERT` per mention.** Clear, and fine for 15 records; a 10,000-record
   batch would be visibly slow.
4. **The total costs a second query.** `count(*) OVER ()` folds it into one, but
   when `offset` runs past the last row nothing comes back and the total
   silently reads 0. Two statements are always right. There is a test for it.
5. **One duplicate rule, not two** — the URL-based second pass is left out to
   keep the rule single and explainable.
6. **`group_by=day` omits zero-count days.** Filling gaps would make the API
   decide the date range, which belongs to the caller.
7. **Schema as one idempotent SQL file, not numbered migrations.** Right for one
   schema version; it does not scale to real schema evolution.
8. **Warnings are returned in full**, and ingest is a single transaction. Both
   are correct at this size and would need capping/chunking at scale.

---

## Tests

```bash
npm test        # 98 tests, 7 files
```

The brief asks for a few meaningful tests over the riskiest logic. These target
where a wrong answer is both likely and **invisible** — none of them would throw
an error if the behaviour regressed:

- **`dedupe.test.ts`** — asserted against `seed_mentions.json` itself: 15
  records → 12 mentions, the three known duplicate groups merge, and the two
  outlets covering the same tourism story stay separate.
- **`ingest.test.ts`** — idempotency against real PostgreSQL: 1, 2 and 5
  consecutive posts all leave 12 rows, plus every merge rule.
- **`search.test.ts`** — three consecutive pages yield 12 unique ids with no
  gaps (fails if the sort tie-breaker is removed); `to=<date>` covers the whole
  day; undated rows drop out under a date filter.
- **`stats.test.ts`** — the day bucket is Malaysian, not UTC; undated rows are
  counted in their own bucket rather than dropped.
- **`dates.test.ts`** — all six date shapes and the ambiguous `11/08/2026`.
- **`text.test.ts`** — `<script>alert(1)</script>` cannot reach a browser,
  including the entity-encoded form which is inert on arrival and live one
  decode later.
- **`sources.test.ts`** — the label-matching path, which never runs against the
  seed data because every record has a recognisable host.

Database tests run against real PostgreSQL because what is being tested *is* the
guarantee the database provides. `ingest.test.ts` wraps everything in a
transaction and always rolls back.

---

## Time spent

Roughly **3 hours**, across **two sessions on two days** (17–18 August 2026).

The first session went on reading the brief, going through `seed_mentions.json`
record by record, and settling the schema and duplicate rule. The second was the
three endpoints, the tests and this README.

One detour: I built the first version on SQLite for setup simplicity, then moved
to PostgreSQL once it was clear the three things this task needs — `TIMESTAMPTZ`
across three timezone conventions, an indexed generated search column, and
database-enforced constraints — are exactly what SQLite does not give. The commit
history shows that reversal.

---

## With another week, I would…

1. **Add the URL-based second duplicate check** — the current rule catches the
   same article under different URLs, not the inverse (same URL, headline
   reworded by the desk). `canonical_url` is already stored and indexed for it.
   First thing I would do.
2. **Switch to keyset pagination**, keeping `LIMIT`/`OFFSET` only for "jump to
   page N".
3. **Batch the inserts** — one multi-row `INSERT … ON CONFLICT`.
4. **Add a raw-payload table and numbered migrations**, making the whole
   normalisation layer replayable from the archive.
5. **Improve search** — `pg_trgm` for prefix matching, dictionary per detected
   language, and a relevance score so results can be ranked.
6. **Monitor feed health.** Ingest already reports per-record warnings;
   aggregating them over time turns a debugging aid into monitoring. A silently
   degrading upstream feed is the most likely real-world failure here.

---

## Deliberately not built

Per the brief: no authentication, CI, Kubernetes, ML, or exhaustive coverage.
Docker Compose is omitted too — the service needs only Node and a connection
string, so it would have made setup longer, not shorter.
