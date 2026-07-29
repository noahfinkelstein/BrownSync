# Task 6B report: alias growth from unresolved evidence, gate recalibration, publication

## What shipped

- `ingest/brownsync_ingest/gazetteer/overpass.py`: `index_buildings` now also
  indexes unnamed way/relation footprints carrying both `addr:housenumber`
  and `addr:street` under the fallback key `addr:{housenumber} {street}`
  (first wins; the prefix keeps the namespaces disjoint), so curated entries
  can claim address-only buildings via explicit `osm:` references.
- `ingest/brownsync_ingest/gazetteer/aliases.yaml`: 17 new aliases on 16
  existing places + 14 new places (full inventory below), every one grounded
  in the recorded Overpass fixture or (two entries) OSM-derived curated
  coordinates. Catalog: 148 -> 162 places, 148 with footprints, 14 curated.
- `ingest/brownsync_ingest/gazetteer/job.py`: the minimal places job seam
  (CLI is Task 9) — fail-closed gates (>= 120 rows, zero dropped entries),
  atomic deterministic publication via `output.publish_ndjson`.
- `ingest/brownsync_ingest/cab/job.py`: `MIN_MEETING_ROWS` 2000 -> 1500 with
  the sign-off recorded verbatim in the module docstring;
  `RESOLUTION_GATE` 0.90 unchanged.
- `db/seeds/course_meetings.ndjson` (1,828 rows) and `db/seeds/places.ndjson`
  (162 rows): published by the real jobs behind fully passing gates.
- `reports/cab_fall_2026_place_resolution.md`: regenerated from the green run.
- Tests: `tests/gazetteer/test_job.py` (new, 9), 35 alias-growth resolver
  vectors, addr-key overpass tests, catalog pins, revised job gates/regression
  — suite 505 -> 559 passed, 34 skipped.

## Gate revision (verbatim, signed off)

> Original 2,000-row gate was calibrated for a live CAB scrape whose volume
> includes sections this authoritative user-provided export lists as
> arranged/TBA (3,328 of 5,275 records). Export maximum is 1,828
> physically-scheduled rows. Revised threshold 1,500 approved by the
> orchestrating agent (Claude, owner of both lanes) 2026-07-29 per the plan's
> explicit-revised-threshold mechanism; automatic overrides remain forbidden.

The >= 90% section-resolution gate is UNCHANGED.

## Final gate numbers (real export, real catalog)

```
gate subjects:           required 50    actual 81       PASS
gate meeting-rows:       required 1500  actual 1828     PASS  (revised, signed off)
gate section-resolution: required 0.90  actual 0.99867  PASS  (1499/1501 sections)
published: db/seeds/course_meetings.ndjson 1828 rows
places job: gate failures ()  -> db/seeds/places.ndjson 162 rows
```

Task 6 baseline was 1253/1501 = 83.5%. Embedded (`cab-embedded`, outside the
gate): 97/100. Zero resolution regressions: every string resolved before
Task 6B resolves to the identical place and room after it (verified by
old-vs-new catalog diff over all 1,501 published sections).

Seed validation (independent pass): all 1,828 meeting rows contract-valid
with plausible times, ids unique and sorted; all 162 place rows
contract/slug/coordinate/WKT-valid, names listed in own aliases, ids unique
and sorted; every non-null `place_id` in course_meetings exists in places
(foreign-key clean; 1,647/1,828 rows carry a place).

## Alias-growth inventory (evidence-only)

### Aliases added to existing places (17 aliases, 16 places)

| Alias added | Place | Evidence |
| --- | --- | --- |
| S. Frank Hall for Life Science | Sidney Frank Hall | OSM way/177011609 "Sidney Frank Hall", 185 Meeting St; export "S. Frank Hall for Life Science {218,318,283,MARC}" |
| 155 George Street | Modern Culture and Media | OSM way/177016110 (MCM) is addressed 155 George Street |
| Grant Recital Hall, Grant Recital | Orwig Music Hall | Grant Recital Hall is the recital wing of Orwig (1 Young Orchard Ave, way/177187124); no separate OSM footprint; distinct from Grant-Fulton (105 Benevolent, residence) |
| 111 Thayer St-Watson Institute | Watson Institute for International Studies | OSM way/177075426 addressed 111 Thayer Street |
| 190 Hope Street | German Department | OSM way/340202442 "German Department" addressed 190 Hope Street |
| Geo-Chemistry Building | GeoChem Building | OSM way/845493061 "GeoChem Building", 156 George Street |
| 68 Waterman Mencoff Hall | Mencoff Hall | OSM way/177016143 "Mencoff Hall" addressed 68 Waterman Street |
| 79 Brown St-Peter Green Hse | Peter Green House | OSM way/177016173 "Peter Green House" at 79 Brown Street |
| 84 Prospect St-Rochambeau Hse | Rochambeau House | OSM way/721684020 "Rochambeau House" at 84 Prospect Street |
| 163 George Street | Hirschfeld House | OSM way/495328573 "Hirschfeld House" addressed 163 George Street (was an ambiguous 180/182-George tie) |
| 159 George St-Meiklejohn House | Meiklejohn House | OSM way/495328574 "Meiklejohn House" addressed 159 George Street |
| 50 John Street | Theatre Arts Building | OSM way/1434142068 "Theatre Arts Building" addressed 50 John Street (the footprint the catalog already merges) |
| 1 Euclid Ave, Nelson Ctr Entr | Nelson Center for Entrepreneurship | OSM way/185225893 addressed 1 Euclid Avenue |
| 47 George St-Horace Mann | Horace Mann House | OSM way/177187140 "Horace Mann House" addressed 47-49 George Street |
| 45 Prospect St-CorlissBrackett | Corliss-Brackett House | OSM way/177075324 "Corliss–Brackett House" at 45 Prospect Street |

