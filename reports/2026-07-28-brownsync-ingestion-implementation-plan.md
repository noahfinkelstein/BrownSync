# BrownSync Ingestion Workstream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Python 3.12 ingestion package that emits validated BrownSync gazetteer, Fall 2026 course-meeting, club, athletics-venue, and best-effort dining data as NDJSON or Postgres upserts.

**Architecture:** Source adapters fetch through one cache-first, rate-limited HTTP client and convert source-specific DTOs into strict Pydantic contract rows. Jobs stage and validate complete outputs before atomically publishing seeds, share one place resolver, and record every run. Tests exercise parsers only against checked-in recorded fixtures.

**Tech Stack:** Python 3.12, uv, httpx, BeautifulSoup 4, lxml, Pydantic v2, psycopg 3, tenacity, Typer, RapidFuzz, PyYAML, Shapely, pytest, pytest-cov.

## Global Constraints

- Edit only `ingest/**`, `db/seeds/**`, and `reports/**`; never edit `apps/`, `packages/`, `services/`, `db/migrations/`, or `DATA_CONTRACT.md`.
- `DATA_CONTRACT.md` v1 is authoritative for row fields, upsert behavior, category values, and NDJSON shape.
- Python is exactly `>=3.12,<3.13`, managed by uv.
- Every outbound request uses `BrownSync/1.0 (+<contact email>)`, waits at least one second since the previous request to the same host, retries transient failures with exponential backoff, and caches successful responses on disk.
- Offline tests never reach the network; recorded source fixtures and explicit fake transports are the only parser inputs.
- Seed files are written to `reports/tmp/`, validated in full, and atomically moved to `db/seeds/`; an invalid or partial run never replaces a published seed.
- Every job emits or updates one `source_runs` record, including failures and partial runs.
- Exact place aliases are case-, punctuation-, Unicode-, and `&`/`and`-normalized. A fuzzy match is accepted only when both pg_trgm-style similarity is `>=0.55` and RapidFuzz `token_set_ratio` is `>=88`; ties and near-ties remain unresolved.
- Every canonical place name is repeated in its alias array so contract §2 exact-alias matching includes names.
- `organizations.ndjson` contains only contract fields. Because contract v1 has no organization `raw` column, LiveWhale links are emitted separately to `db/seeds/organization_livewhale_groups.json`.
- Place polygons use plain `MULTIPOLYGON(...)` WKT in NDJSON and `ST_Multi(ST_GeomFromText(%s, 4326))` in Postgres.
- The CAB resolution gate denominator is unique `(srcdb, crn)` sections with at least one parseable physical location; a section passes only if every parseable physical meeting pattern resolves. The gate is `>=90%`.
- No club meeting, default venue, course time, or source fact is fabricated.
- The current checkout is the concurrent app owner's `feat/phase-0-foundation` branch with app-side files in flight. Workers do not switch branches, stage, or commit while that owner is active; each report lists exactly which lane-owned files it changed.

## File Structure

```text
ingest/
  .gitignore                         # .venv, .cache, .env, coverage artifacts
  pyproject.toml
  uv.lock
  README.md
  brownsync_ingest/
    __init__.py
    cli.py                           # Typer `ingest run`
    contract.py                      # strict contract rows and codecs
    output.py                        # atomic NDJSON publishing
    repository.py                    # Postgres upserts and source-run lifecycle
    common/
      __init__.py
      http.py                        # cache/rate/retry/user-agent boundary
      checkpoint.py                  # atomic resumable job state
      identifiers.py                 # deterministic slugs and collision suffixes
      category_map.py                # source categories -> contract taxonomy
    gazetteer/
      __init__.py
      aliases.yaml                   # canonical Brown place registry
      models.py
      geometry.py
      overpass.py
      catalog.py
      resolver.py
      report.py
      job.py
    cab/
      __init__.py
      models.py
      discovery.py
      client.py
      meeting_parser.py
      job.py
    clubs/
      __init__.py
      models.py
      parser.py
      livewhale.py
      recurrences.py
      job.py
    athletics_venues.py
    dining/
      __init__.py
      discover.py
      job.py
      NOTES.md
  fixtures/
    recorded/
      cab/
      clubs/
      gazetteer/
      dining/
  tests/
    conftest.py
    test_contract.py
    test_output.py
    test_repository.py
    common/
    gazetteer/
    cab/
    clubs/
    test_athletics_venues.py
    dining/
    test_cli.py
db/seeds/
  places.ndjson
  organizations.ndjson
  organization_livewhale_groups.json
  course_meetings.ndjson
  events.ndjson
  source_runs.ndjson
  athletics_venues.json
reports/
  2026-07-28-brownsync-ingestion-implementation-plan.md
  place_resolution.md
  tmp/
```

