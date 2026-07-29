# SDD ledger — plan: reports/2026-07-28-brownsync-ingestion-execution-plan.md

Preflight: isolated worktree `/Users/noah_finkelstein/Developer/BrownSync/ingestion-worktree`, branch `codex/ingestion`, base `56dfa5c`.
Preflight: contract wins; trigram similarity >=0.55 accepts fuzzy place matches, RapidFuzz only ranks/reports.
Preflight: organization LiveWhale linkage and athletics venues use versioned sidecars; contract rows stay strict.
Preflight: Task 1 seed codecs omit database-default event IDs/timestamps; source-run extension uses atomic monotonic integer history.
Preflight: app-side checkout and index are out of scope.
Task 1: fix round 1/5 (4 addressed, 0 open — finite JSON, structural WKT, recovered TDD evidence, regression coverage; no commits)
Task 1: complete (no commits, review clean; controller verification: 70 passed in 0.16s)
Task 2B: complete (Postgres upserts, guarded cancellation, source-run lifecycle SQL+NDJSON+recorder; offline suite 162 passed, RED/GREEN captured in task-2b-report.md)
Task 2B: postgres-marked integration suite (7 tests) pending — supabase status showed no running local DB and was not started; suite skips cleanly without TEST_DATABASE_URL
Task 2B: committed explicit brief paths in one conventional commit on codex/ingestion (not pushed)
Task 3: complete with explicit gaps (capture harness + fixture manifest + integrity gate; LiveWhale events/groups + Overpass geometry recorded through CachedHttpClient; offline suite 169 passed + 8 skipped)
Task 3: cab.brown.edu answers every route with an AWS WAF bot challenge and studentactivities/dining.brown.edu answer Pantheon edge 403 for the mandated UA — recorded as explicit manifest gaps; bot-detection was not bypassed and no synthetic fixtures were fabricated; closing these gaps needs an OIT allowlist or user-driven capture (blocking input for Tasks 6-8)
Task 3: committed explicit brief paths in one conventional commit on codex/ingestion (not pushed)
Task 4: complete (gazetteer geometry/overpass/aliases/catalog + common/identifiers; 148 valid PlaceRows from recorded Overpass fixture + curated aliases.yaml — 136 osm-backed with MultiPolygon WKT, 12 curated; six canonical dining places kind="dining"; 0 diagnostics; offline suite 298 passed + 8 skipped)
Task 4: pre-fix landed — CachedHttpClient caches HTTP 200 exactly and ignores cached non-200 metadata (Task 3's WAF 202 challenge bodies can no longer poison the cache); RED/GREEN in task-4-report.md
Task 4: inherited baseline failed 1 test from the user-dropped ingest/fixtures/user_provided/ CSV (Fall 2026 CAB data, arrived after Task 3); fixture integrity gate now permits exactly that directory name, recorded/ stays hash-gated, CSV left uncommitted for the task that consumes it
Task 4: committed explicit brief paths in one conventional commit on codex/ingestion (not pushed)
Task 5: complete (gazetteer resolver + place-resolution report; exact -> longest-alias-prefix room extraction -> portable pg_trgm trigram >=0.55 authoritative, RapidFuzz ranks/reports only, ties fail closed as ambiguous; offline suite 371 passed + 34 skipped)
Task 5: 26 golden parity vectors pinned offline as exact fractions (11/20 boundary included) and replayed via postgres-marked test that skips without TEST_DATABASE_URL; Docker not started
Task 5: read-only preview vs user_provided Fall 2026 CSV: 1253/1501 sections (83.5%) resolve pre-alias-growth, gate FAIL as expected; top unresolved are uncatalogued street addresses and same-street ambiguous ties — Task 10 alias-growth worklist
Task 5: committed explicit brief paths in one conventional commit on codex/ingestion (not pushed)
Task 6: complete, fail-closed (cab package: csv_source + measured meeting_schedule grammar + resolver wiring + gates; user-provided CSV hash-pinned in fixtures manifest as kind user_provided filling the four CAB WAF gaps; offline suite 505 passed + 34 skipped)
Task 6: gates on the real export: subjects 81/50 PASS, meeting-rows 1828/2000 FAIL, section-resolution 1253/1501 = 83.5%/90% FAIL -> no seeds published, reports/cab_fall_2026_place_resolution.md rendered; 3501 structured skips (3328 arranged-tba, 100 cross-listed, 72 online, 1 empty), 73 cancelled rows carried in raw, 100 embedded "in <loc>" rows enriched under cab-embedded outside the gate
Task 6: unblocking publication needs Task 10 alias growth (~57 distinct unresolved patterns, mostly uncatalogued street addresses: 2 Stimson Avenue, 101 Thayer (VGQ), 67 George, 135 Thayer, 155 George, Grant Recital, S. Frank Hall MARC, 111 Thayer-Watson, 190 Hope) and either export growth past 2,000 scheduled rows or an explicitly revised row threshold
Task 6: committed explicit brief paths in one conventional commit on codex/ingestion (not pushed)
Task 6B: complete (evidence-only alias growth: 17 aliases on 16 existing places + 14 new places, all grounded in the Overpass fixture or OSM-derived curated coordinates; addr:-fallback indexing for unnamed footprints; places job seam gazetteer/job.py; offline suite 559 passed + 34 skipped)
Task 6B: section resolution 1253/1501 (83.5%) -> 1499/1501 (99.87%), zero regressions on previously-resolved strings; survivors pinned as ungroundable (SMN121 801, one two-venue pipe row; embedded-only: 300 Richmond, National Press Building DC)
Task 6B: meeting-rows gate revised 2000 -> 1500 with the orchestrator's sign-off recorded verbatim in brief, report, and cab/job.py docstring (export maximum is 1,828 physically-scheduled rows; 3,328/5,275 records arranged/TBA); resolution gate 90% unchanged; all three gates PASS
Task 6B: published db/seeds/course_meetings.ndjson (1,828 rows) and db/seeds/places.ndjson (162 rows incl. the six dining halls) atomically; independent validation: contract/policy clean, sorted unique ids, place_id foreign keys clean (1,647/1,828 rows placed); db/seeds/manifest.json bundling stays Task 9
Task 6B: committed explicit brief paths in one conventional commit on codex/ingestion (not pushed)
Task 8: complete (athletics venue mapping + dining documentation; Task 7 not yet run — Task 8 depends only on 2, 4-5; offline suite 587 passed + 34 skipped)
Task 8: ONE live fetch of the SIDEARM composite ICS through CachedHttpClient recorded as fixtures/recorded/athletics/calendar.ics (170 VEVENTs, 50 distinct LOCATIONs); harness gained --groups with manifest merge so Task 3 evidence survives partial recaptures; athletics_ics joined the integrity-gate minimums
Task 8: home-venue rule is city+venue+SIDEARM "vs" summary + non-Brown blocklist — feed proves "Providence, R.I., Chapey Field at Anderson Stadium" is Providence College (away), so city prefix alone is disqualifying evidence; exclusions carry tested reasons (away-city 98, away-game 1, tba 6, no-location 3), never silent drops
Task 8: db/seeds/athletics_venues.json published atomically (schema v1, 11 mappings: 4 observed home venues + contract §5 required variants), fail-closed on unmapped home venues; every place_id verified against the catalog and published seeds
Task 8: gazetteer +2 evidence-grounded athletics places (goldberger-family-field curated from OSM pitch way 141129272 + Brown EAP adjacency; coleman-aquatics-center merges the Nelson Fitness Center footprint way/195508288 it physically occupies); places.ndjson republished 162 -> 164, gates PASS, 0 diagnostics
Task 8: dining BLOCKED — no requests sent (Pantheon-edge 403 to declared UA, evasion forbidden); ingest/dining/NOTES.md documents evidence + unblock paths (OIT allowlist or user-exported pages); reports/app_side_dependencies.md registers athletics-sidecar consumer, pending Task 7 sidecar, dining user input, and Task 9 manifest enforcement as blocking dependencies
Task 8: committed explicit brief paths in one conventional commit on codex/ingestion (not pushed)
