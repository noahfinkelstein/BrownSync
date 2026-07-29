# Task 8 brief: athletics venue mapping + dining discovery (adapted)

## Situation

The plan's Task 8 covers two sources whose feasibility diverged after the
Task 3 capture round and the 2026-07-29 athletics probe
(`reports/sdd/brownsync-ingestion/athletics-probe.md`):

- **Athletics: REACHABLE.** `https://brownbears.com/calendar.ashx/calendar.ics`
  answers 200 with 170 VEVENTs to the exact declared UA
  `BrownSync/1.0 (+noah_finkelstein@brown.edu)`; robots.txt allows the path
  and asks `Crawl-delay: 30`; the feed advertises `X-PUBLISHED-TTL:PT120M`.
  Home-game LOCATION lines carry the venue after the city (e.g.
  `Providence\, R.I., Stevenson-Pincince Field`), which is richer than the
  contract's "city-level only" caveat.
- **Dining: BLOCKED.** `dining.brown.edu` answers a Pantheon-edge 403 to the
  declared UA (Task 3 manifest gaps `dining_landing` / `dining_bundle`).
  Evading the block is forbidden, so **no discovery requests run in this
  task** — the plan's landing/script/API/GraphQL discovery bullets are
  replaced by documentation of the block and of what the user must provide.
  Contract v1 has no dining-hours row anyway, and the six fixed dining
  places are already seeded in `db/seeds/places.ndjson` (Task 6B).

## Scope

1. **Capture (Step 1).** Exactly ONE live fetch of the athletics ICS through
   `CachedHttpClient` (declared UA, per-host throttling; a single request
   trivially satisfies the 30s crawl delay). Extend the Task 3 harness
   (`fixtures_capture.py`) with an `athletics` group and a `--groups`
   selector that merges new entries into the existing
   `ingest/fixtures/manifest.json` instead of discarding the other groups'
   evidence. Record route, request fingerprint, sha256, retrieval date, and
   expected parser facts. The harness email scrubber runs as always; the
   body is public schedule data but is checked for personal data anyway.
2. **Athletics venue mapping (Step 2, TDD).** New
   `brownsync_ingest/athletics_venues.py`:
   - unfold the ICS, extract distinct `LOCATION` values;
   - a **tested classification rule**: a location is a home-venue candidate
     iff its city prefix normalizes to `Providence, R.I.`; away-city and
     city-only locations are explicitly excluded with machine-readable
     reasons (`away-city`, `city-only`), never silently dropped;
   - map every home-venue SIDEARM variant observed in the recorded feed,
     plus the contract §5 required variants (Brown Stadium, Meehan
     Auditorium, Pizzitola, OMAC, Stevenson-Pincince), to canonical
     gazetteer place ids; an unmapped home venue fails the job closed;
   - emit versioned `db/seeds/athletics_venues.json` exactly per plan
     schema v1:
     `{"schema_version":1,"generated_at":"<UTC ISO>","mappings":[{"source_name":"<SIDEARM venue>","place_id":"<canonical slug>"}]}`;
     the element schema is tested exactly and every `place_id` must exist in
     the catalog;
   - publication is atomic (staging + `os.replace`), consistent with
     `output.py` discipline.
3. **Gazetteer additions (Step 2).** Missing athletics venues join
   `aliases.yaml` ONLY with Overpass-fixture footprints or curated-confidence
   coordinates grounded in OSM — never fabricated. If `places.ndjson` gains
   rows, republish it via the tested places job (atomic) and note the
   regeneration.
4. **Dining (Step 3).** Write `ingest/dining/NOTES.md`: the 403 evidence
   (task-3 manifest gaps), that no discovery ran and why, what the user must
   provide (OIT allowlist for the declared UA or exported pages), and that
   contract v1 has no hours rows while the six fixed dining places are
   already seeded. Record the app-side/user dependency in
   `reports/app_side_dependencies.md` (also carrying the plan-mandated
   athletics-sidecar consumer dependency).

## Explicitly out of scope

- Any request to `dining.brown.edu` (blocked; evasion forbidden).
- Emitting athletics **event** rows (`source="athletics_ics"` events are the
  poller's job in the app lane; this task ships the venue mapping sidecar
  the poller needs).
- CLI wiring and `db/seeds/manifest.json` bundling (Task 9).

## Acceptance

- One and only one live athletics request; fixture + manifest entry pass the
  Task 3 integrity gate (extended with `athletics_ics` minimum).
- `cd ingest && uv run pytest -q` fully green (baseline 559 passed +
  34 skipped, plus new tests; RED before GREEN for each new behavior).
- Sidecar validates: exact schema v1 elements, all place ids exist,
  away/city-only exclusions asserted by test.
- Task-8 report with RED/GREEN evidence and the venue inventory;
  progress.md ledger updated; ONE conventional commit staging explicit
  paths; no push.
