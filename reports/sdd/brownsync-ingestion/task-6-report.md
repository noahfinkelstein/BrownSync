# Task 6 report: CAB Fall 2026 course meetings (user-provided CSV)

## What shipped

- `ingest/brownsync_ingest/cab/{__init__,models,csv_source,meeting_parser,job}.py`:
  the CSV-adapted CAB pipeline — strict export loading, the measured
  `meeting_schedule` grammar, Task 5 resolver wiring, deterministic
  `{term_code}-{crn}-{idx}` identity, and fail-closed publication gates.
- `ingest/tests/cab/{test_meeting_parser,test_csv_source,test_job}.py`:
  132 tests, including 22 real schedule vectors + 4 real skip vectors copied
  verbatim from the export (CRN-tagged), a full-export sweep, and a
  real-export job regression pinning the gate numbers.
- `ingest/fixtures/manifest.json` + `ingest/tests/test_fixtures.py`: new
  manifest entry kind `user_provided`; the CSV is hash-pinned
  (sha256 `50a20ad…`, 1,016,538 bytes) with provenance and
  `fills_gaps: [cab_home, cab_bootstrap, cab_search, cab_details]`.
  Recorded-fixture checks are untouched; `user_provided/` files are now
  manifest-mandatory (previously merely tolerated).
- `reports/cab_fall_2026_place_resolution.md`: the rendered Task 5 report
  from the real run (the "report only" artifact of the failed gates).
- NOT shipped: `db/seeds/course_meetings.ndjson` — gates failed, publication
  correctly refused (see below).

## RED/GREEN evidence

| Step | RED | GREEN |
| --- | --- | --- |
| Fixture kind + CSV registration | `2 failed, 7 passed` — `test_every_stored_fixture_is_manifested` (unmanifested `user_provided/` file) and `test_the_cab_fall_2026_csv_is_manifested_as_user_provided` | after manifest entry (+ correcting `bytes` to the measured 1,016,538): `9 passed, 1 skipped` |
| meeting_parser | collection error (`brownsync_ingest.cab.meeting_parser` missing) | `85 passed` |
| csv_source | collection error, then `2 failed, 18 passed` (both test-helper bugs: mid-cell quoting of the combined column, `course_title` kwarg) | `20 passed` |
| job | collection error, then `1 failed, 26 passed` — cancelled-row count asserted sections (72) where rows (73) were correct: ARAB 0100 crn 13436 is cancelled *and* multi-pattern | `27 passed` |
| full suite | — | `505 passed, 34 skipped in 1.54s` (was 371+34 after Task 5) |

## Real-run gate numbers (fail-closed, no seeds)

```
gate subjects:           required 50    actual 81      PASS
gate meeting-rows:       required 2000  actual 1828    FAIL
gate section-resolution: required 0.90  actual 0.83478 FAIL  (1253/1501 sections)
gates passed: False -> published: None (db/seeds/ untouched, report rendered)
```

- 5,275 logical records loaded (0 duplicate `(term_code, crn)`); 1,774
  sections emitted 1,828 contract-valid rows (54 second weekly patterns);
  3,501 structured skips: `arranged-tba` 3,328, `cross-listed-reference`
  100, `online-no-schedule` 72, `empty-schedule` 1 (ARTS 1018, Granoff).
- Resolution methods over 1,601 samples (1,501 published + 100 embedded):
  exact-room 1,122, trigram 190, unresolved 289 (257 below-threshold, 32
  ambiguous same-street ties). Embedded (`cab-embedded`) hit rate 59/100 —
  reported, never in the gate.
- 73 cancelled meeting rows (72 sections) carried with `raw.cancelled=true`;
  nothing dropped silently.
- Top unresolved (Task 10 alias-growth worklist): `2 Stimson Avenue 111`
  (18), `101 Thayer Street (VGQ 1st fl) 116E` (16), `67 George Street 104`
  (16), `101 Thayer Street (VGQ 1st fl) 116B` (13), `135 Thayer Street 101`
  (10), `155 George Street 106` (10), `Grant Recital 105` (10), `S. Frank
  Hall for Life Science MARC` (10), `111 Thayer St-Watson Institute …`,
  `190 Hope Street 102`, … — almost all uncatalogued street addresses.

The meeting-rows gate can only be met once either the export grows (TBA
sections gain schedules closer to term) or the threshold is explicitly
revised; the resolution gate needs Task 10's evidence-driven alias growth
(~57 distinct unresolved patterns). Both are deliberate fail-closed states,
not defects: the pipeline publishes the report and refuses seeds.

## Notable decisions

- The 100 `Not published in CAB` rows carry their real location inside
  `meeting_schedule` (`… in Nicholson House 101`); the job resolves those
  embedded strings for `place_id`/`room` enrichment under report source
  `cab-embedded`, keeping the CAB gate denominator exactly the 1,501
  published sections (identical to the Task 5 preview).
- Published sections without any schedule still enter the gate denominator;
  one bad sub-pattern skips its whole section (`unparseable-schedule`)
  rather than emitting half a section.
- `title` is whitespace-stripped (six export titles begin with a raw
  newline); `raw.csv` keeps every column verbatim.
- The fixture manifest now distinguishes kinds: `user_provided` entries
  must carry provenance (`provided_by=user`, `provided_at`, note,
  `fills_gaps` referencing declared gaps) and must not carry HTTP capture
  keys; all recorded checks are byte-for-byte unchanged.

## Dependency note

Seed bundling (`db/seeds/manifest.json`, generation IDs, manifest-last
publication) remains Task 9; this job publishes at most the single
`course_meetings.ndjson` via `output.publish_ndjson`. Task 10 grows aliases
from the unresolved evidence above, reruns this job, and publishes once all
three gates pass.
