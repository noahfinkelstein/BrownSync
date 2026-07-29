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
