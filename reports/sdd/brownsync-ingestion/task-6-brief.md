# Task 6: CAB Fall 2026 course meetings (user-provided CSV adaptation)

## Context

The plan's Task 6 scoped live CAB acquisition: term/subject discovery from
`cab.brown.edu` bootstrap, the `fose` search/details client, pagination, and
per-detail checkpoints. Task 3 proved that route dead: every request to
`cab.brown.edu` answers an AWS WAF bot challenge (status 202), recorded as
explicit manifest gaps (`cab_home`, `cab_bootstrap`, `cab_search`,
`cab_details`); bypassing bot detection is not permitted. On 2026-07-28 the
user supplied an authoritative export instead:
`ingest/fixtures/user_provided/brown_fall_2026_classes_and_locations.csv`
(sha256 `50a20adb13d64f061ff11239a32e9a51b6d33dfc00f86003f1fdec4af975204c`,
5,281 raw data lines = 5,275 logical records after quoted embedded newlines,
single `term_code` 202610, UTF-8 with BOM).

This packet replaces the discovery/client/pagination scope with CSV
ingestion. Parser rigor, identity rules, gates, fail-closed publication, and
TDD are unchanged from the plan.

## Source shape (measured, not assumed)

- Columns (exact order): `term, term_code, course_code, course_title,
  section, crn, meeting_schedule, location, location_status, instructor,
  schedule_type_code, class_status, cab_status_code, cancelled, start_date,
  end_date, cab_schedule_and_location, source_url`.
- `location_status` values: `Physical location published` (1,501), `TBA`
  (3,328), `Physical location not yet published` (274 = 174 `TBD` + 100
  `Not published in CAB`), `Cross-listed reference` (100), `Online` (72).
- `meeting_schedule` grammar: `DAYS h[:mm](am|pm)-h[:mm](am|pm)` with day
  tokens from the contract set {M,T,W,Th,F,S,Su} (observed combos include
  MWF, TTh, MW, MF, MTh, WF, MTWTh, MTThF, MTWThF, Su); multiple weekly
  patterns joined by `" | "` (54 rows); optional embedded location suffix
  `" in <location>"` (exactly the 100 `Not published in CAB` rows); optional
  date-bounded suffix `" (m/d to m/d)"` (2 sub-term rows); `TBA`; empty.
- `instructor`: `K. Blain` or `/`-joined surnames (`Meeks/Dawes`,
  `Giardina Papa/Li`); never empty; no duplicate surnames observed.
- `cancelled`: `true` on 83 rows (72 with parseable schedules, none with a
  published physical location).
- No `(term_code, crn)` duplicates observed; dedupe is enforced anyway.

## Binding constraints

- Work only in `/Users/noah_finkelstein/Developer/BrownSync/ingestion-worktree`
  on branch `codex/ingestion`; edit only the files listed below plus report
  and ledger.
- Run uv with `UV_CACHE_DIR=/private/tmp/brownsync-uv-cache`; tests offline.
- Strict TDD with captured RED/GREEN evidence.
- `DATA_CONTRACT.md` v1 wins: `course_meetings` schema, day-token grammar
  (canonical M,T,W,Th,F,S,Su in that order, unique), id
  `{srcdb}-{crn}-{meet_idx}` with `srcdb` = `term_code` = `202610`.
- Location resolution goes through the Task 5 `PlaceResolver` exactly as
  shipped (exact alias -> longest-alias-prefix room extraction -> trigram
  >= 0.55 authoritative; RapidFuzz reports only). No alias growth in this
  task — that is Task 10's evidence-driven work.
