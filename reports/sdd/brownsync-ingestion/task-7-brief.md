# Task 7: Clubs, category mappings, LiveWhale sidecar, bounded recurrences (user-provided CSV adaptation)

## Context

The plan's Task 7 scoped a live scrape of the Drupal undergraduate directory
and the GSC graduate listing (pagination, cycles). Task 3 proved that route
dead: `studentactivities.brown.edu` answers a Pantheon-edge HTTP 403 to the
mandated UA (declared gaps `clubs_undergraduate`/`clubs_graduate`); bypassing
bot detection is not permitted. On 2026-07-29 the user delivered a 13-CSV
data pack collected by Codex (a browser-based agent with authenticated
browser access), staged at `ingest/fixtures/user_provided/`. Codex's own
provenance manifest is `brown_data_sources.csv` (dataset, row_count,
coverage, snapshot_utc, source, update_strategy, license); its claims were
independently re-measured before registration and every row count matches.

This packet replaces the pagination-scrape scope with CSV ingestion exactly
as Task 6 did for CAB. Parser rigor, identity rules, linkage thresholds,
gates, fail-closed publication, and TDD are unchanged from the plan.

## Source shape (measured, not assumed)

`brown_all_student_groups.csv` — 457 logical records (424
`Undergraduate student group` + 33 `Graduate student group`), UTF-8 BOM,
17 columns in exact order: `group_type, name, description, contact_emails,
advisor, funding_category, tags, website_url, instagram_url, facebook_url,
linkedin_url, youtube_url, twitter_url, tiktok_url, other_social_urls,
source_url, directory_source_url`.

- `funding_category` vocabulary: `Category 2` (275), `Category 1` (140),
  empty (35 — all 33 graduate rows plus 2 undergraduate), `Student
  Governance` (7). These are UFB funding tiers / governance status, NOT
  thematic categories.
- `tags` vocabulary: `UCS Recognized Undergrad Student Groups` (424),
  `Graduate Student Council recognized group` (33). Recognition status, NOT
  thematic categories.
- Non-empty link columns: `website_url` 21, `instagram_url` 337,
  `facebook_url` 41; `linkedin/youtube/twitter/tiktok/other_social` all 0.
- `contact_emails` 457 (all single addresses), `advisor` 386 — published
  directory data with no contract organization field.
- `source_url` is an org-specific profile page for all undergraduate rows;
  12 graduate rows fall back to the shared GSC directory URL (equal to
  `directory_source_url`).
- One duplicate name across group types: `Chinese Students and Scholars
  Association` (undergrad + grad directory entries; same contact email).
- No temporal columns of any kind: nothing carries weekday, time, term
  bounds, duration, or venue for club meetings.

Supporting inputs: `fixtures/recorded/livewhale/groups.json` (218 recorded
LiveWhale publisher groups; titles HTML-entity-escaped) and
`fixtures/user_provided/brown_upcoming_events.csv` (1,000 LiveWhale event
instances with `organizer`, `location`, `online` columns) for
default-venue evidence.

## Binding constraints

- Work only in `/Users/noah_finkelstein/Developer/BrownSync/ingestion-worktree`
  on branch `codex/ingestion`; edit only `ingest/**`, `db/seeds/**`,
  `reports/**`. `UV_CACHE_DIR=/private/tmp/brownsync-uv-cache`; tests offline.
- Strict TDD with captured RED/GREEN evidence.
- `DATA_CONTRACT.md` v1 wins: `organizations` schema (id, name, kind,
  category, description, url, instagram, default_place_id, source — no
  email, advisor, facebook, or raw column), §4 taxonomy, §6 NDJSON seeds.
- Sidecar schema v1 EXACTLY as pinned by the plan and by the app lane's
  `packages/contract/src/seeds.ts` `OrgLivewhaleGroupsSchema` (verified
  read-only against main, field-for-field):
  `{"schema_version": 1, "generated_at": "<UTC ISO>", "mappings":
  [{"organization_id", "livewhale_group", "match_method": "exact|fuzzy",
  "score": 0..100}]}`.
- Completeness gate: >= 400 distinct validated organizations, fail-closed
  (no seeds, no sidecar on failure).
- Linkage: exact normalized match first (Task 4 `normalize_alias` on both
  sides, groups HTML-unescaped), then RapidFuzz `token_set_ratio >= 92`
  with runner-up margin `>= 5`; ambiguous -> no link, reported.
- `default_place_id`: >= 3 resolved venue observations AND winning venue
  >= 75% share; observations are (organizer x location) pairs from
  `brown_upcoming_events.csv` resolved through the Task 5 `PlaceResolver`
  exactly as shipped (no alias growth); an organization only accrues
  observations through its linked LiveWhale group.
- Recurring club events: emit ONLY with full temporal source evidence
  (weekday, local time, effective start, bounded end, duration/end time,
  physical venue). The source carries none — expected emission is zero,
  and prose descriptions are never parsed into events.
