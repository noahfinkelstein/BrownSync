# App-side and cross-workstream dependencies (ingestion lane)

Per the execution plan, app-side acceptance of ingestion sidecars is a
**blocking cross-workstream dependency**: ingestion completion never claims
the TS poller consumes an artifact until a consumer test passes in the app
lane. This file is the register.

## 1. Athletics venue sidecar (Task 8) — RESOLVED 2026-07-29 (PR #8 merged)

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
  shape is unchanged. **`fix/athletics-sidecar-v1` merged to main as PR #8
  (merge commit `2251a15`, 2026-07-29) — verified on `origin/main`:
  `services/poller/src/athletics/venues.ts` imports `AthleticsVenuesSchema`
  from `@brownsync/contract` and parses the v1 envelope. Consumer acceptance
  test exists and runs in CI. This dependency is closed.** Residual root
  cause — DATA_CONTRACT.md never defines either sidecar file — should still
  be closed with a coordinated contract bump listing both sidecar schemas.
- Caution for the consumer: a `Providence, R.I.` LOCATION prefix does NOT
  imply a home game — "Chapey Field at Anderson Stadium" is Providence
  College's stadium. Home classification requires the SIDEARM "vs" summary
  in addition to city and venue (rule and evidence:
  `ingest/brownsync_ingest/athletics_venues.py`).

## 2. Organization LiveWhale sidecar (Task 7) — RESOLVED 2026-08-07

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
- ~~Required app-side action unchanged: a consumer test must pass in the app
  lane before ingestion claims the integration done. This dependency stays
  BLOCKING until then.~~ **RESOLVED 2026-08-07**: the app-lane consumer test
  exists and passes — `services/poller/test/seed-sidecars.test.ts` drives
  `loadOrgGroups()` (services/poller/src/livewhale/orgs.ts) against the
  recorded sidecar fixture, asserting schema-v1 parsing, tolerance of an
  ABSENT file (empty map), and tolerance of the measured-empty `mappings`
  list. Runs in the poller suite in CI (green on `main` @ ad25f48).

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
- **Follow-ups recorded explicitly — both CLOSED by the events-bootstrap
  round (2026-07-29):** (a) the `buildings` job is registered in the CLI
  (`cli.py`, file-only sidecar like athletics) and
  `brown_owned_buildings.json` is covered by `db/seeds/manifest.json`
  (generation `9e8e8a479a97401ab4077c449d7a1871`, 7 artifacts); (b) the
  same `run all` republished the bundle with the enrichment-round
  `places.ndjson` (174 rows, byte-identical hash `4b522c81…`), healing the
  documented mixed-generation state.

## 6. Events bootstrap seeds (events round) — poller convergence contract

- Artifact: `db/seeds/events.ndjson` — 1,106 contract event rows (1,000
  `source="livewhale"` from the 2026-07-29 snapshot + 106
  `source="registrar"` admin rows from the 2026-2027 academic calendar).
  Every row validates against the app lane's compiled `SeedEventSchema`
  (verified against `packages/contract/dist/seeds.js`, 1,106/1,106).