---

### Task 1: Strict contract rows and atomic seed publication

**Files:**
- Create: `ingest/pyproject.toml`
- Create: `ingest/.gitignore`
- Create: `ingest/brownsync_ingest/__init__.py`
- Create: `ingest/brownsync_ingest/contract.py`
- Create: `ingest/brownsync_ingest/output.py`
- Create: `ingest/tests/test_contract.py`
- Create: `ingest/tests/test_output.py`

**Interfaces:**
- Produces: `PlaceRow`, `OrganizationRow`, `EventRow`, `CourseMeetingRow`, and `SourceRunRow`, all with `extra="forbid"`.
- Produces: `publish_ndjson(rows, model_type, destination, staging_root) -> int`.
- Consumes: Only `DATA_CONTRACT.md` v1.

- [ ] **Step 1: Write contract validation tests**

  Cover every required/default/nullable field, forbidden unknown fields, exact category and kind literals, UTC event datetimes, canonical course-day grammar (`M,T,W,Th,F,S,Su` concatenated in order), `start_time < end_time`, confidence range `0..1`, coordinate ranges, slug IDs, and JSON serialization of `time`, `datetime`, UUID, and raw payload values.

- [ ] **Step 2: Run the tests and verify RED**

  Run: `cd ingest && uv run pytest tests/test_contract.py -q`

  Expected: import failure because `brownsync_ingest.contract` does not exist.

- [ ] **Step 3: Implement strict Pydantic models**

  Use shared `ContractModel` configuration with `extra="forbid"`, frozen default factories for lists, UTC normalization validators, and explicit day-token parsing that consumes `Th` and `Su` before one-character tokens.

- [ ] **Step 4: Verify contract tests GREEN**

  Run: `cd ingest && uv run pytest tests/test_contract.py -q`

  Expected: all contract tests pass with no warnings.

- [ ] **Step 5: Write atomic publication tests**

  Prove that valid rows replace a destination byte-for-byte deterministically, duplicate primary/natural keys fail before publication, invalid rows leave an existing seed unchanged, and no staging artifact remains after either success or failure.

- [ ] **Step 6: Run publication tests and verify RED**

  Run: `cd ingest && uv run pytest tests/test_output.py -q`

  Expected: import failure because `brownsync_ingest.output` does not exist.

- [ ] **Step 7: Implement validate-then-publish**

  Materialize and validate the whole row set, sort by deterministic key, write UTF-8 NDJSON with one compact JSON object per line under `reports/tmp/`, flush and `fsync`, then use `os.replace`. Reject duplicate `id` keys and duplicate event `(source, source_id)` keys.

- [ ] **Step 8: Verify Task 1**

  Run: `cd ingest && uv run pytest tests/test_contract.py tests/test_output.py -q`

  Expected: all tests pass offline.

### Task 2: HTTP etiquette, checkpoints, Postgres upserts, and run records

**Files:**
- Create: `ingest/brownsync_ingest/common/__init__.py`
- Create: `ingest/brownsync_ingest/common/http.py`
- Create: `ingest/brownsync_ingest/common/checkpoint.py`
- Create: `ingest/brownsync_ingest/repository.py`
- Create: `ingest/tests/common/test_http.py`
- Create: `ingest/tests/common/test_checkpoint.py`
- Create: `ingest/tests/test_repository.py`

**Interfaces:**
- Consumes: Task 1 contract rows.
- Produces: `CachedHttpClient(contact_email, cache_dir, transport=None, clock=..., sleeper=...)`.
- Produces: `CheckpointStore.load/save/clear(job, fingerprint)`.
- Produces: `PostgresRepository` upserts for all five contract tables and `SourceRunRecorder`.

