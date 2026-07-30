# BrownSync — Codex Parallel Handoff (Ingestion Workstream)

> **How to use:** run this in the same `brownsync` repo as the Claude Code build, or in a fork merged later. Your scope is **`ingest/**` and `db/seeds/**` only** — never touch `apps/`, `packages/`, `services/`, or `db/migrations/`. `DATA_CONTRACT.md` (repo root) is law: your output must conform to its schema, upsert rules (§2), category taxonomy (§4), and NDJSON seed format (§6). Claude Code is concurrently building the map/app against these seeds.

## 0. Mission

Build the Python ingestion package that gives BrownSync its hardest data: **Fall 2026 Brown courses with where/when they meet, the full club directory, and the campus building gazetteer** — emitted as contract-conformant NDJSON seeds (`--out ndjson`) and, once `DATABASE_URL` is provided, direct Postgres upserts (`--out postgres`).

## 1. Setup

- Python 3.12, `uv` for env/deps. Package layout:

```
ingest/
  pyproject.toml            # uv-managed; deps: httpx, beautifulsoup4, lxml,
                            # pydantic v2, psycopg[binary], tenacity, typer, rapidfuzz
  brownsync_ingest/
    cli.py                  # typer app: `ingest run <job> --out ndjson|postgres`
    contract.py             # pydantic models mirroring DATA_CONTRACT §1/§6 exactly
    gazetteer/              # job 1
    cab/                    # job 2
    clubs/                  # job 3
    athletics_venues.py     # job 4 (small)
    dining/                 # job 5 (best-effort)
    common/ (http.py rate-limited client w/ UA "BrownSync/1.0 (+<email>)",
             caching to .cache/, place_resolver.py, category_map.py)
  tests/                    # pytest; ALL network mocked via recorded fixtures
  fixtures/
```

- Etiquette: ≤ 1 req/s/host, retries with backoff (tenacity), on-disk response cache so re-runs are free, every run writes a `source_runs` record (or `db/seeds/source_runs.ndjson`).

## 2. Job 1 — Campus gazetteer (`places`) — DO THIS FIRST (jobs 2–3 depend on it)

1. Overpass query (contract §5) for the College Hill bbox → building polygons + names + levels.
2. Keep/enrich Brown-relevant buildings; slug IDs (`barus-holley`); centroid lat/lng; polygon as WKT MultiPolygon; `kind` per contract.
3. **Alias table is the crown jewel** — seed `gazetteer/aliases.yaml` manually with the canonical Brown vocabulary and grow it from real CAB/LiveWhale location strings. Must include at minimum: SciLi/Sciences Library, the Ratty/Sharpe Refectory, V-Dub/Verney-Woolley, B&H/Barus & Holley, Salomon/Salomon Center/Salomon DECI, MacMillan/MacMillan Hall, CIT/Watson CIT/Thomas Watson CIT, Sayles, Wilson, Smitty-B/Smith-Buonanno, List/List Art, Metcalf, Friedman/Friedman Hall, Kassar/Kassar House/Foxboro Auditorium, Barus Building vs Barus & Holley (distinct!), Andrews Commons, Blue Room/Faunce, Stephen Robert '62 Campus Center/Faunce House, Pembroke Hall, Alumnae Hall, Granoff/Perry and Marty Granoff Center, Pizzitola, OMAC, Meehan, Brown Stadium, Nelson Fitness/Jonathan Nelson, Keeney, Wriston Quad, Main Green/College Green, Quiet Green, Lincoln Field, Hillel/Glenn and Darcy Weiner Center, 85 Waterman, 164 Angell, 170 Hope, South Street Landing, 225 Dyer (Jewelry District).
4. `place_resolver.py`: exact-alias (case/punct-normalized) → `rapidfuzz` token_set_ratio ≥ 88 → else None. Emit a resolution report (`reports/place_resolution.md`: hit-rate per source, top unresolved strings) — this file is how we grow aliases.
5. Output: `db/seeds/places.ndjson`. Target ≥ 120 places.

## 3. Job 2 — Fall 2026 courses (`course_meetings`)

Endpoint + payloads: contract §5 (verified from a working scraper; no auth).