- Convergence guarantee (tested in `ingest/tests/events/test_livewhale.py`
  with 10 ids pinned against the poller's recorded fixture): livewhale
  `source_id` is byte-identical to the TS poller's `${id}:${date_ts}`
  derivation, so post-deploy live polling upserts ONTO these rows on
  `(source, source_id)` instead of forking them. Categories/org lookup are
  verbatim ports of `services/poller/src/livewhale/{categories,orgs}.ts`.
- Fields the poller will overwrite on first refresh (expected, not a bug):
  `description` (CSV carries none), `place_id` (poller emits null today —
  if gazetteer placement should survive refreshes, the poller needs the
  resolver semantics of contract §2), `raw` (feed object vs CSV row).
- `source="registrar"` rows are outside the LiveWhale poller's namespace
  and stay stable; 21 registrar entries also exist as livewhale rows
  (same underlying LiveWhale event) — cross-source duplicates are the
  app lane's `canonical_id` dedup concern (contract §1).

## 7. Per-source health fields (migration 0006) — BLOCKING, app lane, ONE LINE

**Status: API side landed 2026-07-29. Client change outstanding.**

`api_health()` now left-joins `source_registry` and `/api/health` returns three
new **optional** fields on every `SourceHealth` entry:

| field | type | meaning |
|---|---|---|
| `staleAfterSeconds` | `number \| null` | per-source staleness horizon in seconds; `null` = not registered |
| `enabled` | `boolean` | `false` = ToS gate or recorded refusal — paused, not broken |
| `label` | `string \| null` | registry display name; `null` = keep the local map |

They are optional in `SourceHealthSchema`, so **the current client keeps
working untouched** — this is a correctness improvement, not a break.

**The change needed in `apps/web/src/ops/health-model.ts` (owned by the app
lane; deliberately not edited from the data lane):**

- `effectiveStatus(source, nowMs)` currently applies one global
  `STALE_AFTER_MS = 45 * 60_000` to every source. With ArcGIS at weekly and
  dining at daily, every slow-by-design source is permanently yellow. Use
  `source.staleAfterSeconds * 1000` when present, falling back to the existing
  constant when it is null — so the change is safe against a registry gap:

  ```ts
  const staleAfterMs = source.staleAfterSeconds != null
    ? source.staleAfterSeconds * 1000
    : STALE_AFTER_MS;
  ```

- `sourceLabel()` should prefer `source.label` from the wire and keep its local
  map as fallback.
- `source.enabled === false` should render as **paused/blocked with a reason**,
  never as a failure or a stale warning. Two sources ship that way on purpose —
  `providence_gov` (robots.txt explicitly disallows `/event/`, `/events/`,
  `/*?*`) and `today_brown` (Shibboleth SSO) — plus `bdh` while its ToS gate
  holds. The whole point of registering refusals is that they are *reported*.
- Suggested tests: a weekly source last seen 3 days ago is `ok`; the same
  source at 3 weeks is `stale`; a source with `enabled: false` is neither.

**Also newly visible:** `/api/health` now returns a row for every registered
source, including ones with no producer yet (`dining`, `libcal`, `arcgis`,
`passiogo`, `feed_rank`, …) with `status: "never"`. That is the same category
the client already renders for `cab`/`clubs`, just more of them.

## 8. Seed bundle manifest enforcement — RESOLVED 2026-07-29 (closes §4)

The blocking item in §4 ("the app-side loader must reject mixed generations")
is closed. Manifest verification moved out of `db/seed-check.ts` into a shared
`db/manifest.ts`; **`db/seed.ts` now calls `verifyManifest()` before reading a
single NDJSON byte and exits 1 with zero writes** on any byte-length or sha256
mismatch. Covered by `db/test/manifest.test.ts`, which drives the real loader
against a tampered bundle with a deliberately unreachable `DATABASE_URL` — the
run dying on the gate without ever mentioning a connection is the proof that
nothing was written.

Two related notes for the ingestion lane:

- `campus_buildings.geojson` is present in `db/seeds/` but is **not listed in
  `db/seeds/manifest.json`** (generation `9e8e8a479a97401ab4077c449d7a1871`,
  7 artifacts). `pnpm db:seed-check` now says so, once, as a warning. The next
  `run all` that publishes the manifest should cover it.
- `source_runs.ndjson` is deliberately **outside** the manifest — it is
  append-only run history with no fixed generation to hash. It used to warn on
  every single run by construction, which is how real warnings get ignored; it
  now gets one explanatory summary line instead.

## 9. Organization enrichment and private claim evidence — RESOLVED LOCALLY, Lane C

- Contract v1.3 adds source-owned organization fields to the Python producer,
  TypeScript seed validator, database loader, and migration `0013`; contract
  v1.4 adds the separate ownership/overlay model in migration `0014`.
- `contact_emails` is deliberately present in `organizations.ndjson` and
  Postgres so an exact current Brown contact can bootstrap ownership. It is
  PII-like claim evidence and must never appear in `/api/orgs`, generated
  client response types, or direct `anon`/`authenticated` column access. The
  raw source `logo_url` remains private. Contract v1.6 instead exposes only
  separately uploaded, transformed, validated controlled media through the
  attributed asset pipeline in migration `0017`.
- User-authored club content must be read through the seed-surviving overlay
  from migration `0014`; consumers must not write those edits back into the
  weekly ingested `organizations` row.
- Legacy `GET /api/orgs/{id}` remains shape-compatible. Enriched safe data is
  additive at `GET /api/orgs/{id}/profile`; ownership/review operations are
  authenticated Worker routes, and protected organization reads are bounded
  by the fail-closed per-user read limiter.
- The Lane C dependency gate is resolved: the seed loader/check, private-column
  negatives, two author fresh-database sequences, an independent PostGIS
  replay, 298 API tests, 32 contract tests, Worker binding dry-run, and
  byte-identical canonical/iOS OpenAPI snapshots all pass.
- The repository-wide SQL chain still fails in the separate Lane B-owned
  `0004_bdh_licence_checks.sql` attributed-GUID assertion. Lane C did not
  modify or waive that failure; it remains a merged-CI/deployment blocker
  outside this dependency.

## 10. Student-created event integration — RESOLVED LOCALLY, Lane C

- Contract v1.5 and migration `0016` add a separate RLS-enabled
  `user_events` write model. They do not change the source-ingested `events`
  row, its seed artifacts, or any ingestion producer.
- `v_events_api` keeps its exact 21-column legacy shape and source branch.
  Published BrownSync rows are additive with source `brownsync`; they carry a
  canonical place but never latitude or longitude.
- Authenticated Worker routines own request-idempotent creation, optimistic
  edits, idempotent cancellation, bounded management reads, detail, and
  moderation. Direct client writes and routine execution remain revoked.
- Personal creation requires a Brown account at least 24 hours old;
  organization creation requires current org administration. An atomic limit
  of ten per actor per fixed 24-hour window covers both, while exact committed
  replays do not consume quota.
- Account deletion removes personal visibility and attribution without
  deleting organization-owned events. The posting switch gates public
  visibility and enabling writes.
- The local dependency gate is resolved: two full author database replays,
  independent and root PostGIS 15 semantic/race runs, 404 API tests, 32
  contract tests, both typechecks, Worker binding dry-run, byte-identical
  OpenAPI snapshots, generated Swift assertions, simulator
  build-for-testing, and the complete 14/14-task workspace pipeline pass.
- The only repository-wide SQL failure remains the unchanged, unrelated
  Lane B-owned `0004_bdh_licence_checks.sql` attributed-GUID assertion.

## 11. Organization media and Instagram cards — RESOLVED LOCALLY, Lane C

- Contract v1.6 and migration `0017` add eight RLS-enabled operational tables
  and owner-only routines for controlled organization media, durable cleanup,
  bounded link cards, provider capacity, mutation limits, and attribution
  cleanup. They do not alter the source-ingested `organizations` row, seed
  artifacts, manifest, or any ingestion producer.
- Public media comes only from the controlled 8 MiB input → validated 2 MiB
  WebP pipeline. The raw seed `logo_url`, storage paths, leases, actors,
  service credentials, provider errors, and cached HTML remain private.
  Gallery and social collections each cap at 12; actor media/social quotas are
  30/hour and durable provider capacity is 900/hour with the switch disabled
  by default.
- Instagram is opt-in and link-first. Only exact canonical post/Reel
  permalinks are stored. Missing, disabled, unsafe, stale, or unavailable
  provider behavior degrades to a link card, and embed HTML is available only
  from the isolated origin after a fresh safe-cache read.
- Local proof is complete: 518 API tests, 40 contract tests, both typechecks,
  Worker dry-run, byte-identical canonical/iOS OpenAPI, generated Swift
  assertions, simulator compile, the 14/14-task workspace pipeline, and
  author/reviewer/conductor PostGIS 15 semantic and deterministic-race runs
  pass on the corrected exact snapshot.
- Deployment still requires deliberate Cloudflare Images and limiter binding,
  a restricted `org-media` Storage bucket plus server-only service role, Meta
  business/oEmbed approval and token, a real club-supplied permalink staging
  pass through the conservative sanitizer, and isolated embed origin/CSP
  configuration. None is locally or publicly verified, provisioned, or
  enabled.
- The only repository-wide SQL failure remains the unchanged, unrelated Lane
  B-owned `0004_bdh_licence_checks.sql` attributed-GUID assertion.

## 12. Native Brown-only pseudonymous board — RESOLVED LOCALLY, Lane C

- Contract v1.7 and migration `0015` add an isolated operational board model
  with eleven RLS-enabled tables and owner-only routines. They do not alter an
  ingestion producer, source row, seed artifact, or manifest.
- The account link is a versioned HMAC derived only in the Worker from the
  verified Brown actor UUID and a server secret. Board rows never store actor
  UUIDs, emails, IPs, device identifiers, or the Worker pepper. Public and
  member responses never expose the token. The disclosure explicitly calls
  this pseudonymity, not cryptographic anonymity.
- All board HTTP methods are Brown-authenticated; writes are protected by a
  separate fail-closed limiter. SQL provides durable operation quotas,
  replay-safe request IDs, moderation epochs, owner authority, kill-switch
  recovery, and account-deletion fencing. After first infrastructure launch,
  board cleanup must complete before Supabase Auth Admin deletion.
- Local proof is complete on the corrected snapshot: two SQL-owner and two
  independent conductor fresh PostGIS 15 sequences each applied every
  migration `0001..0017`, passed the semantic suite, and passed the race
  harness twice. The integrated state also passes 634 API tests, 49 contract
  tests, both typechecks, contract/Worker builds, a focused repository G6
  regression, generated Swift assertions, and byte-identical canonical/iOS
  OpenAPI.
- Deployment remains deliberately closed. `BOARD_ENABLED` is checked in as
  `false`; production still requires hosted migration verification, an initial
  verified owner, a dedicated limiter binding, a newly provisioned Worker-only
  pepper, and disposable-account/moderation/quota smoke tests. No hosted system
  was changed or claimed verified.