- Fixture registration: all 12 not-yet-registered CSVs from the drop enter
  `ingest/fixtures/manifest.json` as kind `user_provided` with sha256/bytes
  and provenance mirroring Codex's `brown_data_sources.csv` row plus the
  note "collected by Codex via browser, delivered by user 2026-07-29".
  `brown_fall_2026_classes_and_locations.csv` is byte-identical to the
  Task 6 registration (sha `50a20ad…` re-verified) and is NOT re-registered.
  Recorded-fixture checks stay byte-for-byte strict.

## Vocabulary mapping decisions (never guess)

`brownsync_ingest/mappings/categories.py` (plan/contract name
`ingest/mappings/categories.py`; placed inside the installed package
exactly as Task 6 placed `cab/` — an out-of-package module would not be
importable from the installed CLI):

- `group_type` -> organization `kind`: both observed values map to `club`.
  Unknown value -> `UnmappedSourceValueError` (job collects, gate fails).
- `funding_category`/`tags` -> §4 `category`: every observed value is a
  funding tier or recognition status carrying NO thematic signal, so every
  known value maps to `category=None` with an explicit machine-readable
  reason (e.g. `funding-tier-not-thematic`, `recognition-tag-not-thematic`,
  `no-source-category`). Nothing is inferred from names or descriptions.
  Unknown vocabulary values raise; the job reports them and fails the
  `vocabulary` gate rather than guessing.

## Emission rules

- Slug identity: `common/identifiers.slugify(name)` +
  `unique_slug` against already-assigned slugs, assigned in source CSV
  order (the file is hash-pinned, so assignment is deterministic;
  collision-stable in the `unique_slug` base/base-N sense). Measured: one
  collision — `chinese-students-and-scholars-association` (undergrad,
  first) / `-2` (grad). The two rows are distinct directory entries and
  both emit; no cross-directory merging is guessed.
- Dedupe: first-wins on `(group_type, name)` with a drop counter
  (measured drops on the real file: 0).
- `name`: verbatim (already clean); `description`: stripped, empty -> None.
- Links into the contract shape: `url` = `website_url` when present, else
  `source_url` when it is an org-specific page (differs from
  `directory_source_url`), else None (12 graduate rows); `instagram` =
  `instagram_url` or None. Measured: url from website 21, from source_url
  424, none 12.
- Dropped because contract v1 has no field (documented, never invented):
  `contact_emails` (457 — published directory data, but `organizations`
  has no email column), `advisor` (386), `facebook_url` (41), the four
  empty social columns, `directory_source_url`.
- `source`: `studentactivities` (undergraduate) / `gsc` (graduate) —
  provenance-accurate per Codex's manifest.
- `category`: None for all rows (see vocabulary decisions); `kind`: `club`.
- `default_place_id`: only per the evidence rule below.

## LiveWhale linkage (with one fail-closed guard, documented deviation)

Following the plan's acceptance rule literally
(`token_set_ratio >= 92`, margin `>= 5`) against the real data produces 11
would-be fuzzy links that are all false positives of the same class:
`token_set_ratio` scores a strict token-subset at 100, so "College Hill
Irish Music Ensemble" -> "Music" (the Music *department*), "Association for
Women in Mathematics" -> "Mathematics", "Journal of Philosophy, Politics &
Economics, Brown" -> "Economics", etc. Emitting them would misattribute
every department LiveWhale event to a student club — exactly the
data-integrity class the Task 10 review fixed for trigram address traps.

Decision (fail-closed narrowing only; it can reject, never accept, relative
to the plan rule): a fuzzy candidate is additionally rejected with reason
`degenerate-subset` when, after dropping filler tokens
(`brown, university, the, of, for, and, at, in, a, an`), one side's
significant-token set is a strict subset of the other's. Legitimate
near-matches like "Brown Outing Club" vs "Outing Club" (equal significant
sets) are unaffected. Every rejection is reported with club, group, and
scores for human review; nothing is silently dropped.

Measured on the real data: exact 0, fuzzy accepted 0, ambiguous-margin 1
("Society for Industrial and Applied Mathematics Student Chapter (SIAM)" —
"Mathematics" vs "Applied Mathematics", both 100), degenerate-subset 11,
below-threshold 445. The 218 recorded LiveWhale groups are university
departments/offices; none of the 457 student groups is a LiveWhale
publisher. The sidecar therefore publishes schema v1 with an EMPTY
`mappings` list — the file existing with `[]` is the definitive,
consumer-tolerated statement that no link is claimed.

## Default venue evidence

From `brown_upcoming_events.csv`: skip `online=true` (179) and empty
locations (108); resolve the rest through the Task 5 resolver (283
unresolved); aggregate resolved observations per organizer (35 organizers).
7 organizers meet the >= 3 observations / >= 75% share rule (e.g. John
Carter Brown Library 116/118 at `67-george-street`), but observations
attach to an organization ONLY through its linked LiveWhale group, and no
organization is linked — so 0 organizations receive `default_place_id`.
Per-org evidence counts are carried in the job result and report. The
machinery is fully tested with synthetic corpora, including the exact
75%-boundary case.

## Recurring events

