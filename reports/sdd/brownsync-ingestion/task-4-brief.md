# Task 4: Gazetteer catalog and geometry

## Context

This packet turns the recorded Overpass evidence (Task 3) plus a curated
campus catalog into contract-valid `PlaceRow` output for the gazetteer that
Tasks 5-8 resolve against. It also lands two prerequisites: a pre-fix that
restricts `CachedHttpClient` caching to exactly HTTP 200 (the Task 3 capture
cached AWS WAF 202 challenge bodies as if they were real responses), and the
deterministic slug/collision helpers in `common/identifiers.py` before their
first consumer.

## Binding constraints

- Work only in `/Users/noah_finkelstein/Developer/BrownSync/ingestion-worktree`
  on branch `codex/ingestion`; edit only the files listed below plus the task
  report and ledger lines.
- Run uv with `UV_CACHE_DIR=/private/tmp/brownsync-uv-cache`.
- Tests are offline. The recorded Overpass fixture
  `ingest/fixtures/recorded/overpass/college-hill-buildings.json` is the only
  geometry source; no network access.
- Strict TDD with captured RED/GREEN evidence for every behavior.
- `DATA_CONTRACT.md` v1 wins: `PlaceRow` stays schema-pure; slug shape,
  coordinate bounds, and WKT shape remain ingestion-policy checks.
- WKT is plain `MULTIPOLYGON(...)` with `lng lat` coordinate order and must
  satisfy `policy.validate_multipolygon_wkt`.
- Every place name is also present in `aliases`; normalized alias uniqueness
  is enforced across the whole catalog; Barus Building stays distinct from
  Barus & Holley.
- Canonical dining entries for Ratty, Andrews Commons, V-Dub, Blue Room,
  Ivy Room, and Jo's each carry `kind="dining"`.
- OSM-derived output and README notes carry ODbL/OpenStreetMap attribution
  and provenance.
- Acceptance: at least 120 valid rows from the offline fixture plus the
  curated catalog, with all policy checks green.

## Files

- Modify `ingest/brownsync_ingest/common/http.py` (cache only HTTP 200)
- Modify `ingest/tests/common/test_http.py`
- Create `ingest/brownsync_ingest/common/identifiers.py`
- Create `ingest/tests/common/test_identifiers.py`
- Create `ingest/brownsync_ingest/gazetteer/__init__.py`
- Create `ingest/brownsync_ingest/gazetteer/models.py`
- Create `ingest/brownsync_ingest/gazetteer/geometry.py`
- Create `ingest/brownsync_ingest/gazetteer/overpass.py`
- Create `ingest/brownsync_ingest/gazetteer/aliases.py`
- Create `ingest/brownsync_ingest/gazetteer/aliases.yaml`
- Create `ingest/brownsync_ingest/gazetteer/catalog.py`
- Create `ingest/tests/gazetteer/__init__.py`
- Create `ingest/tests/gazetteer/test_geometry.py`
- Create `ingest/tests/gazetteer/test_overpass.py`
- Create `ingest/tests/gazetteer/test_aliases.py`
- Create `ingest/tests/gazetteer/test_catalog.py`
- Create `ingest/README.md` (attribution note; Task 9 expands it)
- Modify `ingest/pyproject.toml` + `ingest/uv.lock` (add PyYAML, Shapely)
- Modify `ingest/tests/test_fixtures.py` (permit the user-supplied
  `fixtures/user_provided/` directory beside the manifest; see below)

## Pre-existing baseline break: user-supplied fixture directory

The user dropped `ingest/fixtures/user_provided/brown_fall_2026_classes_and_locations.csv`
(untracked, 2026-07-28 22:32 — evidently CAB Fall 2026 data supplied by hand
because cab.brown.edu is WAF-blocked) into the fixtures root after Task 3
landed. The Task 3 integrity gate
(`test_every_stored_fixture_is_manifested`) rejects any entry beside
`manifest.json` and `recorded/`, so the inherited baseline currently fails
1 test. Fix: extend the allowed sibling set with exactly `user_provided`,
documented as user-supplied input data pending manifesting by the task that
consumes it. The `recorded/` tree stays fully gated; the CSV itself is NOT
committed in this task.

## Pre-fix: cache only HTTP 200

`CachedHttpClient` currently caches any 2xx response and replays any cached
2xx. The Task 3 capture run proved this wrong: cab.brown.edu answers 202 AWS
WAF challenges, and those challenge bodies were cached as if they were source
evidence. RED test first: a 202 response is returned to the caller but never
written to the cache, and a second request hits the transport again; a cache
entry whose metadata claims a non-200 status is ignored on load. Then change
`_write_cache`/`_load_cache` gating to `status == 200` exactly and update the
existing 201-caching regression to 200. The behavior change is recorded in
the task report.

## Exact interfaces

```python
# common/identifiers.py
def slugify(text: str) -> str: ...            # deterministic lower-kebab; ValueError if empty result
def unique_slug(base: str, taken: Collection[str]) -> str: ...  # base, base-2, base-3, ...
```

`slugify` case-folds, strips accents to ASCII, drops apostrophes (`Jo's` ->
`jos`), converts every other non-alphanumeric run to a single hyphen, and
trims hyphens (`Barus & Holley` -> `barus-holley`, matching the contract
example). No existing module imports slug helpers yet, so no refactor is
required — this lands before its first consumer (catalog here, clubs in
Task 7).