- [ ] **Step 1: Write HTTP behavior tests**

  A fake transport and fake clock must prove: required contact email; exact UA shape; cache key includes method, URL, body, and relevant headers; cache hits make zero transport calls; two uncached same-host requests are at least one second apart; different hosts do not block each other; `429`, `500`, `502`, `503`, and `504` retry; permanent `4xx` responses do not retry.

- [ ] **Step 2: Verify HTTP tests RED**

  Run: `cd ingest && uv run pytest tests/common/test_http.py -q`

  Expected: missing module failure.

- [ ] **Step 3: Implement cache-first HTTP**

  Store response status, selected headers, content type, body bytes, retrieval timestamp, and request fingerprint in JSON metadata plus a body file. Use tenacity for bounded exponential retries and a per-host monotonic timestamp protected by a lock.

- [ ] **Step 4: Verify HTTP tests GREEN**

  Run: `cd ingest && uv run pytest tests/common/test_http.py -q`

  Expected: all tests pass without sleeping in real time.

- [ ] **Step 5: Test and implement atomic checkpoints**

  Checkpoint data includes job, source fingerprint, phase, cursor, counters, and temporary output path. A fingerprint mismatch returns no resumable state. Save through a sibling temporary file and `os.replace`.

  Run RED then GREEN: `cd ingest && uv run pytest tests/common/test_checkpoint.py -q`

- [ ] **Step 6: Write repository SQL contract tests**

  Use a recording fake connection to assert parameterized SQL: events conflict on `(source, source_id)` while preserving `id` and `first_seen_at`, refreshing `last_seen_at`, and clearing cancellation on a sighting; other rows conflict on `id`; places convert WKT with SRID 4326; source runs begin `partial` and end `ok`, `partial`, or `error`.

- [ ] **Step 7: Implement Postgres repository and source-run recorder**

  Keep SQL static and values parameterized. Missing-event cancellation accepts an explicit complete coverage window and seen source IDs and refuses to run for partial fetches.

- [ ] **Step 8: Verify Task 2**

  Run: `cd ingest && uv run pytest tests/common tests/test_repository.py -q`

  Expected: all tests pass offline.

### Task 3: Gazetteer geometry, alias registry, and place catalog

**Files:**
- Create: `ingest/brownsync_ingest/gazetteer/__init__.py`
- Create: `ingest/brownsync_ingest/gazetteer/models.py`
- Create: `ingest/brownsync_ingest/gazetteer/geometry.py`
- Create: `ingest/brownsync_ingest/gazetteer/overpass.py`
- Create: `ingest/brownsync_ingest/gazetteer/catalog.py`
- Create: `ingest/brownsync_ingest/gazetteer/aliases.yaml`
- Create: `ingest/fixtures/recorded/gazetteer/overpass_sample.json`
- Create: `ingest/tests/gazetteer/test_geometry.py`
- Create: `ingest/tests/gazetteer/test_catalog.py`

**Interfaces:**
- Consumes: Task 1 `PlaceRow`; Task 2 `CachedHttpClient`.
- Produces: `parse_overpass(payload) -> list[PlaceCandidate]`.
- Produces: `build_place_catalog(candidates, alias_specs) -> list[PlaceRow]`.
- Produces: canonical place IDs used by all later tasks.

- [ ] **Step 1: Write geometry tests**

  Recorded/small fixtures cover a closed way, open way, relation with one hole, relation with two outer polygons, fragment stitching, malformed members, zero-area rings, `lng lat` coordinate order, WKT parseability, and area-weighted centroid.

- [ ] **Step 2: Verify geometry tests RED**

  Run: `cd ingest && uv run pytest tests/gazetteer/test_geometry.py -q`

  Expected: missing module failure.

- [ ] **Step 3: Implement geometry conversion**

  Use Shapely to stitch/polygonize relation member lines, preserve holes, validate/repair with `make_valid`, emit only `MultiPolygon`, and fall back to `polygon=None` with a diagnostic if valid geometry cannot be produced.

- [ ] **Step 4: Verify geometry tests GREEN**

  Run: `cd ingest && uv run pytest tests/gazetteer/test_geometry.py -q`

