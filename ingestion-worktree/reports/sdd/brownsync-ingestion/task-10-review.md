# Task 10 — final adversarial review: findings and dispositions

Date: 2026-07-29. Worktree `/Users/noah_finkelstein/Developer/BrownSync/ingestion-worktree`,
branch `codex/ingestion`, baseline `80cefd3` (coverage portion: 717 passed + 34 skipped).

Method: three adversarial lenses (data-integrity, parser-robustness,
contract-compliance) ran independently over the published seed bundle, the
producing code, and the app-side consumers on `origin/main`; their verified
findings were then fixed TDD-style (RED test reproducing each defect, then
the fix, then GREEN) or explicitly dispositioned below. Suite after fixes:
**738 passed + 34 skipped**; per-parser branch-coverage gate still clears 80%
everywhere (cab/job.py 28/28 = 100% after the rewrite).

## Findings table

| # | Lens | Severity | Finding | Disposition |
|---|------|----------|---------|-------------|
| 1 | data-integrity | critical | 32 published meeting rows carried a silently wrong building: trigram address-alias traps bound `70 Brown Street NNN` (26 rows) to Page-Robinson Hall via its `69 Brown Street` alias (0.684), `94 Waterman Street- CSSJ 110` (3 rows) to 85 Waterman Street (0.727, room corrupted to `CSSJ 110`), and `155 South Main Street - Packet 151` (3 rows) to 121 South Main Street (0.75, room `Packet 151`). All 32 counted as resolution successes. | **FIXED** (curation): added `70-brown-street` (OSM way/1073442221) and `packet-building` (The Packet Building, OSM way/141567737) — both grounded by the recorded Overpass fixture — plus street-address aliases on the CSSJ; all three now resolve `exact-room` with clean room numbers. Seeds republished. |
| 2 | data-integrity | critical | Multi-pattern sections with per-pattern locations (`A \| B` location cells aligned 1:1 with the `' \| '`-joined `meeting_schedule`, proven by `cab_schedule_and_location`) were conflated: the whole piped cell resolved once and stamped the same place/room/location_raw on every pattern row — 40 published rows across 20 sections, several in the wrong building (e.g. `202610-15392-0` published as Page-Robinson 201 while its MW pattern meets in Sayles Hall 104), plus building fragments leaking into `room`. | **FIXED**: `cab/job.py` now splits an aligned piped cell per pattern (`_section_locations`), resolves and samples each part under the section's crn (the gate ANDs them), and emits per-pattern `location_raw`/`place_id`/`room`. Unaligned pipe counts fall back to whole-cell resolution — never guessed apart. `202610-10136-*` (`Gerard House 101 \| Sciences Library 604`), which fell below threshold as a combined string, now resolves half by half. |
| 3 | data-integrity | minor | 73 rows from 72 cancelled sections published as regular meetings, cancellation visible only inside `raw`. | **FIXED** together with #5 (same defect, stronger framing there). |
| 4 | contract-compliance | critical | Athletics venue sidecar schema divergence between lanes: ingestion publishes the versioned v1 envelope while the poller on `origin/main` pinned `z.record(z.string(), z.string())` (flat map) and throws on a present envelope — after merge, every poller athletics run with the sidecar present fails. Root cause: DATA_CONTRACT.md never defines either sidecar file. | **RESOLVED CROSS-LANE**: the app lane moved to the v1 envelope on branch `fix/athletics-sidecar-v1` (commit `60c349d`) — `AthleticsVenuesSchema` (`z.literal(1)`) pinned in `@brownsync/contract`, loader rewritten over `mappings[]`, ingestion-emitted file mirrored as a poller fixture, consumer tests cover absent and present-with-v1. Producer shape unchanged (verified conformant). `reports/app_side_dependencies.md` §1 updated: dependency stays BLOCKING until that branch merges; recommends a coordinated contract bump defining both sidecar schemas. |
| 5 | contract-compliance | important | 73 cancelled-section rows published as live course meetings: contract §1 has no cancellation column and §3 pins `/api/meetings` as meetings "in session", so the app would render phantom classes all term with no contract-compliant way to filter them. | **FIXED**: cancelled sections are now structured skips (`cancelled-section`, all 83 of them — 72 schedule-bearing, 11 schedule-less) and never reach the seeds; they also stay out of the resolution denominator (none were published-location anyway). Seeds 1,828 → 1,755 rows; meeting-rows gate 1,755 ≥ 1,500 still PASS. |
| 6 | contract-compliance | minor | `srcdb` disagreement between lanes: all published rows carry `202610` (verbatim from the authoritative user export) while the app lane seeded `term_calendar` with `202710` for Fall 2026; `api_meetings_at` degrades to its wide default window, so nothing breaks, but term-edge accuracy is lost and one lane has the wrong Banner code. | **ACCEPTED** (cross-lane): ingestion is not in violation — the code was discovered from the authoritative export, and reconciling means changing the app-side migration or proving the export wrong, neither of which belongs to this lane. Recorded here for the classes-layer reconciliation. |
| 7 | contract-compliance | minor | Latent: the contract row models (last validation gate before `publish_ndjson`) accepted values the app-side seed loader rejects — `EventRow` confidence 5.0, lat 999/lng −999; `PlaceRow` out-of-range coordinates — so a future producer bug would fail the whole generation at app load time instead of the producing job. | **FIXED** (trivial): `PlaceRow.lat/lng` and `EventRow.lat/lng/confidence` now carry the app-side bounds (`[-90,90]`, `[-180,180]`, `(0,1]`) as field constraints; bounded floats also reject NaN/inf. The schema/policy split narrows to identity shape and temporal plausibility (test updated with rationale). Published artifacts were already 100% clean against the app-side schemas. |
| 8 | parser-robustness | minor | `index_buildings` catches only `GeometryError`, so a type-corrupt Overpass element (missing `lon`, non-dict entry, …) crashes indexing instead of recording a per-building diagnostic. | **ACCEPTED**: latent — the pinned fixture (2,155 elements) indexes with zero errors; only a corrupt future re-capture reaches it, and the failure mode is a fail-loud crash, not corruption. |
| 9 | parser-robustness | minor | `assemble_multipolygon` never validates the assembled MultiPolygon, so a mis-tagged OSM relation (nested/duplicated outers) could emit an OGC-invalid footprint with a slightly skewed centroid. | **ACCEPTED**: latent — requires mis-tagged OSM data; skew is small and the centroid stays inside the footprint; the shape-only WKT policy check is documented. |
| 10 | parser-robustness | minor | ICS edge cases: a quoted property parameter containing `:` (ALTREP) corrupts LOCATION; `vs.` (with period) classifies as away; a VALARM SUMMARY overwrites the event's; an unterminated final VEVENT is dropped. | **ACCEPTED**: latent — the recorded feed's 170 VEVENTs contain none of these (verified by grep); misclassification can only add exclusions or trip the fail-closed home-venue gate, never publish wrong data (the sidecar mapping is static). |
| 11 | parser-robustness | minor | `\d`-based schedule regexes accept non-ASCII Unicode digits (values still convert correctly), and date bounds are shape-only (`13/3` accepted verbatim into raw). | **ACCEPTED**: grammar laxity, not corruption — the pinned export is pure ASCII (0 unparseable skips over 5,275 records); verbatim raw passthrough is documented design. |

