# BrownSync — Ops Deck Launch Handoff

**Date:** 2026-08-07
**Audience:** an orchestrating Claude session with the full ops deck available — the `Workflow` tool, `Agent` subagents, git worktree isolation, dynamic loops (`ScheduleWakeup` / `/loop`), and scheduled tasks (`create_trigger` / `send_later`).
**Repo:** `~/Developer/projects/BrownSync` (pnpm monorepo, Turbo, Biome; Node 24 + Python 3.12/uv)
**Prod:** [brownsync.pages.dev](https://brownsync.pages.dev) (web) · [brownsync-api.noahfinkelstein.workers.dev](https://brownsync-api.noahfinkelstein.workers.dev) (API over Supabase via Hyperdrive)
**Owner:** Noah Finkelstein (`nbfinkelstein@gmail.com` / `noah_finkelstein@brown.edu`)

**Mission:** take BrownSync from "live but thin and stale" to **launched**: the daytime map rendering bug fixed, every data source current and *continuously* refreshing, a wider set of information sources (major-outlet news + sanctioned social), a simpler UI, and an architecture that survives adversarial review. You are expected to orchestrate — fan out workflows, run fix→verify loops until dry, and install the recurring automation — not to grind through this single-threaded.

**Standing instructions from the owner (apply to every session this handoff spawns):** post a progress update at each phase boundary, and back work up continuously — commit at every green milestone and push the branch, so nothing is lost if a session dies.

---

## 1. Read first — 20 minutes, non-negotiable

In order:

1. `ARCHITECTURE.md` — the two-lane system (TS poller lane vs Python ingest lane) and why `DATA_CONTRACT.md` is the only permitted coupling.
2. `DATA_CONTRACT.md` — §1 schema, §2 upsert semantics, §3 API routes, §4 taxonomy, §6 seed shapes. Every row in both lanes validates at the boundary.
3. `BROWNSYNC_V2_PLAN.md` — the approved three-lane v2 plan, what already landed (Lane A steps 1–6, Lane B steps 1–6, P0/P1), and the **Legal and ToS gates table (G1–G8)**. That table is law; it is restated in §2 below.
4. `handoffs/` — the six existing lane handoffs. `CODEX_LANE_A_MAP_UI.md` and `CURSOR_LIGHT_CARTOGRAPHY.md` are required reading for Workstream A; `CODEX_LANE_B_DATA.md` for Workstream B.
5. `reports/app_side_dependencies.md` — the cross-lane dependency register. Nothing claims cross-lane integration until a consumer test passes; this protocol caught a real bug once (athletics sidecar envelope) and skipping it is how this project breaks.
6. `DEPLOY.md`, `.github/workflows/` — how prod actually ships and what runs on cron today.

Use `Explore`/read-only subagents for this recon so your main context stays clean — you need the conclusions, not the file dumps.

## 2. Rules that never bend

These are inherited from the existing discipline. Every workflow you author must carry them as constraints in agent prompts.

1. **Legal gates.** BDH is **headline-only** (`description: null`, DB CHECK physically rejects body text — G1). `providenceri.gov` and `today.brown.edu` are never crawled (G2/G3). Sidechat is never scraped (G6 — not the owner's to clear). Instagram is opt-in oEmbed only (G7). Reddit needs approved API access before r/brownu ships (G8). Dining ESB and ArcGIS are cleared on owner authority with attribution carried on every artifact (G4/G5). Any *new* source gets a robots.txt + ToS check recorded in `source_registry` **before** the first request.
2. **Scraper etiquette is absolute.** Declared UA `BrownSync/1.0 (+contact)`, ≤1 req/s/host, ETag caching, backoff, bot-detection never bypassed. A blocked source is a recorded refusal, never a workaround.
3. **CI never touches a live server.** Every source is tested against one recorded, hash-pinned fixture. Web tests run on MSW + the fixture dataset; DB semantics prove out in `db/checks/*.sql` against a disposable PostGIS container.
4. **Gates fail closed.** Producers validate after building full output; any failure leaves the previous artifact untouched, records the run `partial`, exits 1. Gate thresholds move only by explicit, recorded sign-off.
5. **Nothing is hard-deleted.** Upsert on `(source, source_id)`; disappearance within a fully-fetched window flags `is_canceled`.
6. **Contract changes are bilateral.** `DATA_CONTRACT.md` changes bump the version and update both lanes in the same PR. `packages/contract/src/api.ts` is append-only. Never renumber a pushed migration; Lane B owns `0005–0009`, Lane C owns `0010–0019`.
7. **Design law stays test-enforced.** 6 type sizes app-wide, ≤3 visible label tiers, one ambient animation, every label-bearing surface ≥4.5:1 at every daylight level, `getStyle().layers.length ≤ 40`. Where a change bends a law, the bend is bounded by a *new* test — never by deleting the old one.
8. **Backups.** Work in worktree branches (`lane/…` or `ops/…`), commit small and often, push after every green milestone. Long-running orchestration sessions write a dated progress report to `reports/ops/` before they end.

## 3. Phase 0 — Stabilize before orchestrating

The tree is **dirty on `main`** as of this handoff: modified files across `apps/api/src/*` (app, auth, mappers, queries, routes, server, worker), `.github/workflows/ci.yml`, `DATA_CONTRACT.md`, `DEPLOY.md`, and more. Do not fork lanes off an undiagnosed dirty tree.

1. `git status` + `git diff` triage: identify what the in-flight change is (the file set suggests API/auth work mid-landing). Either finish and commit it, or stash it with a note in `reports/ops/`. Decide deliberately; record the decision.
2. Baseline: run the full suite (`pnpm -r test`, `pnpm --filter @brownsync/web e2e`, `uv run --directory ingest pytest`, `tsc --noEmit` per package). Record the baseline in `reports/ops/<date>-baseline.md`. Every later workflow measures against this.
3. Probe prod: hit `GET /api/health` and record per-source staleness verbatim. Load brownsync.pages.dev and screenshot the map at 3 fixed cameras (see §4). This is your before-state.

Only after Phase 0 is committed do the workstreams fork.

## 4. Workstream A — Fix the daytime map (white splotches)

**Symptom (owner report):** the map "looks weird during the day time — random white splotches."

**Context you must load:** the app chrome flipped to a light Brown-palette theme; `handoffs/CURSOR_LIGHT_CARTOGRAPHY.md` specs the map-side light conversion and — critically — explains that the conversion **inverts a measured contrast constraint**: `MAX_SURFACE_LUMINANCE = 0.0258` in `apps/web/src/map/daylight.ts` becomes a *minimum* on a light basemap. White splotches during daylight hours are exactly the failure shape you'd expect from a half-landed light conversion or a daylight ramp interpolating against wrong-polarity endpoints.

**Suspect files (start here, don't stop here):**
`apps/web/src/map/daylight.ts` (NIGHT/DAY palettes, ramp compression), `map/style.json` (19 paint layers; background/earth/landuse fills), `campusBuildings.ts` (brick/stone/glass ramp), `campusLandmarks.ts` (green/field fills), `campusAmenities.ts` + `eventsLayer.ts` (halos that assume a dark ground), `DaylightLayer.tsx` (setLight/setSky wiring). Also check data-shaped causes: missing `height` (86% of Providence buildings lack it; `coalesce(height, 12)`), landuse/water polygons with no fill at day palette, and sky/light settings washing out extrusion faces.

**Orchestration pattern — reproduce → localize → fix → prove, as a loop:**

1. *Reproduce deterministically.* Run `pnpm --filter @brownsync/web dev --port 5199 --mode fixtures`, drive the map via the dev handle `window.__brownsyncMap.jumpTo(...)` and the time cursor. Capture screenshots at 3 cameras (Main Green z16.4/pitch 55; z14.5 flat/extrusion crossover; a wide z13) × hourly sweep 00:00→23:00. Identify exactly which hours/layers produce splotches.
2. *Localize with a diagnostic fan-out.* Workflow: parallel agents each with a distinct lens — (a) daylight interpolation math vs the light-mode inversion, (b) style.json layer-by-layer paint audit at day palette, (c) feature-state/hover paint, (d) tile/data gaps (missing heights, unfilled polygons). Each returns a ranked hypothesis with the *specific expression* it indicts. Then adversarially verify the top hypotheses before writing a fix — a splotch has more than one plausible cause and a wrong fix here costs a repaint of the whole ramp.
3. *Fix under the contrast law.* Derive colors numerically (preserve hue, walk lightness to the contrast target — never eyeball; `daylight.test.ts` iterates level 0→1 in 0.02 steps and must stay green, with the inequality direction updated if the light conversion is being completed).
4. *Prove with a golden.* Land/extend `apps/web/e2e/cartography.e2e.ts`: golden screenshots at fixed camera + fixed daylight hours (at minimum 02:00, 09:00, 13:00, 17:00, 21:00) so daytime rendering becomes a reviewable PR diff and this class of bug can't silently return.
5. *Loop until dry:* repeat the hourly screenshot sweep; exit only when zero anomalies across all 24 hours × 3 cameras, all contrast/style/perf tests green.

If, mid-fix, the light basemap proves genuinely worse than the deliberate dark-map pairing, the CURSOR handoff's escape hatch stands: say so, stop, and report — reverting is one commit.

## 5. Workstream B — Current data, continuously updated

**Symptom (owner report):** "most of the info is old, not current." The seed CSVs are late-July snapshots; the question is whether the *pipelines* are running and healthy, not just the data's age.

**Diagnose first (one workflow, parallel probes):**

- `GET /api/health` per-source staleness vs each source's threshold.
- GitHub Actions: are `poll.yml` and `refresh.yml` (dining, `12 9 * * *`) actually green on schedule? Cron workflows on default branches get disabled after 60 days of repo inactivity — check for that failure mode explicitly.
- `source_runs`: last `ok` per source. The standing bug where `livewhale` could never report `ok` (1000-row cap) was fixed by date-window sharding in Lane B step ~4 — verify it *reports ok in prod*, not just in tests.
- Academic-time correctness: it is now Fall 2026 move-in season. Verify `term_calendar`, the Fall 2026 course meetings (1,755 rows, 94% resolved), athletics schedule, and library hours all reflect the *current* term, and that event queries window correctly around today's date.

**Then finish Lane B's remaining steps — this is the permanent fix for staleness:**

- **`source_registry`-driven dispatcher** (the keystone): one `* * * * *` Worker cron running a registry-driven dispatcher (`limit 3` per tick, `order by last_started_at nulls first`) — cadence, staleness threshold, etiquette interval, licence, backoff, and an `enabled` kill switch all as *rows*, replacing hardcoded cron. Blocked sources ship as disabled rows with the refusal recorded.
- Contract v2 tables (`articles`, `place_hours`, `dining_menus`, `amenities`, `academic_calendar`, `feed_entries`, …), source producers, `packages/sources/` extraction, `ingest.yml`. Migrations `0005–0007` are landed; continue in Lane B's allocated range.
- The poller conflict-clause fix (`coalesce(excluded.place_id, resolved.place_id, events.place_id)`) so refreshes stop nulling resolved places — verify it's live, not just specced.

**Continuous updates are the product's job; auditing them is yours.** The refresh loop must live in Worker cron / GitHub Actions so it runs with no Claude session attached. On top of that, install **one recurring scheduled task** (server-side `create_trigger`, not local cron): a daily freshness audit that hits `/api/health`, compares every enabled source against its registry threshold, checks the last runs of the cron workflows, and — only if something is stale or red — investigates, fixes or files, and reports. Write its prompt as a complete standalone instruction (each firing is a fresh session): repo path, the §2 rules, the health URL, and "commit any fix on a branch and push."

**Exit criteria:** every enabled source within threshold for 7 consecutive days; `livewhale` reporting `ok`; HealthStrip honest in prod; the daily audit trigger installed and observed firing.

## 6. Workstream C — Wider information sources (news + social)

Goal: a unified feed where campus events sit alongside *current coverage of Brown* from major outlets and sanctioned social. Every candidate source goes through the same pipeline: **robots/ToS check → `source_registry` row (or recorded refusal) → recorded hash-pinned fixture → producer with a fail-closed gate → staleness threshold → feed weight.**

Ordered by value ÷ risk:

1. **`brown.edu/news`** — the sanctioned public university feed (G3's designated alternative to today.brown.edu). Highest value, lowest risk. Do first.
2. **Major-outlet coverage of Brown** (ProJo, Boston Globe, NYT, AP, higher-ed trades): headlines + links + source + date only — never bodies (the `articles.license` CHECK architecture from Lane B applies to every outlet, not just BDH). Prefer per-outlet RSS/sitemaps where ToS permits; use Google News RSS query feeds as discovery where it doesn't; record refusals for outlets that prohibit indexing. Dedup per Lane B's three layers: URL canonicalization, title trigram at 0.72, simhash banding for syndication.
3. **BDH** — already flowing headline-only. Owed follow-up: the permission email to `herald@browndailyherald.com` (draft it for Noah; do not send without his sign-off).
4. **r/brownu** — titles/permalinks via Reddit's API, **blocked on G8 approval**. Prepare the producer against a recorded fixture and ship it disabled; draft the Reddit application for Noah early (lead time is the constraint).
5. **Instagram opt-in** — club-supplied permalinks + official oEmbed only, riding Lane C's club-page claim flow.
6. **Time-boxed spikes** (≤30 min each, off critical path): `theindy.org/api/article` listing routes; `goprovidence.com` JSON-LD Event markup via raw-HTML fetch (the earlier 403s were REST probes and prove nothing about JSON-LD).
7. **Never:** Sidechat scraping (G6), Instagram feed harvesting, providenceri.gov, today.brown.edu auth. If an agent proposes any of these, that's a workflow-prompt failure — tighten the constraint block.

This workstream parallelizes well: one workflow, `pipeline()` over the source list — vet → fixture-record → producer+gate → consumer test — with an adversarial legal-review agent as a stage on *every* source before its registry row flips `enabled`.

## 7. Workstream D — Simpler, easier UI

Approach: **audit → converge → implement → verify**, not taste-driven tinkering.

1. *Audit fan-out.* Parallel reviewer agents against the running fixture app + screenshots, each with one lens: (a) first-week freshman who's never seen it — can they answer "what's happening near me right now?" in <10s; (b) mobile/touch; (c) accessibility (WCAG AA pass on the real DOM); (d) information density — what can be removed or demoted; (e) interaction cost — clicks/keystrokes for the top 5 tasks. Merge and dedupe findings; adversarially verify each against the running app before it becomes work.
2. *Known intended direction* (from the v2 plan, weigh findings against it): scrubber → full-width bottom dock; header slot → live `NowBar`; layer rail → grouped, collapsible, URL-synced `LayerPanel` (~28 amenity toggles **default-OFF**, progressive disclosure); unified feed (Lane A steps 7–10 remain: type scale, header, layer panel, feed).
3. *Simplification bias.* Prefer deleting and demoting over adding. Candidates: search-first entry, fewer visible toggles, one obvious "now" view as the landing state, empty/loading/error states designed rather than incidental (§6.4 states are already a norm — extend it).
4. *Verify.* Every UI change: type-scale + style-law tests green, e2e green, perf tripwire green (p50/p95 per map step), before/after screenshot pair in the PR. Re-run the freshman-lens agent on the built result as the acceptance test.

## 8. Workstream E — Architecture + SWE hardening

The repo's discipline is unusually strong; your job is to close the *registered* gaps and then attack the whole thing.

Known registered gaps (verify current status in `reports/app_side_dependencies.md` first — some may have landed since):

- Sidecar file schemas defined by lane coordination, not by the contract — owed a contract bump.
- Manifest/bundle-integrity verification in the app-side loader (`db/seed.ts`) — 0005 claims to wire this; confirm with a mixed-generation test.
- P0 named OpenAPI schemas (`.openapi("Event")` etc.) — blocks Lane C/iOS codegen entirely; confirm landed.
- The `home`-tag Providence-prefix approximation on athletics; the `organization_livewhale_groups` producer still pending on the clubs source.

Then the **adversarial review workflow** (the Phase 3 protocol, scaled up): dimensions = correctness, security (auth/RLS/Worker secrets — especially the in-flight `apps/api` auth work from Phase 0), data integrity (contract drift, upsert semantics), legal/licence compliance, performance (bundle budget, query plans, layer count), test honesty (tests that can't fail, fixtures that drifted from reality). Pipeline: per-dimension finder → adversarial verifier per finding (independent skeptic prompted to *refute*; drop what doesn't survive) → fix in worktree-isolated agents → re-verify. Loop until a full round returns nothing new. This protocol has caught real bugs in this repo twice (athletics envelope, LiveWhale dedup-on-bare-`id` near-miss); trust it over any single reviewer.

Also: CI green and fast (Turbo caching honest), Biome clean, no snapshot rot, `.env.example` current, `DEPLOY.md` reproducible from scratch, CHANGELOG maintained.

## 9. Orchestration playbook — using the deck to capacity

- **Workflows** for anything with fan-out: the §4 diagnostic fan-out, §6 source pipeline, §7 audit panel, §8 review rounds. Default to `pipeline()` (no barriers unless a stage truly needs *all* prior results — dedup and zero-count early-exit are the legitimate cases). Give parallel *file-mutating* agents `isolation: 'worktree'`; readers don't need it. Use structured-output schemas for findings so merging is code, not prose-parsing.
- **Adversarial verify everywhere it's cheap to be wrong loudly:** any finding that will trigger a code change gets an independent refutation pass first. Diverse lenses beat N identical skeptics when a thing can fail more than one way.
- **Dynamic loops** (`ScheduleWakeup`) for external waits: CI runs (~one check sized to the run, not 60s polls), deploy propagation, the 7-day freshness observation window. Long fallback heartbeats (20–30 min) when a Monitor or task notification is the primary signal.
- **Scheduled tasks** (server-side `create_trigger` — never local cron, which dies with the session) for the recurring layer: the §5 daily freshness audit; optionally a weekly integrate task (rebase active lanes onto `main`, full suite, report). Prompts must be standalone — fresh session, no memory of this conversation.
- **Subagents to protect context:** `Explore` for recon sweeps, `general-purpose` for scoped implementation; the orchestrator holds conclusions and decisions, not file dumps.
- **Sequencing:** Phase 0 → then A, B, C, D in parallel worktrees (E's review runs as the merge gate for each). The one hard v2 ordering constraint stands: Lane A's campus-buildings GeoJSON precedes any Lane C presence work. B step 12 (feed model in `apps/web/src/browse/`) rebases on A step 10 — never concurrent.
- **Reporting cadence:** progress update at every phase boundary; `reports/ops/<date>-<topic>.md` per orchestration session; commit + push at every green milestone. If a workflow bounds its coverage (top-N, sampling), say what was dropped.

## 10. Launch checklist

- [ ] Phase 0 dirty tree resolved and baseline recorded
- [ ] Map: zero daytime anomalies across 24h × 3 cameras; cartography golden e2e landed; contrast/style/perf tests green
- [ ] Data: all enabled sources within staleness threshold 7 consecutive days; `livewhale` reports `ok`; dispatcher + registry live; daily freshness audit trigger installed and firing
- [ ] Sources: brown.edu/news + ≥2 major-outlet feeds live headline-only with licence CHECKs; BDH permission email drafted for Noah; Reddit application drafted; refusals recorded for everything declined
- [ ] UI: audit findings verified→fixed; Lane A steps 7–10 done; freshman-lens acceptance pass; e2e + perf green
- [ ] Architecture: registered gaps closed or explicitly re-registered with reasons; adversarial review run to dry; security pass on auth/RLS/secrets
- [ ] Legal: G1–G8 table re-reviewed against everything that ships; attribution strings on all ArcGIS/dining artifacts
- [ ] Deploy: prod web + API green from a clean-room follow of `DEPLOY.md`; `/api/health` honest in the UI
- [ ] Owner sign-off from Noah on: any gate-threshold change, anything G-table-adjacent, the launch itself

Anything a session cannot resolve autonomously — a legal-gate judgment, an irreversible choice, a gate-threshold revision — gets prepared to the decision point, written up in `reports/ops/`, and surfaced to Noah rather than guessed.
