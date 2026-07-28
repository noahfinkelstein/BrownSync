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
