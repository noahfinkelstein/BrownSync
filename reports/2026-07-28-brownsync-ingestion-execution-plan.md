# BrownSync Ingestion Workstream Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Every production behavior follows a recorded RED test and a GREEN verification.

**Goal:** Build the Python 3.12 ingestion package and validated BrownSync seeds for the campus gazetteer, Fall 2026 course meetings, clubs, athletics venues, and documented dining discovery, with optional direct Postgres upserts when `DATABASE_URL` is supplied.

**Architecture:** Strict database-row models stay separate from source DTOs and ingestion-policy checks. All acquisition uses one cache-first, per-host throttled client; source adapters normalize into contract rows; outputs stage and validate before per-file atomic publication. The gazetteer and resolver are shared by CAB, clubs, and athletics.

**Tech stack:** Python 3.12, uv, httpx, BeautifulSoup 4, lxml, Pydantic v2, psycopg 3, tenacity, Typer, RapidFuzz, PyYAML, Shapely, pytest, pytest-cov.

## Global constraints and resolved ambiguities

- Edit only `ingest/**`, `db/seeds/**`, and `reports/**`.
- Never edit `apps/`, `packages/`, `services/`, `db/migrations/`, or `DATA_CONTRACT.md`.
- `DATA_CONTRACT.md` v1 wins over the ingestion handoff where they conflict.
- Tests are offline. Recorded fixtures are captured once through the production HTTP client after that client exists.
- Every request has `BrownSync/1.0 (+<contact email>)`, at least one second per host, retry/backoff, and on-disk caching. LiveWhale additionally has a ten-minute freshness gate.
- Contract models forbid unknown fields but do not add database-absent policy constraints. Slug shape, geographic coordinate bounds, confidence bounds, and CAB temporal plausibility are separate ingestion-policy validators.
- Event seed rows omit database-default `id`, `first_seen_at`, and `last_seen_at` unless a source supplies them. Deterministic ordering uses `(source, source_id)`.
- `source_runs.ndjson` is an ingestion extension required by the handoff: an atomic append/merge log with monotonically increasing integer IDs. It is not claimed as a contract §6 loader input until the app-side loader accepts it.
- Place resolution exactly matches normalized aliases first. For fuzzy acceptance, portable PostgreSQL trigram similarity `>=0.55` is authoritative. RapidFuzz `token_set_ratio` ranks candidates and is reported, but cannot veto a contract-valid trigram match.
- Python trigram behavior gets golden parity tests against PostgreSQL `similarity()` when a PostGIS/pg_trgm test database is available.
- Every place name is also present in `aliases`.
- `organizations.ndjson` stays contract-pure. LiveWhale links use versioned `db/seeds/organization_livewhale_groups.json`; app-side consumption is a declared integration dependency.
- Organization sidecar schema v1 is `{ "schema_version": 1, "generated_at": "<UTC ISO>", "mappings": [{ "organization_id": "<slug>", "livewhale_group": "<source name>", "match_method": "exact|fuzzy", "score": <0..100> }] }`.
- Athletics sidecar schema v1 is `{ "schema_version": 1, "generated_at": "<UTC ISO>", "mappings": [{ "source_name": "<SIDEARM venue>", "place_id": "<canonical slug>" }] }`.
- App-side acceptance of both sidecars is a blocking cross-workstream dependency recorded in `reports/app_side_dependencies.md`; ingestion completion does not claim the TS poller consumes them until a consumer test passes in the app lane.
- WKT is plain `MULTIPOLYGON(...)`; Postgres uses `ST_Multi(ST_GeomFromText(%s, 4326))`.
- Fixed seed files are individually atomic, not transactionally atomic as a bundle. `db/seeds/manifest.json` is published last with a generation ID and SHA-256 per artifact; the ingestion validator rejects mixed generations.
- A fault-injection test interrupts replacement after each possible artifact, proves the previous manifest remains authoritative and detects the mixed set, then proves a full rerun repairs every artifact before publishing the new manifest. App-side manifest enforcement is recorded as a blocking dependency.
- CAB publishes only after complete term/subject pagination, no unhandled subject failure, at least 50 discovered subjects, at least 2,000 meeting rows, and the section-level place-resolution gate `>=90%`. `--allow-partial` writes only to `reports/tmp/`, marks the run partial, and never replaces seeds.
- Clubs publish only after pagination completes and at least 400 distinct organizations validate. Legitimate source drift is reported and requires an explicit revised threshold, never an automatic override.
- Club name fuzzy linkage requires `token_set_ratio >=92` and a runner-up margin `>=5`.
- `default_place_id` requires at least three resolved venue observations and the winning venue must represent at least 75% of that club’s resolved observations.
- Multiple CAB instructors are source-order de-duplicated and joined with `"; "`.
- A recurring club event requires source evidence for weekday, local time, effective start date, effective end date or bounded term calendar, duration/end time, and physical venue. Otherwise no event is emitted.
- Dining discovery stops at the earlier of one wall-clock hour or a configured request budget. Contract v1 has no hours row; verified API details are documented, while only fixed dining places can be seeded.
- Parser coverage is at least 80% branch coverage for each parser module, not merely package-wide statement coverage.
- OSM-derived output and README carry ODbL/OpenStreetMap attribution and provenance.
- Postgres integration tests and `--out postgres` smoke run are mandatory when `TEST_DATABASE_URL`/`DATABASE_URL` is available; absence of credentials is reported, never treated as a successful database verification.
- `all --out postgres` is a documented hybrid: contract rows and source runs are upserted to Postgres; organization/athletics sidecars and dining notes still publish as files because contract v1 has no database target for them.
- Every job invocation is wrapped in exactly one source-run lifecycle. `run all` records one row per constituent source job, with `ok`, `partial`, or `error` finalized even when a job raises.
- Gazetteer acceptance requires fixed dining places for Ratty, Andrews Commons, V-Dub, Blue Room, Ivy Room, and Jo's, each with `kind="dining"`.
- The work is isolated on `codex/ingestion`; do not touch the app worktree.