- [ ] **Step 5: Write catalog and alias-registry tests**

  Require every canonical name in aliases, normalized alias uniqueness, the complete mandated vocabulary, distinct `barus-building` and `barus-holley`, fixed kind literals, stable `way/<id>` or `relation/<id>` provenance, OSM/manual merge behavior, valid coordinates, and at least 120 rows in the complete curated-plus-recorded catalog fixture.

- [ ] **Step 6: Populate the canonical registry**

  Add the mandated aliases plus a deliberate Brown inventory spanning academic, residence, dining, athletic, library, admin, outdoor, and off-campus sites. Registry entries may supply verified manual coordinates for non-building places and OSM matching hints for catalog enrichment.

- [ ] **Step 7: Implement Overpass parsing and catalog merging**

  Use the exact contract bbox/query. Prefer curated identity/kind/name, enrich it from OSM geometry/address/ID, include named Brown-relevant OSM buildings not yet curated with deterministic slugs, and report slug or alias collisions instead of silently overwriting.

- [ ] **Step 8: Verify Task 3**

  Run: `cd ingest && uv run pytest tests/gazetteer/test_geometry.py tests/gazetteer/test_catalog.py -q`

  Expected: all tests pass and the test catalog contains at least 120 valid places.

### Task 4: Shared place resolver and resolution report

**Files:**
- Create: `ingest/brownsync_ingest/gazetteer/resolver.py`
- Create: `ingest/brownsync_ingest/gazetteer/report.py`
- Create: `ingest/tests/gazetteer/test_resolver.py`
- Create: `ingest/tests/gazetteer/test_report.py`

**Interfaces:**
- Consumes: Task 3 place catalog.
- Produces: `PlaceResolver.resolve(raw_location, source) -> ResolutionResult`.
- Produces: `write_resolution_report(results, destination) -> ResolutionSummary`.

- [ ] **Step 1: Write resolver tests**

  Cover Unicode/case/punctuation/ampersand normalization, longest-alias matching, exact canonical names, room suffix and `Room 101, Building` forms, alphanumeric rooms, the no-strip address cases `85 Waterman`, `164 Angell`, `170 Hope`, and `225 Dyer`, both fuzzy thresholds at/around their boundaries, ambiguity margin, raw-text preservation, and the Barus distinction.

- [ ] **Step 2: Verify resolver tests RED**

  Run: `cd ingest && uv run pytest tests/gazetteer/test_resolver.py -q`

- [ ] **Step 3: Implement structured resolution**

  Return the original input, place ID, room, method (`exact_alias`, `fuzzy`, `unresolved`), RapidFuzz score, portable pg_trgm score, runner-up, and reason. Search known aliases before stripping a trailing room token. Reject any fuzzy tie/near-tie rather than guessing.

- [ ] **Step 4: Verify resolver tests GREEN**

  Run: `cd ingest && uv run pytest tests/gazetteer/test_resolver.py -q`

- [ ] **Step 5: Write report tests**

  A deterministic golden example asserts per-source hit rates; exact/fuzzy/unresolved/ambiguous counts; top unresolved values ordered by frequency then name; per-pattern CAB rate; section-level CAB denominator/numerator; and explicit gate PASS/FAIL.

- [ ] **Step 6: Implement Markdown report**

  Write `reports/place_resolution.md` atomically. Never lower thresholds to pass the gate; aliases grow from evidence.

- [ ] **Step 7: Verify Task 4**

  Run: `cd ingest && uv run pytest tests/gazetteer/test_resolver.py tests/gazetteer/test_report.py -q`

### Task 5: Fall 2026 CAB discovery and meeting parser

**Files:**
- Create: `ingest/brownsync_ingest/cab/__init__.py`
- Create: `ingest/brownsync_ingest/cab/models.py`
- Create: `ingest/brownsync_ingest/cab/discovery.py`
- Create: `ingest/brownsync_ingest/cab/client.py`
- Create: `ingest/brownsync_ingest/cab/meeting_parser.py`
- Create: `ingest/fixtures/recorded/cab/manifest.json`
- Create: at least 20 `ingest/fixtures/recorded/cab/details/*.json` files
- Create: `ingest/tests/cab/test_discovery.py`
- Create: `ingest/tests/cab/test_client.py`
- Create: `ingest/tests/cab/test_meeting_parser.py`

