# Codex handoff — Lane B: Data platform + continuous scrapers

**Branch:** `lane/b-data` · **Migrations:** `0005`–`0009` (allocated, do not exceed)
**Owns prerequisites P0 and P1** — these land on `main` before any lane forks.
**Blocks:** Lane C (P0 → Swift codegen).

Read `BROWNSYNC_V2_PLAN.md` first, then `DATA_CONTRACT.md` and `ARCHITECTURE.md` §2.

---

## Non-negotiable inherited constraints

1. **Two lanes, one contract.** Any schema change ships as ONE PR touching `DATA_CONTRACT.md` +
   `packages/contract/src/` + `ingest/brownsync_ingest/contract.py` + `ingest/tests/test_contract.py`
   + `db/seed-check.ts` together.
2. **Gates fail closed.** Bot detection is never bypassed. `run all` publishes the manifest last.
   CI never touches a live server. Fixtures are hash-pinned.
3. **Additive migrations only.** `0001_init.sql` is the contract verbatim and stays untouched.

---

## P0 — OpenAPI component naming (ship first, zero risk)

`packages/contract/openapi.json` has `components.schemas == {}`. Every schema is inlined at the
response site, which produces unusable generated Swift names
(`Operations.getEvents.Output.Ok.Body.jsonPayload.eventsPayload`). **This blocks Lane C.**

Append `.openapi("Event")`, `.openapi("Place")`, `.openapi("Org")`, `.openapi("Meeting")`,
`.openapi("EventDetail")`, `.openapi("OrgDetail")`, `.openapi("PlaceActivity")`, `.openapi("Now")`,
`.openapi("SourceHealth")`, `.openapi("Health")` to each exported schema in
`packages/contract/src/api.ts`. Same for `ErrorEnvelopeSchema` and the four response envelopes in
`apps/api/src/routes.ts` (`EventsResponse`, `PlacesResponse`, `OrgsResponse`, `MeetingsResponse`).

`zod-openapi` then registers them into `components.schemas` and emits `$ref` at each site.
**Every new v2 schema below gets a name at birth.**

**Test:** extend `packages/contract/test/contract.test.ts` — assert
`Object.keys(doc.components.schemas).length >= 15` and that no response body contains an inline
`"type":"object"` with `properties` (everything is a `$ref`). Regenerate via
`pnpm --filter @brownsync/api openapi`; the committed JSON diff is the review artifact.

---

## P1 — BDH headline-only (urgent, legal)

**This is a live exposure, not a hypothetical.**

`services/poller/src/bdh/normalize.ts:63` stores `truncate(stripHtml(description), 500)` and
line 81 stores `raw: rec` — the whole RSS item. BDH's RSS carries **full article text in CDATA**.
Their Terms of Use prohibit obtaining, copying, monitoring, indexing, or data-mining the site by
robot or automated device; content is `© 2026 The Brown Daily Herald, Inc.` Their robots.txt
permits crawling with `Crawl-delay: 10`. **ToS governs over a permissive robots.txt.**

Do now, ahead of everything else:

1. `description: null` for BDH rows.
2. Store only `{ guid, link, pubDate, title, categories, author }` in `raw` — never the item.
3. A migration purging existing `description` and `raw` bodies for `source = 'bdh'`.
4. Prominent attribution + click-through in any UI that renders them.

Same envelope applies to **post-** (same SNworks install).

Then email `herald@browndailyherald.com` for written permission — they run a reprint permission
form and are a financially independent nonprofit, so a student app will likely get a yes. Track
as a register entry in `reports/app_side_dependencies.md`.

---

## Part 1 — Contract v2

### Placement decisions

| Data | Home | Rationale |
|---|---|---|
| ArcGIS building polygons | **`places`** (enrich + insert `source='arcgis'`) | `places.polygon` already exists and is the FK target of everything. `Property_Name` + `Aliases` directly **grow the resolver's alias index**, which is the lever for problem #2. Do not create a parallel buildings table. |
| ~22 amenity layers | **new `amenities`** | Points, high cardinality, uniform shape, need `ST_DWithin`. Critically they must **not** go into `places` — a blue-light phone named "Emergency Phone 12" entering the alias index would poison location resolution with numeric near-matches. |
| Dining menus | **new `dining_menus`**, one row per `(place_id, service_date, meal)` with `stations jsonb` | The read pattern is "what's at the Ratty for lunch today". A fully normalized `menu_items` table is 3 joins per read of a doc that arrives as a doc. GIN on `stations` still answers "where is there tofu". |
| Dining + library hours | **one `place_hours`** | LibCal and `menu.hours` are the same statement: "place P is open X→Y on date D". One table = one route, one contract shape, one health row. LibCal's empty `lat`/`long` don't matter because the row FKs to `places`. |
| News articles | **new `articles`** | Fixes the BDH-in-`events` misfit. |
| Shuttle routes + stops | **`transit_routes`, `transit_stops`** | Static reference data, weekly. |
| Shuttle **vehicle positions** | **Never Postgres.** Durable Object (§3.4) | 20 s × forever = write amplification for data with a 30-second shelf life. |
| Academic calendar | **new `academic_calendar`**, fed by a hand-curated JSON in-repo | Changes ~annually; a parser costs more than it saves. `term_calendar` (0002) stays for CAB term windows. |