## Dependency and ownership table

| Task | Owns | Depends on |
|---|---|---|
| 1 | contract models, policy checks, atomic NDJSON | contract |
| 2 | HTTP, checkpoints, repository, run logs | 1 |
| 3 | live evidence capture and fixture manifest | 2 |
| 4 | gazetteer catalog, aliases, geometry | 1–3 |
| 5 | resolver and report | 4 |
| 6 | CAB discovery, parser, runner, gates | 1–5 |
| 7 | clubs, category mappings, LiveWhale sidecar, bounded recurrences | 1–5 |
| 8 | athletics mapping and dining discovery | 2, 4–5 |
| 9 | CLI, bundle manifest, README, offline integration | 1–8 |
| 10 | live seeds, Postgres smoke when configured, coverage, final review | 9 |

Tasks execute sequentially because Tasks 1–5 establish shared interfaces. Tasks 6–8 have separate files but remain sequential in this shared agent session to keep every packet independently reviewed.

---

### Task 1: Contract rows, policy checks, and per-file atomic publication

**Files:** `ingest/pyproject.toml`, `ingest/.gitignore`, `ingest/brownsync_ingest/{__init__,contract,policy,output}.py`, `ingest/tests/{test_contract,test_policy,test_output}.py`.

**Produces:** strict `PlaceRow`, `OrganizationRow`, `EventRow`, `CourseMeetingRow`, `SourceRunRow`; `model_identity(row)`; `publish_ndjson(rows, model_type, destination, staging_root) -> int`.

- [ ] Write contract tests that mirror all §1 fields/defaults/nullability, fixed literals, JSON-safe raw values, UTC normalization, day-token grammar, and forbidden unknown keys.
- [ ] Run `cd ingest && uv run pytest tests/test_contract.py -q`; verify the missing implementation causes RED.
- [ ] Implement only schema-level validation. Allow omitted DB-default event/run IDs and timestamps.
- [ ] Run the same command; verify GREEN.
- [ ] Write policy tests for slug, latitude/longitude, confidence, normal CAB meeting times, and explicit exceptions; keep them separate from Pydantic schema acceptance.
- [ ] Run RED, implement `policy.py`, then run GREEN.
- [ ] Write output tests for deterministic ordering, duplicate identities, compact JSON, full validation before publication, `reports/tmp/` staging, `fsync`, `os.replace`, cleanup, and unchanged existing output after failure.
- [ ] Run RED, implement `output.py`, then run GREEN.
- [ ] Run `cd ingest && uv run pytest tests/test_contract.py tests/test_policy.py tests/test_output.py -q`.

