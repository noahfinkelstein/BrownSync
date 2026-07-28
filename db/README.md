# @brownsync/db

Single responsibility: the canonical schema and its loader. `migrations/0001_init.sql` mirrors
`DATA_CONTRACT.md` §1 verbatim (contract changes require a version bump in the same PR).
`seed.ts` validates and loads `db/seeds/*.ndjson` (contract §6) with §2 upsert semantics.
`db/seeds/` content itself is produced by the Codex ingestion workstream — never authored here.
`supabase/migrations` symlinks to `migrations/` so `supabase db reset` applies the same files.
`checks/` holds rollback-safe psql assertion scripts (not migrations — they insert fixtures,
assert, and roll back); CI's postgis job runs them after applying migrations. Safe to run by
hand against any database: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/checks/0002_api_checks.sql`.