1. **Discover `srcdb`:** GET `https://cab.brown.edu` and read the term `<select>`/bootstrap JSON; pick the Fall 2026 code (pattern is `YYYYTT`-style, e.g. Fall 2024 was `202410`-family — READ it, don't guess). Log the chosen code loudly.
2. Enumerate subjects (dept codes from the same bootstrap payload, or search with an empty/`%` subject criterion if supported by FOSE).
3. For each result (`code`, `crn`, `title`), POST the details route; parse `meeting_html` (BeautifulSoup) into meeting patterns: days (canonical `M,T,W,Th,F,S,Su` → stored like `MWF`, `TTh`), start/end times, and location string (e.g. "Salomon Center 101" → building + room). Parse `instructordetail_html` for instructor. Some sections: no meetings (async/arranged) — skip with a counter; multiple patterns → one row per pattern, id `{srcdb}-{crn}-{idx}`.
4. Resolve building via `place_resolver`; keep `location_raw` always. **Gate: ≥ 90 % of sections with a parseable location must resolve to a `place_id`** — grow aliases until true.
5. Full run is thousands of detail POSTs: cache aggressively, checkpoint/resume, expect ~1–2 h at 1 req/s. Output `db/seeds/course_meetings.ndjson` (expect several thousand rows).

## 4. Job 3 — Club directory (`organizations`)

1. Scrape `https://studentactivities.brown.edu/student-groups/undergraduate-student-groups` (server-rendered Drupal, paginated): name, category, description, any linked site/email. Also grad groups at `https://sites.brown.edu/gsc/student-groups/`.
2. Map SAO categories → contract taxonomy (`category_map.py`); `kind='club'`; slug IDs.
3. **Cross-link to events:** fetch LiveWhale groups (`https://events.brown.edu/live/json/events?max=500` and the calendars index `https://events.brown.edu/calendars/`) and fuzzy-match club names to LiveWhale `group` values → record the LiveWhale group name in the org row (field `raw.livewhale_group`) so the TS poller attributes events to orgs. Where a club's events reveal a habitual venue, set `default_place_id`.
4. Meeting times: Brown has no central source of club meeting schedules (this is a known gap — the app's LiveWhale/club-submitted events are the honest source). Do NOT fabricate. Where a club's own site publishes a recurring meeting ("Tuesdays 7 pm, Wilson 302"), capture it as an `events` row with `rrule`, `source='clubs'`, `confidence=0.7`.
5. Output: `db/seeds/organizations.ndjson` (target: full directory, ~400+), plus any recurring-meeting events in `db/seeds/events.ndjson`.

## 5. Job 4 — Athletics venue table (small)

Static mapping file for SIDEARM home-venue strings → `place_id` (Brown Stadium, Meehan, Pizzitola, OMAC, Stevenson-Pincince Field, Marston Boathouse…) consumed by the TS athletics poller: `db/seeds/athletics_venues.json`.

## 6. Job 5 — Dining endpoint discovery (best-effort, timeboxed)

`https://menus.dining.brown.edu` is an SPA. Try to identify its XHR JSON endpoint from the page bundle (fetch JS, grep for `/api`/fetch calls). If found: document in `ingest/dining/NOTES.md` + minimal hours/locations seed (dining halls are fixed `places` — Ratty, Andrews, V-Dub, Blue Room, Ivy Room, Jo's — with `kind='dining'`). If not found in ≤ 1 h, write up findings and move on.

## 7. Definition of Done

- `uv run ingest run all --out ndjson` completes from a clean checkout → valid seeds (pydantic-validated) for places, organizations, course_meetings, athletics venues (+ events from job 4 recurrences)
- pytest green, offline (fixtures only); ≥ 80 % coverage on parsers (meeting_html parser especially — feed it ≥ 20 real captured variants)
- `reports/place_resolution.md` shows ≥ 90 % course-location resolution and lists top unresolved strings
- No request without the BrownSync UA; no endpoint hammered > 1 req/s; `.cache/` and secrets git-ignored
- README in `ingest/` documenting each job, runtime, and the srcdb discovery procedure (next-term re-runs are one flag)

## 8. Coordination rules

- You own `ingest/**`, `db/seeds/**`, `reports/**`. Nothing else. Schema changes → propose in a PR touching `DATA_CONTRACT.md` + version bump, never silently.
- Commit early, small PRs, Conventional Commits. If the repo has CI, your package must pass `uv run pytest` in it.
- Assume the app side consumes your seeds at any moment — never commit half-valid NDJSON to `db/seeds/` (write to `reports/tmp/` until valid).
