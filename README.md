# BrownSync

A live map of everything happening at Brown University — events, club meetings, classes in
session, athletics — aggregated from every reachable source onto a dark 2.5D campus map.

Full architecture and data-flow docs land in Phase 3 (`ARCHITECTURE.md`). Until then:

- `BROWNSYNC_CLAUDE_CODE_HANDOFF_1.md` — build plan (app side)
- `BROWNSYNC_CODEX_HANDOFF.md` — build plan (Python ingestion side)
- `DATA_CONTRACT.md` — the shared contract both sides integrate through (law)

## Layout

| Path | Responsibility |
|---|---|
| `apps/web` | Vite + React map client |
| `apps/api` | Hono read API (DATA_CONTRACT §3) |
| `packages/contract` | Zod schemas, taxonomy, design tokens |
| `packages/ui` | Design system (tokens, primitives, icon sprites) |
| `services/poller` | TS pollers for structured feeds (LiveWhale, athletics ICS, BDH RSS) |
| `db` | Migrations (contract §1 verbatim) + NDJSON seed loader |
| `ingest`, `db/seeds`, `reports` | **Codex-owned** Python ingestion workstream — do not edit here |

## Dev

```bash
pnpm install
pnpm db:start        # local Supabase (Docker)
pnpm db:reset        # apply migrations
pnpm db:seed         # load db/seeds/*.ndjson when present
pnpm dev             # turbo: web + api watchers
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
