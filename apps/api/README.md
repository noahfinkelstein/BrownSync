# @brownsync/api

Single responsibility: the read API — Hono + zod-openapi routes per `DATA_CONTRACT.md` §3 over
the SQL layer in `db/migrations/0002_api.sql`. No writes, no auth in MVP.

## Routes (contract §3 — shapes are law)

| Route | Returns | Notes |
|---|---|---|
| `GET /api/events?from&to&bbox&category&q` | `{ events: EventOut[] }` | Overlap semantics; defaults `from=now`, `to=from+7d`; `bbox=w,s,e,n`; `q` ranks ilike substring hits above trigram similarity. Max 500. |
| `GET /api/events/:id` | `EventDetailOut` | `org` + `place` expanded; id must be a UUID (else 400). |
| `GET /api/places` | `{ places: PlaceOut[] }` | Gazetteer, name-sorted. |
| `GET /api/places/:id/activity?at` | `PlaceActivityOut` | Events overlapping `[at, at+24h]` + meetings in session at `at`. Default `at=now`. |
| `GET /api/orgs` | `{ orgs: OrgOut[] }` | Name-sorted. |
| `GET /api/orgs/:id` | `OrgDetailOut` | `upcoming` (soonest first) + `past` (latest first), 100 each. |
| `GET /api/meetings?at` | `{ meetings: MeetingOut[] }` | Day tokens (`M,T,W,Th,F,S,Su`) + America/New_York times expanded against `term_calendar`; unknown `srcdb` falls back to a wide Fall 2026 window (see 0002 migration comments). |
| `GET /api/now` | `NowOut` | Events in progress or starting ≤2 h + meetings now + `countsByCategory` (all 10 taxonomy keys, meetings count into `class`). |
| `GET /api/health` | `HealthOut` | Latest run + latest ok per source from `source_runs`; known sources with no runs report `status: "never"`. |
| `GET /api/openapi.json` | OpenAPI 3.1 | Same document as the committed artifact. |

Only canonical events (`canonical_id is null`) are returned; duplicates surface as
`mergedSources`. All error responses use the envelope `{ error: { code, message } }`:
`bad_request` 400 (contract-schema query/path validation), `not_found` 404,
`db_unavailable` 503 (connection-level failures), `internal` 500. CORS allows any
localhost origin; extend with `CORS_ORIGINS=https://a,https://b` for deploys.

## Architecture

```
src/routes.ts    createRoute definitions (shape-only; feeds OpenAPI)
src/app.ts       createApp(queries) — thin handlers: validate → query → map → validate response
src/queries.ts   ALL SQL (postgres.js over DATABASE_URL) behind the Queries interface
src/mappers.ts   snake_case rows → camelCase contract Out-shapes (pure, unit-tested)
src/db.ts        postgres.js client (lazy — no connection until first query)
src/errors.ts    error envelope + DB-unreachable classification
src/openapi.ts   emits packages/contract/openapi.json (Swift codegen input)
src/server.ts    @hono/node-server entry (API_PORT, default 8787)
```

Handlers never build SQL: tests inject a fake `Queries` (see `test/fixtures.ts`) so the suite
runs without a database; the SQL itself is exercised by CI's postgis job applying
`db/migrations/*.sql`. Response bodies are validated against the contract Out-schemas in every
environment except production, so mapper/SQL drift fails loudly in dev and CI.

## Commands

```bash
pnpm --filter @brownsync/api dev        # tsx watch, http://localhost:8787
pnpm --filter @brownsync/api test       # vitest — no DB needed
pnpm --filter @brownsync/api openapi    # regenerate packages/contract/openapi.json (commit it)
```