### `0005_indexes_and_hygiene.sql` (no contract change)

```sql
places_polygon_gist    on places using gist (polygon) where polygon is not null   -- problem #7
places_name_trgm       on places using gin (name gin_trgm_ops)
events_source_idx      on events (source, start_ts)
source_runs_source_idx on source_runs (source, started_at desc)
```

The polygon GiST is load-bearing forward: `ST_Contains` against footprints is how amenities,
shuttle stops, and LibCal locations get their `place_id`.

### `0006_source_registry.sql` — the keystone

```sql
create table source_registry (
  source                          text primary key,
  label                           text not null,
  lane                            text not null,   -- 'worker'|'actions'|'ingest'|'realtime'|'sql'
  enabled                         boolean not null default true,
  cadence_seconds                 int  not null,
  stale_after_seconds             int  not null,
  etiquette_min_interval_seconds  int  not null default 1,
  robots_note                     text,
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
```

Deliberately **not** FK'd from `events.source` — a new source must never fail to upsert because
a registry row is missing.

Seeded rows encode every verified etiquette fact **as data**:

| source | lane | cadence_s | stale_after_s | enabled | note |
|---|---|---|---|---|---|
| `livewhale` | worker | 600 | 2400 | ✅ | contract §5 ≤10 min |
| `athletics_ics` | actions | **7200** | 14400 | ✅ | **problem #6** — `Crawl-delay 30`, `X-PUBLISHED-TTL PT120M` |
| `bdh` | worker | 1800 | 7200 | ❌ | **ToS gate** — headline-only until permission |
| `bpr` / `bjwa` / `ppl` | worker | 1800 | 7200 | ✅ | WP REST / RSS |
| `dining` | worker | 86400 | 172800 | ✅ | ESB, 520 KB |
| `libcal` | worker | 3600 | 10800 | ✅ | CORS `*` |
| `arcgis` | actions | 604800 | 1209600 | ✅ | |
| `passiogo` | realtime | 20 | 300 | ✅ | undocumented API, hard ceiling |
| `academic_calendar` | ingest | 31536000 | — | ✅ | hand-curated |
| `providence_gov` | — | — | — | ❌ | `robots_note`: **explicit Disallow — recorded refusal, never crawled** |
| `today_brown` | — | — | — | ❌ | Shibboleth SSO — unavailable |
| `dedup` / `feed_rank` | sql | 900 | 3600 | ✅ | derived jobs |

**Registering the refusals as disabled rows is deliberate** — matching the `BlockedJob`
philosophy in `cli.py`. A blocked source becomes a reported state, never a silent omission
someone rediscovers and crawls by accident.

`api_health()` is replaced (`create or replace`, additive) to left-join the registry and return
`stale_after_seconds`, `enabled`, `label`. Registry sources with no runs report `'never'` from
SQL rather than being synthesized in `mappers.ts`.

### `0008_contract_v2_tables.sql`

```sql
create table articles (
  id uuid primary key default gen_random_uuid(),
  source text not null, source_id text not null,
  canonical_id uuid references articles(id),
  url text not null, url_canonical text not null,
  title text not null, dek text, excerpt text, body_text text,
  authors text[] not null default '{}',
  section text, topics text[] not null default '{}', category text,
  published_at timestamptz not null, updated_at timestamptz,
  image_url text,
  place_id text references places(id),
  org_id text references organizations(id),
  event_id uuid references events(id),
  lang text not null default 'en',
  paywalled boolean not null default false,
  license text not null,
  simhash bigint,
  simhash_b0 smallint, simhash_b1 smallint, simhash_b2 smallint, simhash_b3 smallint,
  word_count int, confidence real not null default 1.0,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  raw jsonb,
  unique (source, source_id),
  constraint articles_license_ck check (license in ('headline_only','excerpt','full')),
  constraint articles_headline_only_ck
    check (license <> 'headline_only' or (body_text is null and excerpt is null)),
  constraint articles_body_ck
    check (license = 'full' or body_text is null)
);
```

**The two CHECK constraints are the legal gate made structural.** With `bdh` shipping
`license='headline_only'`, the database physically rejects a row carrying BDH body text or
excerpt. A future permission grant is a one-line
`update source_registry set license='excerpt'` plus a normalizer change — an explicit, auditable
act rather than a code path that quietly starts storing more.

