# Enrichment round — Codex data drop (2026-07-29)

Concurrent with the orgs round (Task 7). This round owned: LiveWhale
event-location alias growth, the Brown-owned buildings sidecar, and the
Overpass snapshot cross-validation. Paths were kept disjoint from the orgs
agent; see "Concurrency notes" for the two deliberate exceptions.

## 0. Fixture registration (landed via the orgs round)

The brief assigned this round the registration of the 12 non-CAB CSVs in
`ingest/fixtures/manifest.json`. On starting that step, the concurrent orgs
agent had already completed it in the shared worktree — all 12 CSVs
hash-pinned as `kind: user_provided` with per-entry `codex_provenance`
mirrors of `brown_data_sources.csv`, "collected by Codex via browser …
2026-07-29" provenance notes, a `published_contact_data` declaration policy
for the three email-bearing CSVs, and `fills_gaps` for the student-groups
CSV; the integrity gate stays strict for `recorded/` fixtures
(`test_no_personal_email_addresses_survive_in_recorded_fixtures` is
unchanged in substance). I verified their state green (`tests/test_fixtures.py`:
12 passed + 1 skipped, every sha256 matching disk) and did NOT touch
`ingest/fixtures/manifest.json` or `ingest/tests/test_fixtures.py`, to keep
the two commits in disjoint files. `brown_fall_2026_classes_and_locations.csv`
was confirmed byte-identical to the Task 6 registration (sha `50a20adb…`)
and was not re-registered.

## 1. Alias growth from `brown_event_locations.csv`

Input: 153 distinct LiveWhale location strings, 772 event instances, with
coordinates and per-string event counts. Every string was resolved through
the Task 5 resolver; unresolved strings were grounded with point-in-polygon
(and nearest-footprint distance) of the LiveWhale coordinates against the
recorded Overpass fixture, plus OSM `name`/`addr:*`/`operator` tags and the
existing catalog. Evidence-only throughout — nothing guessed.

**Event-count-weighted resolution: 457/772 (59.20%) -> 594/772 (76.94%).**
Unweighted strings: 52/153 (33.99%) -> 83/153 (54.25%). Tests:
`ingest/tests/gazetteer/test_event_locations.py` (73 tests) pin the floor
(>=75% weighted), 33 grounded strings, 13 stay-unresolved strings, and 15
regression sentinels. RED run recorded (44 failed pre-implementation),
GREEN after.

Changes: 37 aliases added to 16 existing places; 8 new places (15 alias
strings including names). Catalog: 166 -> 174 rows
(`test_curation_growth_keeps_the_catalog_at_174_places`), 0 diagnostics,
gates green.

New places, each with its evidence:

| place | grounding |
|---|---|
| `chace-center` | coords inside OSM way/1032446275 "Chace Center" (RISD) |
| `wexford-innovation-complex` | coords inside way/710679438, addr 225 Dyer Street |
| `51-prospect-street` | coords inside unnamed way/771420949 via `addr:` fallback |
| `international-house-of-rhode-island` | coords inside unnamed way/195508296, addr 8 Stimson Avenue |
| `south-street-landing` | no fixture footprint (outside bbox); curated on the LiveWhale coords, 7 HR events |
| `70-ship-street` | outside bbox; curated on the LiveWhale coords, BioMed organizers |
| `van-wickle-gates` | gates are not a building way; curated on the LiveWhale coords |
| `stonewall-house` | coords inside way/177187131 (no full addr tags, not indexable); curated on the LiveWhale coords |

**Three wrong-building traps repaired** (previously "resolved", counted in
the before-rate, so the true attribution gain exceeds the rate delta):

- `94 George Street` (116 events, John Carter Brown Library — way/166668948
  carries addr 94 George Street + operator=Brown University) had
  trigram-bound to `67-george-street`;
- `111 Thayer Street` (31 events, Watson Institute — way/177075426 addr)
  had bound to `135-thayer-street`;
- `450 Brook Street` (1 event, Sternlicht Commons — way/923913054 addr)
  had bound to `stephen-robert-hall` via its "280 Brook Street" alias.

In total 148 events were re-attributed to the right building and 137
formerly-unresolved event instances gained pins.

**Trap deliberately avoided:** a bare `172 Meeting Street` alias for
Pembroke Hall was rejected after measurement showed it trigram-captured the
street-only string `Meeting street`; only the full LiveWhale string is
aliased and `Meeting street` is pinned unresolved-by-design.

`85-waterman-street` was upgraded from curated coordinates to the named
OSM footprint (way/176918226 "BERT", addr 85 Waterman Street), proven by
the drop's "Building for Environmental Research and Teaching (BERT)" string
geocoding inside it.

Remaining unresolved weight (178/772) is dominated by virtual/placeholder
strings (Zoom/Virtual/TBA/TBD/"Dining Halls"/dorm-room strings: ~60),
athletics away venues that must never pin to campus (~60), and off-campus
one-offs (URI, Tufts, ferry, parks). `Brown Bookstore` (2 events) stays
unresolved on conflicting evidence: it geocodes inside the 164-176 Angell
footprint while the store itself is at 244 Thayer, which the fixture does
not cover. CAB cross-check: all 259 distinct CAB location values resolve
identically before/after this alias growth (zero regressions; the CAB gates
and pins are untouched).

