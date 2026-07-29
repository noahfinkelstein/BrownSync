# Events bootstrap brief (post-task-9 extension)

**Scope:** bootstrap `db/seeds/events.ndjson` from two files of the
2026-07-29 user-provided Codex CSV pack — `brown_upcoming_events.csv`
(1,000 LiveWhale event instances, 2026-07-29 → 2026-11-03) and
`brown_academic_calendar_2026_2027.csv` (110 registrar entries) — register
the `events` job (and the deferred `buildings` sidecar job) in the CLI,
and republish the full seed bundle manifest covering every current
artifact. Runs AFTER the concurrent orgs (task 7, commit 814bfcd) and
enrichment (commit f943c61) rounds.

## Poller-parity constraint (the load-bearing decision)

This is a BOOTSTRAP snapshot: post-deploy, the app lane's TS poller
(`services/poller/src/livewhale/` on `main`, read read-only at
`/Users/noah_finkelstein/Developer/projects/BrownSync`) refreshes live and
upserts on `(source, source_id)`. Seed identity MUST therefore match the
poller's derivation exactly, or the first live poll forks every row
instead of converging.

Poller derivation (normalize.ts, verified against its recorded fixture
`services/poller/fixtures/livewhale-events.json`, 2026-07-28, 1000 rows):

- `source_id = "${id}:${date_ts}"` — LiveWhale pre-expands repeat series;
  `id` alone repeats (919 ids / 1000 rows in the poller fixture; 923/1000
  in this CSV), `id:date_ts` is the per-occurrence identity.
- `date_ts` is exactly the Unix epoch of `date_utc`/`date_iso` (verified
  0 mismatches across all 1000 fixture rows). The CSV carries
  `start_date_iso` (same value as feed `date_iso`, offset-aware), so
  `source_id = f"{event_id}:{int(fromisoformat(start_date_iso).timestamp())}"`
  reproduces the poller's ids byte-for-byte.
- Coordinates: string/number tolerant; `0` is a null-island sentinel →
  null; a missing side nulls BOTH (measured CSV: 0 zero-coords, 0
  single-sided).
- Text: `decodeEntities` (14 named entities + decimal/hex numeric,
  unknown named entities preserved) then trim; the mirrored Python lives
  in `common/text.py`.
- Category: `categorize(event_types, group)` — ordered topical table
  (food > arts > social > academic), audience qualifier "Open to the
  Public" ignored, publisher-group fallback table, final fallback
  `academic`. Ported verbatim into `mappings/categories.py` (the
  DATA_CONTRACT §4 named home for LiveWhale mapping tables). **Deviation
  from the task-7 raise-on-unknown ethos, documented:** the poller never
  fails on an unknown `event_types` value — it falls through the table.
  Parity wins (a seed that raises where the poller categorizes would
  diverge on refresh); unknown types are counted and reported instead.
  Measured CSV vocabulary is exactly the poller's 7 known values.
- Org attribution: normalized-group lookup built from the task-7 sidecar
  `db/seeds/organization_livewhale_groups.json` (higher score wins,
  missing file → empty map, malformed file → loud failure), mirroring
  poller `orgs.ts`. The task-7 sidecar's measured truth is `mappings: []`
  (no student group is a LiveWhale publisher), so attribution is 0 —
  honest, and identical to what the poller computes today.
- `rrule` stays null (feed `repeats` is prose, occurrences pre-expanded);
  `confidence` 1.0; `is_canceled`/`is_all_day` from the flags.

**Parity test:** 10 sampled rows present in BOTH this CSV and the
poller's recorded fixture (982/1000 overlap on `(id, epoch)`) pin the
emitted `source_id` against the poller's `id:date_ts` values, hardcoded
from the fixture with their derivation documented.

## Where the seed goes beyond the poller (allowed, non-identity fields)

- `place_id`: resolved via the task-5 gazetteer resolver (enriched
  aliases, commit f943c61) where coords are ABSENT, location text is
  present, and the event is not `online_type="Online only"` (an
  online-only event has no campus place — contract has no online column;
  the online fields ride along in `raw`). The poller leaves `place_id`
  null; filling it from the gazetteer is the documented ingestion-side
  duty (contract §2) and survives upserts only until the poller
  refreshes the row — reported as such.
