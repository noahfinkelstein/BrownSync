# Events bootstrap report (post-task-9 extension)

Ran after both concurrent rounds (orgs/task 7 commit `814bfcd`, enrichment
commit `f943c61`). Brief: `events-bootstrap-brief.md`. Suite: **942 → 1,053
passed** (+111) + 34 skipped, offline.

## What was published

`uv run ingest run all --out ndjson` exit 0; manifest generation
`9e8e8a479a97401ab4077c449d7a1871` published LAST covering **7 artifacts**
(was 5): `places.ndjson`, `course_meetings.ndjson`, `organizations.ndjson`,
`organization_livewhale_groups.json`, `athletics_venues.json`,
`brown_owned_buildings.json` (NEW in manifest), `events.ndjson` (NEW).

- `db/seeds/events.ndjson`: **1,106 rows** — 1,000 `livewhale` + 106
  `registrar`; sorted unique identities; all 1,106 validate against the app
  lane's compiled `SeedEventSchema` (independent zod check against
  `packages/contract/dist/seeds.js`).
- Byte-stability check: `places.ndjson` (174 rows, `4b522c81…`),
  `course_meetings.ndjson` (`23b7ddce…`), `organizations.ndjson`
  (`d67448f8…`) all byte-identical to their committed pre-run state — the
  rerun healed the documented mixed-generation manifest (register §5b)
  without touching row content.

## Gates (all PASS, fail-closed)

| gate | required | measured |
|---|---|---|
| coords (non-canceled livewhale rows with lat+lng) | >= 300 | **379** |
| livewhale_events | >= 900 | **1,000** |
| admin_events | >= 100 | **106** |
| vocabulary (unknown `online_type`) | 0 | **0** |

## LiveWhale bootstrap (source `livewhale`)

- **Poller parity is the load-bearing property**: `source_id` =
  `"{id}:{epoch(start_date_iso)}"`, identical to the TS poller's
  `${id}:${date_ts}` (verified: `date_ts` == epoch(`date_iso`) on all
  1,000 poller-fixture rows; 982/1,000 CSV rows overlap the fixture on
  `(id, epoch)`; 10 diverse ids pinned in
  `tests/events/test_livewhale.py::TestPollerSourceIdParity`).
  Entity decoding (`common/text.py`), category tables and group keys
  (`mappings/categories.py`), and the org-sidecar lookup
  (`load_org_livewhale_groups`, higher score wins, missing → empty) are
  verbatim ports of `services/poller/src/livewhale/` + `util.ts`.
