# @brownsync/db

Single responsibility: the canonical schema and its loader. `migrations/0001_init.sql` mirrors
`DATA_CONTRACT.md` §1 verbatim (contract changes require a version bump in the same PR).
`seed.ts` validates and loads `db/seeds/*.ndjson` (contract §6) with §2 upsert semantics.
`db/seeds/` content itself is produced by the Codex ingestion workstream — never authored here.
`supabase/migrations` symlinks to `migrations/` so `supabase db reset` applies the same files.
`checks/` holds rollback-safe psql assertion scripts (not migrations — they insert fixtures,
assert, and roll back); CI's postgis job runs them after applying migrations. Safe to run by
hand against any database: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/checks/0002_api_checks.sql`.
Run `0003_term_checks.sql` from the repo root — it re-applies `migrations/0003` via `\i`
(cwd-relative) to prove the Fall 2026 term-code reconciliation (202710 → 202610) is
idempotent.

`seed-check.ts` (`pnpm db:seed-check`) is the **offline** QA sweep over the published
`db/seeds/` artifacts — no database, no network. It loads every artifact through the same
contract schemas `seed.ts` uses (shared reader in `ndjson.ts`), verifies `manifest.json`
byte lengths + sha256 digests, checks every course-meeting and athletics-venue `place_id`
against the gazetteer (existence + usable centroid = renderable on the map), guards against
the retired 202710 term code, and prints a place-resolution/renderability summary. CI's
offline job runs it on every push; exits 1 on any failure.
