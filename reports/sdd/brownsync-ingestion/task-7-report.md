# Task 7 report: Clubs, category mappings, LiveWhale sidecar, bounded recurrences

## What shipped

- `ingest/brownsync_ingest/mappings/{__init__,categories}.py`: explicit
  club vocabularies -> contract §4 taxonomy. Every measured value maps —
  `group_type` to `kind="club"`, and the non-thematic
  `funding_category`/`tags` vocabularies to `category=None` with
  machine-readable reasons; unknown values raise
  `UnmappedSourceValueError` (job vocabulary gate, fail-closed).
- `ingest/brownsync_ingest/clubs/{__init__,models,csv_source,livewhale,recurrences,default_place,job}.py`:
  the CSV-adapted clubs pipeline — strict 17-column export loading,
  collision-stable slug identity, contract-pure `OrganizationRow` emission,
  LiveWhale linkage + schema-v1 sidecar, evidence-gated `default_place_id`,
  and the full-temporal-evidence recurrence gate.
- `ingest/tests/{mappings,clubs}/…`: 102 tests including real-input
  regressions pinning every measured number below.
- `ingest/brownsync_ingest/output.py`: `publish_json_document` promoted
  from `athletics_venues.py` (same staging/fsync/replace discipline) so
  both sidecar publishers share one atomic implementation;
  `athletics_venues.py` now imports it.
- `ingest/brownsync_ingest/cli.py`: clubs `BlockedJob` replaced by the real
  job (registry order `places, cab, clubs, athletics, dining(blocked)`),
  options `--clubs-csv/--events-csv/--livewhale-groups`, postgres hybrid
  (organizations upsert; sidecar stays a file).
