# BrownSync — Shared Data Contract v1.2

**This file is the single source of truth for how the frontend/API side (Claude Code) and the ingestion side (Codex) integrate.** Both handoffs reference it. Neither side may change it unilaterally — changes require bumping the version header and updating both sides in the same PR.

## Version history

- **v1.2** (2026-07-29) — strictly additive, and **entirely outside Postgres**. Adds four
  *static map/data artifacts* published by the Python lane into `db/seeds/` and fetched by the
  web app as plain assets. No table, column, row shape or route response changed; a client
  written against v1 keeps working unmodified. These are deliberately NOT database tables —
  see "§7 Static artifacts" below for why. This is still **not** the planned contract v2
  (articles, hours, dining, amenities, transit, feed ranking as *relational* tables).
- **v1.1** (migrations `0005`–`0007`) — strictly additive. Adds two **operational** tables neither lane emits as a seed artifact (`source_registry`, `place_aliases`), the two SQL functions that implement §2 place resolution (`normalize_alias`, `resolve_place`), and three **optional** fields on `SourceHealth` in §3. No existing table, column, row shape or route response changed; a client written against v1 keeps working unmodified. This is **not** the planned contract v2 (articles, hours, dining, amenities, transit, feed ranking) — that remains unshipped.
- **v1** — the original schema, upsert semantics, read API and taxonomy below.

## 1. Database: Postgres 15+ with PostGIS + pg_trgm

Connection via `DATABASE_URL` env var. Migrations live in `db/migrations/` (SQL files, run with `dbmate` or `supabase migration`). Ingestion workers NEVER create tables — they only upsert into this schema.

```sql
create extension if not exists postgis;
create extension if not exists pg_trgm;

-- Campus gazetteer: every named place on/near College Hill
create table places (
  id            text primary key,              -- slug: 'barus-holley', 'sayles-hall'
  name          text not null,                 -- 'Barus & Holley'
  aliases       text[] not null default '{}',  -- {'B&H','BH','Barus and Holley'}
  kind          text not null,                 -- 'academic'|'residence'|'dining'|'athletic'|'library'|'admin'|'outdoor'|'other'
  lat           double precision not null,
  lng           double precision not null,
  polygon       geometry(MultiPolygon, 4326),  -- OSM footprint, nullable
  address       text,
  osm_id        text,
  source        text not null default 'osm'
);

-- Organizations: clubs, departments, offices
create table organizations (
  id            text primary key,              -- slug: 'brown-outing-club'
  name          text not null,
  kind          text not null,                 -- 'club'|'department'|'office'|'athletics'|'external'
  category      text,                          -- from taxonomy in §4
  description   text,
  url           text,
  instagram     text,
  default_place_id text references places(id),
  source        text not null
);

-- Canonical events (all sources normalize into this)
create table events (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,                 -- 'livewhale'|'athletics_ics'|'cab'|'clubs'|'bdh'|'manual'|...
  source_id     text not null,                 -- stable ID within that source
  canonical_id  uuid references events(id),    -- non-null => this row is a duplicate of canonical_id
  title         text not null,
  description   text,
  start_ts      timestamptz not null,
  end_ts        timestamptz,
  is_all_day    boolean not null default false,
  rrule         text,                          -- iCal RRULE if recurring
  location_raw  text,                          -- as reported by source
  place_id      text references places(id),    -- resolved by gazetteer; nullable
  lat           double precision,              -- direct coords if source provides (LiveWhale does)
  lng           double precision,
  org_id        text references organizations(id),
  category      text,                          -- taxonomy §4
  tags          text[] not null default '{}',
  url           text,
  cost          text,
  confidence    real not null default 1.0,     -- 1.0 structured feed; <1.0 LLM/NLP-extracted
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  is_canceled   boolean not null default false,
  raw           jsonb,                         -- original source payload
  unique (source, source_id)
);
create index events_time_idx  on events (start_ts, end_ts);
create index events_geo_idx   on events using gist (ST_SetSRID(ST_MakePoint(lng, lat), 4326));
create index events_title_trgm on events using gin (title gin_trgm_ops);

-- Course meetings: Fall term sections, expanded per weekly meeting pattern
create table course_meetings (
  id            text primary key,              -- '{srcdb}-{crn}-{meet_idx}'
  srcdb         text not null,                 -- CAB term code
  crn           text not null,
  course_code   text not null,                 -- 'CSCI 0150'
  title         text not null,
  instructor    text,
  days          text not null,                 -- 'MWF','TTh' (canonical: M,T,W,Th,F,S,Su)
  start_time    time not null,
  end_time      time not null,
  location_raw  text,                          -- 'Salomon Center 101'
  place_id      text references places(id),
  room          text,
  enrollment    int,
  raw           jsonb
);

-- Source health, for the ops dashboard + staleness display
create table source_runs (
  id          bigserial primary key,
  source      text not null,
  started_at  timestamptz not null,
  finished_at timestamptz,
  status      text not null,                   -- 'ok'|'error'|'partial'
  items_upserted int,
  error       text
);
```

