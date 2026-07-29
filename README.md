# BrownSync

A live map of everything happening at Brown University — events, club meetings, classes in
session, athletics — aggregated from every reachable source onto a dark 2.5D campus map
(MapLibre GL, 3D building extrusions, College Hill bounds-locked).

<!-- screenshot placeholder: live map default view (fixture mode), full-bleed.
     Capture at 1440×900, commit as docs/screenshot-map.png, then replace this
     comment with: ![BrownSync live map](docs/screenshot-map.png) -->

- `ARCHITECTURE.md` — the ingestion → canonical → API → map data flow, the two-lane
  build split, sidecars, health, and the fail-closed publication gates
- `DATA_CONTRACT.md` — the shared contract both lanes integrate through (law)
- `CHANGELOG.md` — one entry per merged PR, staged for `v0.1.0`
- `BROWNSYNC_CLAUDE_CODE_HANDOFF_1.md` / `BROWNSYNC_CODEX_HANDOFF.md` — the original
  build plans (app lane / Python ingestion lane)

## Quickstart

Requires Node ≥ 24 and pnpm 11 (`corepack enable`). Docker is only needed for the
full-stack path.

```bash
pnpm install
pnpm --filter @brownsync/contract build   # contract exports dist/ — everything imports it
```

### Zero-backend (fixture mode)

No database, no network — the app serves a deterministic in-memory dataset that
follows the contract §3 query semantics:

```bash
VITE_USE_FIXTURES=1 pnpm --filter @brownsync/web dev   # http://localhost:5173
```

### Full stack (local Supabase)

```bash
pnpm db:start        # supabase start — local Postgres + PostGIS via Docker
pnpm db:reset        # apply db/migrations/*.sql (symlinked into supabase/migrations)
pnpm db:seed         # load db/seeds/*.ndjson — 166 places, 1,755 course meetings
pnpm dev             # turbo: web (5173) + api (8787) + ui gallery watchers
```

`.env.example` documents every variable; `db:seed` defaults to the local Supabase
`DATABASE_URL` printed by `supabase start`.

### One-shot pollers

```bash
pnpm poll livewhale --dry-run --fixture   # offline: replay the recorded response, print rows
pnpm poll all --dry-run                   # live: three polite fetches, no DB touched
pnpm poll all                             # live + upsert (needs DATABASE_URL)
```

Sources: `livewhale`, `athletics`, `bdh`, `all`. See `services/poller/README.md` for
sweep semantics, sidecar consumption, and per-source decisions.

### Verify

```bash
pnpm lint                                 # biome check .
pnpm typecheck && pnpm test && pnpm build # turbo across all packages
```

Tests never hit live servers — pollers replay recorded fixtures, the web app uses
MSW + the fixture dataset, and API handlers run against an injected fake query layer.
DB-semantics checks (`db/checks/*.sql`) run in CI against a migrated PostGIS container.

## Layout

| Path | Responsibility |
|---|---|
| `apps/web` | Vite + React 19 map client: live map, time machine, ⌘K search, place/org pages |
| `apps/api` | Hono read API (`DATA_CONTRACT.md` §3) + OpenAPI emission |
| `packages/contract` | Zod schemas (API + seed rows), category taxonomy, design-token values |
| `packages/ui` | Design system: tokens, re-themed primitives, 10 category glyphs, `/dev/ui` gallery |
| `services/poller` | TS pollers for structured feeds: LiveWhale JSON, athletics ICS, BDH RSS |
| `db` | Migrations (contract §1 verbatim), NDJSON seed loader, rollback-safe SQL checks |
| `db/seeds` | Published seed bundle + manifest — produced by the ingestion lane, never edited here |
| `ingest` | **Codex-owned** Python ingestion: gazetteer, CAB course meetings, sidecars |
| `map` | Canonical dark basemap `style.json` (imported directly by `apps/web`) |
| `scripts` | `basemap-extract.sh` — reproduce the committed Providence PMTiles cutout |
| `supabase` | Local dev config; `supabase/migrations` symlinks `db/migrations` |
| `reports` | Ingestion execution plan, task reports, cross-lane dependency register |
| `.github/workflows` | `ci.yml` (lint/typecheck/test/build + PostGIS jobs), `poll.yml` (poller runs) |

## Data sources & etiquette

| Source | Transport | Lane |
|---|---|---|
| LiveWhale events (`events.brown.edu`) | JSON feed | TS poller |
| Athletics schedule (`brownbears.com`) | ICS | TS poller |
| Brown Daily Herald | RSS | TS poller (buzz layer, no coords) |
| Campus gazetteer | OSM Overpass (recorded fixture) + curated catalog | Python ingestion |
| CAB Fall 2026 course meetings | User-provided CSV export (live API is behind an AWS WAF challenge) | Python ingestion |
| Athletics venues | Recorded SIDEARM ICS → sidecar | Python ingestion |
| Clubs directory, dining | **Blocked** — Pantheon edge answers HTTP 403 to the declared UA | Python ingestion |

Every request to Brown servers identifies as `BrownSync/1.0 (+contact email)`, at most
1 request/second per host, with ETag caching and exponential backoff. Bot-detection is
never bypassed: blocked sources stay blocked until an allowlist or a user-provided
export unblocks them (see `ARCHITECTURE.md` §8). Building footprints and addresses are
© OpenStreetMap contributors, ODbL 1.0 — attribution renders on the map and must be
preserved when redistributing `db/seeds/places.ndjson`.

## Deploy

Target: Cloudflare Pages (web) + Supabase (Postgres/API), pollers on GitHub Actions —
`.github/workflows/poll.yml` runs on `workflow_dispatch` today with its 10-minute cron
schedule written but commented until Phase 3 ops hardening flips it on. The deploy
configuration itself is the Phase 3E lane; its docs land with that branch.