`db/seeds/places.ndjson` republished atomically via `run_places_job`:
174 rows, gates green (see follow-ups for bundle-manifest coherence).

## 2. Brown-owned buildings sidecar

`db/seeds/brown_owned_buildings.json` (schema v1) closes the deferred
map-tint item — Claude handoff section 5, "Brown-owned buildings slightly
lighter". Producer: `ingest/brownsync_ingest/brown_owned_buildings.py`;
tests: `ingest/tests/test_brown_owned_buildings.py` (35 tests, RED then
GREEN; 92.86% branch coverage, above the 80% per-parser gate).

Classification is evidence-tiered, from
`brown_college_hill_buildings.csv` (2,150 OSM ways):

- **tier 1 — direct** (8 ways): `operator`/`owner` contains "Brown
  University" (case-insensitive). Includes Penner Field House, John Carter
  Brown Library, Soldiers Memorial Gate, Power Street Parking Structure.
- **tier 2 — catalog** (138 ways): the way appears in the export and backs
  a curated gazetteer place of institutional kind (academic, residence,
  dining, athletic, library, admin) — places themselves grounded in
  Brown-only evidence across Tasks 4/6B/8/10 and this round.

**Published: 140 way ids (union), 142 place ids** (139 way-matched places
incl. `soldiers-memorial-gate` via its operator tag, plus the 3
relation-backed institutional places Kassar House, Barbour Hall,
Verney-Woolley, which `osm_way_ids` cannot express). The document also
carries the plan-mandated ODbL `attribution` key.

`brown_relevant_hint` corroborates but never classifies — the drop itself
proves the hint name-matches RISD buildings. **The ambiguous middle is
reported, not guessed in:**

- 17 hint-only ways with no ownership evidence: mostly RISD (Chace Center,
  Metcalf Building, Memorial Hall, Bank Building, Cheapside, Hope Block,
  Carr House, North Hall) plus unnamed `building=university` ways and
  "BioMed Center ACF";
- 13 catalog kind=`other` places excluded pending ownership evidence:
  `271-thayer-street`, `51-prospect-street`, `alumnae-hall`,
  `brown-center-for-students-of-color`, `brown-risd-hillel`,
  `carrie-tower`, `chace-center`, `faculty-club`,
  `international-house-of-rhode-island`,
  `sarah-doyle-center-for-women-and-gender`,
  `stephen-robert-62-campus-center`, `swearer-center-for-public-service`,
  `wexford-innovation-complex`. Several are certainly Brown in reality
  (campus center, Alumnae Hall, Carrie Tower) but carry no in-corpus
  ownership evidence; the Brown campus-map ArcGIS source Codex catalogued
  (`brown_data_sources.csv` row 14) is the natural future evidence source.

Known semantic caveats, documented rather than hidden: tier 2 asserts
"Brown-operated campus function", not fee-simple ownership — commercial
buildings Brown occupies for academic/admin functions (Hemisphere Building,
121 South Main, 135 Thayer, The Packet Building, 70 Brown Street) are
included, matching what the map tint communicates. Fail-closed gates:
operator conflict on a curated way, curated ways missing from the export,
thin export (<2,000 rows), empty classification, dropped catalog entries.

## 3. Overpass snapshot cross-validation (informational)

`brown_college_hill_buildings.csv` (snapshot 2026-07-29T13:33Z) vs the
recorded fixture `overpass/college-hill-buildings.json` (2026-07-28T21:50Z),
same source/bbox: **zero drift** — identical 2,150 way-id sets in both
directions, and every catalog-backed way present in both
(`TestSnapshotDrift`, kept as a permanent two-snapshot integrity test).

## Verification

- Full offline suite green: **939 passed, 34 skipped** (skips: Postgres
  suites pending credentials, unchanged). The count includes the orgs
  agent's in-flight clubs/mappings tests present in the shared worktree at
  the time of the run.
- New-module branch coverage 92.86% (>=80% per-parser gate).
- `db/seeds/brown_owned_buildings.json` matches a from-scratch rebuild
  modulo `generated_at`; every sidecar place id exists in the republished
  `db/seeds/places.ndjson` (tested).

## Concurrency notes and follow-ups

1. **Fixtures manifest**: registered by the orgs agent (see section 0);
   this round's commit excludes `ingest/fixtures/manifest.json` and
   `ingest/tests/test_fixtures.py`.
2. **`reports/app_side_dependencies.md` is shared by design** (the plan's
   single register): the orgs agent updated sections 2-3 concurrently; this
   round appended section 5. Whichever commit lands second will show no
   delta for the other's hunks.
3. **Bundle manifest is deliberately NOT regenerated here** (owned by the
   orgs round / CLI). Two explicit follow-ups, also recorded in the
   register: (a) `brown_owned_buildings.json` needs a `db/seeds/manifest.json`
   entry and a CLI job registration in a later round; (b) the orgs-round
   `run all` of 14:28Z staged `places.ndjson` from a pre-enrichment
   aliases.yaml snapshot (166 rows), so this round republished
   `db/seeds/places.ndjson` (174 rows) afterwards — the bundle manifest's
   `places.ndjson` hash is stale until the next `run all`; mixed-generation
   detection protects loaders meanwhile.
4. `progress.md` intentionally untouched (owned by the orchestrator/orgs
   lane this round).