## RED → GREEN evidence

- **#1** `tests/gazetteer/test_resolver.py::TestTask10AddressAliasTraps` — 5
  vectors RED against the pre-curation catalog (each reproduced the wrong
  building exactly: `121-south-main-street`, `page-robinson-hall`,
  `85-waterman-street`), GREEN after the `aliases.yaml` curation;
  `test_catalog.py` re-pins the catalog at 166 places with the two new OSM
  footprints (`way/1073442221`, `way/141567737`) and the 69-Brown-Street
  alias still binding Page-Robinson.
- **#2** `tests/cab/test_job.py::TestPerPatternPipedLocations` (aligned split,
  partially-unresolved section fails the AND-ed gate, mismatched counts fall
  back to the whole cell) plus real-export pins
  `test_piped_sections_publish_their_per_pattern_buildings` (crns 15392,
  14107, 10136, 10119, 15572) — 6 RED before the `_section_locations`
  rewrite, all GREEN after.
- **#5** `tests/cab/test_job.py::TestSkipsAndDedupe::test_cancelled_sections_become_structured_skips`
  and `TestRealExportRegression::test_cancelled_sections_are_skipped_never_published`
  — RED (73 cancelled rows were being published), GREEN after the
  `cancelled-section` skip.
- **#7** `tests/test_contract.py::test_numeric_contract_bounds_are_enforced_at_the_row_models`
  — 8 parametrized RED cases, GREEN after the field constraints.

## Republished seed bundle

`uv run ingest run all --out ndjson` exit 0; manifest published last,
generation `30cbef95b0874a0fbb0fdc1bc133839a` over 3 artifacts.

| Artifact | Before | After |
|---|---|---|
| `places.ndjson` | 164 rows | 166 rows (+`70-brown-street`, +`packet-building`, CSSJ gains address aliases) |
| `course_meetings.ndjson` | 1,828 rows (32 wrong-building, 40 conflated-pattern, 73 cancelled) | 1,755 rows; 0 cancelled; piped sections carry per-pattern locations; FK check clean (1,649/1,755 placed) |
| `athletics_venues.json` | 11 mappings | unchanged content (`generated_at` only) |
| resolution report | cab 1499/1501 sections (2 unresolved) | cab 1500/1501 sections, 1,521 per-location samples; sole survivor `SMN121 801` (opaque code); embedded 97/100 unchanged |

Gates after republish: subjects 81 ≥ 50 PASS, meeting-rows 1,755 ≥ 1,500
PASS (Task 6B signed-off threshold), section-resolution 99.93% ≥ 90% PASS;
places 166 ≥ 120 PASS, 0 dropped entries; athletics gates green.