### New places (14; kind academic unless noted)

| Place (id) | Grounding |
| --- | --- |
| 67 George Street | OSM way/177187123, name "67 George", addr 67 George Street; 18 sections (was the top ambiguous tie) |
| 135 Thayer Street | unnamed OSM way/177016169 via `addr:135 Thayer Street` |
| 2 Stimson Avenue | unnamed OSM way/195508291 (wikidata Q131858673) via `addr:2 Stimson Avenue`; 18 embedded rows |
| 59 Charlesfield Street | unnamed OSM way/177075425 (building=university) via `addr:59 Charlesfield Street` |
| 8 Fones Alley | unnamed OSM way/177075314 via `addr:8 Fones Alley` |
| 271 Thayer Street (kind other) | unnamed retail OSM way/185225906 via `addr:271 Thayer Street`; export uses "2NDFLOOR" rooms |
| Steinert Hall | OSM way/177187119 "Steinert", 148 Power Street |
| Feinstein Building | OSM way/177187110 "Feinstein", 130 Hope Street; export "130 Hope St (Feinstein Bldg.)" |
| Gerard House | OSM way/722023788 "Gerard House", 54 College Street |
| Shirley Miller House | OSM way/177187135 "Shirley Miller House", 59 George Street; export "59 George St- S. Miller House" |
| Walter Hall | OSM way/177016108 "Walter Hall", 80 Waterman Street |
| Nicholson House | OSM way/786446766 "Nicholson House" (footprint, no addr tags) |
| Vartan Gregorian Quad | CURATED coordinates (41.823440, -71.399645) — the midpoint of the Quad A/B fixture centroids. Both constituent footprints share addr 101 Thayer Street and no complex-level element exists; Brown lists the classroom suite as "Vartan Gregorian Quad, 101 Thayer Street" (THA101 116A-E) without an A/B designation, so aliasing to either dorm would be a guess. Export "101 Thayer Street (VGQ 1st fl) 116A/B/C/E" |
| Warren Alpert Medical School | CURATED coordinates (41.818885, -71.408416) = OSM way/141567787 per Nominatim lookup 2026-07-29; 222 Richmond Street is outside the College Hill capture bbox (41.820..41.834, -71.410..-71.393). Export "222 Richmond (Alpert Med) 280/160" |

Curated-coordinate entries carry the catalog's confidence flag
(`source: "curated"`, no polygon/osm_id) in places.ndjson.

### Left unresolved (honest, ungroundable — pinned by tests)

- `SMN121 801` (1 section): opaque code, nothing in the fixture, export, or
  OSM grounds it.
- `Gerard House 101 | Sciences Library 604` (1 section): a two-venue pipe
  row; both venues are catalogued, but the combined string matches neither
  alias set above threshold. The row still publishes with its verbatim
  `location_raw`.
- Embedded only (never in the gate): `300 Richmond Street 298` (no fixture
  footprint, identity unverified — not fabricated), `National Press Building
  DC 975 …` (Washington DC, off-campus by design).

## RED/GREEN evidence

| Step | RED | GREEN |
| --- | --- | --- |
| addr-fallback indexing | `8 failed, 15 passed` (test_overpass: addr keys absent, fixture count) | `23 passed` after `index_buildings` extension |
| alias growth vectors | `32 failed, 60 passed` (test_resolver: all 6B vectors unresolved/mis-roomed pre-growth; ungroundable + Barus guards already green) | `92 passed` after aliases.yaml growth |
| places job seam | collection error (`brownsync_ingest.gazetteer.job` missing) | `9 passed` |
| gate recalibration + real regression | `2 failed, 25 passed` (pinned 2000 constant; real export still publishing None) | `27 passed` |
| full suite | — | `559 passed, 34 skipped in 1.84s` (was 505 + 34) |

Regression guard: old-vs-new resolver diff over every distinct published
location string — 0 previously-resolved strings changed place or room.
Barus Building vs Barus & Holley distinction re-pinned in the 6B vectors.

## ODbL / OSM attribution

Geometry, addresses, and osm ids in `db/seeds/places.ndjson` derive from
OpenStreetMap: "Building footprints and addresses © OpenStreetMap
contributors, licensed under the Open Database License (ODbL) 1.0 —
https://www.openstreetmap.org/copyright" (carried in aliases.yaml, exposed
on the places job result, and required by the loader). The Warren Alpert
curated coordinates are likewise OSM-derived (Nominatim). Attribution
placement in `db/seeds/manifest.json` is Task 9's bundling work.

## Dependency note

`db/seeds/manifest.json` bundling, generation IDs, and manifest-last
publication remain Task 9; this round publishes exactly the two NDJSON files
via the atomic publisher. The dining venue detail pages and clubs sources
(Tasks 7-8) can now link `place_id` against the seeded gazetteer.
