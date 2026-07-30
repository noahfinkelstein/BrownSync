# Codex handoff — Lane A: Map + UI

**Branch:** `lane/a-map` · **Worktree:** isolated · **Migrations:** none (deliberate)
**Depends on:** nothing. Can start immediately.
**Blocks:** Lane C presence (needs `campus_buildings.geojson` from step 1).

---

## ⚠️ STATUS: steps 0–4 are already implemented on `main` (2026-07-29)

Do **not** rebuild them. What exists:

| Step | State | Files |
|---|---|---|
| 0 — deck.gl gate | **Skipped, not needed.** Everything below is MapLibre-native; `interleaved: false` untouched. Still run the smoke test before any 3D-model work. | — |
| 1 — ingest job | **Done.** `ingest run campus` publishes `db/seeds/campus_buildings.geojson` (262 features, 319 kB raw / 58 kB gz). Registered in `default_registry()` after `buildings`, `postgres_target=False`. Fixture hash-pinned in `ingest/fixtures/manifest.json` as `arcgis_buildings`. | `ingest/brownsync_ingest/campus/{arcgis,aliases_parse,height,conflate,job}.py` |
| 2 — render | **Done.** Flat ≤z14 + extrusion ≥z14 + outline ≥z15, age colour ramp, measured heights, context buildings pushed to `#141821` @ 0.9. | `apps/web/src/map/campusBuildings.ts`, `CampusBuildingLayers.tsx` |
| 3 — labels | **Done.** One symbol layer, 4 tiers via `labelMinZoom`, `symbol-sort-key`. `label-pois-civic` retired; `style.test.ts` updated 4→3 symbols and the POI assertion **inverted to `toHaveLength(0)`**. | `map/style.json`, `apps/web/test/style.test.ts` |
| 4 — feature-state | **Done.** `ClassActivityLayer.tsx` **deleted** (152 lines). Tint now one `setFeatureState` call. | `CampusBuildingLayers.tsx` |
| 6 — daylight | **Done.** `daylight.ts` (NOAA solar position, written not imported) + `DaylightLayer.tsx`. Scrubbing the cursor repaints campus for the real sun position at Providence. | `apps/web/src/map/daylight.ts`, `DaylightLayer.tsx`, `test/daylight.test.ts` (17) |
| 5 — landmarks | **Done.** 552 greens/fields published to `campus_landmarks.geojson` (454 kB raw / 74 kB gz). **Five of the six polygon-less `outdoor` places now have geometry AND a label**; `van-wickle-gates` correctly stays unbound. `label-places-neighbourhood` maxzoom pulled 16→15 to keep the union at ≤3 tiers. | `ingest/.../campus/landmarks.py`, `apps/web/src/map/campusLandmarks.ts`, `CampusLandmarkLayers.tsx` |
| 7 — type scale | **Done.** Scale is now **6 tiers `[12, 14, 16, 19, 24, 30]`, body 14 px** (was 5 tiers / body 13). `tokens.type` gained `body` and `lineHeights`. **`apps/web/test/type-scale.test.ts` landed GREEN against the old scale first**, then the change turned 40 off-scale usages red across 21 files and the sweep was mechanical. | `packages/contract/src/tokens.ts`, `packages/ui/src/styles.css`, `apps/web/test/type-scale.test.ts` |
| 8 — header + dock | **Done.** `TimeMachineBar` **deleted**; the scrubber is now a full-width bottom dock in the app shell (`TimeMachineDock`). The freed header slot is `NowBar` — live/soon/in-class counts + the next event, off the same query cache and `?cats=` filter as the map. | `apps/web/src/time/TimeMachineDock.tsx`, `panels/NowBar.tsx`, `panels/nowSummary.ts`, `panels/Header.tsx`, `App.tsx` |
| 9 — layer panel | **Done.** `LayerRail` **deleted**. Grouped, collapsible `LayerPanel` over a data registry, URL-synced via `?layers=` as a **diff against defaults** so a shared link cannot freeze the catalogue. 16 layers across 4 groups. | `apps/web/src/map/layerRegistry.ts`, `useLayerState.ts`, `panels/LayerPanel.tsx` |
| 10 — amenities | **Done.** New `ingest run amenities` job publishes `campus_amenities.geojson` — **823 points across 11 kinds** from 5 ArcGIS layers (blue-light 158, AED 64, Narcan 43, restrooms 147 + 78 all-gender, hydration 45, bike 225, menstrual 31, lactation 12, printers 9, dining 11). | `ingest/.../campus/amenities.py`, `apps/web/src/map/campusAmenities.ts`, `CampusAmenityLayers.tsx` |

**Adversarially reviewed** 2026-07-29 (84 agents, 39 findings raised, 22 survived
two independent refutation attempts). All P0 and P1 findings fixed; see
`ingest/tests/campus/test_review_regressions.py`.

| 11 — dining | **Done.** The recorded block was scoped too widely — the 403 was `dining.brown.edu` (the CMS), not the data. Brown OIT's ESB answers the menus at 200 unauthenticated. `ingest run dining` publishes **7 halls / 1,143 items**; `DiningPanel` reads the same time cursor as the map. | `ingest/.../dining/menus.py`, `apps/web/src/dining/**` |
| 12 — publications | **Done.** BDH + Brown Political Review RSS → `publications.json` (**45 articles, HEADLINE-ONLY**, allowlist + byte-level leak test). Indy and post- recorded as explicit gaps with verbatim reasons. | `ingest/.../publications/feeds.py` |
| 13 — libraries | **Done.** LibCal widget grid → `library_hours.json` (**12 libraries, 548 day rows**). An *undefined* day and a *closed* day deliberately do not collapse. | `ingest/.../libraries/hours.py` |
| 14 — unified feed | **Done.** `buildFeed` merges events + articles + dining into one ranked list with inspectable score components and diversity rules (≤30% per source, never 3 in a row). **It is the default right-pane tab** — the all-in-one list is what the site is for. | `apps/web/src/feed/**` |

**Tests:** ingest **1,304 passed** / 98 skipped; web **479 passed**; 14/14 turbo tasks;
e2e **12/12**; `pnpm lint` clean; `pnpm db:seed-check` **PASS, 0 warnings, 13 artifacts**.
Bundle **252.52 kB gz** of 450.

**Findings that corrected this document's original assumptions** — trust these over
anything above that contradicts them:

- `Year_of_Construction` is 263/263 non-null but **38 rows are `0`**, the source's
  unknown sentinel. Treated as null; `coalesce(…, 1930)` lands them mid-ramp.