- Categories emitted: academic 509, arts 250, admin 152 (106 registrar +
  46 livewhale via the Academic Calendar/HR group fallback), athletics
  122, career 30, food 27, social 13, wellness 3. Unknown `event_types`:
  **none** (the measured vocabulary is exactly the poller's 7 values).
  Documented deviation: unknown types would be *reported*, never raised —
  poller fall-through parity beats the task-7 raise-on-unknown ethos here.
- Coordinates: 379 rows carry both (0 zero-sentinels, 0 single-sided);
  cancellation flag honored (0 canceled in this snapshot); all-day 154.
- Place resolution (ingestion-side extra, coords-absent rows only):
  **229 resolved** (179 exact, 50 trigram) / 138 below-threshold /
  0 ambiguous; **149 online-only rows never resolved** (contract has no
  online column — `online`/`online_type`/`online_url` ride in `raw`;
  resolving a virtual event's blurb would be a guess). 30 hybrid rows
  behave as physical. 228 rows have neither coords nor location text.
- Org attribution via the task-7 sidecar + organizer name: **0 rows** —
  the sidecar's measured `mappings: []` is the truth (no student group is
  a LiveWhale publisher); identical to what the poller computes today.
- Published-contact columns dropped from `raw` with counts (task-7
  precedent): `contact` 651, `contact_emails` 552; the published file
  contains zero email-like strings (independently re-scanned).
- `description` is None (the CSV carries no description column); the
  poller fills it on first live refresh. `rrule` stays null (`repeats`
  is prose; occurrences arrive pre-expanded).

## Registrar academic calendar (source `registrar`)

- Contract check (brief instruction): `events.source` is an OPEN text set
  (`'livewhale'|…|'manual'|...`) and the app-side `SeedEventSchema` pins
  `z.string().min(1)` — `registrar` is permitted; the sub-scope proceeded.
- 110 rows → **106 admin events** (4 month-section duplicates first-wins
  deduped after verifying non-divergence; a divergent duplicate raises).
- Year derivation is weekday-validated fail-closed: candidates
  {term_year−1, term_year}, the printed weekday must match exactly one
  (consecutive years can never both match — brute-force tested across a
  decade). 110/110 resolve; range 2026-03-23 → 2027-05-29; Winter-2027
  December rows land in 2026 as their weekdays prove.
- All-day at 00:00 America/New_York (contract §2; zoneinfo EST/EDT),
  `source_id` = the numeric LiveWhale id in every `event_url` (106
  distinct), `category="admin"`, no locations/coords.
- Cross-source overlap: 21 registrar ids also exist as livewhale rows —
  `canonical_id` dedup is the app lane's concern (contract §1), reported
  not suppressed.

## CLI and bundle changes

- `events` JobSpec registered (postgres target: `upsert_events`), running
  AFTER `clubs` so the org lookup reads the freshly published sidecar;
  new `--calendar-csv`; `--events-csv` now feeds both clubs evidence and
  the bootstrap.
- `buildings` JobSpec registered (file-only sidecar, like athletics) —
  closes the enrichment round's register §5 follow-up: manifest entry +
  CLI registration for `brown_owned_buildings.json`; `--buildings-csv`.
- Registry: places, cab, clubs, athletics, buildings, events, dining
  (blocked). Offline integration suite drives the full real bundle and
  asserts the DoD gates, FK integrity (event `place_id` ⊂ places, event
  `org_id` ⊂ organizations), poller-shaped ids, no contact emails, 7
  manifest artifacts with independently recomputed hashes, and one `ok`
  source run per job (6 jobs).

## Branch coverage (new modules, >= 80% gate)

`events/csv_source` 100%, `events/job` 100%, `events/registrar` 100%,
`events/models` 100%, `events/livewhale` 95%, `common/text` 100%,
`mappings/categories` 98%.

## Fixtures: drop registration verified + dispositions

All 13 CSVs of the 2026-07-29 Codex pack were already registered by task 7
in `ingest/fixtures/manifest.json` (kind `user_provided`, sha256 pinned,
`codex_provenance` mirrored from `brown_data_sources.csv`, note "collected
by Codex via browser, delivered by user 2026-07-29") — verified against
the on-disk hashes, nothing re-registered;
`brown_fall_2026_classes_and_locations.csv` stays single-registered
(byte-identical, `50a20adb…`). The recorded/ email-scrub integrity test
stays strict. Dispositions of the files consumed by no job:

| file | disposition |
|---|---|
| `brown_upcoming_events.csv` | CONSUMED — events job (this round) + clubs default-place evidence (task 7) |
| `brown_academic_calendar_2026_2027.csv` | CONSUMED — events job admin rows (this round) |
| `brown_college_hill_buildings.csv` | CONSUMED — buildings sidecar (enrichment round; CLI-registered this round) |
| `brown_event_locations.csv` | CONSUMED — enrichment-round alias growth evidence |
| `brown_all_student_groups.csv` | CONSUMED — clubs job (task 7) |
| `brown_athletics_calendar.csv` | supplementary evidence; the recorded SIDEARM ICS remains the athletics source of truth |
| `brown_news_archive.csv` | **post-MVP backlog** (app handoff §10: buzz/news layer is not built now; keep seams) — no contract table consumes article metadata |
| `brown_daily_herald_news.csv` | **post-MVP backlog** (same §10 item; BDH RSS is the poller's live buzz source when built) |
| `brown_library_hours.csv` | **no contract table** — contract v1 has no hours row anywhere; revisit only with a contract bump |
| `brown_dining_menu_links.csv` | **dining NOTES enrichment** — registered against the dining block (register §3); not landing/bundle discovery evidence, so the `dining_landing`/`dining_bundle` gaps stand |
| `brown_a_to_z_resources.csv` | **future alias source** — 300 directory entries with addresses; candidate evidence for gazetteer alias growth in a later enrichment round, no seed now |
| `brown_data_sources.csv` | Codex's own provenance manifest — mirrored into fixture entries, not a data source |

## Follow-ups / dependencies

- Register §6 (new): the poller overwrites `description`/`place_id`/`raw`
  on first refresh — if gazetteer placement should survive live refreshes,
  the poller needs contract §2 resolver semantics (app-lane decision).
- Register §§1, 2, 4, 5 consumer acceptances unchanged (BLOCKING, app lane).
- 138 below-threshold event locations (Providence venues, off-campus
  addresses) are alias-growth candidates for a later enrichment round —
  never guessed now.