- `raw`: the CSV row (this bootstrap's actual source), minus the two
  published-contact columns `contact`/`contact_emails` — dropped with
  counts, the task-7 precedent: no contract field consumes them and
  publishing directory emails into seeds is forbidden. The poller's
  `raw` is the live feed object; `raw` is provenance, not identity.
- `description`: the CSV carries no description column → None (the
  poller fills it on first live refresh).

## Registrar calendar (source `registrar`)

Contract §1 declares `events.source` as an OPEN set (`'livewhale'|…|
'manual'|...`, text column) and the app-side `SeedEventSchema` pins only
`z.string().min(1)` — `registrar` is permitted, sub-scope proceeds.

- `source_id`: the numeric LiveWhale event id embedded in every
  `event_url` (`/event/<id>-slug`, 110/110 rows carry one; 106 distinct).
  Duplicate ids are the same entry listed under two month sections —
  verified non-divergent on (event, dates, term), first-wins deduped
  with a count; a divergent duplicate fails loudly.
- Dates: `start_date_display` is "Www, Mmm D" with NO year. Year is
  derived fail-closed by weekday validation: candidates {term_year - 1,
  term_year} (end dates: {start_year, start_year + 1}, ≥ start); the
  weekday name printed in the source must match exactly one candidate —
  consecutive years can never share a weekday for the same date, so a
  match is unique; zero or two matches raise. Measured: 110/110 resolve,
  range 2026-03-23 → 2027-05-29; the Winter-2027 December rows land in
  2026 as the weekday proves.
- All-day rows at 00:00 America/New_York (contract §2 source-local
  rule; zoneinfo handles EST/EDT), `is_all_day=true`, `end_ts` = end
  date 00:00 NY (LiveWhale's own all-day convention).
- `category="admin"` (§4: deadlines, university ops); `url=event_url`;
  title = the registrar's event text verbatim; no location/coords.
- 21 of the 106 registrar ids also appear in the LiveWhale CSV as
  livewhale-source rows — cross-source duplicates are the app lane's
  `canonical_id` dedup concern (contract §1), reported not suppressed.

## Gates (fail-closed: any failure publishes nothing)

| gate | required | measured |
|---|---|---|
| `coords` (non-canceled livewhale rows with lat+lng) | ≥ 300 (DoD, app handoff §4) | 379 |
| `livewhale_events` | ≥ 900 (0.9 × the 1,000-row hash-pinned export) | 1000 |
| `admin_events` | ≥ 100 (110-row export minus listed duplicates) | 106 |

## CLI + bundle

- `events` JobSpec (postgres target: `repository.upsert_events`
  exists); new `--calendar-csv` option; reuses `--events-csv` (same
  file already feeds clubs default-place evidence) and the seeds-dir
  sidecar for org lookup.
- `buildings` JobSpec (file-only sidecar, `postgres_target=False`) —
  closes the enrichment round's recorded follow-up (dependency register
  §5): `brown_owned_buildings.json` gains its CLI registration and its
  manifest entry.
- Registry order: places, cab, clubs, athletics, buildings, events,
  dining (blocked). `run all --out ndjson` republishes the bundle and
  the manifest LAST, now covering 7 artifacts — which also heals the
  documented mixed-generation state (enrichment republished
  `places.ndjson` after the task-7 manifest snapshot).

## Fixtures

All 13 drop CSVs are already registered (task 7) in
`ingest/fixtures/manifest.json` as `kind=user_provided` with sha256 +
codex_provenance mirrored from `brown_data_sources.csv` — verified, no
re-registration; `brown_fall_2026_classes_and_locations.csv` stays
single-registered (byte-identical, sha 50a20adb…). Remaining-file
dispositions are documented in the report (news archive → post-MVP
backlog per app handoff §10; library hours → no contract table; dining
links → dining NOTES enrichment; a-to-z → future alias source).