**Interfaces:**
- Consumes: Task 2 HTTP client; Task 4 resolver.
- Produces: `discover_term(home_html, target_label="Fall 2026") -> Term`.
- Produces: `discover_subjects(home_html, bootstrap_payload=None) -> list[str]`.
- Produces: `parse_meetings(html) -> list[ParsedMeeting]`.
- Produces: `parse_instructors(html) -> list[str]`.

- [ ] **Step 1: Record and sanitize CAB fixtures**

  Capture the actual Fall 2026 home/bootstrap/search/detail responses through the compliant cached client. The manifest records source route, retrieval date, CRN, and literal expected meeting patterns without student data or secrets.

- [ ] **Step 2: Write term/subject discovery tests**

  Cover select-only, bootstrap-only, both-agree, disagreement, missing, duplicate candidates, whitespace normalization, and deterministic subject sorting. The chosen `srcdb` is read from source content and never hardcoded.

- [ ] **Step 3: Implement and verify discovery**

  Run RED then GREEN: `cd ingest && uv run pytest tests/cab/test_discovery.py -q`

- [ ] **Step 4: Write CAB request/pagination tests**

  Assert the contract §5 search/details payloads exactly, page termination, section dedupe by `(srcdb, crn)`, deterministic order, and partial-subject error reporting.

- [ ] **Step 5: Implement and verify CAB client**

  Run RED then GREEN: `cd ingest && uv run pytest tests/cab/test_client.py -q`

- [ ] **Step 6: Write the 20-plus-variant parser matrix**

  Recorded variants cover table/list/div/`br` layouts; `MWF`, spaced/word days, `TTh`, `TuTh`, weekend and TBA; 12-hour/compact/en-dash/hyphen/24-hour times; numeric/alphanumeric/remote/missing locations; one/multiple/split patterns; multiple instructors; cancellation placeholders; and non-breaking-space noise.

- [ ] **Step 7: Implement DOM-first meeting and instructor parsers**

  `ParsedMeeting` retains `days`, `start_time`, `end_time`, `location_raw`, and `raw_text`. Arranged/TBA/online/asynchronous rows return structured skip reasons and never become contract rows.

- [ ] **Step 8: Verify Task 5**

  Run: `cd ingest && uv run pytest tests/cab -q`

  Expected: every manifest fixture passes and no test reaches the network.

### Task 6: Resumable CAB job and 90% resolution gate

**Files:**
- Create: `ingest/brownsync_ingest/cab/job.py`
- Create: `ingest/tests/cab/test_job.py`
- Create: `ingest/tests/cab/test_resolution_gate.py`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: `run_cab(context, target_term) -> JobResult[CourseMeetingRow]`.

- [ ] **Step 1: Write row-shaping tests**

  Assert IDs are exactly `{srcdb}-{crn}-{idx}`, multiple patterns yield multiple rows, day/time/location/room/instructor fields are correct, `location_raw` is always retained, incomplete patterns are counted but skipped, and the full sanitized detail record is retained in `raw`.

- [ ] **Step 2: Write interruption/resume test**

  Interrupt a fixture run after a deterministic number of details, resume from the checkpoint, and assert byte-for-byte identical, duplicate-free output compared with an uninterrupted run.

- [ ] **Step 3: Write resolution-gate tests**

  Prove CRN-level counting for single/multiple meeting patterns, exclude nonphysical/arranged patterns from the denominator, fail at `89.999%`, and pass at `90%`.

- [ ] **Step 4: Implement CAB orchestration**

  Discover and log the actual term code, enumerate/search subjects, fetch details in deterministic order, checkpoint after each detail, resolve every physical location, publish only after a complete valid run, and leave published seed untouched when the gate fails.

- [ ] **Step 5: Verify Task 6**

  Run: `cd ingest && uv run pytest tests/cab/test_job.py tests/cab/test_resolution_gate.py -q`

### Task 7: Club directory, LiveWhale linkage, and evidence-only recurrences