### Task 2: HTTP etiquette, checkpoints, repository, and run lifecycle

**Files:** `common/{http,checkpoint}.py`, `repository.py`, and focused tests.

**Produces:** `CachedHttpClient`, `CheckpointStore`, `PostgresRepository`, `SourceRunRecorder`, and atomic NDJSON source-run append.

- [ ] Test required contact, exact UA, cache fingerprint, zero-call cache hits, one-second same-host spacing, independent hosts, ten-minute LiveWhale freshness, transient retry set, and permanent-error behavior with fake clock/transport.
- [ ] Implement HTTP behavior and verify focused GREEN.
- [ ] Test/implement fingerprinted atomic checkpoints.
- [ ] Test every upsert column. Events conflict on `(source, source_id)`, preserve `id`/`first_seen_at`, refresh every mutable source field and `last_seen_at`, clear cancellation on sighting, never delete, and only cancel missing rows after a complete explicit window.
- [ ] Test transaction rollback, partial-window no-cancel, full-window cancel, parameterized WKT conversion, and source-run failure recording.
- [ ] Add conditional Postgres 15 + PostGIS/pg_trgm integration tests marked `postgres`; run them when `TEST_DATABASE_URL` exists.

### Task 3: Recorded source evidence

**Files:** `ingest/fixtures/recorded/**`, `ingest/fixtures/manifest.json`, fixture integrity tests.

- [ ] Capture CAB home/bootstrap/search and at least 20 distinct detail responses, undergraduate and graduate club pages, LiveWhale groups/events, Overpass geometry, and dining landing/bundles through `CachedHttpClient`.
- [ ] Store retrieval date, route, request fingerprint, SHA-256, and expected parser facts; remove personal data and secrets.
- [ ] Add an integrity test that verifies every fixture hash/manifest entry and blocks silent synthetic substitution.
- [ ] Do not yet claim full data completeness; this task establishes parser evidence only.

### Task 4: Gazetteer catalog and geometry

**Files:** `gazetteer/{models,geometry,overpass,catalog,aliases}.py|yaml`, recorded fixture, tests.

- [ ] Move deterministic slug/collision helpers into `common/identifiers.py` here, before their first consumer.
- [ ] Test ways, open rings, relation fragment stitching, holes, multiple outers, malformed/zero-area geometry, coordinate order, WKT parsing, and centroid.
- [ ] Populate all mandated aliases, keep Barus Building distinct from Barus & Holley, enforce normalized uniqueness, and include verified inventory sufficient for at least 120 places.
- [ ] Require canonical dining entries for Ratty, Andrews Commons, V-Dub, Blue Room, Ivy Room, and Jo's with `kind="dining"`.
- [ ] Merge curated identity/kind with OSM geometry/address/provenance; emit `polygon=None` plus diagnostic when geometry is invalid.
- [ ] Verify at least 120 valid rows and OSM attribution/provenance.

### Task 5: Resolver and place-resolution report

**Files:** `gazetteer/{resolver,report}.py` and tests.

- [ ] Test exact normalization, longest alias, room extraction, address no-strip cases, pg_trgm parity vectors, threshold boundary, ambiguity, raw preservation, and Barus distinction.
- [ ] Implement exact alias then trigram acceptance; RapidFuzz ranks/reports only.
- [ ] Report hit rate by source, method/reason counts, top unresolved values, section- and pattern-level CAB rates, and explicit gate result.
- [ ] Run conditional PostgreSQL similarity parity tests when configured.

### Task 6: CAB Fall 2026

**Files:** `cab/{models,discovery,client,meeting_parser,job}.py`, 20+ fixtures, parser/job tests.

