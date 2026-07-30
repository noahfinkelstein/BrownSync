# BrownSync — Shared Data Contract v1

**This file is the single source of truth for how the frontend/API side (Claude Code) and the ingestion side (Codex) integrate.** Both handoffs reference it. Neither side may change it unilaterally — changes require bumping the version header and updating both sides in the same PR.

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

## 2. Upsert semantics (ingestion side MUST follow)

- Upsert on `(source, source_id)`; update `last_seen_at` on every sighting; never hard-delete.
- An event present in a previous run but missing from the current full fetch of the same window → set `is_canceled = true` (don't delete).
- `place_id` resolution: exact alias match on `places.aliases` (case/punct-insensitive) → trigram similarity ≥ 0.55 against `places.name`+aliases → else leave null and keep `location_raw`. Never guess below threshold.
- Write one `source_runs` row per run, always, including failures.
- All timestamps stored UTC; source-local parsing assumes `America/New_York`.

## 3. Read API (frontend consumes ONLY these; Swift app later reuses them)

Served as Postgres views/RPC (Supabase) or REST routes. Response shapes are fixed:

- `GET /api/events?from=<iso>&to=<iso>&bbox=<w,s,e,n>&category=<c>&q=<text>` → `{ events: EventOut[] }`
- `GET /api/events/:id` → `EventOut` (with `org`, `place` expanded)
- `GET /api/places` / `GET /api/places/:id/activity?at=<iso>` → place + everything happening there in a window
- `GET /api/orgs` / `GET /api/orgs/:id` → org + upcoming events
- `GET /api/meetings?at=<iso>` → course meetings in session at instant `at` (server expands `days`+times against the term calendar)
- `GET /api/now` → convenience: `{ events, meetings, counts_by_category }` for the default "live" view
- `GET /api/health` → per-source last successful run from `source_runs`

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

Until the shared DB is provisioned, ingestion may write NDJSON to `db/seeds/{events,places,organizations,course_meetings}.ndjson` — one contract-shaped JSON object per line. `db/seed.ts` loads them. This lets the two workstreams proceed with zero coordination, then swap `--out ndjson` for `--out postgres`.