Indexes: `(published_at desc)`, `(url_canonical)` **non-unique** (the dedup job decides; a unique
constraint would make a legitimate re-publish a hard error), `gin (title gin_trgm_ops)`,
`(canonical_id) where canonical_id is not null`, and b-tree on each simhash band.

Also in `0007`: `place_hours`, `dining_menus`, `amenities`, `transit_routes`, `transit_stops`,
`academic_calendar`. Full DDL sketch:

```sql
create table place_hours (
  id bigserial primary key,
  place_id text not null references places(id),
  source text not null,          -- 'libcal'|'dining'
  source_key text not null,      -- lid / location code
  service_date date not null,
  opens_at timestamptz, closes_at timestamptz,
  status text not null,          -- 'open'|'closed'|'text'|'24hours'  (LibCal enum)
  note text, raw jsonb,
  unique (source, source_key, service_date, coalesce(opens_at, 'epoch'::timestamptz))
);

create table dining_menus (
  id bigserial primary key,
  place_id text references places(id),
  location_code text not null,   -- AC|BR|IVY|JOS|SOE|SHRP|VW
  location_name text not null,
  service_date date not null, meal text not null,
  hours_start timestamptz, hours_end timestamptz,
  stations jsonb not null, item_count int not null default 0, raw jsonb,
  unique (location_code, service_date, meal)
);
create index dining_menus_stations_gin on dining_menus using gin (stations jsonb_path_ops);

create table amenities (
  id text primary key,           -- '<layer>:<objectid>'
  kind text not null,            -- 'blue_light'|'aed'|'narcan'|'restroom_gender_inclusive'|…
  name text, place_id text references places(id),
  lat double precision not null, lng double precision not null,
  attributes jsonb, source text not null default 'arcgis', layer_id text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index amenities_geo_idx on amenities using gist (ST_SetSRID(ST_MakePoint(lng,lat),4326));
create index amenities_kind_idx on amenities (kind);
```

### Enums and CHECK constraints — the recommendation

**No Postgres `enum` types, ever.** They cannot be altered inside a transaction in older PG and
fight the additive-only rule the moment a source or category is added.

**CHECK constraints: on new tables immediately** (free, encode intent). **On existing tables: no.**
Adding `check (status in (...))` to `source_runs` risks breaking a live poller mid-flight for zero
read benefit — the Zod/Pydantic boundary already validates both directions. **Record this as a
deliberate decision in `DATA_CONTRACT.md` §1 v2** rather than leaving it ambiguous. If ever
wanted, the safe path is `add constraint … not valid` after a query proves zero violations, then
`validate constraint` separately.

### Contract renderings

- `packages/contract/src/` — new `articles.ts`, `hours.ts`, `dining.ts`, `amenities.ts`,
  `transit.ts`, `feed.ts`; extend `seeds.ts` with the matching `Seed*Schema`s; extend
  `SourceHealthSchema` with `staleAfterSeconds`, `enabled`, `label`. Export from `index.ts`.
- `ingest/brownsync_ingest/contract.py` — mirror each as a strict `ContractRow` subclass
  (`extra="forbid"`), same numeric-bounds discipline as `PlaceRow.lat/lng`.
- **`ingest/tests/test_contract.py` is the hand-mirroring pin.** Extend it to assert field-name-set
  equality and nullability parity for every new pair. Without this the two renderings drift
  silently.
- `db/seed-check.ts` — validators per artifact: schema → unique ids → FK resolution →
  renderability. **Add an `articles` check asserting `license='headline_only'` rows carry no
  `excerpt`/`body_text`** — the CHECK constraint's offline twin, so a bad bundle fails before it
  reaches a database.
- `DATA_CONTRACT.md` → v2: §1 tables, §3 routes, **§7 "licensing and redistribution"** (new —
  `articles.license` semantics and the per-source obligation), **§8 "sidecar schemas"** (closing
  the residual root cause in `reports/app_side_dependencies.md` §1: neither sidecar is
  contract-defined today).

---

## Part 2 — The unified news feed

### Per-source normalization

| Source | Endpoint | `license` | Notes |
|---|---|---|---|
| BDH | `https://www.browndailyherald.com/feed` (**no trailing slash — `/feed/` 404s**) | `headline_only` | ToS gate. `<category>` → `topics`, `<author>` → `authors`. **Never read the CDATA body.** |
| post- | `…/sitemap/section/post-magazine.xml` or filter BDH `<category>` | `headline_only` | Same SNworks install, same ToS envelope. Sections: post-magazine, post-feature, post-narrative, post-arts-culture, post-lifestyle. |
| BPR | `https://brownpoliticalreview.org/wp-json/wp/v2/posts?per_page=20&_fields=…` | `excerpt` | **WP REST is richer than the feed**: `coauthors`, `categories`, `tags`, `featured_media`, `yoast_head_json` (canonical URL + OG image). `?per_page=` and `?_fields=` both verified working. |
| BJWA | `https://bjwa.brown.edu/feed/` | `excerpt` | Quarterly — cadence 86400. |
| PPL | `https://www.provlib.org/feed/` | `excerpt` | Providence Public Library. |
| Brown official news | HTML parse of `/news/all` | `excerpt` | **No feed exists** — all six probes 404 (`/news/rss`, `/news/rss.xml`, `/news/feed`, `/news/all/feed`, `/jsonapi`, `/live/json/news`). Drupal, no `link rel=alternate`. robots.txt does not restrict `/news`. Selector-fragile → confidence 0.9, gate at <10 parsed ⇒ `partial`. |

