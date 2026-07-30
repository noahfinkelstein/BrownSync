# Task 4 Report: Gazetteer catalog and geometry

Date: 2026-07-28

## Status

Complete. The gazetteer now turns the recorded Overpass fixture plus a
curated 148-place catalog into 148 contract-valid `PlaceRow`s (136 with
real OSM MultiPolygon footprints), with the six canonical dining places,
all mandated athletics aliases, globally unique normalized aliases, and
ODbL/OpenStreetMap attribution in both the build output and the README.
Two prerequisites landed first: `CachedHttpClient` now caches HTTP 200
exactly, and deterministic slug helpers live in `common/identifiers.py`
ahead of their first consumer.

## Changed files

- `ingest/brownsync_ingest/common/http.py` (cache-gate fix)
- `ingest/tests/common/test_http.py`
- `ingest/brownsync_ingest/common/identifiers.py` (new)
- `ingest/tests/common/test_identifiers.py` (new)
- `ingest/brownsync_ingest/gazetteer/{__init__,models,geometry,overpass,aliases,catalog}.py` (new)
- `ingest/brownsync_ingest/gazetteer/aliases.yaml` (new, curated catalog)
- `ingest/tests/gazetteer/{__init__,test_geometry,test_overpass,test_aliases,test_catalog}.py` (new)
- `ingest/tests/test_fixtures.py` (permit `fixtures/user_provided/`)
- `ingest/README.md` (new, ODbL attribution; Task 9 expands)
- `ingest/pyproject.toml` + `ingest/uv.lock` (add `pyyaml>=6,<7`, `shapely>=2.0,<3`; lock also picks up numpy as shapely's dependency)
- `reports/sdd/brownsync-ingestion/task-4-brief.md`, this report, `progress.md`

## Behavior change: CachedHttpClient caches HTTP 200 only

Previously any 2xx response was written to cache and any cached 2xx was
replayed. The Task 3 capture run proved this wrong: cab.brown.edu answers
202 AWS WAF challenge bodies, which were cached as if they were source
evidence. Now `_write_cache` runs only for `status == 200` and
`_load_cache` ignores any entry whose metadata claims a non-200 status
(defence against previously poisoned caches). Non-200 2xx responses are
still returned to the caller so capture code can inspect them; they are
simply never persisted or replayed. The existing 201-caching regression
test was updated to 200 per the brief.

```text
RED  $ uv run pytest tests/common/test_http.py -q
FAILED ...test_non_200_success_is_returned_to_the_caller_but_never_cached[201]
FAILED ...[202] / [203] / [204] / [226]
FAILED ...test_cache_entry_claiming_a_non_200_status_is_ignored_on_load
6 failed, 30 passed in 0.16s

GREEN $ uv run pytest tests/common/test_http.py -q
36 passed in 0.15s
```

## Pre-existing baseline break (user-supplied fixture directory)

The inherited tree failed 1 test before this task started:
`test_every_stored_fixture_is_manifested` rejects the untracked
`ingest/fixtures/user_provided/brown_fall_2026_classes_and_locations.csv`
the user dropped in after Task 3 (hand-supplied Fall 2026 CAB data — CAB
is WAF-blocked per the Task 3 gaps). Verified baseline was therefore
`168 passed, 8 skipped, 1 failed`. Fix: the stray-file check now permits
exactly the `user_provided` directory name beside `manifest.json` and
`recorded/`; the `recorded/` tree remains fully hash-gated. The CSV
itself is intentionally NOT committed here — the task that consumes it
must manifest it.

## TDD evidence (RED then GREEN per module)

Each new test module was run before its implementation existed
(collection-error RED), then after:

```text
tests/common/test_identifiers.py  RED: ModuleNotFoundError (collection error)
  intermediate: 1 failed ("Corliss–Brackett House": en dash was dropped by
  the ASCII strip instead of hyphenating; fixed by classifying characters
  before ASCII reduction)                     GREEN: 25 passed

tests/gazetteer/test_geometry.py  RED: ModuleNotFoundError
  intermediate: 2 failed — shapely reports both bowtie and collinear rings
  as "Self-intersection" with area 0, so zero-area is now detected via
  convex-hull area before validity; and the hole-centroid test itself was
  OGC-invalid (hole sharing an edge with the shell) and was rewritten with
  a properly interior hole                    GREEN: 34 passed

tests/gazetteer/test_overpass.py  RED: ModuleNotFoundError
                                             GREEN: 15 passed

tests/gazetteer/test_aliases.py   RED: ModuleNotFoundError
                                             GREEN: 32 passed

tests/gazetteer/test_catalog.py   RED: ModuleNotFoundError
  intermediate: 1 failed (test expected one diagnostic where designed
  behavior emits two: invalid-geometry plus dropped-row; test updated to
  assert both)                                GREEN: 17 passed
```

## What the gazetteer proves

- **Geometry** (`gazetteer/geometry.py`): closed ways become
  single-polygon WKT; open standalone rings raise and are never silently
  closed; relation fragments stitch end-to-end in either orientation;
  unstitchable leftovers, holes outside every outer, ambiguous hole
  containment, self-intersecting rings, and zero-area collinear rings all
  raise `GeometryError`. Emitted WKT is plain `MULTIPOLYGON(...)` in
  `lng lat` order, passes `policy.validate_multipolygon_wkt`, round-trips
  through `parse_multipolygon_wkt` with float precision preserved, and
  `multipolygon_centroid` returns the area-weighted `(lat, lng)` with
  holes subtracting.
- **Overpass adapter** (`gazetteer/overpass.py`): indexes the 329 named
  elements of the 2,155-element recorded fixture with zero geometry
  errors. Kassar House (`relation/14295043`) parses into a two-outer
  MULTIPOLYGON; Barbour Hall (`relation/2723887`) and Verney-Woolley Hall
  (`relation/14553488`) each parse with their hole, including the
  inner-listed-first member order. Unnamed elements are skipped, broken
  geometry yields `wkt=None` + `geometry_error` + bounds fallback-center
  (never a crash), `osm_id` is `way/<id>`/`relation/<id>`, and addresses
  compose available `addr:*` parts ("81 Waterman Street, 02912" for
  Sayles Hall).
- **Aliases** (`aliases.yaml` + `aliases.py`): schema v1 with fail-closed
  loading — unknown keys, bad kinds, non-slug ids, duplicate ids, missing
  name-in-aliases, lat-without-lng, wrong schema_version, uncredited
  attribution, and any normalized-alias collision are load errors. The
  real file carries 148 places; Barus Building and Barus & Holley are
  distinct entries with distinct normalized names; athletics aliases cover
  Brown Stadium, Meehan Auditorium, Pizzitola, OMAC, and
  Stevenson-Pincince Field.
- **Catalog merge** (`gazetteer/catalog.py`): curated identity/kind +
  OSM geometry/centroid/address/`osm_id` with `source="osm"`; invalid OSM
  geometry produces `polygon=None` plus a diagnostic and bounds-center
  (or curated) coordinates; curated-only entries carry their own
  coordinates with `source="curated"`; entries with no usable coordinates
  are dropped with a diagnostic. Rows sort by id and every row passes
  `PlaceRow` revalidation, `validate_slug`, `validate_coordinates`, and
  `validate_multipolygon_wkt`.

## Acceptance numbers (offline fixture + curated catalog)

- **148 valid rows** (>= 120 required): 136 `source="osm"` (all with
  MultiPolygon footprints and OSM-centroid coordinates, 134 with
  addresses), 12 `source="curated"`.
- Kinds: 58 academic, 48 residence, 9 admin, 9 other, 8 athletic,
  6 dining, 5 library, 5 outdoor.
- All six canonical dining places emitted with `kind="dining"`:
  `sharpe-refectory` (Ratty), `andrews-commons`,
  `verney-woolley-dining-hall` (V-Dub), `blue-room`, `ivy-room`,
  `josiahs` (Jo's).
- 0 diagnostics on the real data (no invalid geometry, no drops).
- Every row's coordinates fall inside the College Hill sanity bbox.
- Attribution string (OpenStreetMap contributors / ODbL 1.0) is asserted
  in `CatalogBuild.attribution` and recorded in `ingest/README.md`.

## Final regression

```text
$ cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest -q
298 passed, 8 skipped in 0.68s
```

129 new tests (6 http + 25 identifiers + 34 geometry + 15 overpass +
32 aliases + 17 catalog) on top of the inherited 169 passing; the 8 skips
are the 7 postgres-marked integration tests (no `TEST_DATABASE_URL`) plus
the declared `cab_details` fixture gap.

## Self-review

- The acceptance suite runs against the real recorded fixture and real
  `aliases.yaml` — no synthetic stand-ins — and revalidates every emitted
  row through both the contract model and every policy check.
- Alias hygiene traps were checked explicitly: "Smith-Buonanno Hall" vs
  "Smith Buonanno Hall" normalize identically (only one listed), bare
  ambiguous aliases ("Andrews", "Watson", "Metcalf", "Sharpe") were
  deliberately not assigned to any single place, and the loader would
  fail closed on any future collision.
- OSM names that differ from Brown's canonical names are bridged with the
  explicit `osm:` key (V-Dub -> "Verney-Woolley Hall", Pizzitola ->
  "Pizzitola Gymnasium", Sternlicht Commons -> "Wellness Center &
  Residence Hall", en-dash names for Corliss–Brackett and
  Nightingale–Brown).
- The Wheeler School, RISD, and commercial buildings present in the bbox
  fixture were excluded from the curated catalog on purpose.

## Concerns

- The 12 curated-only coordinate pairs (Blue Room, Ivy Room, Jo's, Brown
  Stadium, Stevenson-Pincince Field, Wilson Hall, 85 Waterman, and the
  five outdoor spaces) are hand-estimated; the three in-building dining
  venues reuse their host building's OSM centroid. Task 10's live pass
  should spot-check them.
- Curated affiliation/kind labels are best-effort judgment for a handful
  of edge buildings (e.g. North House, Penner Field House, Theatre Arts
  Building); mislabels are data edits in `aliases.yaml`, not code changes.
- `index_buildings` keeps the first element on duplicate OSM names
  (deterministic, tested); the recorded fixture has zero duplicate names,
  so this path is currently synthetic-only.
- The controller's stated baseline ("169: 162 pass + 7 postgres-skip")
  described Task 2B; the actual inherited tree was 169 passed + 8 skipped
  (Task 3 added tests and one skip), and it failed 1 test because of the
  user-dropped `fixtures/user_provided/` CSV, handled as described above.
