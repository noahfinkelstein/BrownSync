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

## 2. Organization LiveWhale sidecar (Task 7) — BLOCKING, app lane (pending)

- Artifact: `db/seeds/organization_livewhale_groups.json`, schema v1 per the
  plan. Not yet produced (Task 7 has not run in this lane); recorded here so
  the register is complete when it lands.

## 3. Dining discovery input (Task 8) — BLOCKING, user action

- `dining.brown.edu` answers a Pantheon-edge 403 to the declared UA
  `BrownSync/1.0 (+noah_finkelstein@brown.edu)`; evasion is forbidden, so no
  discovery can run (evidence: `ingest/fixtures/manifest.json` gaps
  `dining_landing`/`dining_bundle`; detail: `ingest/dining/NOTES.md`).
- Required user action, either: (a) an OIT/Pantheon allowlist for the
  declared UA, or (b) browser-exported dining pages dropped under
  `ingest/fixtures/user_provided/` for hash-pinned manifest inclusion.
- Not contract-blocking: contract v1 defines no dining-hours row and the six
  fixed dining places are already seeded in `db/seeds/places.ndjson`.

## 4. Seed bundle manifest enforcement (Task 9) — BLOCKING, app lane

- `db/seeds/manifest.json` (generation ID + SHA-256 per artifact, published
  last) is produced in Task 9; the app-side loader must reject mixed
  generations. Recorded since Task 6B; unchanged.
