# Task 8 report: athletics venue mapping + dining discovery

Brief: `reports/sdd/brownsync-ingestion/task-8-brief.md` (adapted: athletics
REACHABLE per the 2026-07-29 probe; dining BLOCKED at the Pantheon edge, no
discovery requests permitted).

## Capture (Step 1)

Exactly **one** live request: `GET
https://brownbears.com/calendar.ashx/calendar.ics` through
`CachedHttpClient` (UA `BrownSync/1.0 (+noah_finkelstein@brown.edu)`;
robots.txt `Crawl-delay: 30` trivially satisfied by a single request).
Recorded as `ingest/fixtures/recorded/athletics/calendar.ics` (200,
`text/calendar`, 71,149 bytes, sha256 `ded454a1…3da8620`, retrieved
2026-07-29T04:40:47Z) with a full manifest entry: 170 VEVENTs, 50 distinct
LOCATION values, calendar name `Brown University Athletics`, TTL `PT120M`.
The harness email scrubber ran (nothing to scrub — public schedule data,
verified by the existing no-personal-email gate).

Harness changes: `fixtures_capture.py` gained the `athletics` group and a
`--groups` selector whose `preload_manifest` MERGES a partial run into the
existing manifest — Task 3 evidence for unselected groups (including the
user-provided CAB CSV, which no capture group owns) survives verbatim,
while entries/gaps/prefixed notes of the selected sources are replaced.
`tests/test_fixtures.py` now requires `athletics_ics` (min 1) like every
other source.

## RED/GREEN evidence

- Baseline: `uv run pytest -q` → **559 passed, 34 skipped**.
- RED 1 (harness): `tests/test_fixtures_capture_athletics.py` +
  `athletics_ics` minimum → **8 failed** (missing group/expected-facts
  builder/`preload_manifest`; integrity gate demanding the fixture).
- GREEN 1: harness implemented → 7/7; capture run → integrity gate green.
- RED 2 (mapping): `tests/test_athletics_venues.py` → **collection error**
  (module absent); after implementing the module, **4 failed** pinning the
  two missing gazetteer venues (`unknown-place-id: coleman-aquatics-center,
  goldberger-family-field` — the job fails closed exactly as designed).
- GREEN 2: two evidence-grounded catalog entries added; catalog pin updated
  162 → 164 (Task 6B's pin extended, same mechanism 6B applied to Task 4's).
- Final: **587 passed, 34 skipped** (+28 new tests).

## The classification rule (and why city prefix is not enough)

The recorded feed disproves the naive "Providence prefix = home" rule:
`Providence\, R.I., Chapey Field at Anderson Stadium` is **Providence
College's** soccer stadium — the feed carries only `Brown University Men's
Soccer at Providence` there. A home-venue observation requires all three
signals: Providence city prefix, a venue segment, and a SIDEARM home-style
summary (`vs` before any `at`), plus an explicit
`NON_BROWN_PROVIDENCE_VENUES` blocklist so a hypothetical PC-hosted neutral
"vs" game cannot leak in. Every exclusion carries a tested machine-readable
reason; nothing is silently dropped. On the recorded feed (170 events):

| classification | events | note |
|---|---|---|
| home-venue | 62 | 4 distinct venues (below) |
| away-city | 98 | incl. neutral-site "vs" games (Pawtucket, Tulsa, …) |
| away-game | 1 | Chapey Field at Anderson Stadium (PC) |
| tba | 6 | |
| no-location | 3 | |

## Venue inventory (sidecar: `db/seeds/athletics_venues.json`, 11 mappings)

Observed home venues (feed evidence):

| SIDEARM venue | place_id | events |
|---|---|---|
| Stevenson-Pincince Field | `stevenson-pincince-field` | 18 |
| Richard Gouse Field at Brown Stadium | `brown-stadium` | 14 |
| Katherine Moran Coleman Aquatics Center | `coleman-aquatics-center` | 20 |
| Goldberger Family Field | `goldberger-family-field` | 10 |

Contract §5 required variants (winter venues, will resolve on appearance):
`Brown Stadium`, `Meehan Auditorium` → `meehan-auditorium`, `Pizzitola` /
`Pizzitola Sports Center` → `pizzitola-sports-center`, `OMAC` /
`Olney-Margolies Athletic Center` → `olney-margolies-athletic-center`,
`Stevenson-Pincince`.

Sidecar guarantees (tested): exact schema v1 elements
(`{"source_name","place_id"}` only), sorted/unique by source_name, every
place_id in the catalog, atomic publication, fail-closed on unmapped home
venues (previous sidecar left untouched).

## Gazetteer growth (2 new places; places.ndjson 162 → 164, republished)

- **`goldberger-family-field`** (athletic, curated): Brown field hockey's
  home on the Erickson Athletic Complex, adjacent to Stevenson Field (Brown
  EAP: enter 235 Lloyd Ave, "between Stevenson Field and the Goldberger
  Family Field"). Coordinates 41.830826, -71.395228 = centroid of OSM way
  141129272 (`leisure=pitch`) — absent from the buildings-only Overpass
  fixture, hence curated-confidence.
- **`coleman-aquatics-center`** (athletic, osm): swimming/diving and water
  polo venue, part of the 2012 Nelson Fitness Center building program (EAP:
  behind the OMAC, side entrance 235 Hope St). OSM has no separate element,
  so it merges the Nelson Fitness Center footprint it occupies
  (`way/195508288`, polygon + 225 Hope Street address).

`db/seeds/places.ndjson` regenerated via `run_places_job` (atomic): 164
rows, gates PASS, 0 diagnostics, sorted unique ids, six dining places
intact, sidecar foreign keys verified against the published file.

## Dining (Step 3)

No requests sent. `ingest/dining/NOTES.md` documents the Pantheon-edge 403
(manifest gaps `dining_landing`/`dining_bundle`), why no discovery ran
(evasion forbidden), the unblock paths (OIT allowlist for the declared UA,
or browser-exported pages into `fixtures/user_provided/`), and why contract
v1 is unaffected (no hours row; six dining places already seeded).
`reports/app_side_dependencies.md` registers the athletics-sidecar consumer
dependency (blocking, app lane), the pending Task 7 organization sidecar,
the dining user-input dependency, and the Task 9 manifest enforcement.

## Verification

- `cd ingest && uv run pytest -q` → **587 passed, 34 skipped** (postgres
  suite skips without `TEST_DATABASE_URL`, as before).
- Staging (`reports/tmp/`) left empty after both publications.

## Files

- `ingest/brownsync_ingest/athletics_venues.py` (new)
- `ingest/brownsync_ingest/fixtures_capture.py` (athletics group, `--groups`
  merge)
- `ingest/brownsync_ingest/gazetteer/aliases.yaml` (+2 places)
- `ingest/fixtures/recorded/athletics/calendar.ics`,
  `ingest/fixtures/manifest.json` (new fixture entry, merged)
- `ingest/tests/test_athletics_venues.py`,
  `ingest/tests/test_fixtures_capture_athletics.py` (new),
  `ingest/tests/test_fixtures.py`, `ingest/tests/gazetteer/test_catalog.py`
- `db/seeds/athletics_venues.json` (new), `db/seeds/places.ndjson` (164)
- `ingest/dining/NOTES.md`, `reports/app_side_dependencies.md` (new)