### v1.1 operational tables (migrations 0006, 0007)

These two are **not seed artifacts**. Ingestion never emits an NDJSON file for
either, there is no `Seed*Schema` and no `contract.py` row model, and
`db/seed-check.ts` has nothing to validate: `source_registry` is operator
policy applied by a migration, and `place_aliases` is derived from `places` by
a trigger. They are documented here because the API reads them.

```sql
-- Per-source operational policy. DELIBERATELY NOT FK'd from events.source:
-- a new source must never fail to upsert because nobody registered it first.
create table source_registry (
  source                          text primary key,
  label                           text not null,   -- ops display name
  lane                            text not null,   -- 'worker'|'actions'|'ingest'|'realtime'|'sql'|'blocked'
  enabled                         boolean not null default true,
  cadence_seconds                 int  not null,   -- 0 only when not enabled
  stale_after_seconds             int  not null,   -- 0 = n/a (blocked)
  etiquette_min_interval_seconds  int  not null default 1,  -- site's own Crawl-delay
  robots_note                     text,            -- verbatim robots.txt finding
  tos_note                        text,
  license                         text,            -- 'headline_only'|'excerpt'|'full'|null
  feed_weight                     real not null default 1.0,
  endpoint                        text,
  last_started_at                 timestamptz,
  last_ok_at                      timestamptz,
  consecutive_failures            int  not null default 0,
  backoff_until                   timestamptz,
  notes                           text
);

-- The §2 resolver's alias index, maintained from places.name ∪ places.aliases
-- BY A TRIGGER on places — so the seed loader, ingest --out postgres and a
-- manual INSERT all stay consistent with no third code path.
create table place_aliases (
  place_id   text not null references places(id) on delete cascade,
  alias      text not null,     -- as curated
  alias_norm text not null,     -- normalize_alias(alias)
  primary key (place_id, alias_norm)
);
create index place_aliases_trgm_idx on place_aliases using gin (alias_norm gin_trgm_ops);
```

**Registered refusals are data, not omissions.** A source we are not permitted
to fetch is registered with `enabled = false`, `lane = 'blocked'` and its
reason verbatim in `robots_note`/`tos_note`, and a CHECK constraint enforces
that a blocked row carries one. `providence_gov` (robots.txt explicitly
disallows `/event/`, `/events/`, `/*?*`) and `today_brown` (Shibboleth SSO on
the whole host) are registered this way. `bdh` ships `enabled = false` with
`license = 'headline_only'` pending written permission. `/api/health` reports
all three rather than silently leaving them out.

### Enums and CHECK constraints — a recorded decision

**No Postgres `enum` types, anywhere.** They cannot be altered inside a
transaction on older PG and fight the additive-only migration rule the moment
a source, lane or licence value is added.