`clubs/recurrences.py` requires all six evidence fields before any emission
and extracts evidence ONLY from structured columns — the clubs CSV has
none, so `evidence_from_record` returns all-missing for every real record
and the job emits zero events (asserted). A description containing prose
like "we meet every Friday at 5pm in Sayles" still yields no evidence
(tested). The plan's DST/expiration testing applies to an rrule-emission
path this source cannot legitimately exercise; no speculative rrule builder
is written — that machinery lands with the first source that carries real
temporal evidence.

## Files

- Create `ingest/brownsync_ingest/mappings/{__init__,categories}.py`
- Create `ingest/brownsync_ingest/clubs/{__init__,models,csv_source,livewhale,recurrences,default_place,job}.py`
  (`csv_source` replaces the plan's `parser` for the same reason as Task 6;
  `default_place` carries the venue-evidence rule)
- Create `ingest/tests/mappings/{__init__,test_categories}.py`
- Create `ingest/tests/clubs/{__init__,test_csv_source,test_livewhale,test_recurrences,test_default_place,test_job}.py`
- Modify `ingest/tests/test_fixtures.py`: allow empty `fills_gaps`
  (supplementary inputs), scope the email-scrub gate to recorded entries
  (user_provided files are hash-pinned as delivered; scrubbing would break
  the pin) while requiring unflagged user_provided files to stay
  email-free and flagged ones (`published_contact_data: true`) to be named
  in a manifest note; pin the clubs CSV registration. Recorded checks stay
  byte-for-byte unchanged.
- Modify `ingest/fixtures/manifest.json`: register the 12 CSVs.
- Modify `ingest/brownsync_ingest/cli.py`: replace the clubs `BlockedJob`
  with the real job (registry order `places, cab, clubs, athletics,
  dining(blocked)`); new options `--clubs-csv`, `--events-csv`,
  `--livewhale-groups`; postgres hybrid: organizations upsert, sidecar
  stays a file.
- Modify `ingest/tests/test_cli.py`, `ingest/tests/test_integration_offline.py`
  for the new registry and artifacts.
- Modify `ingest/README.md` (clubs no longer blocked),
  `reports/app_side_dependencies.md` §2 (sidecar now produced; app-side
  consumer acceptance stays BLOCKING).
- Publish via `uv run ingest run all --out ndjson`:
  `db/seeds/organizations.ndjson`, `db/seeds/organization_livewhale_groups.json`,
  regenerated `db/seeds/manifest.json` (5 artifacts).
- Write `reports/sdd/brownsync-ingestion/task-7-report.md`; append ledger
  lines to `progress.md`. ONE conventional commit, explicit paths, no push.

## Gates (fail-closed in the job)

1. `organizations`: >= 400 distinct validated `OrganizationRow`s;
2. `vocabulary`: 0 unknown `group_type`/`funding_category`/`tags` values;
3. structural (enforced by `publish_ndjson`/models): unique sorted ids,
   contract-valid rows.

Any failure publishes NOTHING (neither organizations.ndjson nor the
sidecar); link/evidence statistics are still reported.

## Ordered TDD steps

1. Fixture registration: extend `tests/test_fixtures.py` (RED — the
   baseline already fails `test_every_stored_fixture_is_manifested` on the
   12 unmanifested files) -> register + schema evolution (GREEN); prove
   recorded checks did not weaken.
2. `mappings/categories` tests (exhaustive vocabularies, None-with-reason,
   unknown raises) (RED) -> implement (GREEN).
3. `clubs/csv_source` tests (BOM header, exact 17 columns, dedupe, error
   paths, real-file regression: 457 records, 0 drops) (RED) -> implement
   (GREEN).
4. `clubs/livewhale` tests (group loading + unescaping, exact/fuzzy/
   ambiguous/degenerate/below-threshold vectors incl. the 11 real
   rejections' class, sidecar schema v1 exactness, empty-mapping document)
   (RED) -> implement (GREEN).
5. `clubs/recurrences` tests (full-evidence emits, each missing field
   blocks, prose never parsed) (RED) -> implement (GREEN).
6. `clubs/default_place` tests (skip rules, resolver wiring, 3-observation
   minimum, 75% boundary, linkage-scoped attribution) (RED) -> implement
   (GREEN).
7. `clubs/job` tests (slug stability incl. CSSA collision, emission rules,
   gates, fail-closed non-publication, atomic publication, sidecar
   publication, real-CSV regression pinning 457/0/0/1/11/0 numbers) (RED)
   -> implement (GREEN).
8. CLI + integration (registry, options, hybrid postgres, `run all`
   artifacts/manifest/source-runs) (RED) -> implement (GREEN).
9. Full suite green; `uv run ingest run all --out ndjson`; verify bundle;
   measure clubs/mappings branch coverage >= 80%; reports; ledger; commit.

## Dependency note

App-side consumption of `db/seeds/organization_livewhale_groups.json`
remains a BLOCKING cross-workstream dependency
(`reports/app_side_dependencies.md` §2): the app lane already pins
`OrgLivewhaleGroupsSchema`, but ingestion claims nothing until a consumer
test passes in that lane. Dining stays a blocked gap (the menu-links CSV is
registered as supplementary input only; contract v1 has no dining row).