- [ ] Test select/bootstrap term discovery, disagreement/missing/duplicates, subject discovery, exact §5 payloads, pagination, and `(srcdb, crn)` dedupe.
- [ ] Test at least 20 real captured meeting variants across DOM/day/time/location/section/noise cases.
- [ ] Parse arranged/async/online as structured skips; join instructors with `"; "`.
- [ ] Implement deterministic details order, per-detail checkpoints, resume equivalence, `{srcdb}-{crn}-{idx}` IDs, raw retention, completeness minima, and the CRN-level 90% gate.
- [ ] Never publish partial output.

### Task 7: Clubs and LiveWhale linkage

**Files:** `ingest/mappings/{__init__,categories}.py`, `clubs/{models,parser,livewhale,recurrences,job}.py`, tests, versioned sidecar, `reports/app_side_dependencies.md`.

- [ ] Test Drupal/GSC pagination, cycles, dedupe, stable slug collisions, links, category mapping, and 400-row completeness gate.
- [ ] Test exact/fuzzy/ambiguous/no group linkage with threshold 92 and margin 5.
- [ ] Test the exact versioned organization mapping element schema and record app-side consumer acceptance as blocking until its cross-workstream test exists.
- [ ] Test that recurrence emission requires all temporal evidence, handles DST and expiration, and never turns vague prose into events.
- [ ] Test default venue minimum three observations and 75% share.

### Task 8: Athletics and dining

**Files:** `athletics_venues.py`, `dining/{discover,job,NOTES}.py|md`, tests, versioned athletics sidecar.

- [ ] Map required SIDEARM variants, test the exact versioned athletics mapping element schema, and verify every canonical ID exists.
- [ ] Test landing/script discovery, API/GraphQL candidates, false positives, one-hour/request-budget stop, and no-endpoint result.
- [ ] If an endpoint is proven, document request/response evidence. Do not publish unsupported dining-hours rows under contract v1.

### Task 9: CLI, publication manifest, README, and offline integration

**Files:** `cli.py`, `README.md`, CLI/integration tests, `db/seeds/manifest.json`.

- [ ] Implement `ingest run <job> --out ndjson|postgres`, contact/env handling, dependency-injected registry, loud discovered `srcdb`, ordered `all`, and fail-closed exits.
- [ ] Define `all --out postgres` as the documented hybrid: upsert contract rows/source runs while still publishing sidecars and dining notes; reject any other unsupported output combination.
- [ ] Assert exactly one finalized source-run record per invoked job in success, partial, and exception paths; `all` produces one lifecycle per constituent job.
- [ ] Stage/validate all job artifacts, replace each file, then publish manifest last with generation ID and hashes. Fault-inject every replacement boundary, detect mixed generations against the old manifest, and verify a rerun recovers before manifest advancement.
- [ ] Run all jobs against fixtures; validate rows, uniqueness, foreign keys, sidecar schemas, minima, WKT, and no staged leftovers.
- [ ] Document runtime, reruns, cache/checkpoints, thresholds, source-run extension, sidecar consumer dependency, OSM attribution, dining limit, and Postgres prerequisites.

### Task 10: Live outputs, coverage, Postgres smoke, and adversarial review

**Files:** recorded fixtures, `gazetteer/aliases.yaml`, `db/seeds/**`, `reports/place_resolution.md`, `ingest/dining/NOTES.md`.

- [ ] Run live gazetteer/CAB/clubs/dining acquisition through the production client; grow aliases only from unresolved evidence.
- [ ] Run `cd ingest && uv run ingest run all --out ndjson`; require all completeness and resolution gates.
- [ ] Run per-parser branch coverage at least 80%, plus full offline suite.
- [ ] If `DATABASE_URL` exists, run the Postgres-marked integration suite and `ingest run all --out postgres`; otherwise record database verification as pending credentials.
- [ ] Independently validate every seed, WKT, hash, sidecar, identity, and foreign key.
- [ ] Run task-scoped and final adversarial reviews; fix all critical/important findings and rerun covering plus full tests.