- The `Aliases` vocabulary has **8 keys, not 4**: `DISPNAME` 216, `LEGACY` 98,
  `ALTADDRS` 67, `NICKNAME` 45, `OCCUPANT` 35, `FORMER` 32, `ADDITION` 1, and a
  space-variant `DISPLAY NAME` 1 (folded into `DISPNAME`), plus 2 untagged.
- **A bare `\s\d+$` address regex over-matches.** The token before a trailing
  number is `St` 74, `Ave` 5, but also `No.` 4 ("New Pembroke No. 3"), `Dugout` 4,
  `Unit` 2 — so `STREET_TYPES` is the discriminator, not the digit.
- `Ownership_Status` includes a **misspelled `'Affilliated'`** (7 rows) and 19 nulls.
- **One building routinely hosts several places** — Andrews Commons inside Andrews
  Hall, the Blue Room inside the Campus Center, the Ivy Room inside Sharpe
  Refectory. The original "two places in one footprint = ambiguity, drop both"
  rule was wrong; the model is many-to-one, with a primary chosen by **name
  similarity to the building's own label** (kind order alone picks the Ivy Room
  over the Ratty). 159/174 places matched, 0 ambiguities.
- **Outdoor places must be excluded from nearest-match** — without it the Ruth J.
  Simmons Quadrangle bound to "Saint Stephen's Church" 20 m away.
- `LABEL_OVERRIDES` entries carry the `Property_Name` they expect, because the
  first draft guessed a Property_Code and silently relabelled a different
  building. A mismatch now refuses the override and logs it.
- **`_ring_centroid` needs BOTH a local-origin translation and magnitude
  weighting.** A real athletic field is a 4-point sliver at (-71.394, 41.830)
  with signed area 2.3e-12 — the same magnitude as the shoelace's rounding
  error at coordinate magnitude 71. Its centroid computed to 42.58 N, -72.68 E,
  ~80 km off campus. Do not "simplify" that function; two regression tests pin it.
- **Landmark name matching must NOT drop "green"/"field"/"quad" as noise.** With
  them dropped, "Pembroke Field" and "Pembroke Green" share only "pembroke" and
  an athletic field bound to a green. Threshold is Jaccard ≥ 0.5 without
  containment evidence.
- **Bind by iterating PLACES, not landmarks.** Iterating landmarks binds
  whichever polygon comes first in file order — the Ruth J. Simmons Quadrangle
  claimed an unnamed lawn patch before reaching the polygon literally named
  "Simmons Quadrangle (Lower Green)".
- **`["zoom"]` inside a FILTER is evaluated at the INTEGER tile zoom**, not the
  fractional map zoom. Thresholds of 14.5/15.5/16.5 silently rounded up to
  15/16/17 — rank 1 was hidden until z16 and rank 2 until z17, leaving 94
  buildings labelled only between 17.0 and `MAX_ZOOM` 17.5. Tiers are now
  integers; rank 0 uses 0 and defers to the layer's own (fractional-aware)
  `minzoom`. Layer `minzoom` and paint expressions ARE fractional; filters are not.
- **The aspect clamp is load-bearing.** A floor count alone made an 11 m² waste
  shed 32.7 m tall — the joint second-tallest structure on campus, a 3.3 m
  column beside the SciLi — and 19 sub-80 m² structures into 11.7 m pillars. A
  footprint's side length bounds its plausible floor count.
- **Jaccard cannot separate "Simmons Quadrangle" from "Pembroke Field".** Both
  pairs score 0.33 with opposite correct answers. The discriminator is the TYPE
  word: Quadrangle matches Quadrangle, Field contradicts Green (`names_agree`).
- **Stage-2 conflation must be globally distance-ordered, not first-come.**
  First-come let an umbrella place take a footprint at 20.7 m while the place
  1.0 m away shipped unmatched and absent from every `placeIds` array.
- **A runner must return `JobOutcome(gate_failures=...)`.** Returning a bare
  empty outcome made `_run_job` print "ok", exit 0, and let `run all` advance
  the manifest past a drop that failed every gate.
- `Campus_Walkways_view` evaluated and **rejected**: 151 unnamed polygons,
  31,638 vertices, 73 kB gz for pure decoration Protomaps partly covers.
- **`NEAREST_TOLERANCE_M` must stay at 25 m.** Raised to 200 m it bound
  International House to the "OMAC Shed" 138 m away, RISD's Chace Center to
  Macfarlane House at 127 m, and the Soldiers Memorial Gate to Saint Stephen's
  Church at 99 m. Unmatched is the correct outcome for a place with no
  building. `tests/campus/test_conflate.py` now pins both the constant and the
  invariant that no emitted match exceeds it.
- **Daylight cannot brighten buildings.** Measured, `#252D3A` already sits at
  **4.53:1** against `--text-secondary` — 1.9% of luminance headroom. The day
  endpoint IS the existing palette; only dark surfaces lift, and
  `MAX_SURFACE_LUMINANCE` + a per-step contrast assertion pin it.
- **Never gate map work on `map.isStyleLoaded()`.** It stays false while glyphs
  and sources are pending, and `styledata` fires only during that window — so
  `styledata` + `isStyleLoaded()` never lands an apply. Use `idle`, with an
  applied-signature guard to stop idle→paint→idle looping.
- **`querySourceFeatures` is viewport-dependent and returns duplicates.** It
  gave 1 of 262 buildings on first paint and 502 after panning. Build indexes by
  fetching the artifact, not by querying the map.

Read `BROWNSYNC_V2_PLAN.md` first. Read `ARCHITECTURE.md` §2 (lane law) and
`DATA_CONTRACT.md` §6 before touching `ingest/` or `db/seeds/`.

---

## Verified facts you must build on

All confirmed by live request or by `pmtiles show --metadata` on the committed extract. Do not
re-derive; do not assume anything beyond this list.

### The ArcGIS service

```
https://services1.arcgis.com/HMLBxPKXzqtpFXfq/arcgis/rest/services/Active_Buildings_2_view/FeatureServer/0
```

- 263 features **in one page** (`exceededTransferLimit: null` at default page size) — no
  pagination loop needed. `capabilities: "Query"`, read-only, no token, CORS `*`.
  *(Re-verified 2026-07-29: `returnCountOnly` → 263; a bare `where=1=1` returns all 263 with
  `exceededTransferLimit: null`.)*