```python
# gazetteer/geometry.py — coordinates are (lng, lat) tuples, WKT axis order
class GeometryError(ValueError): ...
def close_ring(points: Sequence[Coordinate]) -> list[Coordinate]: ...      # requires already-closed or raises
def stitch_rings(fragments: Sequence[Sequence[Coordinate]]) -> list[list[Coordinate]]: ...
def assemble_multipolygon(outers, inners) -> list[tuple[Ring, list[Ring]]]: ...
def multipolygon_wkt(polygons) -> str: ...
def parse_multipolygon_wkt(wkt: str) -> list[tuple[Ring, list[Ring]]]: ...
def multipolygon_centroid(wkt: str) -> tuple[float, float]: ...            # returns (lat, lng)
```

```python
# gazetteer/overpass.py
@dataclass(frozen=True) class OsmBuilding:  # models.py
    osm_type, osm_id, name, tags, wkt, centroid, fallback_center, address, geometry_error
def load_overpass_elements(path: Path) -> list[dict]: ...
def index_buildings(elements: Iterable[Mapping]) -> dict[str, OsmBuilding]: ...  # exact-name index
```

```python
# gazetteer/aliases.py
def normalize_alias(text: str) -> str: ...
def load_curated_catalog(path: Path = DEFAULT_ALIASES_PATH) -> CuratedCatalog: ...
```

```python
# gazetteer/catalog.py
@dataclass class CatalogBuild:
    rows: list[PlaceRow]; diagnostics: list[PlaceDiagnostic]; attribution: str
def build_catalog(catalog: CuratedCatalog, buildings: Mapping[str, OsmBuilding]) -> CatalogBuild: ...
def build_catalog_from_files(aliases_path: Path | None = None, overpass_path: Path | None = None) -> CatalogBuild: ...
```

## Behavior to prove

### Geometry

- A closed way ring becomes a single-polygon WKT; an open standalone ring is
  a `GeometryError`, never silently closed.
- Relation fragments stitch end-to-end in either orientation into closed
  rings; unstitchable leftovers raise.
- Holes are assigned to their unique containing outer; multiple outers make
  a multi-part MULTIPOLYGON; a hole outside every outer raises.
- Malformed (fewer than 4 points closed, self-intersecting) and zero-area
  (collinear) rings raise.
- WKT emits `lng lat` order, satisfies `policy.validate_multipolygon_wkt`,
  round-trips through `parse_multipolygon_wkt`, and `multipolygon_centroid`
  returns the area-weighted (lat, lng) — holes subtract.

### Overpass adapter

- Ways use their `geometry` arrays; relations stitch `outer`/`inner`
  members; the fixture's Kassar House (two outers) and Barbour Hall /
  Verney-Woolley Hall (holes) parse into valid multi-part WKT.
- Unnamed elements are skipped; a broken geometry yields
  `wkt=None` + `geometry_error` + `fallback_center` from `bounds`, never a
  crash.
- `osm_id` is `way/<id>` or `relation/<id>`; address composes
  `addr:housenumber addr:street, addr:city, addr:state addr:postcode` parts
  when present.

### Aliases and catalog

- `aliases.yaml` schema v1: unique ids (explicit or `slugify(name)`), valid
  kinds, every name present in aliases, normalized alias uniqueness across
  places (collision -> load error), `Barus Building` and `Barus & Holley`
  distinct entries with distinct normalized keys.
- The six canonical dining entries exist with `kind="dining"` and mandated
  aliases (Ratty, V-Dub, Jo's, ...); athletics aliases cover Brown Stadium,
  Meehan Auditorium, Pizzitola, OMAC, Stevenson-Pincince.
- Merge: curated identity/kind + OSM geometry/centroid/address/osm_id with
  `source="osm"`; invalid OSM geometry -> `polygon=None` + diagnostic +
  bounds-center (or curated) coordinates; curated-only entries carry their
  own coordinates with `source="curated"`; entries with no usable
  coordinates are dropped with a diagnostic.
- Every emitted row passes `validate_slug`, `validate_coordinates`, and
  `validate_multipolygon_wkt`; rows also re-validate as `PlaceRow`.
- Acceptance test on the real fixture + real `aliases.yaml`: at least 120
  valid rows, all six dining places, attribution string present in the
  build output and README.

## Required test cycle

1. `cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest tests/common/test_http.py -q` — RED (new 202 tests) then GREEN.
2. Same pattern for `tests/common/test_identifiers.py`, then each
   `tests/gazetteer/test_{geometry,overpass,aliases,catalog}.py` in order.
3. `cd ingest && env UV_CACHE_DIR=/private/tmp/brownsync-uv-cache uv run pytest -q` — full suite green (baseline 162 passed + 7 postgres-skipped, plus the new tests).

## Report

Write `reports/sdd/brownsync-ingestion/task-4-report.md` with changed files,
RED/GREEN evidence, the HTTP cache behavior change, row/diagnostic counts,
dining verification, self-review, and concerns. Append ledger lines to
`progress.md`. One conventional commit staging explicit paths; do not push.
