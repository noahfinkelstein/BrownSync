# Task 6B brief: alias growth from unresolved evidence + row-gate recalibration

## Why

Task 6 correctly failed its publication gates fail-closed on the real Fall
2026 export: section resolution 1253/1501 = 83.5% (< 90%) and meeting rows
1,828 (< 2,000). This round closes the resolution gap the plan reserves for
Task 10's "grow aliases only from unresolved evidence" bullet, recalibrates
the meeting-rows completeness gate with a documented sign-off, and publishes
the seeds the app lane is waiting on.

## Scope

1. **Alias growth, evidence-only.** For each of the 57 distinct unresolved
   CAB location strings (248 sections) plus the 12 embedded strings, decide:
   - *alias to an existing place* when the string is a street-address or
     abbreviated form of a catalogued building (e.g. `190 Hope Street` is the
     German Department's recorded OSM address; `S. Frank Hall for Life
     Science` is Sidney Frank Hall);
   - *new place* when the export proves a class venue the catalog lacks and
     the Overpass fixture (or, failing that, OSM-derived curated coordinates)
     grounds it (e.g. `67 George Street`, `2 Stimson Avenue`, `Steinert
     Hall`);
   - *leave unresolved* when no footprint, OSM record, or address grounds the
     string (`SMN121 801`, `National Press Building DC`). Never fabricate.
2. **Address-fallback footprint indexing.** Several proven venues exist in
   the Overpass fixture only as unnamed footprints with `addr:*` tags
   (`2 Stimson Avenue`, `135 Thayer Street`, `59 Charlesfield Street`,
   `8 Fones Alley`, `271 Thayer Street`). Extend `index_buildings` to also
   index unnamed way/relation footprints under `addr:{housenumber} {street}`
   so curated entries can reference them explicitly via `osm:`.
3. **Gate recalibration (meeting rows only).** See below. The >= 90%
   section-resolution gate is UNCHANGED.
4. **Publication.** Re-run the CAB job; on green gates publish
   `db/seeds/course_meetings.ndjson` via the atomic publisher. Add a minimal
   tested places job seam (`gazetteer/job.py`) and publish
   `db/seeds/places.ndjson` from the full catalog (CLI wiring remains
   Task 9). `db/seeds/manifest.json` bundling stays Task 9 — noted as a
   dependency.

## Gate revision (verbatim record)

> Original 2,000-row gate was calibrated for a live CAB scrape whose volume
> includes sections this authoritative user-provided export lists as
> arranged/TBA (3,328 of 5,275 records). Export maximum is 1,828
> physically-scheduled rows. Revised threshold 1,500 approved by the
> orchestrating agent (Claude, owner of both lanes) 2026-07-29 per the plan's
> explicit-revised-threshold mechanism; automatic overrides remain forbidden.

The plan's mechanism (execution plan, Working agreements): "Legitimate source
drift is reported and requires an explicit revised threshold, never an
automatic override."

## Evidence rules

- The Overpass fixture (footprints + `addr:*` tags) is primary evidence; new
  entries prefer matching an OSM footprint by name or address.
- The user-provided CSV proves a string names a real class venue but never
  where it is.
- Curated coordinates are allowed only when no fixture footprint matches
  (Warren Alpert Medical School at 222 Richmond Street, outside the College
  Hill capture bbox; Vartan Gregorian Quad, whose two constituent footprints
  share the address 101 Thayer Street with no complex-level element), carried
  with `source: "curated"` — the catalog's curated-confidence flag.
- Alias normalization uniqueness stays green; Barus Building vs Barus &
  Holley stays distinct; every new place name is itself listed in aliases.

## Acceptance

- `cd ingest && uv run pytest -q` fully green (baseline 505 passed +
  34 skipped, plus new tests; RED first for each new behavior).
- Resolver preview against the real CSV: section-level resolution >= 90% or
  every remaining unresolved string documented as ungroundable.
- CAB job on the real export: all three gates PASS (subjects >= 50, meeting
  rows >= 1,500, section resolution >= 0.90) and
  `db/seeds/course_meetings.ndjson` published atomically.
- `db/seeds/places.ndjson` published from the full catalog (>= 148 rows,
  six dining halls included) with deterministic ordering and ODbL/OSM
  attribution recorded.
- Task-6b report with the full alias-growth inventory (every new alias/place
  and its evidence), final gate numbers, and RED/GREEN evidence; progress.md
  ledger updated; one conventional commit staging explicit paths; no push.
