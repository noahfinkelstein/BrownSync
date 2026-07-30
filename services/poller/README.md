# @brownsync/poller

Single responsibility: scheduled TS workers for *structured* feeds — LiveWhale JSON, athletics
ICS, BDH RSS — normalizing into the canonical `events` table per `DATA_CONTRACT.md` §2/§5.
Python scrapers (CAB, clubs, OSM) are the Codex workstream in `ingest/` — not here.

## Usage

```bash
pnpm poll <livewhale|athletics|bdh|all|dedup> [--dry-run] [--fixture[=path]]
```

- `--dry-run` — fetch (or replay a fixture), print normalized contract rows as NDJSON on
  stdout (minus the bulky `raw` echo) plus a summary on stderr. **No DB connection at all** —
  this is the local verification path; there is no local database in dev.
- `--fixture` — replay the recorded response in `fixtures/` instead of fetching;
  `--fixture=path` replays an arbitrary file (single source only).
- Default mode connects to `DATABASE_URL` and upserts per contract §2. CI's `migrate` job
  executes this path for real against its migrated postgis service container: a non-dry-run
  `pnpm poll all --fixture` (run twice, with psql assertions on the resulting `events` and
  `source_runs` rows) plus the `DATABASE_URL`-gated `test/db.integration.test.ts` (skipped
  when the env var is absent, i.e. in plain `pnpm test`). Production runs happen via
  `.github/workflows/poll.yml` (workflow_dispatch now, cron in Phase 3).

```bash
pnpm poll livewhale --dry-run --fixture   # offline smoke test
pnpm poll all --dry-run                   # three polite live fetches, no DB
```

## Layout

| Path | What |
|---|---|
| `src/http.ts` | Polite fetch: `POLLER_USER_AGENT` UA, >= 1 s/host spacing, ETag cache in `.cache/` (gitignored), exponential backoff. All collaborators injectable for tests. |
| `src/livewhale/` | `events.brown.edu/live/json/events?max=500` → rows. Schema derived from the recorded real response (loose — unknown fields flow into `raw`). `categories.ts` holds the documented `event_types` → taxonomy table + publisher-group fallback. |
| `src/athletics/` | `brownbears.com/calendar.ashx/calendar.ics` via node-ical. `source_id` = ICS UID, category `athletics`, all-day dates anchored to America/New_York midnight. |
| `src/bdh/` | `browndailyherald.com/feed` RSS via fast-xml-parser. Buzz layer: no coords, category null, tags `["news"]`, `start_ts` = pubDate. |
| `src/sweep.ts` | Cancellation-sweep window logic + truncated-fetch guard (contract §2), pure + unit-tested. `sweepWindowFromShards` for sources that fetch explicit windows. |
| `src/livewhale/shard.ts` | Adaptive date-window sharding: bounded windows, halve-and-refetch at the server cap, dedupe on `source_id`. Pure + unit-tested. |
| `src/db.ts` | postgres.js upsert on `(source, source_id)`, `last_seen_at` refresh, never deletes; `source_runs` row every run including failures. `location_raw` is resolved to a `place_id` by the database (`resolve_place`, migration 0007) over the batch's DISTINCT values, and **an existing `place_id` is never overwritten with null** — that bare `place_id = excluded.place_id` was why `/api/events` served 500 rows with zero `placeId`. |
| `src/dedup/` | Cross-source dedup job (`pnpm poll dedup`): SQL blocking + pg_trgm decision, pure clustering/canonical-pick logic in `cluster.ts`. See below. |
| `src/runner.ts` / `src/cli.ts` | Per-source orchestration + arg parsing. |
| `fixtures/` | ONE recorded real response per source (2026-07-28) + sidecar fixtures: a sample `organization_livewhale_groups.json` and a mirror of the real ingestion-emitted `athletics_venues.json`. LiveWhale additionally carries a **shard replay plan** (`livewhale-shards.json`, plus `-a`/`-b`/`-empty` slices of the recorded feed) — all sha256-pinned in `test/shard.test.ts`. Tests run exclusively against these — zero network in CI. |

## Source-specific decisions

**LiveWhale** — repeat series arrive pre-expanded, one row per occurrence sharing `id`;
`source_id` is `"{id}:{date_ts}"` (verified unique across the recorded feed). `date_utc` is
already UTC and used directly. Org attribution: if the ingestion-lane sidecar
`db/seeds/organization_livewhale_groups.json` exists (`{schema_version: 1, generated_at:
<UTC ISO>, mappings: [{organization_id, livewhale_group, match_method: exact|fuzzy,
score: 0..100}]}` — sidecar schema v1, coordinated with the ingestion lane) its mappings
become a group → org lookup matched against the event `group` (entity-decoded,
case-insensitive; highest score wins a contested group). Missing file → `org_id` stays null until that lane
lands. This package only ever READS from `db/seeds/`. Category mapping rationale lives in
`src/livewhale/categories.ts`.