**Leave `articles.category` null by default.** The §4 taxonomy is an *event* taxonomy; forcing
news into it repeats exactly the mistake being fixed. Rely on `topics[]` (source-native) plus
`source`. Only map where a source's own section is unambiguous (`arts`, `athletics`).

### Redundancy — three layers

**Layer 1 — URL canonicalization** (exact, free, kills the biggest source). New pure module
`services/poller/src/news/canonicalUrl.ts`: lowercase scheme+host, strip leading `www.`, strip
`utm_*`/`fbclid`/`gclid`/`mc_cid`/`mc_eid`/`ref`/`s`/`amp`, drop fragment, collapse `//`,
normalize trailing slash, unwrap AMP, prefer an explicit canonical when present (WP REST
`yoast_head_json.og_url`; RSS `<guid isPermaLink="true">`).

This alone collapses BDH `/feed` vs `/plugin/feeds/top-stories.xml` (verified identical items)
and every social-share variant. Table-driven test over ~40 real URL pairs.

**Layer 2 — title trigram in SQL.** Same shape as `buildCandidatePairsQuery` in
`services/poller/src/dedup/index.ts`, but blocked on `abs(published_at diff) <= 72 hours` and
`b.source <> a.source`, decided by `similarity(a.title, b.title) >= 0.72`.

