# App-side and cross-workstream dependencies (ingestion lane)

Per the execution plan, app-side acceptance of ingestion sidecars is a
**blocking cross-workstream dependency**: ingestion completion never claims
the TS poller consumes an artifact until a consumer test passes in the app
lane. This file is the register.

## 1. Athletics venue sidecar (Task 8) — BLOCKING, app lane

- Artifact: `db/seeds/athletics_venues.json`, schema v1
  (`{"schema_version": 1, "generated_at": "<UTC ISO>", "mappings":
  [{"source_name": "<SIDEARM venue>", "place_id": "<canonical slug>"}]}`).
- Producer guarantees (tested in `ingest/tests/test_athletics_venues.py`):
  exact element schema, mappings sorted and unique by `source_name`, every
  `place_id` present in `db/seeds/places.ndjson`, publication is atomic and
  fail-closed on any unmapped home venue.
- Required app-side action: the athletics ICS poller must resolve home-game
  `LOCATION` venue segments through this sidecar, and a consumer test must
  exist in the app lane before ingestion claims the integration done.
- **Status (Task 10 review, 2026-07-29): consumer acceptance exists but is
  unmerged.** The final review confirmed a schema divergence — the poller on
  `origin/main` still parsed this file as the obsolete flat
  `{"<venue>": "<place_id>"}` map and threw on the v1 envelope. The app lane
  fixed it on branch `fix/athletics-sidecar-v1` (commit `60c349d`): pins
  `AthleticsVenuesSchema` (v1 envelope, `z.literal(1)` version) in
  `@brownsync/contract`, rewrites `loadAthleticsVenues()` over `mappings[]`,
  mirrors the ingestion-emitted file as a poller fixture, and covers both
  sidecar worlds (absent / present-with-v1) in consumer tests. The producer
  shape is unchanged. This dependency stays BLOCKING until that branch
  merges; root cause — DATA_CONTRACT.md never defines either sidecar file —
  should be closed with a coordinated contract bump listing both sidecar
  schemas.
- Caution for the consumer: a `Providence, R.I.` LOCATION prefix does NOT
  imply a home game — "Chapey Field at Anderson Stadium" is Providence
  College's stadium. Home classification requires the SIDEARM "vs" summary
  in addition to city and venue (rule and evidence:
  `ingest/brownsync_ingest/athletics_venues.py`).

## 2. Organization LiveWhale sidecar (Task 7) — BLOCKING, app lane

- Artifact: `db/seeds/organization_livewhale_groups.json`, schema v1
  (`{"schema_version": 1, "generated_at": "<UTC ISO>", "mappings":
  [{"organization_id": "<slug>", "livewhale_group": "<source name>",
  "match_method": "exact|fuzzy", "score": <0..100>}]}`). **Produced as of
  Task 7 (2026-07-29)**, from the user-provided clubs export linked against
  the 218 recorded LiveWhale groups.
- Producer guarantees (tested in `ingest/tests/clubs/test_livewhale.py` and
  `test_job.py`): exact element schema, mappings sorted and unique by
  `organization_id`, every id present in `db/seeds/organizations.ndjson`,
  atomic fail-closed publication behind the clubs gates.
- **Measured content: `mappings` is EMPTY.** The 218 recorded LiveWhale
  publisher groups are departments/offices; no student organization is a
  publisher (exact matches 0; the 11 subset-degenerate fuzzy candidates —
  e.g. "College Hill Irish Music Ensemble" vs the "Music" department — are
  rejected fail-closed and listed in task-7-report.md; 1 ambiguous-margin).
  Consumers must tolerate absence AND an empty list; the app lane's
  `OrgLivewhaleGroupsSchema` (packages/contract/src/seeds.ts, verified
  field-for-field 2026-07-29) already allows both.
- Required app-side action unchanged: a consumer test must pass in the app
  lane before ingestion claims the integration done. This dependency stays
  BLOCKING until then.

## 3. Dining discovery input (Task 8) — BLOCKING, user action

- `dining.brown.edu` answers a Pantheon-edge 403 to the declared UA
  `BrownSync/1.0 (+noah_finkelstein@brown.edu)`; evasion is forbidden, so no
  discovery can run (evidence: `ingest/fixtures/manifest.json` gaps
  `dining_landing`/`dining_bundle`; detail: `ingest/dining/NOTES.md`).
- Required user action, either: (a) an OIT/Pantheon allowlist for the
  declared UA, or (b) browser-exported dining pages dropped under
  `ingest/fixtures/user_provided/` for hash-pinned manifest inclusion.
- Partial input landed 2026-07-29: the Codex pack registers
  `brown_dining_menu_links.csv` (10 menu links, supplementary — it is not
  the landing/bundle discovery evidence, so the `dining_landing`/
  `dining_bundle` gaps stand).
- Not contract-blocking: contract v1 defines no dining-hours row and the six
  fixed dining places are already seeded in `db/seeds/places.ndjson`.

## 4. Seed bundle manifest enforcement (Task 9) — BLOCKING, app lane

- `db/seeds/manifest.json` (generation ID + SHA-256 per artifact, published
  last) is produced in Task 9; the app-side loader must reject mixed
  generations. Recorded since Task 6B; unchanged.

## 5. Brown-owned buildings sidecar (enrichment round) — BLOCKING, app lane

- Artifact: `db/seeds/brown_owned_buildings.json`, schema v1 —
  `{"schema_version": 1, "generated_at": "<UTC ISO>", "attribution":
  "<OpenStreetMap/ODbL credit>", "osm_way_ids": [<int>, ...], "place_ids":
  ["<slug>", ...]}` (the `attribution` key is mandated by the plan's
  ODbL constraint for OSM-derived output — pin it in the consumer schema).
- Closes the deferred map-tint item (Claude handoff section 5, "Brown-owned
  buildings slightly lighter"): the app tints the OSM building footprints
  whose way ids appear in `osm_way_ids`, and may additionally tint the
  published place polygons named by `place_ids` (this carries the three
  relation-backed Brown buildings — Kassar House, Barbour Hall,
  Verney-Woolley — which way ids cannot express).
- Producer guarantees (tested in `ingest/tests/test_brown_owned_buildings.py`):
  evidence-tiered classification (OSM `operator`/`owner` naming Brown
  University, or an export-present way backing an institutional-kind curated
  place), sorted unique ints/slugs, every `place_id` present in
  `db/seeds/places.ndjson`, atomic fail-closed publication (operator
  conflicts and export drift block it). `brown_relevant_hint` never
  classifies; the ambiguous middle (13 kind=`other` catalog places incl. the
  campus center, plus 17 hint-only ways, largely RISD) is reported in
  `reports/sdd/brownsync-ingestion/enrichment-codex-drop.md`, not guessed in.
- Required app-side action: the map layer must consume this sidecar and a
  consumer test must exist in the app lane before ingestion claims the
  integration done.
- **Follow-ups recorded explicitly:** (a) the artifact is NOT yet listed in
  `db/seeds/manifest.json` — the bundle manifest is regenerated by the
  concurrent orgs round and must gain a `brown_owned_buildings.json` entry
  (plus a CLI job registration) in a later round; (b) the orgs-round bundle
  regeneration of 2026-07-29T14:28Z snapshotted `places.ndjson` before this
  round's alias growth landed, so the enrichment round republished
  `db/seeds/places.ndjson` (166 -> 174 rows) afterwards — the bundle
  manifest's `places.ndjson` hash is stale until the next `run all`
  regenerates it (mixed-generation detection protects loaders meanwhile).