**Files:**
- Create: `ingest/brownsync_ingest/common/identifiers.py`
- Create: `ingest/brownsync_ingest/common/category_map.py`
- Create: `ingest/brownsync_ingest/clubs/__init__.py`
- Create: `ingest/brownsync_ingest/clubs/models.py`
- Create: `ingest/brownsync_ingest/clubs/parser.py`
- Create: `ingest/brownsync_ingest/clubs/livewhale.py`
- Create: `ingest/brownsync_ingest/clubs/recurrences.py`
- Create: `ingest/brownsync_ingest/clubs/job.py`
- Create: recorded fixtures under `ingest/fixtures/recorded/clubs/`
- Create: tests under `ingest/tests/clubs/`

**Interfaces:**
- Consumes: Tasks 1, 2, and 4.
- Produces: contract-pure `OrganizationRow` values.
- Produces: optional evidence-backed `EventRow` values.
- Produces: `dict[organization_id, livewhale_group]` sidecar mapping.

- [ ] **Step 1: Write directory parser tests**

  Cover Drupal pagination via real next links, cycle detection, undergrad and graduate layouts, missing optional values, deduplication, source-stable slugs, collision suffixes derived from source URL, email/site/Instagram extraction, and exact taxonomy output or `None` for unknown categories.

- [ ] **Step 2: Implement and verify directory parsing**

  Run RED then GREEN: `cd ingest && uv run pytest tests/clubs/test_parser.py tests/clubs/test_categories.py -q`

- [ ] **Step 3: Write LiveWhale matcher tests**

  Test normalized exact, conservative fuzzy, required ambiguity margin, no match, and deterministic sidecar JSON. Organization rows must reject a `raw` key.

- [ ] **Step 4: Implement and verify group matching**

  Run RED then GREEN: `cd ingest && uv run pytest tests/clubs/test_livewhale.py -q`

- [ ] **Step 5: Write recurrence evidence tests**

  Explicit weekday + time + physical venue on a club-owned page produces a stable club event with New York local time converted to UTC, `RRULE`, `category="club"`, and `confidence=0.7`. Vague “meets weekly,” directory prose, missing time, or unresolved venue produces no event.

- [ ] **Step 6: Implement and verify recurrences**

  Run RED then GREEN: `cd ingest && uv run pytest tests/clubs/test_recurrences.py -q`

- [ ] **Step 7: Implement club job and verify complete fixture run**

  Publish organizations, optional events, and the LiveWhale sidecar only after the full paginated fetch is valid. Set `default_place_id` only from repeated resolved, club-specific evidence.

  Run: `cd ingest && uv run pytest tests/clubs -q`

### Task 8: Athletics venue mapping and dining discovery

**Files:**
- Create: `ingest/brownsync_ingest/athletics_venues.py`
- Create: `ingest/tests/test_athletics_venues.py`
- Create: `ingest/brownsync_ingest/dining/__init__.py`
- Create: `ingest/brownsync_ingest/dining/discover.py`
- Create: `ingest/brownsync_ingest/dining/job.py`
- Create: `ingest/brownsync_ingest/dining/NOTES.md`
- Create: recorded fixtures under `ingest/fixtures/recorded/dining/`
- Create: tests under `ingest/tests/dining/`

**Interfaces:**
- Consumes: Task 3 canonical place IDs and Task 2 HTTP client.
- Produces: `db/seeds/athletics_venues.json`.
- Produces: structured dining endpoint candidates and six fixed dining-place verifications.

- [ ] **Step 1: Write athletics mapping tests**

  Require Brown Stadium, Meehan Auditorium, Pizzitola Sports Center, OMAC/Olney-Margolies Athletic Center, Stevenson-Pincince Field, Marston Boathouse, and common SIDEARM variants. Every mapped ID must exist in the place catalog.

- [ ] **Step 2: Implement and verify athletics mapping**

  Run RED then GREEN: `cd ingest && uv run pytest tests/test_athletics_venues.py -q`

- [ ] **Step 3: Write dining bundle-discovery tests**

  Recorded HTML/JS fixtures cover same-origin asset discovery, absolute/relative API strings, `fetch`, Axios/XHR, GraphQL candidates, deduplication, false-positive filtering, and no-candidate output.