**CHECK constraints on NEW tables: yes, immediately** — they are free and they
encode intent (`source_registry` uses them to make "an enabled source must have
a real cadence" and "a blocked source must record its reason" structural).
**On EXISTING tables: no.** Adding `check (status in (…))` to `source_runs`
risks breaking a live poller mid-flight for zero read benefit; the Zod and
Pydantic boundaries already validate both directions. If one is ever wanted,
the safe path is `add constraint … not valid` after a query proves zero
violations, then `validate constraint` separately.

## 2. Upsert semantics (ingestion side MUST follow)

- Upsert on `(source, source_id)`; update `last_seen_at` on every sighting; never hard-delete.
- An event present in a previous run but missing from the current full fetch of the same window → set `is_canceled = true` (don't delete).
- `place_id` resolution: exact alias match on `places.aliases` (case/punct-insensitive) → longest alias **prefix** with a room-shaped remainder → trigram similarity ≥ 0.55 against `places.name`+aliases → else leave null and keep `location_raw`. Never guess below threshold; an exact tie between two places is **ambiguous and fails closed to null**.
- Write one `source_runs` row per run, always, including failures.
- All timestamps stored UTC; source-local parsing assumes `America/New_York`.

### v1.1: resolution is a SQL function, and null never overwrites a resolution

Two implementations of the rule above now exist, and they are pinned to each
other: `brownsync_ingest.gazetteer.resolver.PlaceResolver` (Python, ingestion
lane) and `resolve_place(text)` (SQL, migration 0007). The parity test
`ingest/tests/gazetteer/test_sql_resolver_parity.py` replays one corpus through
both and asserts identical `(place_id, room, method)`. A room is 1–2 tokens,
must contain a digit, and may never start mid raw token (`Wilson-Annex 3`
yields room `3`, never `Annex 3`).

```sql
select place_id, room, method, score from resolve_place('Salomon Center 101');
-- ('salomon-center-for-teaching', '101', 'exact-room', null)
```

**Writers MUST NOT overwrite an existing `place_id` with null.** A source that
carries no gazetteer (the TypeScript poller does not) emits `place_id: null`,
and a bare `place_id = excluded.place_id` on conflict wipes every previously
resolved place on the next refresh. The required precedence is:

```sql
place_id = coalesce(<explicit value from the feed or a sidecar>,
                    <resolve_place(location_raw)>,
                    <the value already in the row>)
```

`resolve_place` is applied to the **distinct** `location_raw` values of a batch,
not once per row.

## 3. Read API (frontend consumes ONLY these; Swift app later reuses them)

Served as Postgres views/RPC (Supabase) or REST routes. Response shapes are fixed:

- `GET /api/events?from=<iso>&to=<iso>&bbox=<w,s,e,n>&category=<c>&q=<text>` → `{ events: EventOut[] }`
- `GET /api/events/:id` → `EventOut` (with `org`, `place` expanded)
- `GET /api/places` / `GET /api/places/:id/activity?at=<iso>` → place + everything happening there in a window
- `GET /api/orgs` / `GET /api/orgs/:id` → org + upcoming events
- `GET /api/meetings?at=<iso>` → course meetings in session at instant `at` (server expands `days`+times against the term calendar)
- `GET /api/now` → convenience: `{ events, meetings, counts_by_category }` for the default "live" view
- `GET /api/health` → per-source last successful run from `source_runs`, left-joined to `source_registry`

`SourceHealth` (v1.1) carries three **optional** fields alongside the v1 ones —
optional so a v1 client is unaffected:

| field | meaning | when null/absent |
|---|---|---|
| `staleAfterSeconds` | per-source staleness horizon | source not in the registry → use your own default |
| `enabled` | false = ToS gate or recorded refusal; render as paused, not failed | absent → treat as enabled |
| `label` | registry display name | null → keep your own mapping |

A source that is **registered but has never run** now reports `status: "never"`
straight from SQL rather than being synthesized client-side, which is how the
two recorded refusals become visible instead of absent.

```ts
type EventOut = {
  id: string; title: string; description: string | null;
  start: string; end: string | null; allDay: boolean;
  lat: number | null; lng: number | null;
  placeId: string | null; placeName: string | null; locationRaw: string | null;
  orgId: string | null; orgName: string | null;
  category: Category; tags: string[]; url: string | null; cost: string | null;
  source: string; confidence: number; isCanceled: boolean;
}
```

Duplicates: API returns only canonical rows (`canonical_id is null`), with `mergedSources: string[]`.

## 4. Category taxonomy + map icon slugs (fixed set — both sides use exactly these)

| category | icon slug | color token |
|---|---|---|
| `academic` (lectures, talks, colloquia) | `icon-academic` | `--cat-academic` |
| `class` (course meetings) | `icon-class` | `--cat-class` |
| `club` (student org events/meetings) | `icon-club` | `--cat-club` |
| `arts` (performances, exhibits, film) | `icon-arts` | `--cat-arts` |
| `athletics` (games, matches) | `icon-athletics` | `--cat-athletics` |
| `food` (dining, free food) | `icon-food` | `--cat-food` |
| `social` (parties, mixers, festivals) | `icon-social` | `--cat-social` |
| `career` (recruiting, info sessions) | `icon-career` | `--cat-career` |
| `wellness` (health, fitness, religious) | `icon-wellness` | `--cat-wellness` |
| `admin` (deadlines, university ops) | `icon-admin` | `--cat-admin` |

Ingestion maps source-native types → this taxonomy (LiveWhale `event_types` mapping table lives in `ingest/mappings/categories.py`; frontend never sees raw source types).

## 5. Verified source endpoints (do not re-discover these; they are confirmed working July 2026)

| Source | Endpoint | Notes |
|---|---|---|
| LiveWhale events | `GET https://events.brown.edu/live/json/events` | Re-verified 2026-07-28. Fields include `location_latitude`, `location_longitude`, `event_types`, `group`, `is_canceled`, `repeats`. Filters: `/group/<name>`, `/category/<cat>`, `?max=N`. ICS twin at `/live/ical/events`. Poll ≤ every 10 min, UA string `BrownSync/1.0 (contact email)`. |
| Athletics | `GET https://brownbears.com/calendar.ashx/calendar.ics` | All sports; LOCATION is city-level — resolve home venues via gazetteer aliases (Brown Stadium, Meehan Auditorium, Pizzitola, OMAC, Stevenson-Pincince). |
| CAB courses | `POST https://cab.brown.edu/api/?page=fose&route=search` body `{"other":{"srcdb":SRCDB},"criteria":[{"field":"subject","value":DEPT},{"field":"is_ind_study","value":"N"},{"field":"is_canc","value":"N"}]}`; details: `POST ...route=details` body `{"group":"code:"+code,"key":"crn:"+crn,"srcdb":SRCDB,"matched":"crn:"+crn}` | Format extracted from working scraper (andrewL1234/CAB-Scrape). Details response includes `meeting_html`, `instructordetail_html`, `all_sections` — parse building/room + days/times out of `meeting_html`. **SRCDB for Fall 2026 must be read from the `<select>` options / bootstrap JSON on `https://cab.brown.edu` — do not hardcode blind.** |
| Clubs directory | `https://studentactivities.brown.edu/student-groups/undergraduate-student-groups` | Server-rendered Drupal listing (name, category, description). Paginated. |
| BDH news | `GET https://www.browndailyherald.com/feed` | RSS 2.0. Buzz layer only — no coords. |
| Buildings | Overpass API: `[out:json][timeout:60]; ( way["building"](41.820,-71.410,41.834,-71.393); relation["building"](41.820,-71.410,41.834,-71.393); ); out body geom;` | College Hill bbox. Filter/enrich to Brown buildings by name; licence ODbL — attribute OSM. |
| Shuttle (post-MVP) | `athuler/PassioGo` PyPI lib against `brownuniversity.passiogo.com` | Live vehicle positions. |

## 6. Seed-file fallback

## 7. Static artifacts (v1.2) — published files, not tables

Four data sets ship as files in `db/seeds/`, symlinked into `apps/web/public/data/` and
fetched by the browser directly. Each is produced by an `ingest run <job>` with fail-closed
gates, hashed into `db/seeds/manifest.json`, and verified by `pnpm db:seed-check`.

| Artifact | Job | Contents | Refresh |
|---|---|---|---|
| `campus_buildings.geojson` | `campus` | 262 Brown building footprints: label, rank, `labelMinZoom`, `heightM`, `year`, `placeId`, `placeIds` | weekly (`refresh.yml`) |
| `campus_landmarks.geojson` | `campus` | 552 greens, quads and athletic fields | weekly |
| `campus_amenities.geojson` | `amenities` | 823 points × 11 kinds — blue-light, AED, Narcan, restrooms, all-gender restrooms, hydration, menstrual, lactation, printers, bike racks, dining. Carries `propertyCode` and `placeIds` for joins. | weekly |
| `dining_menus.json` | `dining` | 7 halls, per-date services with offset-bearing hours, stations, items, allergens, dietary icons | **daily** |

**Why files and not tables.** Three reasons, in order of weight:

1. **The map must work without the API.** These drive cartography. A Hyperdrive hiccup
   should degrade the event layer, not blank the campus.
2. **They are reviewable in git.** A bad drop shows up as a readable diff in a PR
   (`refresh.yml` opens one) rather than as rows that quietly changed in production.
3. **Round-tripping them through Postgres buys nothing.** Nothing joins against them
   server-side; the joins that matter (`propertyCode` → `placeIds`) are precomputed by the
   producer, which is why the place page can list a building's restrooms without fetching
   327 kB of footprints.

The `placeId`/`placeIds` fields are the contract seam: they reference `places.id` and are
gate-checked against the published `places.ndjson`, so an artifact can never name a place
that does not exist.

Until the shared DB is provisioned, ingestion may write NDJSON to `db/seeds/{events,places,organizations,course_meetings}.ndjson` — one contract-shaped JSON object per line. `db/seed.ts` loads them. This lets the two workstreams proceed with zero coordination, then swap `--out ndjson` for `--out postgres`.