- Gates (adapted from the plan's live gates), all enforced fail-closed in
  the job:
  1. >= 50 distinct subjects (course_code prefix) among emitted rows;
  2. >= 2,000 emitted contract-valid meeting rows;
  3. section-level place-resolution rate >= 90% for rows whose
     `location_status` is `Physical location published`, computed and
     rendered via the Task 5 report module (`build_report` gate).
- NO partial publication: if any gate fails, the job writes the resolution
  report only and never touches `db/seeds/course_meetings.ndjson`.
- Cancelled rows are not dropped silently: rows with parseable schedules are
  emitted with the flag carried in `raw` (the contract table has no
  cancellation column); schedule-less cancelled rows appear as structured
  skips like every other schedule-less row.
- Fixture registration: the CSV enters `ingest/fixtures/manifest.json` as a
  new entry kind `user_provided` with sha256/bytes, provenance note, and the
  WAF gap sources it fills. The integrity test accepts the new kind without
  weakening any recorded-fixture check (recorded entries keep byte-for-byte
  hash, route, fingerprint, status-200, and scrub checks; `user_provided/`
  files become manifest-mandatory instead of merely tolerated).

## Parsing and normalization rules

- `meeting_schedule` outcomes are exhaustive and structured:
  - literal `TBA` -> skip reason `arranged-tba`;
  - empty -> skip reason by `location_status`: `Online` ->
    `online-no-schedule`, `Cross-listed reference` -> `cross-listed-reference`,
    else `empty-schedule`;
  - grammar mismatch in any sub-pattern -> whole section skips as
    `unparseable-schedule` (never emit half a section);
  - `start_time >= end_time` (policy `validate_cab_temporal_plausibility`)
    -> skip reason `implausible-times`;
  - otherwise one `MeetingPattern` per `" | "` sub-pattern, `meet_idx` in
    source order from 0.
- 12-hour times normalize to `datetime.time` (12am -> 00:00, 12pm -> 12:00,
  minutes default 0).
- Day strings are validated with the contract tokenizer (longest-first,
  canonical order, unique) and kept verbatim (`TTh`, `MTWThF`).
- Location resolution:
  - `Physical location published` -> resolve the `location` column; one
    report sample per section, source `cab`, `section_id=crn` (gate
    denominator = 1,501 sections, matching the Task 5 preview);
  - embedded `" in <loc>"` patterns -> resolve the embedded string, report
    source `cab-embedded` (enrichment only, never in the CAB gate);
  - `TBD`/`Online`/`See primary listing`/`TBA` locations are never sent to
    the resolver; `location_raw` keeps the verbatim column value.
- Emitted row: `id={term_code}-{crn}-{idx}`, `srcdb=term_code`, `crn`,
  `course_code`, `title=course_title.strip()` (leading export newlines are
  noise; `raw` keeps the verbatim value), `instructor` = `/`-split surnames
  verbatim, source-order deduped, joined `"; "`, `days`, `start_time`,
  `end_time`, `location_raw`, `place_id`, `room` (from the resolver),
  `enrollment=None`, `raw={"csv": <verbatim record>, "pattern": ...,
  "pattern_index": ..., "cancelled": bool, "date_bounds": ...}`.
- `(term_code, crn)` dedupe keeps the first occurrence and counts drops.

## Files

- Create `ingest/brownsync_ingest/cab/__init__.py`
- Create `ingest/brownsync_ingest/cab/models.py`
- Create `ingest/brownsync_ingest/cab/csv_source.py`
- Create `ingest/brownsync_ingest/cab/meeting_parser.py`
- Create `ingest/brownsync_ingest/cab/job.py`
- Create `ingest/tests/cab/__init__.py`
- Create `ingest/tests/cab/test_meeting_parser.py` (>= 20 real CSV variants)
- Create `ingest/tests/cab/test_csv_source.py`
- Create `ingest/tests/cab/test_job.py`
- Modify `ingest/tests/test_fixtures.py` (user_provided kind, strict)
- Modify `ingest/fixtures/manifest.json` (register the CSV)
- Commit `ingest/fixtures/user_provided/brown_fall_2026_classes_and_locations.csv`
- Write `reports/cab_fall_2026_place_resolution.md` (the job's rendered
  report from the real run)
- Write `reports/sdd/brownsync-ingestion/task-6-report.md`, append
  `reports/sdd/brownsync-ingestion/progress.md` ledger lines
- `db/seeds/course_meetings.ndjson` only if all gates pass

## Exact interfaces

```python
# cab/models.py
@dataclass(frozen=True)
class CabCsvRecord:      # one logical CSV row; strings verbatim
    term: str; term_code: str; course_code: str; course_title: str
    section: str; crn: str; meeting_schedule: str; location: str
    location_status: str; instructor: str; schedule_type_code: str
    class_status: str; cab_status_code: str; cancelled: bool
    start_date: str; end_date: str
    cab_schedule_and_location: str; source_url: str
    raw: Mapping[str, str]   # verbatim column -> value

@dataclass(frozen=True)
class MeetingPattern:
    days: str; start_time: time; end_time: time
    embedded_location: str | None; date_bounds: tuple[str, str] | None
    text: str                # the sub-pattern verbatim

@dataclass(frozen=True)
class ParsedSchedule:        # exactly one of patterns / skip_reason
    patterns: tuple[MeetingPattern, ...]
    skip_reason: str | None

@dataclass(frozen=True)
class SkippedSection:
    term_code: str; crn: str; course_code: str
    reason: str; location_status: str; meeting_schedule: str

@dataclass(frozen=True)
class GateCheck:
    name: str; required: float; actual: float; passed: bool

@dataclass(frozen=True)
class CabGates:
    checks: tuple[GateCheck, ...]
    @property def passed(self) -> bool: ...   # all checks

# cab/csv_source.py
EXPECTED_COLUMNS: tuple[str, ...]            # the 18 exact header names
class CabCsvError(ValueError): ...
def load_cab_csv(path) -> tuple[tuple[CabCsvRecord, ...], int]:
    ...  # (records first-wins deduped on (term_code, crn), dropped count)

# cab/meeting_parser.py
class MeetingScheduleError(ValueError): ...
def parse_time_12h(text: str) -> time: ...
def parse_days(text: str) -> str: ...        # canonical tokens or raise
def parse_meeting_schedule(text: str, location_status: str) -> ParsedSchedule

# cab/job.py
MIN_SUBJECTS = 50
MIN_MEETING_ROWS = 2000
RESOLUTION_GATE = 0.90
@dataclass(frozen=True)
class CabJobResult:
    rows: tuple[CourseMeetingRow, ...]; skips: tuple[SkippedSection, ...]
    duplicates_dropped: int; subjects: tuple[str, ...]
    report: PlaceResolutionReport; report_markdown: str
    gates: CabGates; published_count: int | None   # None = not published

def run_cab_csv_job(csv_path, *, resolver, seeds_path, report_path,
                    staging_root, min_subjects=MIN_SUBJECTS,
                    min_meeting_rows=MIN_MEETING_ROWS,
                    resolution_gate=RESOLUTION_GATE) -> CabJobResult
```

## Ordered TDD steps

1. Fixture registration: extend `tests/test_fixtures.py` with the
   `user_provided` kind contract (RED), register the CSV in
   `fixtures/manifest.json` (GREEN); prove recorded checks did not weaken.
2. `meeting_parser` tests from >= 20 real CSV rows (days, 12h times, multi
   pattern, embedded location, date bounds, TBA/empty/status reasons,
   synthetic malformed/implausible) (RED) -> implement (GREEN).
3. `csv_source` tests (BOM header, exact columns, quoted commas/newlines,
   cancelled parsing, dedupe, error paths) (RED) -> implement (GREEN).
4. `job` tests (identity, instructor joining, cancelled carry, resolution
   wiring, gate arithmetic, fail-closed non-publication, atomic publication
   on a synthetic passing corpus, real-CSV regression numbers) (RED) ->
   implement (GREEN).
5. Full suite `cd ingest && uv run pytest -q` green; run the real job once
   to render `reports/cab_fall_2026_place_resolution.md` and record gate
   numbers; publish seeds only if gates pass.

## Expected gate outcome (evidence-based, not aspiration)

The Task 5 preview measured 1,253/1,501 published sections resolving
(83.5%) against the frozen catalog, and the CSV yields ~1,828 emitted rows
(1,774 scheduled sections + 54 second patterns) — below the 2,000-row gate.
Absent alias growth (out of scope here), the job is expected to FAIL gates
2 and 3, publish the report only, and leave `db/seeds/` untouched. That is
the designed fail-closed behavior; Task 10 grows aliases from this
evidence and republishes.

## Dependency note

Seed bundling (`db/seeds/manifest.json`, generation IDs, manifest-last
ordering) remains Task 9. This job publishes at most the single
`course_meetings.ndjson` artifact via `output.publish_ndjson` per-file
atomicity.
