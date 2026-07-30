# BrownSync — Claude Code Build Handoff (MVP)

> **How to use:** open Claude Code in an empty repo named `brownsync`, place this file, `DATA_CONTRACT.md`, and (optionally) `BROWNSYNC_CODEX_HANDOFF.md` in the repo root, then paste the kickoff prompt from §9. This document is written to be executed with **parallel subagents/worktrees** — the phase plan in §2 tells the orchestrator what can fan out concurrently.

---

## 0. Mission

BrownSync is a live map of everything happening at Brown University: events, club meetings, classes in session, athletics — aggregated from every source we can reach, on a smooth dark 2.5D campus map (MapLibre with 3D building extrusions, in the spirit of Brown's official ArcGIS 3D campus map, but styled like an intelligence console, not a brochure). Web-first; the API must be clean enough that a native SwiftUI app can be added later without backend changes.

Non-negotiables:
1. **It must not look AI-generated.** §6 is the design law. No stock shadcn look, no purple gradient hero, no emoji headers, no `Inter` + default Tailwind slate card grid.
2. **Data breadth is the product.** The map ships with real data: LiveWhale events, Fall 2026 course meetings with buildings, the full club directory, athletics.
3. **Everything behind the read API in `DATA_CONTRACT.md` §3.** The frontend never talks to Brown's servers directly.

## 1. Stack (decided — do not relitigate)

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | Vite + React 19 + TypeScript (strict), TanStack Router + TanStack Query, Tailwind v4 + shadcn/ui primitives (heavily re-themed per §6), `cmdk` |
| Map | MapLibre GL JS via `react-map-gl/maplibre`; basemap = Protomaps PMTiles extract of Providence on Cloudflare R2 (fallback: Protomaps free API), styled dark in-repo (`map/style.json`); `fill-extrusion` 3D buildings; deck.gl `MapboxOverlay` for glow/pulse layers |
| API + DB | Supabase (Postgres + PostGIS + pg_trgm), schema from `DATA_CONTRACT.md` §1; read API as Postgres views + RPC exposed through a thin **Hono** route layer in `apps/api` (gives us OpenAPI via `@hono/zod-openapi` → future Swift codegen). Local dev: `supabase start` (Docker) |
| TS-side ingestion | `services/poller` — Node/TS workers for *structured* feeds (LiveWhale JSON, athletics ICS, BDH RSS) on `pg_cron`/scheduled invocation. (Python scrapers for CAB/clubs/OSM are Codex's parallel scope — see §7. If Codex isn't used, subagents build them here in Python under `ingest/`.) |
| Validation | Zod at every boundary; DB types generated (`supabase gen types`), API types from OpenAPI |
| Testing | Vitest (unit), Playwright (e2e + visual snapshots), pgTAP optional |
| Quality | Biome (lint+format), TypeScript `strict` + `noUncheckedIndexedAccess`, Conventional Commits, CI on GitHub Actions |
| Auth | None in MVP (public read). Google OAuth `hd=brown.edu` (server-verified claim) is a post-MVP stub — leave a clean seam |

Languages: TypeScript (app/API/pollers), Python (scrapers — best scraping ecosystem), SQL (migrations). No Rust/Go — nothing here is CPU-bound enough to justify a third toolchain; PostGIS + GL rendering do the heavy lifting.

## 2. Orchestration plan (parallel workflows)

Run phases sequentially; **within each phase, fan out one subagent per box, each in its own git worktree/branch**, merging via small stacked PRs (§8). Boxes in the same phase have no file overlap by design.

### Phase 0 — Foundation (single agent, ~one PR, everything depends on it)
Scaffold monorepo (pnpm + Turborepo + Biome + tsconfig base + CI skeleton), `db/migrations/0001_init.sql` verbatim from the contract, `supabase start` config, seed loader `db/seed.ts` (NDJSON per contract §6), `packages/contract` (Zod schemas mirroring contract §3 + category taxonomy + color/icon tokens), empty `apps/web`, `apps/api`, `services/poller` packages that build and pass CI.

### Phase 1 — parallel fan-out (5 agents)
| Agent | Scope | Key outputs |
|---|---|---|
| **A. Basemap & map shell** | Protomaps Providence extract (`pmtiles extract` from build script, commit the ~few-MB file or R2 upload script), dark style.json (§6.3), map component with 3D extrusions, camera bounds locked to College Hill, POI labels pruned | `apps/web/src/map/*`, `map/style.json` |
| **B. LiveWhale + ICS + RSS pollers** | `services/poller`: fetch → Zod-parse → normalize → upsert per contract §2; category mapping; recurrence expansion; `source_runs` logging; runnable as one-shot CLI (`pnpm poll livewhale`) + scheduled | `services/poller/*`, fixtures + unit tests from recorded API responses |
| **C. Read API** | Hono + zod-openapi routes per contract §3 over Postgres views (`/events`, `/now`, `/meetings`, `/places`, `/orgs`, `/health`); bbox/time/category/q filtering in SQL; OpenAPI JSON emitted to `packages/contract/openapi.json` | `apps/api/*` |
| **D. Design system** | Tokens (§6.1), typography, icon set (§6.2: 10 category glyphs as hand-tuned SVG sprites, both DOM and map-sprite builds), re-themed shadcn primitives, Storybook-lite page (`/dev/ui`) rendering every component in both densities | `packages/ui/*` |
| **E. Gazetteer + seeds** *(skip if Codex runs — §7)* | Python: Overpass building ingest, alias table, CAB Fall-2026 scrape (payloads in contract §5), clubs directory scrape → NDJSON seeds | `ingest/*`, `db/seeds/*` |

### Phase 2 — parallel fan-out (4 agents; needs A–D merged)
| Agent | Scope |
|---|---|
| **F. Live map view** | Events as GeoJSON circle+symbol layers (GPU, cluster on, category colors/icons), deck.gl pulse on events starting ≤30 min, hover cards, click → detail panel; classes-in-session layer from `/meetings` (building fill intensity by active class count); layer toggle rail |
| **G. Time machine** | Time scrubber (custom Radix slider): NOW ● live mode + drag across ±7 days; URL-synced (`?at=`); all layers re-filter through one `useTimeCursor()` store; "tonight / this weekend" presets |
| **H. Browse & search** | ⌘K palette (events, places, orgs, courses), list view synced to map viewport (split pane), org and place profile pages (place page = "everything happening here"), category filter chips |
| **I. Ops & polish** | `/health` status strip ("LiveWhale ✓ 4 min ago"), empty/error/loading states per §6.4, PWA manifest + icons, OG tags, Plausible or PostHog analytics (existing PostHog project available), Playwright e2e: load map → scrub time → open event → search |

### Phase 3 — integration hardening (single agent + review fan-out)
Cross-source dedup job (contract §2 blocking + trgm), seed-data QA sweep (every seeded event with coords renders; % place-resolution report), performance pass (map ≤ 16 ms frame with 1k points; `pnpm build` bundle budget 450 KB gz excl. map libs), accessibility pass (keyboard nav on list/palette/panel, contrast per §6), README + `ARCHITECTURE.md`, deploy (Cloudflare Pages + Supabase; poller on scheduled worker or GH Actions cron).
Then: **adversarial review fan-out** — 3 parallel reviewer subagents (correctness/data-integrity, frontend/UX-fidelity vs §6, security/robustness of scrapers+API) file issues; fix before tagging `v0.1.0`.

## 3. Product spec (MVP screens)

1. **Map (default, full-bleed)** — dark campus, 3D buildings, live event pins, ambient class-activity fill, header = wordmark + search + time scrubber + category chips + health dot. Right slide-over detail panel (event: what/when/where/who/source badge + confidence, "open source ↗", add-to-calendar ICS). Left rail = layer toggles.
2. **List/split view** — viewport-synced, grouped by time ("Happening now", "Next hour", "Tonight"…).
3. **Place page** `/p/:id` — building photo-less header (name, kind, aliases), timeline of everything there today/this week, mini-map.
4. **Org page** `/o/:id` — club info, category, links, upcoming + past events.
5. **`/dev/ui` + `/health`** — internal.

Explicitly out of MVP: auth, user submissions, Instagram ingestion, shuttle layer, notifications, iOS.

## 4. Data requirements at launch (Definition of Done gates)

- ≥ 300 upcoming LiveWhale events rendered with coords
- Fall 2026 course meetings ingested: ≥ 90 % of sections with a parseable building resolved to a `place_id`; classes layer answers "what's meeting in Salomon right now"
- Full undergrad club directory (≈ 400+ orgs) as org pages with category icons; clubs with LiveWhale groups linked to their events
- Athletics schedule through the fall, home games on venues
- Every pin traces to a live source URL; `/health` green for all pollers 48 h running

## 5. Map spec

- Camera: bounds-locked around `41.820,-71.410 → 41.834,-71.393`, default pitch 45°, bearing ~-15° (campus reads "up the hill"), maxPitch 60. Smooth `flyTo` on selection.
- 2.5D: OSM building footprints as `fill-extrusion` (height from levels × 3.2 m fallback 12 m). Brown-owned buildings slightly lighter than city fabric. Selected building: emissive edge glow (deck.gl PolygonLayer overlay).
- Event pins: circle layer, radius by imminence, color by category token; icons from custom sprite at zoom ≥ 16; supercluster below. **No DOM markers.**
- Class activity: building fill saturation scales with count of in-session meetings at the time cursor.
- Perf: single GeoJSON source updated via `setData`; layers filter client-side on the time cursor (no refetch while scrubbing); target 60 fps desktop / no jank on mid-tier mobile.

## 6. Design law (the "does not look vibe-coded" section)

**6.1 Tokens.** One dark theme only in MVP. Background stack `#0B0E12 / #11151B / #171C24`; line `#232A35`; text `#E8ECF1 / #8B94A3 / #566070`. **Accent is a single restrained signal color** — `#D96C3D` (heat orange) — used ONLY for live/now indicators and primary actions. Category colors: 10 desaturated hues tuned on dark (chroma-matched in OKLCH, ~0.09 C, L ~0.72 — generate and hand-check against the basemap; run the dataviz palette validator if available). Radius: 6 px max. Shadows: none except the detail panel (1 px line + subtle ambient). No gradients anywhere except map glow effects.
**6.2 Type & iconography.** Display/UI: `Söhne`-class grotesk — use **Instrument Sans** (open) — with tight tracking on headers; data/timestamps/coords: **IBM Plex Mono**. Type scale 12/13/15/18/24 only. Category icons: 10 custom 16-px geometric glyphs drawn as a single SVG sprite sheet (consistent 1.5 px stroke, squared terminals) — **not** lucide defaults; build both DOM sprite and MapLibre `addImage` variants.
**6.3 Cartography.** Basemap desaturated near-monochrome: roads `#1C222B`, water `#0D1319`, greens `#131A16`, labels ≤ 3 zoom-gated tiers, hide all commercial POI clutter. The data layer is the only colorful thing on screen. Attribution: OSM/Protomaps, small, bottom-right.
**6.4 Behavior.** Density is a feature — tables and timelines over cards; card grids are banned outside org browse. Motion: 120–160 ms ease-out micro-transitions; the only ambient animation is the ≤30-min pulse. Every async region has designed skeleton/empty/error states with real copy ("No events in view — widen the time window" + action), never bare spinners. Timestamps: "19:04 · in 26 min" (mono). Provenance visible: source badge + confidence dot on every event. Full keyboard support; no `cursor: not-allowed` dead ends.
**6.5 Litmus.** If a screen would pass as a screenshot from Palantir Gotham, a Bloomberg terminal, or Linear's dark mode — ship. If it would pass as a v0/Lovable template — redo it.

## 7. Split with Codex (if running both)

Codex owns `ingest/**` + `db/seeds/**` ONLY (Python scrapers: CAB, clubs, OSM gazetteer, dining discovery — see `BROWNSYNC_CODEX_HANDOFF.md`). Claude Code owns everything else and must not write in `ingest/`. Integration point = the contract's DB schema/NDJSON seeds, nothing else. If Codex is NOT running, assign its scope to agent E in Phase 1. Either way, Phase 2 must run against whatever seeds exist — build with fixtures so frontend agents never block on live scrapes.

## 8. Engineering practices

- **Stacked PRs** (Graphite `gt` if available, else manual branch stacks): each agent lands 1–3 small reviewable PRs, not one megadiff. `main` always green.
- CI (GitHub Actions): typecheck, Biome, Vitest, build, Playwright smoke on PR; poller runs record fixtures — tests never hit Brown servers.
- Scraper etiquette: identify via UA `BrownSync/1.0 (+contact email)`, ≤ 1 req/s per host, cache ETags, exponential backoff, obey robots for anything beyond the documented endpoints.
- Secrets only via env (`.env.example` maintained); no keys in repo. Licenses: OSM attribution required.
- Every package has a README stating its single responsibility. `ARCHITECTURE.md` has the ingestion→canonical→API→map data-flow diagram.
- Commit style: Conventional Commits; changelog generated at tag.

## 9. Kickoff prompt (paste into Claude Code)

```
Read BROWNSYNC_CLAUDE_CODE_HANDOFF.md and DATA_CONTRACT.md in full. You are building
the BrownSync MVP exactly as specified. Use a workflow/subagent orchestration:
execute Phase 0 yourself, then fan out Phase 1 agents A–E in parallel (git worktrees,
one branch each, no file overlap), merge via small stacked PRs, then Phase 2 F–I in
parallel, then Phase 3 with a 3-reviewer adversarial pass. Codex is [running / not
running] — [omit / include] agent E accordingly. The design law in §6 and the data
contract are non-negotiable; the Definition of Done gates in §4 decide when you stop.
Ask me only for: Supabase project credentials, Cloudflare account, and the contact
email for scraper user-agents. Begin with Phase 0 now.
```

## 10. Post-MVP backlog (do not build now; keep seams)

Shuttle live layer (PassioGo) · Today@Brown email parser + LLM structured extraction (`ingest/extract/`) · user-submitted events with review queue · Instagram opt-in ingestion · Google OAuth @brown.edu · Supabase Realtime pin pop-in · Meilisearch · SwiftUI + MapLibre Native client from `openapi.json` · RISD CampusGroups.