- Native SR is **wkid 102730 (RI State Plane feet)**. You **must** pass `outSR=4326` or
  `f=geojson`, else you get state-plane coordinates. *(Verified: `outSR=4326` returns
  `spatialReference: {wkid: 4326}`.)*
- **`Property_Code` (a.k.a. `Building`, e.g. `100326`) is the stable join key.** This is the
  `promoteId`. **Verified 2026-07-29: 263/263 unique, zero null or empty — so gate #2 below
  passes against today's data.** Keep the gate anyway; it is guarding against future drift, and
  `promoteId` failure is silent.
- Verified sample showing the hard case the label resolver exists for:
  `Property_Name: "Hope St 170"` (address-shaped), `Official_Name: null`,
  `Aliases: "DISPNAME: 170 Hope; NICKNAME: Applied Math Building"`, `Property_Code: "100326"`,
  `Year_of_Construction: 2015`.
- Field coverage measured: `Property_Name` 263/263 · `Aliases` 218/263 ·
  **`Official_Name` 22/263 — never use it as the label** (values are ceremonial and visibly
  truncated at ~100 chars in the source).
- `Year_of_Construction`: 225/263, range 1770–2026. A real age axis.
- `Ownership_Status`: Owned 228, Leased 8, Affiliated 7, **Sold 1 — exclude it**.
- `Current_Use`: Dormitory 46, Office 34, School 17, Vacant 8, Classroom/Office 5, Library 5,
  74 null. `Building_Type`: BUILDING 175, HOUSE 72, GARAGE 7, SHED 7.
- `Shape__Area` is exposed (footprint area, RI State Plane **feet**).
  `Gross_area__Property_ / Shape__Area` = floor count. Measured over 237 rows:
  min 0.07, **p50 3.54**, max 19.23. **This is the height source.**
- The 3D path is a **dead end for heights**: `3D_Buildings_08425/FeatureServer/9`
  (`esriGeometryMultiPatch`, `hasZ: true`) flattens to Z=0 rings on the standard query endpoint
  (`zmin = zmax = 0` on both features sampled). Real geometry lives only in the I3S SceneServer.
- There are **80 services** on the host, not 22 — including `GreenSpaces_3D_view`,
  `Campus_Walkways_view`, `Accessibility_Paths_view`, `Curb_Accessibility_view`.

### `Aliases` parsing — the shape that bites

```
"ALTADDRS: 235 Hope St; DISPNAME: Nelson Fitness Ctr"
"DISPNAME: Cental Heat Plant; NICKNAME: Chp; NICKNAME: Physical Plant"
```

Keys observed: `DISPNAME`, `NICKNAME`, `ALTADDRS`, `LEGACY`. **Keys repeat.**
**A `dict` parse silently drops data — return an ordered list of pairs.**

### The basemap

- Protomaps v4 `buildings` fields are **only** `addr_housenumber, height, kind, kind_detail,
  layer, min_height, sort_rank`. **No `name`.** Building labels cannot come from the basemap.
- Campus z15 tile: 889 buildings, **121 with `height` (13.6%)**, `min_height` essentially
  absent, minimum value 0.3048 m (1 ft — a data artifact, clamp it).
- `pois`: 1,829 features, 231 named, **only ~15–20 are Brown buildings**. Under 20% coverage.
- `buildings` minzoom is 11, so `buildings-2d` (no minzoom) is a no-op below z11.
  `landcover` maxzoom is 7, but `map/style.json:41` sets `"maxzoom": 8` — harmless, dead above z7.
- Protomaps **merges** buildings at z11–14; individual OSM buildings only exist at z15+.

### Local data

- `db/seeds/places.ndjson`: **174 rows, 156 with polygons, 156 with `osm_id`, 18 curated-only.**
  The 6 `outdoor` places (Main Green, Quiet Green, Ruth Simmons Quad, Pembroke Green, Wriston
  Quad, Van Wickle Gates) have **no polygon at all**.
- `brown_college_hill_buildings.csv`: 2,150 OSM ways, 325 named, **111 `brown_relevant_hint`
  (106 named)**, 133 with `levels`.
- Type-scale blast radius: `text-13` ×26, `text-15` ×6, `text-18` ×3, `text-12` ×52, across
  **21 files**.
- `e2e/support/mock-api.ts` routes `**/api/**` only — a `public/data/*.geojson` asset is served
  natively in e2e, no new mock needed.

### MapLibre v6 capability — do not attribute Mapbox features to it

| Available in MapLibre v6 | **Mapbox GL JS v3 only — do not plan around** |
|---|---|
| data-driven `fill-extrusion-color`/`-height`/`-base`, `-vertical-gradient`, `-pattern` | `fill-extrusion-flood-light-*` |
| singular root `light` + `map.setLight()` | `fill-extrusion-ambient-occlusion-*` |
| root `sky` **property** (not a layer; experimental) | `fill-extrusion-rounded-roof` |
| `hillshade`, MapLibre-only `color-relief`, `raster-dem` + `setTerrain` | plural `lights` spec |

Two hard constraints: `fog-*` requires 3D terrain, and **`sky` is not implemented on MapLibre
Native iOS/Android** — anything sky-based is web-only. Matters for Lane C.

Symbol gotchas: `symbol-sort-key` — **lower wins**. `text-offset` is **ignored** when
`text-variable-anchor` is set (use `text-radial-offset`). `text-optional` is inert without
`icon-image`. `text-allow-overlap: true` defeats collision — use only for a focused label.
**`feature-state` is readable in `paint` expressions only — never in `filter` or `layout`.**

---

## Step 0 — Gate: deck.gl × maplibre-v6 smoke test (30 min, throwaway branch)

maplibre-gl v6 shipped 2026-07-22; deck.gl 9.3's compat matrix predates it. Flip
`interleaved: true` in `apps/web/src/map/MapView.tsx` with only the existing pulse layer, run
the perf tour.

- **Pass** → the I3S / 3D-model door is open in a later cycle.
- **Fail** → closed for this cycle. **Nothing else in Lane A depends on it.**

Read `MapView.tsx:19-27` first — it documents that `@deck.gl/mapbox ≤9.3.7` reads
`map.transform.height`, which maplibre 6 moved behind `_camera`, and that the first frame with
any deck layer threw every rAF and killed the map. `cameraBridge.ts` patches the react-map-gl
seam, **not** deck's.

---

## Step 1 — Python ingest job `campus_buildings`

**This lives in the Python lane.** Not a build-time script, not a runtime fetch. Four reasons:

1. `ARCHITECTURE.md` §2 scopes `ingest/**` and `db/seeds/**` to Python. The output *is* a seed
   artifact and it *does* enrich `places.ndjson`.
2. Conflation needs the faithful pg_trgm port (`ingest/brownsync_ingest/gazetteer/resolver.py`)
   and shapely MultiPolygon/WKT handling (`gazetteer/geometry.py`). Re-porting either to TS
   creates exactly the drift the two-lane rule exists to prevent.
3. ArcGIS is a no-SLA third party. Touch it **once, offline, in a human-run job** — never at
   `vite build` (CI would depend on Brown's uptime) and never at runtime (outage = blank map).
   The repo's answer to this class of problem is already on disk: `providence.pmtiles` is
   committed, every external response is hash-pinned.
4. Gates, `SourceRunRecorder`, staged-then-`os.replace` atomic publish, and manifest-last
   SHA-256 are all Python already (`output.py`, `seeds_manifest.py`, `run_log.py`).

**Rejected, on the record:** `scripts/fetch-campus.mjs` (couples CI to Brown, no gates, wrong
lane); runtime `fetch()` (outage = broken map, no offline dev); baking into the PMTiles extract
(`basemap-extract.sh` is a pure Protomaps cutout; a second archive loses `setFeatureState`).

### New modules

```
ingest/brownsync_ingest/campus/
  arcgis.py        # client + esri→GeoJSON (outSR=4326), sequential, ≥1 req/s, declared UA
  aliases_parse.py # parse_aliases() -> (ordered pairs, diagnostics); resolve_label()
  height.py        # gross/footprint -> floors -> metres
  conflate.py      # ArcGIS × places × OSM
  landmarks.py     # greens, fields, walkways, boundary
  job.py           # gates + atomic publish, mirroring gazetteer/job.py
```

### `resolve_label` precedence — strictly ordered

1. First `DISPNAME` value.
2. `Property_Name`, **if not address-shaped**. Address regex:
   `^[A-Z][A-Za-z.'\- ]+\s+\d+(?:-\d+)?$` — matches `Hope St 170`, `Waterman St 118-120`;
   does not match `Metcalf Hall`, `Pizzitola`. If `Property_Name` contains `": "` (e.g.
   `Champlin: Pembroke Quad`), take the segment before the colon, record the suffix as `complex`.
3. First `NICKNAME` value (colloquial — `Pitz`, `Chp` — only when 1 and 2 both fail).
4. `Address_Line_1`.
5. `Property_Abbr` — last resort, **and gates the job if reached for >5 rows**.

An unknown `Aliases` key is emitted as an untagged alias **plus a diagnostic** — never dropped
silently. An unknown key is evidence of schema drift.

**Everything becomes an alias:** `aliases[] = dedupe(label, Property_Name, all
DISPNAME/NICKNAME/LEGACY/ALTADDRS, Official_Name, Property_Abbr)`. This is a free win for the CAB
place resolver and ⌘K search — 218 rows carry alias strings the gazetteer has never seen.

### Conflation — spatial first, name second, never name alone

| Stage | Rule | Applies to |
|---|---|---|
| S1 | ArcGIS ∩ place polygon, **IoU ≥ 0.30** *and* ArcGIS contains the place centroid | the 156 with polygons |
| S2 | ArcGIS **contains** the place centroid (shapely point-in-polygon) | the 18 curated-only |
| S3 | `PlaceResolver` trigram ≥ 0.55 over merged aliases | **corroboration + tiebreak only** — never sole evidence |
| S4 | Anything matching ≥2 on either side | **reported, not merged**, and gated |

Conflict resolution:

| Field | Winner | Why |
|---|---|---|
| `places.id` | **Existing slug, always** | 1,755 `course_meetings` rows + `athletics_venues.json` reference these by FK. Renaming is a data break. New ArcGIS-only buildings get new slugs from the resolved label. |
| `polygon` | **ArcGIS** | The owner's own survey. OSM stays the source for non-Brown College Hill buildings. |
| `name` | **Existing curated** | Hand-tuned; it's what LiveWhale/CAB strings resolve against. The ArcGIS label joins `aliases`. |
| `aliases` | **Union** | Strictly additive. |
| `kind` | **Existing curated**; ArcGIS fills only for NEW | `Current_Use` → Dormitory→`residence`, Library→`library`, Office→`admin`, Classroom/School/Lab→`academic`, Dining→`dining`, athletics→`athletic`, else `other`. |
| `address` | ArcGIS `Address_Line_1` if present | Authoritative for Brown property. |

`db/seeds/brown_owned_buildings.json` is **not deleted** (manifest-pinned, the poller reads it)
but stops being the map's ownership signal — every ArcGIS row is Brown-owned by construction.
OSM `levels` (133 rows) becomes a height corroborator.

### Gates (fail closed, mirroring `run_places_job`)

1. `≥ 240` buildings after excluding `Ownership_Status = 'Sold'`.
2. **`100%` of features carry a unique, non-null `propertyCode`** — hard requirement,
   `promoteId` silently no-ops otherwise.
3. `≥ 95%` resolve a label above precedence rung 5.
4. `0` geometry errors from `validate_multipolygon_wkt`.
5. `0` S4 ambiguities (a real Pembroke/Wriston collision must be adjudicated in `aliases.yaml`).
6. `0` existing `places.id` renamed or dropped.

### Artifacts

| Artifact | Path | Consumer |
|---|---|---|
| Campus buildings | `db/seeds/campus_buildings.geojson` | web map (static fetch) |
| Campus landmarks | `db/seeds/campus_landmarks.geojson` | web map (static fetch) |
| Enriched places | `db/seeds/places.ndjson` (rewritten) | `db/seed.ts` → Postgres |
| Recorded responses | `ingest/fixtures/recorded/arcgis/*.json` + manifest entries | ingestion tests |

**The GeoJSON must NOT be a JS import.** 263 polygons is ~250–400 kB raw / ~80–120 kB gz, which
would eat half the app budget headroom for zero benefit. `scripts/bundle-budget.mjs` reads only
`dist/assets/*.{js,css}`, so a `public/` asset is unmetered — exactly like
`public/tiles/providence.pmtiles`.

**Bridge `db/seeds/` → `apps/web/public/` with a symlink**
(`apps/web/public/data/campus-buildings.geojson → ../../../../db/seeds/campus_buildings.geojson`).
Precedent is in-tree: `supabase/migrations` symlinks `db/migrations`. If Vite's `publicDir` copy
doesn't follow symlinks on the target platform, fall back to a committed copy plus
`apps/web/test/campus-buildings-sync.test.ts` asserting its sha256 equals the manifest entry.

Schema goes in `packages/contract/src/seeds.ts` as `CampusBuildingsSchema` with
`schema_version: z.literal(1)`, exactly like `AthleticsVenuesSchema`. Register a BLOCKING entry
in `reports/app_side_dependencies.md` until the app-side consumer test passes.

---

## Step 2 — Render campus buildings

New pure module `apps/web/src/map/campusBuildings.ts` (specs + expressions, unit-testable) and
component `apps/web/src/map/CampusBuildingLayers.tsx`, mounted inside `<MapView>` beside
`<EventLayers>`.

```
<Source id="bs-campus" type="geojson" data="/data/campus-buildings.geojson" promoteId="propertyCode" />
```

`promoteId` **must** be the string form for GeoJSON. `generateId: true` is unusable — indices are
unstable across `setData`.

| id | type | zoom | notes |
|---|---|---|---|
| `bs-campus-flat` | `fill` | `maxzoom: 14` | mirrors the existing 2D/3D handoff |
| `bs-campus-extrusion` | `fill-extrusion` | `minzoom: 14` | `height: ["get","heightM"]`, `vertical-gradient: true` |
| `bs-campus-outline` | `line` | `minzoom: 15` | `--line`, width `interpolate exponential 1.6` 15→0.4, 17.5→1.2, opacity 0.5 |
| `bs-campus-labels` | `symbol` | `minzoom: 14.5` | step 3 |
| `bs-campus-focus-label` | `symbol` | — | separate 1-feature source, `text-allow-overlap: true` |

All inserted `beforeId` the event layers so pins always win.

**Basemap coexistence.** MapLibre has no spatial predicate in expressions, so the Protomaps
buildings under our footprints cannot be filtered out. Keep `buildings-3d` as the **context**
layer (non-Brown College Hill), push it to `#141821` at `fill-extrusion-opacity: 0.9`; our layer
draws above at full opacity and wins coincident faces. Residual: a 1–2 px fringe where an OSM
footprint is slightly larger — accepted, documented. Escape hatch is lowering `buildings-3d`
maxzoom to 15.5.

**Explicitly rejected:** `queryRenderedFeatures` + `feature-state {covered:true}` to zero
basemap building heights. It works, but it reinstates the exact fragile hit-test this layer
exists to delete.

**Heights**, resolved offline, three ranked sources:

1. `heightM = clamp(round(gross / footprint), 1, 14) * 3.5 + 1.2`. Clamp low kills the 0.07
   outliers; 14 is right (the SciLi genuinely is ~14 storeys); `+1.2` is parapet/mechanical —
   without it flat roofs read as slabs.
2. OSM `levels` where (1) is unavailable. Where both exist and differ by >2 floors, emit a
   diagnostic and take OSM (a human tagged it).
3. Protomaps `height` for the context layer only. **Change `map/style.json`:**
   `["coalesce",["get","height"],12]` → `["max", ["coalesce",["get","height"], 9], 6]`.
   This clamps the 1-ft artifacts *and* drops the 86%-of-buildings fallback from a uniform 12 m —
   which is precisely why massing looks flat. **`apps/web/test/style.test.ts:63` pins that exact
   expression and must change.**

**Color — ship the age ramp first** (zero contract change, fully inside the near-monochrome law):

```
["interpolate",["linear"],["coalesce",["get","year"],1930], 1770,"#141922", 2026,"#252D3A"]
```

This is *value*, not hue: the old brick core sits dark, the new glass reads brighter.

**Optional second step (`B-b`), gated on a test:** `Current_Use` → the category palette mixed
down hard, `color-mix(in oklab, var(--cat-x) 18%, <age ramp value>)`. A dining hall becomes a
*warm* dark grey, a dorm a *cool* dark grey. **This bends §6.3 ("data layers are the only
colour"), so the bend must be bounded and tested.** Add `apps/web/test/mapPalette.test.ts` that
evaluates every reachable building colour, converts to OKLCH, and asserts **C ≤ 0.025**.
**Do not ship B-b without that ceiling test.**

The highest-yield change is free: **figure/ground**. Brown buildings get the ramp; non-Brown
context drops darker. This does more for "the campus pops" than any hue choice.

---

## Step 3 — Labels (the headline feature)

**One symbol layer covers all four tiers**, via a per-feature `labelMinZoom` filter. Four
separate layers would be four tiers and would collide independently, losing global sort control.

```jsonc
{
  "id": "bs-campus-labels", "type": "symbol", "source": "bs-campus", "minzoom": 14.5,
  "filter": [">=", ["zoom"], ["get", "labelMinZoom"]],
  "layout": {
    "text-field": ["get", "label"],
    "text-font": ["Noto Sans Medium"],
    "text-size": ["interpolate",["linear"],["zoom"], 14.5,10, 16,11.5, 17.5,13],
    "text-max-width": 8,
    "text-letter-spacing": 0.02,
    "text-variable-anchor": ["center","top","bottom"],
    "text-radial-offset": 0.6,
    "text-justify": "auto",
    "text-padding": 3,
    "symbol-sort-key": ["get","sortKey"],
    "text-allow-overlap": false
  },
  "paint": {
    "text-color": ["step",["get","rank"], "#E8ECF1", 1, "#8B94A3"],
    "text-halo-color": "#0B0E12",
    "text-halo-width": 1.4,
    "text-halo-blur": 0.4
  }
}
```

Three variable anchors, not five — placement cost is linear in anchor count and we're adding
~263 labels. Halo is 1.4 (vs 1.2 in style.json) because ours sit on lit roofs; the blur stops it
reading as an outline.

**Ranks, computed offline and baked into properties — never evaluated at runtime:**

| rank | `labelMinZoom` | Rule | ~n |
|---|---|---|---|
| 0 | 14.5 | `Gross_area ≥ 60,000 sq ft` OR `Current_Use ∈ {Library, Dining}` OR **≥30 course meetings resolve here in `course_meetings.ndjson`** OR one of the 6 greens | ~25 |
| 1 | 15.5 | named building with a non-address label | ~120 |
| 2 | 16.5 | `Building_Type ∈ {HOUSE, GARAGE, SHED}` or address-style label | ~90 |
| 3 | 17.0 | remainder, incl. `Occupancy_Status = 'Non-Brown Occupied'` | ~28 |

Using **CAB meeting counts** for rank 0 is deliberate: measured prominence from data already in
the repo, not taste. `sortKey = rank + (1 - normalizedGrossArea) * 0.9` — one float, so larger
buildings win collisions within a tier.

### Staying inside the ≤3-tier law — the honest accounting

`apps/web/test/style.test.ts:67-79` pins `map/style.json`, so an app-side layer wouldn't
technically trip it. But at z15.5–16 the *visible* set becomes roads + civic POI + neighbourhood
+ campus = **4**. So:

- **Retire `label-pois-civic` from `map/style.json`.** It is now the weakest tier — Protomaps
  `pois` yields ~15–20 Brown buildings out of 231 named — and our layer strictly supersedes it.
- style.json drops to 3 symbol layers. `style.test.ts` changes `toHaveLength(4)` → `(3)`, and the
  POI-clutter test **inverts** from "one whitelisted layer, no `restaurant`/`cafe`" to
  `expect(poiLayers).toHaveLength(0)` — a **stronger** guarantee, not a relaxation. That is the
  justification for the change: a low-coverage tier is replaced by a high-coverage one and the
  clutter rule is tightened.
- Result: z15–16 = {roads, neighbourhood, campus} = 3. z>16 = {roads, campus} = 2. **Law holds.**
- New `apps/web/test/campusBuildings.test.ts` moves tier accounting **up a level** — probing zooms
  against the union of style.json symbol layers *and* the app's specs, so the rule stays enforced
  now that tiers live in two places.

**Focused label:** `feature-state` is paint-only, so `text-allow-overlap` cannot be driven by it.
Use a **second one-feature `<Source id="bs-campus-focus">`** fed from React state.

---

## Step 4 — `feature-state` replaces the centroid hit-test

**Call this out in the PR. It deletes a whole fragile subsystem.**

Today `apps/web/src/map/ClassActivityLayer.tsx` (152 lines) projects each active place to screen
px, runs `queryRenderedFeatures` on a 12×12 box on every `idle`/`sourcedata` (rAF-coalesced to
stop an idle loop), matches whatever basemap building happens to sit under the pin, and mutates
the **shared** `buildings-3d`/`buildings-2d` paint via `setPaintProperty` — with a cleanup path
that restores the originals. `classesLayer.ts:87-97` documents that places missing a rendered
building get no tint at all.

Tomorrow:

```ts
map.setFeatureState({ source: "bs-campus", id: propertyCode }, { classActivity: level })
```

Gone: screen projection, `queryRenderedFeatures`, the `sourcedata`/`idle` listeners, rAF
coalescing, the idle-loop diff guard, basemap paint mutation, the restore-on-unmount dance.
Feature-state **persists on the source**, so it works for off-screen and not-yet-rendered
buildings, and the tint can no longer leak onto a non-Brown neighbour.

No contract change: each feature carries `placeId`, and the component builds a
`placeId → propertyCode` index once on load. `MeetingOut.placeId` is already served.

Same treatment for `apps/web/src/pages/PlaceMiniMap.tsx:70-120` — `FootprintHighlight`'s probe
loop becomes `filter: ["==",["get","placeId"], place.id]` over the same static GeoJSON.
`data-testid="place-minimap"` / `place-minimap-fallback` survive; `FOOTPRINT_PROBE_PX` disappears.

**Deleted:** `ClassActivityLayer.tsx`. **Kept:** every pure function in `classesLayer.ts`
(`aggregateMeetingActivity`, `activityLevel`, `blendHex`, `totalMeetingCount`) and its test.
Net ≈ **−200 lines**.

**Add a dev-only runtime assertion** in `CampusBuildingLayers.tsx` logging if the index size ≠
feature count — `promoteId` failing is silent and would just make the tint not appear.

---

## Step 5 — Landmarks

`db/seeds/campus_landmarks.geojson` from `Green_Spaces_view`, `Athletic_Fields_view`,
`Campus_Walkways_view`, `Campus_Boundary_view`, with a `kind` discriminator
(`green | field | walkway | boundary | gate`).

- **Backfill the 6 polygon-less `outdoor` places** by containment/IoU against
  `Green_Spaces_view`. They currently have *no* geometry at all — this closes a real gap.
- **Van Wickle Gates** stays a labeled point with no fill.
- Layers: `bs-campus-green` (`fill` `#16211A`) + `bs-campus-green-line` (`line` `#1C2A20`) above
  `landuse-green`; `bs-campus-walkways` (`line` `#1E2530`, dashed, z≥15). The diagonal paths
  across the greens are how people actually navigate campus, and Protomaps `roads/path` only
  carries some of them.
- Green labels join `bs-campus-labels` at rank 0. A named, outlined Main Green is probably the
  single biggest "this is Brown" legibility win after building labels.

---

## Step 6 — Daylight on the time cursor

The best tie-in available, and cheap.

New pure module `apps/web/src/map/daylight.ts`:

- `sunAltitude(date, lat, lng)` — a ~40-line NOAA solar-position formula.
  **Write it, do not add a dependency.** This is arithmetic and the budget discipline is real.
- `daylightPhase(altitudeDeg)` → `{ phase: "night"|"twilight"|"day", t: 0..1 }`
- `paletteAt(phase, t)` → `{ skyColor, horizonColor, lightIntensity, lightPosition, buildingLift,
  roadLift }`. Every value derived from existing tokens by lifting L — reuse `blendHex` from
  `classesLayer.ts`, do not add a colour library. **Night = the current values verbatim.**

New component `apps/web/src/map/DaylightLayer.tsx`: subscribes via `useTimeCursor()`, and on
change calls `map.setLight(...)`, `map.setSky(...)` (**feature-detect** —
`typeof map.setSky === "function"`; `sky` is experimental), and `setPaintProperty` on
`bs-campus-extrusion` / `roads-*` / `earth`. `map/style.json` already declares
`"transition": {"duration": 150}`, so every change crossfades for free at exactly the §6.4
motion bound.

**Design-law check, state it in the PR:** this is **not** a second ambient animation. It is
input-driven (scrubber, or the existing 30 s live tick) and it is a transition, not a loop.
Add an assertion in `daylight.test.ts` that the module creates **no `requestAnimationFrame` and
no interval**.

**Contrast cap — a real constraint, not a formality.** `#8B94A3` on `#2A323E` is ≈4.1:1 and
**fails AA**. `#8B94A3` on `#232A35` is ≈4.6:1 and passes. So: **no daylight phase may raise any
map surface above `--line` (#232A35) in relative luminance.** Pin it in
`a11y-contrast.test.ts` — iterate the phase 0→1, compute every surface colour, assert luminance
≤ `luminance(tokens.line)` and every map text colour ≥4.5:1 against it.

`fog-*` needs 3D terrain → skip. `atmosphere-blend: 0` keeps it cheap.

**Hillshade / terrain verdict: no `setTerrain`, hillshade optional and last.** The hill *is* the
campus's defining feature (~60 m over ~1 km), but free terrarium DEM tops out near z13 so campus
zoom samples mush, and terrain re-projects every extrusion vertex per frame — a direct hit on the
p95 the perf harness measures, right after we add ~263 extrusions. Hillshade would also cost the
map its **second external dependency** (today the glyph server is the only one), requiring an
`e2e/support/mock-api.ts` route and degrading offline dev. The `sky` property buys the
zoomed-out atmosphere for free.

---

## Step 7 — Type scale (highest blast radius — read the ordering note)

Current `[12, 13, 15, 18, 24]`, body 13px/1.45. The complaint is real: 13px body with 12px mono
reads cramped, 13→15 is too small a step to build hierarchy with, and 18→24 jumps with nothing
above.

**Proposed — six sizes, still a hard set:**

| Token | Size / line-height / tracking | Role | Was |
|---|---|---|---|
| `--text-12` | 12 / 16 | mono micro: counts, ticks, timestamps | unchanged |
| `--text-14` | 14 / 20 | **body** | 13 |
| `--text-16` | 16 / 22 | emphasis body, list titles, panel body | 15 |
| `--text-19` | 19 / 26 / -0.01em | section + panel headings | 18 |
| `--text-24` | 24 / 30 / -0.02em | page titles | unchanged |
| `--text-30` | 30 / 36 / -0.02em | **new** — one hero size (place/org title) | — |

13→14 is the smallest change that reads as "bigger" without reflowing every panel, and 20/14 =
1.43 preserves the 1.45 rhythm. 15→16 puts emphasis a full 2 px above body instead of 1 px —
13/15 was too close to read as hierarchy at all.

Contract edits in `packages/contract/src/tokens.ts`: `type.scale`, plus **new** `type.body: 14`
and `type.lineHeights` (currently `packages/ui/src/tokens.test.ts:70-79` pins `--text-N: Npx` but
never pins line-heights — add that assertion).

### ⚠️ The ordering that matters more than the change

`@theme` sets `--text-*: initial`, so after the rename `text-13`, `text-15`, `text-18`
**compile to nothing** — a whole-app invisible-size regression with **zero test failures today**.

**Land `apps/web/test/type-scale.test.ts` GREEN against the CURRENT scale first.** Structure it
like the existing `--text-faint` regression scan in `a11y-contrast.test.ts:111-143`: walk `src/`,
regex `text-<digits>` utilities, fail on any number outside `tokens.type.scale`. *Then* change
the scale — the silent failure becomes a red test and the sweep becomes mechanical.

**WCAG:** with 19 and 30 in the scale, 24/30 regular and 19 bold now qualify for the 3:1
large-text carve-out. **Decline it by policy** and say so in the docstring — the app is dark-only
and dense, and taking the carve-out is how `--text-faint` creeps back in. **No colour token
moves, so the type change is contrast-neutral.**

**Density trade — the honest answer to "bigger font AND more info":** bigger type means fewer
rows; buy it back from padding, not content. `TimelineRow` `density="dense"` goes `py-1.5` →
`py-1`, time gutter `w-16` → `w-14` (14px mono `"19:04"` ≈ 42 px fits 56 px). Add a third
`density="compact"`.

---

## Step 8 — Header + `TimeMachineDock` + `NowBar`

`Header.tsx:10-13` documents the header as width-starved: 10 chips plus a full time machine
cannot share a 1280 px row without starving the scrubber, which is why the chips were evicted.

**Move the scrubber out of the header entirely, to a full-width bottom dock.**

- `panels/Header.tsx` stays `h-12` — no vertical loss. Slots: wordmark + coords · `SearchTrigger`
  (grown to `h-8 w-72`) · **`NowBar`** (new) · `HealthStrip compact`.
- **`panels/NowBar.tsx`** fills the freed centre slot with live mono counts —
  `142 events · 87 classes in session · 3 games · 12 min ago`. The information-density ask, in
  the most valuable pixels on screen, at zero layout cost.
- **`time/TimeMachineDock.tsx`**: `h-10`, full width across map + list, `border-t border-line`.
  The scrubber finally gets the whole viewport, which is what it wanted, and a bottom timeline
  scrubber is the conventional placement anyway.
- `CategoryChips` moves out of `IndexPage.tsx:107` into the layer panel, reclaiming ~40 px.

*(Rejected: a two-row `h-20` header — costs 32 px of map for the same result, and leaves the
scrubber constrained by its siblings.)*

**`data-testid="time-scrubber"` must MOVE with the component, not be recreated.**
`journey.e2e.ts` and `a11y.e2e.ts` depend on it.

---

## Step 9 — `LayerPanel` + registry + `?layers=`

`LayerRail.tsx` is `w-44` with three hardcoded rows and state **local** to `LiveMap.tsx:53-57`,
not URL-synced (unlike `?cats=`). With ~28 toggles a flat list is unusable.

**`panels/LayerPanel.tsx`** (replaces `LayerRail.tsx`): `w-52`, internally scrollable, collapsible
groups built on native `<details>`/`<summary>` — zero JS, keyboard-accessible for free, matching
the repo's native-element instinct.

| Group | Default | Contents |
|---|---|---|
| Activity | open | Events, Classes, Athletics (with counts) + the 10 relocated `CategoryChips` |
| Campus | open | Buildings, Labels, Greens & fields, Walkways, Construction |
| Get help | collapsed | Blue-light phones, AED, Narcan |
| Basics | collapsed | Restrooms (gender-inclusive / single-occupancy), Hydration, Lactation, Menstrual products |
| Access | collapsed | Accessible entries, Elevators, Ramps, Curb cuts, Accessible paths |
| Getting around | collapsed | Bike racks, EV chargers, Parking, Printers, Dining, Exhibitions |

**Registry-driven, not hand-written JSX.** New `apps/web/src/map/amenityLayers.ts` exports a typed
`AMENITY_LAYERS: AmenityLayerSpec[]` — `{ id, group, label, dataUrl, symbol, minzoom, color }`.
Adding a layer is one registry entry plus one artifact.

**URL sync** via new `apps/web/src/map/layerState.ts`, a direct structural clone of
`browse/filter.ts` — same functional search update that **preserves sibling params**. Param
`?layers=`. Serialize only the **delta from default**: `?layers=blue-light,restrooms` for extras,
`?layers=-classes` for a disabled default.

**Perf guard, non-negotiable:** amenity layers are **lazily fetched on first enable** and
**removed from the style when toggled off** — not `visibility: none`, which still costs a symbol
placement pass. Add a ceiling assert in the perf harness: with defaults on,
`map.getStyle().layers.length` stays under ~40.

---

## Step 10 — Unified feed shell

**Key insight: BDH items are already `events` rows** (`services/poller/src/bdh/normalize.ts`
writes `source: "bdh"`). So the *shell* is a presentation problem. Lane B replaces the backing
data with a real `articles` table and `/api/feed` — **coordinate: B's step 12 rebases on this.**

- New `apps/web/src/browse/feed.ts`: a `FeedItem` discriminated union +
  `buildFeed(events, meetings, cursor, filters)`. Pure, unit-testable.
- `ListView` gains a `SegmentedControl` (already in `packages/ui`): **Now / Today / News**.
- Rows: keep `TimelineRow` for events; add `packages/ui/src/components/FeedRow.tsx` for news —
  no time gutter, a source-badge gutter instead, headline at the new 16 px, dek at 14 px. This is
  where the bigger type visibly pays off.
- `grouping.ts`'s `bucketOf` currently takes `EventOut`; change its parameter to the structural
  subset `{ start, end, allDay }` it already uses. Zero behavior change, `grouping.test.ts`
  passes untouched.

**The #1 way this breaks CI:** `data-testid="event-list-item"` is load-bearing in three e2e
specs. Add `data-testid="feed-item"` on the union wrapper but **keep `event-list-item` on
event-kind rows. Do not rename it.**

---

## Test changes by step

| Step | Change | Add |
|---|---|---|
| 1 | `ingest/tests/test_seeds_manifest.py`, `test_cli.py` | `ingest/tests/campus/test_{arcgis,aliases_parse,conflate,height,job}.py`; `CampusBuildingsSchema` round-trip |
| 2 | `style.test.ts:63` (height expr), `buildingColors.test.ts` | `apps/web/test/campusBuildings.test.ts` |
| 3 | `style.test.ts` 4→3 symbols; POI test inverts to `toHaveLength(0)` | union tier probe in `campusBuildings.test.ts` |
| 4 | `classesLayer.test.ts`, `place-minimap.test.tsx` | `placeId → propertyCode` index test |
| 5 | `ingest/tests/gazetteer/test_catalog.py` | `ingest/tests/campus/test_landmarks.py` |
| 6 | `a11y-contrast.test.ts` (map pairs + the `--line` luminance cap) | `apps/web/test/daylight.test.ts` — solar position vs known sunrise/sunset, palette monotonicity, **no rAF/interval** |
| 7 | `tokens.ts`, `styles.css`, `tokens.test.ts`, `a11y-contrast.test.ts` docstring, every `packages/ui/src/components/*.tsx` | `type-scale.test.ts` + `packages/ui` mirror; line-height pins |
| 8 | `pages.test.tsx`, `journey.e2e.ts`, `a11y.e2e.ts` | `now-bar.test.tsx` |
| 9 | `eventsLayer.test.ts` (`LayerToggles` → `Set`), `LiveMap` tests | `layer-state.test.ts` — **must assert `?cats=` and `?layers=` survive each other**; `layer-panel.test.tsx` |
| 10 | `browse-grouping.test.ts`, `browse-list.test.tsx`, `journey.e2e.ts` | `feed.test.ts`; `FeedRow` test |

---

## Verification

- **Extend the dev handle.** `MapView.tsx:83-85` already exposes `window.__brownsyncMap` under
  `import.meta.env.DEV`. Add `window.__brownsyncMapDebug = { setDaylight(hour), listLayers(),
  featureState(code), labelTiersAt(zoom) }` under the same guard — statically stripped from prod.
- **`e2e/perf.e2e.ts`**: add (a) a second measured pass with 6 amenity layers enabled, (b) the
  `layers.length ≤ 40` ceiling, (c) **p50/p95 recorded per map step**, so regressions are
  attributable rather than discovered at step 10. Run each step once on real GPU hardware with
  `PERF_ENFORCE=1`. The always-on 1,500 ms tripwire catches catastrophes but will not catch a
  20% regression.
- **One golden screenshot.** New `apps/web/e2e/cartography.e2e.ts` — fixed camera, fixed daylight
  hour, fixed data, `maxDiffPixelRatio: 0.03`, **non-blocking initially** (software GL is noisy).
  Makes building colour and label placement reviewable in a PR diff, which is otherwise
  impossible. The repo has no `toHaveScreenshot` usage today; this is the first.

---

## Risks

1. **Bundle budget** (243.58 / 450 kB gz). New JS ≈ +13 kB net after deleting
   `ClassActivityLayer`. Comfortable. Two things would blow it, both avoided by design:
   importing the GeoJSON as a module (+80–120 kB — it must be a `public/` asset) and
   `@loaders.gl/i3s` + draco. **Also: write the solar math, don't `npm i suncalc`.**
2. **Frame time.** Every symbol layer is a placement pass per camera change. Mitigated by 3
   anchors not 5, offline-precomputed `sortKey`/`labelMinZoom` (no per-feature arithmetic per
   frame), and the zoom filter meaning only ~25 labels are candidates at z15. Measure every step.
3. **deck.gl × maplibre-6.** Everything here is deliberately MapLibre-native; `interleaved: false`
   stays. Only the deferred 3D idea is gated on step 0.
4. **ArcGIS has no SLA.** Mitigated by fetching once, offline, in Python; hash-pinning the
   response; committing the artifact; and fail-closed gates so a degraded response never
   overwrites a good one.
5. **Licence — G5 in the master plan.** The service is public but **no licence was found in the
   service metadata**. This repo is scrupulous about ODbL attribution. **Check Brown's terms
   before the first publish, and carry an attribution string regardless.** A genuine gate.
6. **Type scale has the highest blast radius and no current coverage.** Order matters more than
   the change. Scanner green first.
7. **`promoteId` silent failure.** Gate #2 in step 1 plus the dev assertion in step 4 exist
   precisely for this.