- [ ] **Step 4: Implement bounded dining discovery**

  Fetch the landing page and same-origin scripts through the compliant client, rank candidates, and render `NOTES.md` with URL, method, evidence, expected request/response shape, and confidence. If no endpoint is proven, say so explicitly and seed no hours.

- [ ] **Step 5: Verify Task 8**

  Run: `cd ingest && uv run pytest tests/test_athletics_venues.py tests/dining -q`

### Task 9: CLI, all-jobs orchestration, README, and integration validation

**Files:**
- Create: `ingest/brownsync_ingest/cli.py`
- Create: `ingest/README.md`
- Create: `ingest/tests/test_cli.py`
- Create: `ingest/tests/test_integration_offline.py`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces: `ingest run <gazetteer|cab|clubs|athletics|dining|all> --out <ndjson|postgres>`.

- [ ] **Step 1: Write CLI tests**

  Assert valid jobs/output modes, required contact email for networked jobs, `DATABASE_URL` requirement for Postgres, term default `Fall 2026`, loud `srcdb` output, deterministic job order (`gazetteer`, `cab`, `clubs`, `athletics`, `dining`), nonzero exit on gate/validation failure, and source-run completion on exceptions.

- [ ] **Step 2: Implement Typer CLI and dependency-injected job registry**

  `--contact-email` overrides `BROWNSYNC_CONTACT_EMAIL`; no email is written to seeds or cache metadata. `--cache-dir` defaults to `ingest/.cache`.

- [ ] **Step 3: Write offline integration test**

  Run all jobs against recorded fixtures and a temporary seed root. Validate every line with its contract model; validate every foreign key against emitted IDs; validate sidecar and athletics mappings; require at least 120 places and at least 90% fixture CAB resolution.

- [ ] **Step 4: Document operations**

  README covers setup, UA/contact config, each job, endpoint, cache/checkpoint behavior, runtime, next-term `srcdb` discovery, fixture recording, NDJSON/Postgres modes, resolution-gate repair, dining timebox, and the v1 organization-link sidecar limitation.

- [ ] **Step 5: Verify Task 9**

  Run: `cd ingest && uv run pytest tests/test_cli.py tests/test_integration_offline.py -q`

### Task 10: Live fixture capture, seed generation, coverage, and final review

**Files:**
- Modify only recorded fixtures, `db/seeds/**`, `reports/place_resolution.md`, and `ingest/dining/NOTES.md` based on source evidence.

**Interfaces:**
- Consumes: Complete package and a user-controlled contact email.
- Produces: final published seeds and verification evidence.

- [ ] **Step 1: Capture source evidence through the production client**

  Set `BROWNSYNC_CONTACT_EMAIL` from the user-controlled local configuration, record retrieval dates/provenance, and never bypass cache/rate/retry behavior.

- [ ] **Step 2: Run targeted live jobs to grow aliases**

  Run gazetteer, a CAB discovery/search sample, clubs, LiveWhale linking, athletics, and dining discovery. Review unresolved CAB strings, add only evidence-backed aliases, and repeat without lowering thresholds.

- [ ] **Step 3: Run the complete NDJSON workflow**

  Run: `cd ingest && uv run ingest run all --out ndjson`

  Expected: exit 0, valid atomic seeds, at least 120 places, the full reachable club directory, Fall 2026 meetings, athletics mappings, source-run records, and a CAB resolution gate of at least 90%.

- [ ] **Step 4: Run the full offline suite and coverage**

  Run: `cd ingest && uv run pytest --cov=brownsync_ingest --cov-report=term-missing --cov-fail-under=80`

  Expected: zero failures, no network, and at least 80% total coverage with at least 80% coverage for CAB parser modules.

- [ ] **Step 5: Validate every published artifact independently**

  Re-read each NDJSON file with the strict model, assert uniqueness and foreign keys, parse every WKT polygon, confirm all athletics/default place IDs exist, and check no staged temporary files remain.

- [ ] **Step 6: Run a final adversarial review**

  Review contract compliance, request etiquette, parser evidence, cancellation/upsert safety, no-fabrication rules, lane ownership, and all Definition-of-Done gates. Address every critical or important finding, re-run its covering tests, then re-run the full suite.
