# @brownsync/poller

Single responsibility: scheduled TS workers for *structured* feeds — LiveWhale JSON, athletics
ICS, BDH RSS — normalizing into the canonical `events` table per `DATA_CONTRACT.md` §2/§5.
Python scrapers (CAB, clubs, OSM) are the Codex workstream in `ingest/` — not here.

## Usage

```bash
pnpm poll <livewhale|athletics|bdh|all> [--dry-run] [--fixture[=path]]
```

- `--dry-run` — fetch (or replay a fixture), print normalized contract rows as NDJSON on
  stdout (minus the bulky `raw` echo) plus a summary on stderr. **No DB connection at all** —
  this is the local verification path; there is no local database in dev.
- `--fixture` — replay the recorded response in `fixtures/` instead of fetching;
  `--fixture=path` replays an arbitrary file (single source only).
- Default mode connects to `DATABASE_URL` and upserts per contract §2. Exercised in CI
  (postgis service container) and by `.github/workflows/poll.yml` (workflow_dispatch now,
  cron in Phase 3).

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
| `src/bdh/` | `browndailyherald.com/feed` RSS via fast-xml-parser. Buzz layer: no coords, category `admin`, tags `["news"]`, `start_ts` = pubDate. |
| `src/sweep.ts` | Cancellation-sweep window logic (contract §2), pure + unit-tested. |
| `src/db.ts` | postgres.js upsert on `(source, source_id)`, `last_seen_at` refresh, never deletes; `source_runs` row every run including failures. |
| `src/runner.ts` / `src/cli.ts` | Per-source orchestration + arg parsing. |
| `fixtures/` | ONE recorded real response per source (2026-07-28) + a sample `organization_livewhale_groups.json` sidecar. Tests run exclusively against these — zero network in CI. |

## Source-specific decisions

**LiveWhale** — repeat series arrive pre-expanded, one row per occurrence sharing `id`;
`source_id` is `"{id}:{date_ts}"` (verified unique across the recorded feed). `date_utc` is
already UTC and used directly. Org attribution: if the ingestion-lane sidecar
`db/seeds/organization_livewhale_groups.json` exists (`{schema_version: 1, generated_at,
mappings: [{organization_id, livewhale_group, match_method, score}]}`) its mappings become a
group → org lookup matched against the event `group` (entity-decoded, case-insensitive;
highest score wins a contested group). Missing file → `org_id` stays null until that lane
lands. This package only ever READS from `db/seeds/`. Category mapping rationale lives in
`src/livewhale/categories.ts`.

**Athletics** — LOCATION is `"City, St.[, Venue]"`; home games (`Providence, R.I., …`) get
tag `home` and, when `db/seeds/athletics_venues.json` (venue → place_id) exists, a resolved
`place_id`. Away games keep `location_raw` only — never guessed (contract §2).

**BDH** — rolling top-N article feed, so the cancellation sweep is disabled: an article
dropping off the feed is not a cancellation. Descriptions are stripped to a <= 500-char
plain-text teaser; the full item is preserved in `raw`.

**Cancellation sweep** (LiveWhale + athletics) — after a successful full fetch, this
source's not-seen events starting inside `[min, max]` fetched `start_ts` are flagged
`is_canceled = true`; nothing is ever deleted. An empty feed never sweeps.

## Etiquette (handoff §8)

Every request identifies as `POLLER_USER_AGENT` (default
`BrownSync/1.0 (+noah_finkelstein@brown.edu)`), max 1 req/s per host, ETags honored,
exponential backoff. Tests never hit the network — they replay `fixtures/`.