- `ingest/fixtures/manifest.json` + `ingest/tests/test_fixtures.py`: the 12
  not-yet-registered CSVs of the 2026-07-29 Codex pack registered as kind
  `user_provided`, each mirroring its `brown_data_sources.csv` provenance
  row (`codex_provenance` object + note "collected by Codex via browser,
  delivered by user 2026-07-29"); row counts independently re-measured and
  all matching. `brown_fall_2026_classes_and_locations.csv` re-verified
  byte-identical to the Task 6 registration (sha `50a20ad…`) and NOT
  re-registered. Schema evolution: `fills_gaps` may be empty
  (supplementary inputs); the email-scrub gate stays byte-for-byte strict
  for recorded/ fixtures, while user_provided files (hash-pinned as
  delivered, unscrubable by construction) must either be email-free or
  declare `published_contact_data: true` backed by a manifest note.
- Published seeds (generation `34f2d273c10e4120a1a65ee300288599`, 5
  artifacts, manifest last): `db/seeds/organizations.ndjson` (457 rows,
  NEW), `db/seeds/organization_livewhale_groups.json` (schema v1, NEW),
  athletics sidecar (generated_at only), places/course_meetings
  byte-identical to HEAD.
- `ingest/README.md` and `reports/app_side_dependencies.md` §2/§3 updated
  (clubs unblocked; org sidecar produced, consumer acceptance still
  BLOCKING; dining menu-links CSV registered as supplementary only).

## RED/GREEN evidence

| Step | RED | GREEN |
| --- | --- | --- |
| Fixture registration | baseline `1 failed` (12 unmanifested files) + new tests `3 failed, 9 passed` | after registration + schema evolution: `12 passed, 1 skipped` |
| mappings/categories | collection error (module missing) | `16 passed` |
| clubs/csv_source | collection error | `12 passed` |
| clubs/livewhale | collection error; then `1 failed` (my test vector "The Outing Club" scores 84.6 — legitimately below threshold; vector corrected, not the code) | `22 passed` |
| clubs/recurrences | collection error | `8 passed` |
| output.publish_json_document | `2 failed, 8 passed` | `10 passed` (athletics refactored onto it, `21 passed` unchanged) |
| clubs/default_place | collection error | `12 passed` |
| clubs/job | collection error | `13 passed` |
| CLI + integration | `3 failed, 23 passed` (registry order, clubs runner) | `93 passed`; integration `20 passed` |
| full suite | — | `942 passed, 34 skipped` (Task 10 baseline was 738+34; 35 of the new tests belong to a concurrent session's WIP, all passing) |

## Real-run numbers (all gates PASS)

```
gate organizations: required 400  actual 457  PASS
gate vocabulary:    required 0    actual 0    PASS
published: organizations.ndjson 457 rows; sidecar mappings []
```

- 457 records (424 undergraduate + 33 graduate), 0 duplicates dropped; one
  slug collision, deterministic in source order:
  `chinese-students-and-scholars-association` (undergrad) / `-2` (grad).
- Emission: kind `club` (457), category `None` (457 — no thematic source
  signal exists; reasons `funding-tier-not-thematic` 415,
  `governance-status-not-thematic` 7, `no-source-category` 35,
  `recognition-tag-not-thematic` all), url from `website_url` 21 /
  org-specific `source_url` 424 / none 12 (graduate rows sharing the GSC
  directory URL), instagram 337.
- Dropped columns (no contract field; counted, never invented):
  `contact_emails` 457, `advisor` 386, `facebook_url` 41, four empty
  social columns, `other_social_urls` 0.

### LiveWhale linkage (sidecar `mappings: []` — a measured result)

Against the 218 recorded LiveWhale groups: **exact 0, fuzzy accepted 0,
below-threshold 445, ambiguous-margin 1, degenerate-subset 11.** The
recorded groups are university departments/offices; no student group is a
LiveWhale publisher. The margin-ambiguous case is SIAM Student Chapter
("Mathematics" vs "Applied Mathematics", both 100). The 11
degenerate-subset rejections are the plan-literal rule's false positives —
`token_set_ratio` scores a strict token-subset at 100 — all
club-contains-department-word traps: Association for Women in
**Mathematics**, BrownSPH4Palestine -> **School of Public Health**, College
Hill Irish **Music** Ensemble, Journal of PP&**Economics**, MET/Olneyville
**English**, **Music** Co-op, **Music** Review, oSTEM -> **Mathematics**,
Outdoor Leadership … **Education** Program, SHAPE -> **Education**, **Visual
Art** Appreciation. The guard (significant-token strict-subset after filler
removal) can only reject relative to the plan rule, never accept; it is
documented as a deviation in task-7-brief.md and every rejection is
reported. Emitting those links would have misattributed department events
to student clubs — the same defect class the Task 10 review fixed for
trigram address traps.

### Default venues (0 awarded — a measured result)

From `brown_upcoming_events.csv` (1,000 instances): 179 online + 108
location-less skipped; 713 observations over 68 organizers; 430 resolve
through the frozen Task 5 resolver (283 unresolved instances). 7
*organizers* meet the >= 3 observations / >= 75% share rule (John Carter
Brown Library 116/118 at `67-george-street`; Joukowsky 71/71
`rhode-island-hall`; Watson 31/31 `135-thayer-street`; Study Abroad 9/9 and
Chaplains 3/4 `page-robinson-hall`; Carney 3/3 `hemisphere-building`;
School of Public Health 3/3 `121-south-main-street`) — but observations
attach only through an accepted LiveWhale link and no organization has
one, so **0 organizations receive `default_place_id`**. The machinery is
fully tested (75% boundary included) and activates the moment a linkable
source appears.

### Recurring events (0 emitted — a measured result)

The export carries no structured temporal columns; `evidence_from_record`
is all-`None` for every record (prose descriptions deliberately never
parsed) and zero events are emitted. No speculative rrule builder was
written; the extraction seam (`EVIDENCE_COLUMNS`) is tested for the day the
export grows a real column.

## Branch coverage (parser gate >= 80%)

`clubs/{job,livewhale,models,recurrences}` 100%, `default_place` 95.45%,
`csv_source` 90.00%, `mappings/categories` 87.50% — all clear the gate.

## Concurrent-session incident (documented, resolved)

Mid-task, an uncommitted `gazetteer/aliases.yaml` enrichment (plus
`brown_owned_buildings.py`/`.json`, `test_event_locations.py`, a
`test_catalog.py` edit) appeared in this worktree from a concurrent agent
session working the Codex drop. My first `ingest run all` silently absorbed
it (places 166 -> 174), which would have committed seeds unreproducible
from committed sources. Resolution: the bundle was republished through the
same `execute_run("all")` path with `aliases_path` pinned to a scratch copy
of HEAD's committed `aliases.yaml` — the other session's files were never
modified or committed. Verified: `places.ndjson` byte-identical to HEAD,
`course_meetings.ndjson` untouched, and the clubs artifacts are provably
identical under both alias states (zero links means resolver output cannot
reach any organization row). The Task 7 commit contains ONLY this task's
explicit paths; the concurrent session's alias/buildings work remains
uncommitted for its own lane.

## Dependency note

`db/seeds/organization_livewhale_groups.json` (schema v1, verified
field-for-field against `packages/contract/src/seeds.ts`
`OrgLivewhaleGroupsSchema` on main, read-only) is now produced with an
empty `mappings` list. App-side consumer acceptance remains a BLOCKING
cross-workstream dependency (`reports/app_side_dependencies.md` §2) until a
consumer test passes in the app lane; the app schema already tolerates both
absence and emptiness. Dining stays the sole blocked job.