**Athletics** — LOCATION is `"City, St.[, Venue]"`; home games (`Providence, R.I., …`) get
tag `home` and, when the ingestion-lane sidecar `db/seeds/athletics_venues.json` exists
(`{schema_version: 1, generated_at: <UTC ISO>, mappings: [{source_name, place_id}]}` —
sidecar schema v1, coordinated with the ingestion lane), a resolved `place_id` looked up by
case-folded venue string. Missing file → `place_id` stays null until that lane lands. Away
games keep `location_raw` only — never guessed (contract §2).

**BDH** — rolling top-N article feed, so the cancellation sweep is disabled: an article
dropping off the feed is not a cancellation. Articles carry category **null**, not `admin`:
the fixed §4 taxonomy has no news slot and `admin` means deadlines/university ops — mapping
news there would surface every article under the admin filter chip. The buzz layer is
identified by `source = "bdh"` plus the `news` tag instead. Descriptions are stripped to a
<= 500-char plain-text teaser; the full item is preserved in `raw`.

**Cancellation sweep** (LiveWhale + athletics) — after a successful full fetch, this
source's not-seen events starting inside `[min, max]` fetched `start_ts` are flagged
`is_canceled = true`; nothing is ever deleted. An empty feed never sweeps.

**Cross-source dedup** (`pnpm poll dedup`) — the same real-world event often arrives from
several feeds (a home game is in the athletics ICS, LiveWhale, and a BDH article). The dedup
job marks — never deletes — duplicates per contract §1/§3: the duplicate row's
`canonical_id` points at the cluster's canonical row, and the read API exposes only
canonical rows with `mergedSources`. Detection is one SQL self-join over canonical rows
(candidate **blocking**: `start_ts` within 60 min AND same `place_id` / coords within 250 m
/ at least one side unlocated) with the **decision** made by pg_trgm
`similarity(title, title) >= 0.55` — contract §2's trigram threshold ("never guess below
threshold"). Canonical pick: higher `confidence`, then source priority (livewhale >
athletics_ics > cab > clubs > manual > bdh), then earliest `first_seen_at`, then smallest id
— deterministic and idempotent; re-runs mark nothing new. Pre-existing duplicates whose
canonical itself gets marked are re-pointed so `canonical_id` always lands on a canonical
row. `--dry-run` prints the planned assignments as NDJSON without writing (it still reads
`DATABASE_URL` — candidates live in the DB). Every non-dry run writes a `source_runs` row
(`source = 'dedup'`). Logic split: `src/dedup/cluster.ts` is pure (union-find clustering +
canonical pick, offline-tested in `test/dedup.test.ts`); the SQL text is built by
`buildCandidatePairsQuery` (also offline-tested); the end-to-end path runs in CI's postgis
job via `test/dedup.integration.test.ts` plus a `pnpm poll dedup` one-shot with psql
invariant assertions.

**Truncated fetches** — LiveWhale ignores small `?max=` values and caps the feed server-side:
the recorded response to `?max=500` is exactly 1000 rows, sorted ascending by start. A fetch
returning >= the requested max (or >= the observed 1000-row cap) is therefore treated as
incomplete: an event tied at the window's end may be absent only because it fell past the
cap, so the sweep is clamped to `[min, max)` (end-exclusive) and the run is recorded as
`partial` instead of `ok`. See `isLikelyTruncated` in `src/sweep.ts` and the fixture-at-cap
tests in `test/sweep.test.ts`. **This is now the fallback path** — the single-fetch path
every source without a `fetchPlan` still uses.

**Date-window sharding (LiveWhale)** — the rule above made `partial` structural for the
project's primary source: one unbounded fetch ALWAYS came back at the cap, so `last_ok_at`
stayed null forever and everything past row 1000 was never fetched at all. `src/livewhale/
shard.ts` asks for bounded windows instead — 14 days at a time across `[now-7d, now+180d]`,
in the publisher's local calendar. A window under the cap is PROVABLY complete; a window at
the cap is halved and refetched; only a window narrowed to a single day that still hits the
cap is genuinely `partial`. LiveWhale's parameters are **path segments**
(`/start_date/YYYY-MM-DD/end_date/YYYY-MM-DD`) — `?start_date=` is silently ignored.

Two consequences worth knowing:

- Rows are deduped on `source_id` (`${id}:${date_ts}`), because cross-posted events repeat
  across groups and halved windows share a boundary day. Not on the bare LiveWhale `id`:
  a repeating series is pre-expanded into one row per occurrence sharing one `id`, so that
  would delete every occurrence after the first.
- The cancellation sweep now covers the union of the windows that were **requested**
  (`sweepWindowFromShards`), not the span of the rows that came back. A fortnight the feed
  answers with zero events used to contribute no window at all, so anything stored there was
  never swept and stayed live forever.

`--fixture` for a sharded source replays a **plan** (`fixtures/livewhale-shards.json`) keyed
by request order rather than by date, so it stays deterministic as `now` moves. See
`test/shard.test.ts`.

## Etiquette (handoff §8)

Every request identifies as `POLLER_USER_AGENT` (default
`BrownSync/1.0 (+noah_finkelstein@brown.edu)`), max 1 req/s per host, ETags honored,
exponential backoff. Tests never hit the network — they replay `fixtures/`.
