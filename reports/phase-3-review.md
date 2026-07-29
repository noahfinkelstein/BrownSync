# Phase 3 final review — findings & dispositions

Integration branch: `integration/phase-3` (worktree `BrownSync-wt/P3INT`).
Review input: Phase 3 integration state (wiring commits `50fb0ca`, `2766912`,
`c7e5b38`) + confirmed findings from the `correctness-data` and
`ux-design-law` lanes. Every finding was re-verified against source before
fixing; all fixes are TDD (failing test first) where testable.

## Findings table

| # | Lane | Severity | Finding | Disposition |
|---|------|----------|---------|-------------|
| 1 | correctness-data | important | Dedup blocking could NEVER pair an athletics home game (place_id set, `lat/lng` NULL — `services/poller/src/athletics/normalize.ts`) with its LiveWhale twin (coords set, `place_id` NULL — `services/poller/src/livewhale/normalize.ts`). All three blocking arms in `buildCandidatePairsQuery` were provably false for that pair; the coord arm was dead code for its stated purpose and home games listed by both feeds stayed visible duplicates forever. | **FIXED** — `services/poller/src/dedup/index.ts`: the candidate CTE now left-joins `places` and blocks on EFFECTIVE coordinates (feed coords when a full pair is present, else the gazetteer centroid of the resolved place). Unit-tested (SQL shape, `services/poller/test/dedup.test.ts`) and integration-tested with the exact production row shapes (`rugby` scenario, `services/poller/test/dedup.integration.test.ts`); generated SQL re-validated with the real PG parser (libpg_query). |
| 2 | correctness-data | important | Transitive clustering could merge two SAME-source rows — two different real events — via one unlocated bridge row (bdh article, unresolved away game): `clusterPairs` union-found pairs with no source guard, so a bridge blocking against both occurrences of a LiveWhale pre-expanded series got all three clustered and `resolveAssignments` marked one REAL occurrence a duplicate, vanishing it from `v_events_api`. | **FIXED** — `services/poller/src/dedup/cluster.ts`: clustering is now SOURCE-DISJOINT. A union that would put two rows of one source into a component is skipped; edges process strongest-`similarity` first (SQL's `title_similarity` is threaded through `DedupPair`), ties broken by id for determinism. `resolveAssignments` derives the source map from member metadata, so no assignment can ever mark a same-source duplicate, directly or transitively. Unit tests cover the bridge repro, the similarity preference, the direct same-source pair (defense-in-depth vs SQL), and the `{ATH,ATH,LW}` shape; integration test adds the `tour-early`/`tour-late`/bdh-bridge scenario. |
| 3 | ux-design-law | important | Zero-backend fixture mode was half-broken: only `src/data/api.ts` honored `VITE_USE_FIXTURES`. The lane-H fetch helper `getJson` (`src/data/search.ts` — browse list, places, orgs, place activity, ⌘K search) and `src/ops/useHealth.ts` always hit `fetch('/api/…')`, which the Vite dev server answers with index.html/404 — map pins rendered while the list pane showed "Events unavailable", the header showed "sources unreachable", search returned nothing, and `/p/:id` / `/o/:id` rendered only error states. | **FIXED** — new `src/mocks/fixtureRoutes.ts`: one in-process read-API router over the fixture dataset (all §3 paths incl. `/api/places`, `/api/orgs`, `/api/orgs/:id`, `/api/places/:id/activity`, bbox on `/api/events`), mirroring `apps/api` semantics (name sort, activity window `[at, at+24h]`, upcoming/past split, bbox = located events only). `getJson` and `useHealth` branch through it under `VITE_USE_FIXTURES=1` (same statically-false tree-shake pattern as `api.ts`); `fixtureApi.ts` gained `listPlaces`/`listOrgs`/`getOrgDetail`/`getPlaceActivity` + bbox filtering; the MSW handlers now delegate to the SAME router, so test and fixture-mode semantics cannot drift. Runtime-verified in a live browser: index list + health strip + ⌘K + `/p/sayles-hall` + `/o/brown-outing-club` all render from fixtures with zero network. Tests: `test/fixtureRoutes.test.ts`, `test/fixtureMode.test.tsx`. |
| 4 | ux-design-law | important | The Phase 3C "text-faint is banned for text" pass (f0817fc) shipped incomplete: `@brownsync/ui` still painted 12–13 px text in `--text-faint` #566070 (≈2.7–3.0:1, fails AA 4.5:1 and the 3:1 large-text bar) — TimelineRow `sub`, DataTable headers, EmptyState body/icon, StatusDot `detail`, Kbd, Chip `count`, SearchInput placeholder/glyph/clear, SegmentedControl inactive labels — plus the map's "Loading basemap…" (raw hex `text-[#566070]` in `MapView.tsx`) and the MapLibre attribution (`color: var(--text-faint)` in `apps/web/src/styles.css`). | **FIXED** — every text/icon paint moved to `--text-secondary` (#8B94A3, AA-passing on all three surfaces); `--text-faint` remains only as non-text ornament (borders, slider fill, aria-hidden rail dot), which stays legal. Enforcement: new `packages/ui/src/contrast.test.ts` scans `packages/ui/src` and bans text-painting faint utilities and inline `color: var(--text-faint)`; the app-side scan (`apps/web/test/a11y-contrast.test.ts`) was extended to also catch the raw-hex `text-[#566070]` form and `color: var(--text-faint)` in stylesheets. The e2e harness headings were updated too. |

Refuted findings: **none** — all four confirmed findings reproduced exactly as
described when checked against the normalizer/emitter sources and (for #3) at
runtime in a browser.

## Fix round 2 — remaining confirmed findings

The reviewer's remaining CONFIRMED findings (2 important, 7 minor), all fixed
in this round; every fix verified by the full pipeline below.

| # | Lane | Severity | Finding | Disposition |
|---|------|----------|---------|-------------|
| 5 | ux-design-law | important | P3B's route-level code split shipped without §6.4 loading states: PlacePage/OrgPage are `lazyRouteComponent` chunks with no `pendingComponent` (route- or router-level) — navigating to `/p/:id` / `/o/:id` painted nothing while the chunk loaded. | **FIXED** — `apps/web/src/pages/routeStates.tsx` + `router.tsx`: both lazy routes get `ProfilePagePending` (PageShell chrome + `PanelSkeleton`/`ListSkeleton` from the ops states library — real skeletons, no spinners); the router carries a themed `defaultPendingComponent` backstop and `defaultPendingMs`/`defaultPendingMinMs` = 300 (loader pendings never flash-and-swap). Suspense chunk fallbacks ignore `defaultPendingMs`, so `.bs-route-pending` (styles.css) holds the skeleton invisible for its first 150 ms — fast chunk loads swap in the real page before anything paints. Pinned in `test/pages.test.tsx`. |
| 6 | security-robustness | important | `services/poller/src/util.ts` `decodeEntities()`: `String.fromCodePoint` on unguarded feed-controlled numeric character references — `&#x110000;`, digit-overflow, lone surrogates throw `RangeError`, so one hostile article/event title crashed the whole poll run. | **FIXED** — `decodeCodePoint()` range-guards (valid iff integer, 0 < cp ≤ 0x10FFFF, not U+D800–DFFF); everything invalid decodes to U+FFFD per the HTML spec. Hostile-payload unit tests cover the util directly plus all three feed paths: bdh RSS description (via `stripHtml`), athletics ICS URL, LiveWhale title (`test/util.test.ts`, `bdh.test.ts`, `athletics.test.ts`, `livewhale.test.ts`). |
| 7 | ci | minor | `seed-load.yml` ran `pnpm --filter @brownsync/db run --if-present seed:check` but the real script is `seed-check` — the QA step silently no-opped. | **FIXED** — correct script name AND `--if-present` dropped, so a future rename fails the step loudly. |
| 8 | ci-security | minor | `deploy.yml` interpolated `${{ github.ref_name }}` raw into the wrangler-action command string — shell/flag metacharacter injection vector (git ref names may contain `$ ; \| &` and quotes). | **FIXED** — the ref enters the gate step via `env:`, is validated against an `[A-Za-z0-9._/-]` allowlist (wrangler-action spawns without a shell, so a bare `$VAR` would never expand — the validated step output is the safe carrier), and only that output reaches `--branch`. |
| 9 | ci-security | minor | Third-party `cloudflare/wrangler-action` rode the mutable `v3` tag. | **FIXED** — pinned to the immutable commit SHA for v3.15.0 (what `v3` resolves to today); YAML comment records the convention: third-party actions get SHA pins, first-party `actions/*` stay on major tags. |
| 10 | ux-design-law | minor | No `notFoundComponent` — unrouted URLs rendered TanStack's unstyled default paragraph. | **FIXED** — `NotFoundScreen` (root-route `notFoundComponent`): §6.4 real copy, mono echo of the dead path, ghost-button link back to the map. Runtime-verified in a browser; pinned in `test/pages.test.tsx`. |
| 11 | ux-design-law | minor | Detail-panel WHERE printed `location_raw` as a second line even when it equaled the resolved place name. | **FIXED** — `locationRawAddsInfo()` (whitespace/case-normalized equality) gates the raw line; unit-tested in `test/detail-where.test.ts`. |
| 12 | a11y | minor | A bare unlabeled canvas tab stop followed the labeled map canvas — deck.gl's overlay canvas (mjolnir KeyInput force-sets `tabIndex=0` post-init). | **FIXED** — `DeckOverlay` passes `onLoad` (fires after deck's event manager exists, so the override sticks) setting `tabIndex=-1` + `aria-hidden` on the overlay canvas; labeled MapLibre canvas untouched. New a11y e2e spec pins the invariant in every init state plus a full tab-walk (no unlabeled canvas ever takes focus); runtime-verified in a live browser. |
| 13 | ux-design-law | minor | Category chip row overflowed its pane with the scrollbar hidden and no affordance. | **FIXED** — `CategoryChips` fades clipped chips at either edge (mask-image gradient) and snaps chips to the row (`snap-x proximity`), bleeding into the pane's `px-3` inset so the fade never dims the first/last chip at a scroll extreme. Roving keyboard access to all 10 chips pinned in `test/browse-chips.test.tsx` (ArrowRight walk + Home/End). |

## Minor cleanups (in passing)

- `.env.example` now documents `VITE_USE_FIXTURES` (README claims the file
  documents every variable; the fixture flag is a first-class documented mode).
- `apps/web/test/a11y-contrast.test.ts` "KNOWN out-of-lane usages" note updated
  to point at the ui package's own enforcement instead of listing debt.

## Known non-blockers (documented, unchanged)

- `pnpm db:seed-check` emits one pre-existing warning: `source_runs.ndjson`
  exists in `db/seeds/` but is not covered by `manifest.json` (ingestion-lane
  artifact register; PASS with 0 failures).
- The fixture modules still appear in the production bundle (the
  `import.meta.env` check sits behind a function call the bundler does not
  fold; identical pre-existing pattern in `api.ts`). Budget-enforced and green
  with wide margin — app JS 243.11 kB gz of 450 kB.

## Verification (all green — re-run after fix round 2)

| Check | Command | Result |
|-------|---------|--------|
| Lint | `pnpm biome check .` (254 files) | clean |
| Types + unit + build | `pnpm turbo typecheck test build --force` | 14/14 tasks green; contract 24, ui 15, api 51, poller 102 (12 DB-gated skipped locally — CI's `migrate` job runs them against the postgis service container), web 322 |
| Bundle budget | `node scripts/bundle-budget.mjs` | app JS 243.44 kB gz (budget 450) — `bundle-budget: OK` |
| E2E | `pnpm --filter @brownsync/web e2e` (hermetic Playwright, chromium) | 12/12 passed (a11y keyboard journey incl. new canvas tab-order spec, smoke, full journey, perf soft budget) |
| Seeds | `pnpm db:seed-check` | PASS — 0 failures, 1 pre-existing warning (above) |
| Dedup SQL | libpg_query parse of `buildCandidatePairsQuery` output | syntax OK |