**0.72, not the events' 0.55** — headlines are long and distinctive, and a false merge across two
publications (suppressing one outlet's coverage) is a worse failure than a missed dedup. Justify
the constant in the module docstring the way `DEFAULT_DEDUP_CONFIG` already does.

**Layer 3 — content simhash.** `services/poller/src/news/simhash.ts`: 64-bit simhash over shingled
tokens of `excerpt ?? title + dek`, stored as `simhash` + four `smallint` bands. Candidate join is
band equality (indexed), decided by `popcount(a.simhash # b.simhash) <= 3` within 7 days. Catches
syndication and reprints under different headlines.

**Reuse vs new — explicit:**

- **Reuse unchanged:** `services/poller/src/dedup/cluster.ts`. Its union-find, canonical pick
  (confidence → source priority → `first_seen_at` → id), and the "never two rows of one source in
  a cluster" invariant are already generic over `{id, source, confidence, firstSeenAt}`.
- **Reuse the shape, new SQL:** `flattenChains`, the grouped-by-canonical apply loop, the
  `canonical_id is null` re-check, the `source_runs` lifecycle → new
  `services/poller/src/dedup/articles.ts`.
- **Must be new:** the blocking query, `canonicalUrl.ts`, `simhash.ts`, and `sourcePriority` —
  which for articles comes from `source_registry.feed_weight` (data), not a hardcoded array.

### Ranking — materialized, not a view

A `UNION ALL` view with a scoring expression cannot use an index on the score and recomputes per
request. `0009_feed_entries.sql`:

```sql
create table feed_entries (
  item_kind text not null,          -- 'article'|'event'|'dining'
  item_id text not null,
  score real not null,
  score_components jsonb not null,
  ts timestamptz not null,
  category text, source text not null,
  place_id text references places(id),
  org_id text references organizations(id),
  topics text[] not null default '{}',
  computed_at timestamptz not null default now(),
  primary key (item_kind, item_id)
);
create index feed_entries_rank_idx on feed_entries (score desc, item_id asc);
```

A few thousand rows, refreshed by a `feed-rank` job at 10 min. `score_components` makes every
placement auditable and lets the UI answer "why is this here" — matching the project's existing
provenance-visible design law.

Pure function `services/poller/src/feed/score.ts`, every constant named and exported:

```
score = 0.34·recency + 0.26·imminence + 0.18·sourceWeight
      + 0.12·locality + 0.06·media + 0.04·enrichment
score *= confidence
```

- `recency = exp(-ageHours / TAU)`, `TAU_ARTICLE = 36`, `TAU_DINING = 6`. Articles only.
- `imminence` (events only): `1 - clamp(hoursUntilStart / 168, 0, 1)`, ×0.5 once started, 0 ended.
- `sourceWeight = source_registry.feed_weight` — **tuning is a SQL update, not a deploy.**
- `locality` = 1.0 on-campus `place_id`, 0.6 Providence coords, 0.3 unlocated.
- **No engagement term in v1** — there is no telemetry. Leave the weight slot documented and zero
  rather than inventing a proxy.

**Assembly-time diversity — this is where "little redundancy" reaches the reader.** Scoring dedups
*identity*; assembly dedups *experience*. `services/poller/src/feed/assemble.ts`, greedy MMR-lite
over the top 200: max 1 per `url_canonical` cluster; **max 30% of a page from one source, never 3
consecutive**; topic decay ×0.75 per shared `topics[]` entry; interleave floor of ≥1 event and
≥1 article in the first 5.

### API routes

New in `apps/api/src/queries.ts` (the designed seam) + `routes.ts`/`app.ts`:

- `GET /api/feed?cursor=&limit=&kinds=&category=&q=` → `{ items, nextCursor }`.
  **Keyset cursor on `(score, item_id)`, never offset** — the ranking table is refreshed
  underneath the reader and offset would duplicate and skip across pages.
- `GET /api/articles`, `/api/articles/{id}`, `/api/places/{id}/hours`, `/api/dining`,
  `/api/amenities?kind=&bbox=`, `/api/transit/routes`, `/api/transit/stops`,
  `/api/transit/vehicles`, `/api/transit/stream`.

`FeedItemOut` is a **Zod discriminated union on `kind`** — this generates clean Swift enums with
associated values, worth choosing deliberately over a flattened optional-everything shape.
`ArticleOut` must expose `license` so the client cannot render more than permitted, and
`attribution: { publication, url }` so click-through is structural.

---

## Part 3 — Continuous scrapers

### Platform evaluation

| | Floor | Reliability | Fits |
|---|---|---|---|
| GH Actions cron | 5 min | Poor — routinely 5–20 min late | Heavy payloads, Python, anything needing the repo. IPv4-only (matters: `db.<ref>.supabase.co` is IPv6-only). |
| **Worker Cron Triggers** | 1 min | Good; not exactly-once | Small fetch → normalize → upsert. Worker + Hyperdrive already exist. No Python, no filesystem. |
| Durable Object alarms | ~1 s | Good, single-instance | Sub-minute, stateful, fan-out. |
| pg_cron | 1 min | Excellent | Pure SQL. Cannot fetch without `pg_net`. |

### Recommended split

| Lane | Runtime | Sources | Cadence |
|---|---|---|---|
| A — Realtime | Durable Object `ShuttleTracker` | PassioGo vehicles | 20 s active / 120 s idle / sleep |
| **B — Fast poll** | **One** Worker cron `* * * * *` → registry dispatcher | LiveWhale, LibCal, publications, dedup, feed-rank | 10 m / 60 m / 30 m / 15 m |
| C — Batch | GH Actions (`poll.yml` extended) | dining, ArcGIS, athletics | daily / weekly / **2 h** |
| D — Python | GH Actions (`ingest.yml`, **new**) | gazetteer, campus buildings, academic calendar | weekly / on-demand |
| E — SQL | pg_cron | retention, `analyze`, `source_runs` pruning | daily |

**The single most important decision: one `* * * * *` trigger with a registry-driven dispatcher,
not N cron expressions.**

`apps/api/src/scheduled.ts`. Each minute:

```sql
select source from source_registry
where enabled and lane = 'worker'
  and (backoff_until is null or backoff_until <= now())
  and (last_started_at is null
       or last_started_at + make_interval(secs => cadence_seconds) <= now())
order by last_started_at nulls first
limit 3
```

`limit 3` bounds per-tick work inside the Worker CPU budget; `nulls first` prevents starvation.
The dispatch decision itself is a **pure function** in `apps/api/src/schedule/dispatch.ts`
(`due(rows, now) → string[]`), unit-tested with no Worker and no DB.

From one mechanism you get: per-source cadence as data (root fix for problem #5); backoff as data
(`backoff_until = now() + least(cadence · 2^failures, 6h)` with full jitter, pure function
mirrored in `ingest/.../common/backoff.py` with a cross-lane parity test); **one kill switch**
(`update source_registry set enabled=false where source='bdh'` — the legal gate needs exactly
this); and starvation-avoidance for free.

**Shared normalizers.** The Worker needs the same normalize code as the Node CLI, but
`services/poller` is Node-coupled (`node:fs` ETag cache, fixture replay). Extract the pure parts
into a new workspace package **`packages/sources/`**. `services/poller` keeps the CLI, the
fs-backed `http.ts`, fixtures, and `db.ts`, and imports from it. **Worth its own step** — a pure
move-and-re-export with no behavior change, with the existing poller tests as the safety net.
**Must precede the Worker dispatcher** (the Worker cannot import Node-coupled modules).

### Dining — do NOT build a CORS proxy

The ESB has no `access-control-allow-origin`. The instinct is a proxy route. **Reject it.** A
per-request proxy puts Brown's internal ESB in the critical path of every page load and re-fetches
520 KB to answer "what's for lunch".

**Instead: a daily Worker cron job fetches once, normalizes, upserts `dining_menus`; the browser
reads `/api/dining`.** One ESB request per day instead of one per visitor, queryable and joinable
to `places`, and it survives an ESB outage. **Record `GET /api/dining/raw` as explicitly rejected
in the API README** so nobody adds it later.

### The shuttle lane

`apps/api/src/transit/ShuttleTracker.ts` — a Durable Object, one instance
(`idFromName("brown-1067")`).

**The per-action body-key difference is the documented gotcha and must live in a table, not
inline strings:**

```ts
const PASSIO_ACTIONS = {
  routes: { q: "getRoutes=1", body: { systemSelected0: "1067", amount: 1 } },
  buses:  { q: "getBuses=1",  body: { s0: "1067", sA: 1 } },
  stops:  { q: "getStops=2",  body: { s0: "1067", sA: 1 } },
} as const;
```

Snapshot in DO storage; fan out over **hibernatable WebSockets** so idle subscribers cost nothing.
SSE fallback at `/api/transit/stream`. **Never writes vehicle positions to Postgres** — one
`source_runs` row per 5-minute window so health rolls up like every other source.

**Defensive by construction** — this is an undocumented private API with no published ToS, the
highest-breakage source in the plan:

- every field optional in the Zod schema; a parse failure serves the last good snapshot with
  `stale: true` rather than erroring
- 20 s only while ≥1 subscriber; 120 s idle; hibernate after 10 min with none
- **hard ceiling of 3 requests/minute regardless of subscriber count**
- 3 consecutive failures → back off to 5 min, degrade to `transit_routes`/`transit_stops`
- **any 4xx other than 404 → disable the lane and record the reason. Do not retry into a refusal.**

**Ship it last (step 10) so nothing else depends on it.** Treat total loss of this lane as
acceptable.

### Health model — per-source cadence (problem #5)

`apps/web/src/ops/health-model.ts:14` has a single global `STALE_AFTER_MS = 45 * 60_000`. With
ArcGIS weekly and dining daily, every slow source turns yellow permanently.

**Fix at the API, not the client.** `api_health()` returns `stale_after_seconds`;
`effectiveStatus(source, nowMs)` uses `source.staleAfterSeconds * 1000`, falling back to the
existing constant when null so the change is safe against a registry gap. `sourceLabel()` prefers
`source.label` from the wire, keeping its local map as fallback. Tests gain a weekly source at
3 days (ok) and 3 weeks (stale).

---

## Part 4 — Fixing the known problems

### Problem #1 — LiveWhale can never report `ok`

`isLikelyTruncated(rows.length, 500)` in `services/poller/src/sweep.ts:36` is true forever because
the server caps at exactly 1000. `lastOkAt` stays null; the green dot is unreachable for the
primary source.

**Fix: adaptive date-window sharding.** Verified param facts: `?max=` is silently ignored,
`/max/N` works, `/start_date/YYYY-MM-DD/end_date/YYYY-MM-DD` works, `/starting_date/` has no
effect, `/limit/` is ignored.

New `services/poller/src/livewhale/shard.ts`:

- start with 14-day windows covering `[now - 7d, now + 180d]`
- a window returning ≥ `SERVER_ROW_CAP` is **halved and re-fetched** recursively
- recursion floor at 1 day; only a single-day window still at cap is genuinely truncated
- **dedupe on the LiveWhale `id` before the `${id}:${date_ts}` contract key** — verified
  necessary: `group_id/2` returned records with `gid` values `[2,17,57]`, so cross-posted events
  leak across filters, and windows overlap at boundaries
- ~8–20 requests to cover six months at ≥1 s spacing ≈ 20 s per sweep — comfortably inside a
  10-minute cadence and politer than the 218-request group enumeration

**New truncation semantics:** a sweep is `partial` only if some shard bottomed out at 1 day and
*still* hit the cap. All shards under cap ⇒ genuinely complete ⇒ `status: 'ok'`.

**Bonus correctness win:** the sweep window becomes the **union of the requested shard windows**,
not `[min(start_ts), max(start_ts)]` of what came back. Today, if the feed returns nothing for a
two-week stretch, that stretch is invisible to the cancellation sweep and those events are never
marked canceled. Explicit windows fix a real, currently-silent bug. Add
`sweepWindowFromShards(shards)`, keeping `sweepWindow` exported for other sources.

Group sharding is **retained as a weekly reconciliation pass** in the Actions lane (218 requests
is fine weekly), which also refreshes the group→org mapping.

`SourceModule` gains an optional `fetchPlan?: (client) => Promise<Shard[]>`. Sources without it
keep today's single-fetch path byte-for-byte.

**CI:** flip the existing assertion in `ci.yml` from
`count(*) = 2 … status = 'partial'` to assert the sharded fixture path records `ok`. That
assertion is the regression guard for the whole fix.

### Problem #2 — the poller wipes place resolution

`services/poller/src/livewhale/normalize.ts:76` emits `place_id: null` and `db.ts:71` writes
`place_id = excluded.place_id`. The 229 resolved `place_id`s in the seed bundle are nulled on
first live refresh — which is why `/api/events` returns 500 rows with **0** `placeId`.

**Options considered:**

- **(a) Port `resolver.py` to TypeScript — rejected.** ~350 lines including a hand-written pg_trgm
  mirror. It creates a second implementation that must stay bit-identical, in a repo whose
  founding rule is zero shared code between lanes. `test_trigram_postgres.py` exists precisely
  because trigram parity is hard; a TS port needs the same proof, tripling maintenance surface.
- **(c) A `place_resolutions` lookup table — rejected.** A cache that goes stale silently and by
  construction cannot resolve a string it has never seen. The premise of this whole lane is *new
  sources with new location strings*.
- **(b) Move resolution into SQL — RECOMMENDED.** Postgres already has `pg_trgm` and
  `places.aliases`. The Python resolver was explicitly *built to mirror pg_trgm*
  (`resolver.py:37-67`). Putting resolution in SQL makes the mirror the original.

`db/migrations/0007_place_resolution.sql`:

```sql
create table place_aliases (
  place_id text not null references places(id) on delete cascade,
  alias text not null, alias_norm text not null,
  primary key (place_id, alias_norm)
);
create index place_aliases_trgm_idx on place_aliases using gin (alias_norm gin_trgm_ops);

create function normalize_alias(text) returns text ...;    -- ~15 lines
create function resolve_place(p_raw text)
  returns table (place_id text, room text, method text, score real) ...;
```

- `place_aliases` is populated from `places.name ∪ places.aliases` **by a trigger on `places`** —
  so `db/seed.ts`, the ingest `--out postgres` path, and any manual insert all stay consistent
  with no third code path.
- `normalize_alias` is the **only** thing that must be ported: casefold → NFKD strip-combining →
  drop apostrophes → non-alnum→space → collapse. Mirrors
  `ingest/brownsync_ingest/gazetteer/aliases.py:27-43`.
- `resolve_place` implements contract §2 verbatim: exact hit → longest-alias-prefix with a room
  remainder → `similarity() >= 0.55` → strict tie ⇒ NULL. Ambiguity fails closed, as today.

**Poller change** (`services/poller/src/db.ts`): a CTE resolves `location_raw` before insert, and
the conflict clause becomes

```sql
place_id = coalesce(excluded.place_id, resolved.place_id, events.place_id)
```

In that order: an explicit feed/sidecar `place_id` wins; else SQL resolution; else **the existing
value is never overwritten with null**. That last term alone is the direct fix, and it is
defensive against every future source.

**Ripple benefit:** the dedup blocking query joins on `place_id` and coords. At 0% resolution,
half its predicates are dead — cross-source dedup is silently degraded today too. Fixing
resolution repairs dedup for free.

**Parity test — the pin:** `ingest/tests/gazetteer/test_sql_resolver_parity.py`, modeled on the
existing `test_trigram_postgres.py`, replays the resolver's fixture corpus through **both**
`PlaceResolver.resolve()` and `select * from resolve_place(...)`, asserting identical
`(place_id, room, method)`. Runs in CI's postgis `migrate` job.

Plus a CI psql assertion in the existing style:
```
check "livewhale place resolution survived the poll" \
  "select count(*) > 100 from events where source='livewhale' and place_id is not null"
```

### Problems #3, #4, #6, #7, #8, #9

- **#3** `db/seed.ts` doesn't verify the manifest. Extract `seed-check.ts:89-137` into a shared
  `db/manifest.ts` exporting `verifyManifest(seedsDir)`. `seed.ts` calls it **before reading any
  NDJSON** and exits 1 with zero writes on a mixed generation. `db/` has no test directory today —
  add one plus a `test` script, with a tampered-bundle fixture.
- **#4** `source_runs.ndjson` warns forever. Split `known[]` into `MANIFEST_ARTIFACTS` (the 7) and
  `UNMANAGED_ARTIFACTS`. Warn only for the former; emit a summary line for the latter stating
  *why* it's unmanaged. Correct-by-construction noise trains people to ignore warnings.
- **#6** athletics `37 * * * *` → `37 */2 * * *`, `cadence_seconds = 7200`.
  **Sequencing catch:** the workflow currently rides `pnpm poll dedup` on that schedule (scheduled
  lists are never `'all'`, so without the rider dedup would never run in production). Moving
  athletics to 2 h would **silently halve dedup's cadence**. Dedup must move to the Worker
  dispatcher (`lane='sql'`, 15 min) **in the same PR**. Do not port union-find to plpgsql —
  `cluster.ts` is well-tested TypeScript.
- **#7** GiST on `places.polygon`, partial (`where polygon is not null`).
- **#8** New `.github/workflows/ingest.yml` mirroring `poll.yml` (including the green-no-op
  `::warning::` gate). Weekly `17 5 * * 1` → `uv run ingest run all --out postgres`.
  **One rule:** `--out postgres` deliberately does not advance the manifest, so regenerating the
  NDJSON bundle is a **dispatch-only job that opens a PR** — never a scheduled commit to `main`.
  A scheduled job committing data artifacts unreviewed bypasses exactly the gate the fail-closed
  philosophy depends on.
- **#9** Split the bundle by cadence tier, keeping all-or-nothing *within* a tier. `SeedManifest`
  → v2 with `groups: { gazetteer, academic, orgs, bootstrap }`, each with its own generation.
  **Migration hazard, called out:** both `SeedManifestSchema` and `seeds_manifest.py` pin
  `schema_version` to literal `1` *on purpose* — "a future v2 fails loudly instead of being
  half-read." So v2 cannot be introduced quietly. Ship a `z.union([V1, V2])` discriminated on
  `schema_version` in one PR on both lanes.
  **Also retire `events.ndjson` from the bundle — but only after problem #2 lands**, and as an
  explicit gated step (verify ≥900 live LiveWhale rows with resolution ≥ the seed's 229), never a
  silent drop.

---

## Sequencing

| # | Step | Contract? | Why here |
|---|---|---|---|
| **1** | P0 OpenAPI names | no | Zero risk, unblocks Lane C |
| **2** | **P1 BDH headline-only + purge** | no | **Live legal exposure** |
| **3** | Hygiene: #7 GiST, #3 manifest verify, #4 warning | no | Risk-free |
| **4** | `source_registry` + per-source health (#5, #6) | **yes** | Steps 8, 11 and the health model all depend on it |
| **5** | **SQL place resolver (#2)** | no (SQL-only) | **Highest-value fix in the plan.** Gates 11 (dedup blocking needs `place_id`) and 13 |
| **6** | LiveWhale sharding (#1) | no | Make the primary source honest before adding sources around it |
| **7** | Extract `packages/sources/` | no | Must precede 8 — the Worker can't import Node-coupled modules |
| **8** | Contract v2 schema (**tables empty, zero producers**) | **yes** | Schema before producers so 9–12 are small and parallel |
| **9** | Worker cron dispatcher + backoff | no | |
| **10** | Producers, one PR each: dining → LibCal → ArcGIS → publications | no | One recorded fixture per source, hash-pinned |
| **11** | Shuttle Durable Object | no | **Last** — most fragile, nothing depends on it |
| **12** | Article dedup + `feed_entries` + `/api/feed` | no | |
| **13** | Frontend feed hosting | no | **Rebase on Lane A step 10** |
| **14** | Bundle group split (#9) + retire `events.ndjson` | **yes** | Needs 5 proven in production |
| **15** | `ingest.yml` scheduler (#8) | no | |

---

## Risks

- **R1 — PassioGo is the most fragile component.** Undocumented, no ToS, per-action body keys,
  and system id 1067 could be reassigned. Ship last; treat total loss as acceptable.
- **R2 — `brown.edu/news` HTML parsing.** No feed exists. Selector-fragile. Confidence 0.9, gate
  at <10 parsed, and the hash-pinned `brown_news_archive.csv` (3,301 articles through 2026-07-28)
  as the historical backstop.
- **R3 — LiveWhale request volume** goes 1 → 8–20 per sweep. Still far under the ≤10-min etiquette
  and politer than group enumeration. Registry backoff absorbs a new rate limit automatically.
- **R4 — Ranking is unfalsifiable in v1.** No engagement telemetry means weights are asserted, not
  measured. `score_components` records every term so the first week of real data can be replayed
  against alternative weightings offline; `feed_weight` is tunable by SQL update.
- **R5 — Worker cron is not exactly-once** and can be skipped. Cadence is a floor, not a
  guarantee; `last_started_at` ordering self-heals. **Build nothing requiring exact timing here.**
- **R6 — `resolve_place` performance.** A trigram scan per unresolved `location_raw` × 1000 rows
  per sweep. Mitigated by the GIN index and by resolving only *distinct* values per batch (a CTE,
  not per-row). Measure in the CI postgis job. If it regresses, add a resolution cache **in front
  of the function, never as a replacement for it.**
- **R7 — Contract v2 is a large simultaneous two-lane change.** Mitigated: step 8 ships **schema
  only, tables empty, zero producers**. If the shapes prove wrong, an empty table is cheap to alter.

**Open spikes:** `theindy.org/api/article` listing routes (10 min with devtools);
**`goprovidence.com` JSON-LD — the recon tool strips `<script>` tags, so `application/ld+json`
Event markup may well exist and has NOT actually been checked. Do not treat the 403s as proof of
absence.** Requires a raw-HTML fetch; robots.txt is permissive with `Crawl-delay: 2`.
