# BrownSync v2 — Master Plan

**Date:** 2026-07-29
**Status:** approved for execution, three parallel lanes
**Supersedes:** nothing. Extends `BROWNSYNC_CLAUDE_CODE_HANDOFF.md` §10 (post-MVP backlog).

---

## Context

BrownSync v0.1.0 is live: [brownsync.pages.dev](https://brownsync.pages.dev) serving a dark 2.5D
campus map, [brownsync-api.noahfinkelstein.workers.dev](https://brownsync-api.noahfinkelstein.workers.dev)
serving 9 read routes over Supabase via Hyperdrive, and GitHub Actions polling LiveWhale,
athletics ICS, and BDH on cron.

It is also thin. The map labels almost nothing, the campus reads flat and monochrome, the feed
shows only events, there are no accounts, and half the data Brown publishes is untouched.

This plan turns it into an all-in-one information platform for Brown students: every building
labeled, a colorful and time-aware campus, a unified news feed, continuously-running scrapers
across a much wider source set, accounts with friends and place-level presence, editable club
pages, an anonymous Brown-gated board, and a native iOS client sharing the same backend.

**Three lanes run in parallel in isolated worktrees**, using the Phase 3 protocol
(integrate step + adversarial review pass). Lane handoffs live in `handoffs/`.

---

## What reconnaissance changed

Six findings materially reshaped this plan. All were verified by live request, not assumed.

### 1. Brown publishes a public, queryable ArcGIS FeatureServer

```
https://services1.arcgis.com/HMLBxPKXzqtpFXfq/arcgis/rest/services/Active_Buildings_2_view/FeatureServer/0
```

263 building **polygons**, no token, CORS `*`, 59 fields. Plus ~80 sibling services including
blue-light phones, AEDs, Narcan, gender-inclusive restrooms, hydration stations, lactation
rooms, elevators, ramps, accessible entries and paths, EV chargers, bike racks, printers,
green spaces, athletic fields, walkways, parking, and construction zones.

This is the single biggest unlock in the plan. `facilities.brown.edu/maps` links to
`maps.brown.edu` → the ArcGIS experience → these services.

**Caveat that shapes the work:** `Official_Name` is populated for only **22 of 263** buildings.
`Property_Name` is 263/263 but is often address-shaped (`"Hope St 170"`). The human-facing
labels live in the semi-structured `Aliases` string (`"DISPNAME: …; NICKNAME: …; LEGACY: …"`,
keys repeat). Labeling every building is a **data-cleaning task**, not a field lookup.

### 2. Protomaps v4 `buildings` has no `name` attribute

Confirmed against the committed extract (`pmtiles show --metadata`, planetiler 0.10.2). Fields
are only `addr_housenumber, height, kind, kind_detail, layer, min_height, sort_rank`. Building
labels **cannot** come from the basemap. And only 13.6% of Providence buildings carry `height`,
which is why the massing looks flat — `coalesce(height, 12)` is doing the work for 86% of them.

### 3. Dining was never actually blocked — now confirmed and shipped

`https://esb-level1.brown.edu/services/oit/sys/brown-dining/v1/menus` → 200, 520 KB JSON, no
auth. 7 halls with stations, items, allergens, and per-meal hours. The prior 403 was on the
marketing site, not the API. It has **no CORS header**, so it needs a daily server-side job —
which we want anyway.

### 4. The LiveWhale 1000-row cap is beatable

Params are **path segments, not query strings** — `?max=3` is silently ignored, `/max/3` works.
`/start_date/YYYY-MM-DD/end_date/YYYY-MM-DD` is verified working, which enables adaptive date
sharding. This fixes the standing bug where `livewhale` can never report `ok`.

### 5. Sidechat and Instagram feed-scraping are off the table

Sidechat has no sanctioned programmatic access — no public API, only a reverse-engineered
client, and the platform is gated by school-email verification. Instagram killed the Basic
Display API in Dec 2024; the Graph API only reads accounts that authorize you.

Substitutes, per the user's decision: **r/brownu** (public API, but self-service OAuth
registration closed in late 2025 — manual approval, budget lead time), **a native anonymous
board** gated by Brown SSO, and **Instagram opt-in** via club-supplied permalinks + official
oEmbed. For Sidechat specifically, see the revised adapter decision in
[handoffs/CODEX_LANE_C_SOCIAL_IOS.md](handoffs/CODEX_LANE_C_SOCIAL_IOS.md) §5.

### 6. We are currently storing BDH article bodies

`services/poller/src/bdh/normalize.ts:63` stores `truncate(stripHtml(description), 500)` and
line 81 stores `raw: rec` — the entire RSS item. BDH's RSS carries **full article text in
CDATA**, and their Terms of Use explicitly prohibit automated indexing of their content
(`© 2026 The Brown Daily Herald, Inc.`), even though their robots.txt permits crawling.

**This is a live exposure and it is fixed first, in P1, ahead of everything else.**

---

## Prerequisites — land on `main` before lanes fork

| # | Change | Why it blocks | Owner |
|---|---|---|---|
| **P0** | Register named OpenAPI schemas (`.openapi("Event")` etc. in `packages/contract/src/api.ts` + the four response envelopes in `apps/api/src/routes.ts`) | `components.schemas` is empty, so every schema is inlined. Swift codegen would emit `Operations.getEvents.Output.Ok.Body.jsonPayload.eventsPayload`. **Blocks Lane C entirely.** | Lane B |
| **P1** | ✅ **DONE 2026-07-29.** BDH → headline-only: `description: null`, a metadata allowlist for `raw`, `db/migrations/0004_bdh_licence_purge.sql` to purge what was stored, `db/checks/0004_bdh_licence_checks.sql` wired into CI, and 4 regression tests in `services/poller/test/bdh.test.ts`. | Live ToS/copyright exposure. | Lane B |
| **P2** | Migration number allocation (below) + `handoffs/` committed | Three lanes writing `db/migrations/` will collide on filenames. | this doc |

### Migration number allocation

| Range | Lane | Contents |
|---|---|---|
| `0004` | **P1 (landed)** | `0004_bdh_licence_purge.sql` — shipped ahead of the lanes; see below |
| `0005`–`0009` | **B — Data** | indexes/hygiene, `source_registry`, place resolution, contract v2 tables, `feed_entries` |
| `0010`–`0019` | **C — Social** | profiles, friendships, presence, org admin/claims/edits, board, sidechat |
| — | **A — Map** | **none.** The campus building layer ships as a static GeoJSON asset, not a table. |

Lane A needing zero migrations is deliberate and is the main reason it can run fully parallel.

---

## Lane A — Map + UI

**Handoff:** [handoffs/CODEX_LANE_A_MAP_UI.md](handoffs/CODEX_LANE_A_MAP_UI.md)

> **Steps 1–6 are DONE (2026-07-29).** The campus building layer ships: 262
> buildings labeled from Brown Facilities' ArcGIS layer, real derived heights,
> an age-driven colour ramp, figure/ground separation, and `feature-state`
> replacing the centroid hit-test. `ClassActivityLayer.tsx` (152 lines) deleted.
> Verified in a browser: labels render at campus zoom. Bundle cost **+0.56 kB gz**.
> Step 5 adds 552 greens and athletic fields, giving five of the six
> polygon-less `outdoor` places real geometry and a label for the first time.
> Step 6 adds real time-of-day cartography driven by the existing time cursor
> and the sun's actual position over Providence.
> Remaining in this lane: type scale (7), header (8), layer panel (9),
> unified feed (10).

Fetch the 263 ArcGIS polygons in a new Python `ingest` job, conflate them against the existing
174 `places` and the 2,150-way OSM set, and publish `db/seeds/campus_buildings.geojson` +
`campus_landmarks.geojson`. Render them as our own MapLibre layers **above** the basemap with
`promoteId: "propertyCode"`.

Headline outcomes:

- **Every Brown building labeled**, in four ranked tiers driven by a precomputed `labelMinZoom`,
  with `symbol-sort-key` breaking collisions by size. Rank 0 is chosen by *measured* prominence
  — buildings with ≥30 resolved course meetings in `course_meetings.ndjson` — not by taste.
- **Colorful and realistic**: per-building extrusion color from `Year_of_Construction`
  (225/263 populated, 1770–2026) as a value ramp, real heights derived from
  `Gross_area__Property_ / Shape__Area` → floors → metres, crisp outlines, and figure/ground
  separation pushing non-Brown context buildings darker.
- **Dynamic**: a `daylight.ts` module driving `setLight`/`setSky`/paint from the **existing time
  cursor**. Scrub to 02:00 and the campus goes deep blue-black; scrub to 13:00 and roofs lift.
  Input-driven, so it does not violate the one-ambient-animation rule.
- **A subsystem deleted**: `ClassActivityLayer.tsx` (152 lines of `queryRenderedFeatures`
  centroid hit-testing against basemap buildings, with a paint-restore dance) collapses to one
  `map.setFeatureState(...)` call. Net ≈ −200 lines, and the tint stops leaking onto neighbors.
- **Bigger type as a contract change**: the 5-size scale becomes 6, body 13→14px, with a new
  `type-scale.test.ts` scanner landed **green first** so the silent
  `text-13`-compiles-to-nothing failure becomes a red test.
- **Header restructured**: scrubber moves to a full-width bottom dock (finally getting the width
  it wanted), the freed header slot becomes a live `NowBar` counts readout, and the layer rail
  becomes a grouped, collapsible, URL-synced `LayerPanel` scaling to ~28 amenity toggles.

**Gate at step 0:** a 30-minute deck.gl × maplibre-v6 `interleaved: true` smoke test. maplibre-gl
v6 shipped 2026-07-22 and deck.gl's compat matrix predates it. Everything else in Lane A is
deliberately MapLibre-native so nothing depends on the outcome.

---

## Lane B — Data platform + continuous scrapers

**Handoff:** [handoffs/CODEX_LANE_B_DATA.md](handoffs/CODEX_LANE_B_DATA.md)

> **Steps 1–6 DONE (2026-07-29).** Migrations `0005` (indexes + manifest
> verification wired into `db/seed.ts`), `0006` (`source_registry`, 15 rows,
> both refusals registered with a CHECK that makes an unexplained refusal
> structurally impossible), `0007` (`normalize_alias` + `place_aliases` +
> `resolve_place`, pinned by a 62-vector Python↔SQL parity test), plus
> LiveWhale date-window sharding. `db/` gained its first test directory.
>
> **The handoff spec was wrong on one point and the lane caught it:** deduping
> LiveWhale on the bare `id` would have DELETED data — LiveWhale pre-expands a
> repeating series into occurrences that share a single `id`. Dedup is on
> `source_id` (`{id}:{date_ts}`), with a regression test.
>
> Remaining: contract v2 tables, source producers, the Worker dispatcher,
> `packages/sources/` extraction, `ingest.yml`.

Contract v2, many new sources, a unified ranked feed, and a scheduling architecture that
replaces hardcoded cron with data.

Headline outcomes:

- **`source_registry` is the keystone.** Per-source cadence, staleness threshold, etiquette
  interval, licence, feed weight, backoff state, and an `enabled` kill switch — all as rows.
  One `* * * * *` Worker cron trigger runs a registry-driven dispatcher (`limit 3` per tick,
  `order by last_started_at nulls first`) instead of N cron expressions. Blocked sources
  (`providenceri.gov`, `today.brown.edu`) ship as **disabled rows with the refusal recorded**,
  so they are a reported state rather than an omission someone rediscovers and crawls.
- **Two long-standing bugs fixed.** `livewhale` gets adaptive date-window sharding so it can
  finally report `ok` (and the sweep window becomes the *requested* windows, fixing a silent
  cancellation bug). Place resolution moves into SQL (`resolve_place()` + `place_aliases`), and
  the poller's conflict clause becomes
  `coalesce(excluded.place_id, resolved.place_id, events.place_id)` — so the poller stops
  nulling the 229 resolved places on every refresh.
- **New tables**: `articles`, `place_hours`, `dining_menus`, `amenities`, `transit_routes`,
  `transit_stops`, `academic_calendar`, `feed_entries`.
- **The legal gate is structural.** `articles.license` plus two CHECK constraints mean the
  database physically rejects a BDH row carrying body text. Loosening it is an explicit,
  auditable `update source_registry set license='excerpt'`, not a quiet code path.
- **Redundancy handled in three layers**: URL canonicalization (kills the biggest source for
  free), title trigram at **0.72** (not events' 0.55 — falsely merging two outlets' coverage is
  worse than a missed dedup), and 64-bit simhash banding for syndication. Plus assembly-time
  diversity: max 30% of a page from one source, never 3 consecutive, topic decay.
- **Shuttle lives in a Durable Object**, never Postgres — 20s cadence with a hard 3 req/min
  ceiling, hibernatable WebSocket fanout, degradation to static routes on failure, and immediate
  disable on any non-404 4xx. It ships **last** so nothing depends on the most fragile source.
- **Dining gets a daily job, not a proxy.** One ESB request per day instead of one per visitor.

---

## Lane C — Accounts, social, and iOS

**Handoff:** [handoffs/CODEX_LANE_C_SOCIAL_IOS.md](handoffs/CODEX_LANE_C_SOCIAL_IOS.md)

Headline outcomes:

- **Brown SSO with one enforcement point.** Google OAuth, but `hd=brown.edu` is a UI hint and
  not a security control, and the web and iOS flows differ (query param vs `GIDConfiguration`).
  So the domain check lives in exactly one place: a trigger on `auth.users` that refuses
  non-`@brown.edu`, with `is_brown_member()` in RLS and JWKS validation in the Worker as
  defense in depth.
- **RLS from zero**, plus a test asserting the PostgREST surface is actually closed — today
  that is inherited default behavior nothing verifies.
- **Place-level presence, made structural.** There is **no `lat`/`lng` column anywhere in the
  user tables**. The client snaps its position against Lane A's campus polygons and sends only a
  `place_id`. The privacy promise is enforced by the schema, not by a code path.
- **Realtime Presence is not used for friend locations.** Presence fanout is O(N²) per channel —
  40 students updating every 5s exceeds even the Pro tier. Place-level state is durable rows with
  an expiry, so RLS-filtered `postgres_changes` fans out only to authorized friends at ≥60s.
- **Club pages have content on day one.** The 457 seeded orgs already carry `contact_emails`,
  `advisor`, `funding_category`, and six social URLs in the source CSV that contract v1 drops.
  Adding those columns also bootstraps the claim flow: if your `@brown.edu` address is in
  `contact_emails`, you get instant admin.
- **Anonymous board with honest anonymity.** `author_token = hmac(pepper, user_id)` with the
  pepper in a **Cloudflare Worker secret, never in Supabase** — so a database dump alone cannot
  deanonymize. The handoff states plainly where this stops being strong.
- **Native SwiftUI + MapLibre iOS app**, XcodeGen-generated with the `.xcodeproj` committed so a
  human clones and hits ⌘R with zero tooling. Generated API client in its own local SwiftPM
  package so the app target never triggers Xcode's plugin-trust prompt.

---

## Cross-lane coordination

### Conflict hotspots

| File | Lanes | Protocol |
|---|---|---|
| `packages/contract/src/api.ts` | A, B, C | B lands P0 first. After that, **append-only** — new schemas in new files, re-exported from `index.ts`. |
| `packages/contract/src/tokens.ts` | A, C | A owns it (type scale). C consumes for `Tokens.swift` codegen and must rebase after A step 7. |
| `db/migrations/` | B, C | Number ranges allocated above. Never renumber a pushed migration. |
| `apps/api/src/queries.ts` | B, C | The `Queries` interface is append-only. B adds read methods, C adds authenticated ones. |
| `db/seed-check.ts` | B, C | Both add validators. Merge by appending to the check list; never restructure. |
| `apps/web/src/browse/` | A, B | A restructures `ListView`; B adds the feed model. **B's step 12 rebases on A's step 10** — do not run these concurrently. |

### Protocol

1. Each lane runs in its own git worktree off `main`, branch `lane/{a-map,b-data,c-social}`.
2. P0–P2 land on `main` before any lane forks.
3. Weekly integrate: rebase all three onto `main`, run the full suite, resolve in one sitting.
4. Before merge, each lane gets the Phase 3 adversarial review pass (3 independent reviewers,
   findings verified before they are fixed).
5. Cross-lane dependencies get a **BLOCKING entry in `reports/app_side_dependencies.md`** until
   a consumer test passes. This protocol is what caught the real athletics-sidecar bug; skipping
   it is how this breaks.

### The one hard ordering constraint

**Lane A step 1 (campus buildings GeoJSON) must land before Lane C's presence work**, because
client-side place snapping needs the polygons. Everything else in C can proceed in parallel.

---

## Legal and ToS gates

These are **blocking**. Each is tracked as a register entry in
`reports/app_side_dependencies.md`.

| # | Gate | Status | Action |
|---|---|---|---|
| **G1** | **Brown Daily Herald** — ToS prohibits automated indexing; content is copyrighted. robots.txt permits crawling. ToS governs. | 🔴 **We are currently in violation** (storing bodies) | P1 reduces to headline-only + purges. Then email `herald@browndailyherald.com` for written permission. Applies identically to post- (same SNworks install). |
| **G2** | `providenceri.gov` — robots.txt explicitly disallows `/event/`, `/events/`, `/*?*` | ✅ Never crawled | Ships as a disabled registry row with the disallow verbatim in `robots_note`. |
| **G3** | `today.brown.edu` — Shibboleth SAML on the whole host | ✅ Not attempted | **Do not attempt authentication.** Per-recipient segmentation means no canonical feed exists even with access. Public alternative is `brown.edu/news`. |
| **G4** | ✅ **CLEARED 2026-07-29 by the project owner** (Noah Finkelstein), who states permission was obtained from Facilities and the other relevant offices. Recorded as an owner assertion — no written grant has been seen by this repo, so if that is ever challenged the artifact is standalone and `ingest run dining` can simply be dropped. **Brown OIT ESB** (dining) — an internal service bus that happens to be publicly reachable. No published ToS; the absent CORS header signals it was not designed for public browser use. **Now live** (2026-07-29): 7 halls, 1,143 items, published as `db/seeds/dining_menus.json`. | 🟢 Cleared on owner authority | Constraints are all implemented: **1 request/day** (`refresh.yml`, `12 9 * * *`), declared UA via `CachedHttpClient`, server-side job publishing a static artifact, **never a per-request proxy**. Still owed: email OIT. If they object, delete the `dining` entry from `ARCGIS`/capture groups and the job — the artifact is standalone, nothing else reads it. |
| **G5** | ✅ **CLEARED 2026-07-29 by the project owner**, same basis and same caveat as G4. **ArcGIS licensing** — public and unauthenticated, but terms unread. **Scope grew 2026-07-29**: now 8 recorded layers (buildings, greens, fields + blue-light, AED, building resources, bike racks, restrooms) feeding 823 published amenity points. | 🟢 Cleared on owner authority | Attribution string is carried on every artifact (`Brown University Facilities Management (public ArcGIS FeatureServer)`) and noted in the fixtures manifest. **The sibling `brown3d` project records "you said you're authorized for your use" — that is a personal-project note, NOT clearance to republish on a public site.** Confirm terms with Facilities/OIT before this ships publicly; the amenity layers are default-OFF, which limits but does not remove the exposure. |
| **G6** | **Sidechat** — no sanctioned programmatic access | 🔴 **Will not be built, and this one is not the owner's to clear** | Re-raised and re-declined 2026-07-29. The blocker is not our access to the app: Sidechat posts are *other students'* content in a closed, anonymous, school-gated community, and neither the owner nor this repo can consent on their behalf to republishing it. The substitute is unchanged and is what Lane C builds — a native anonymous board behind Brown SSO using `author_token = hmac(pepper, user_id)`, plus r/brownu titles/permalinks via Reddit's public JSON. Content people posted to *this* platform, not content lifted from another. |
| **G7** | **Instagram** — feed harvesting prohibited | ✅ Opt-in only | Club-supplied permalinks + official oEmbed. |
| **G8** | **Reddit** — free tier is non-commercial only; self-service OAuth registration closed late 2025 | 🟡 Lead time | Apply via Reddit's contact form early. Monetizing later flips to the commercial tier. |

---

## Verification

Preserved from the existing discipline, non-negotiable:

- **CI never touches a live server.** Every new source contributes one recorded, hash-pinned
  response under `services/poller/fixtures/` or `ingest/fixtures/recorded/`, registered in
  `ingest/fixtures/manifest.json`. Blocked captures are recorded as `gaps[]` with verbatim
  reasons. Bot detection is never bypassed.
- **Gates fail closed.** Every producer validates after building full output; failure leaves the
  previous artifact untouched, records `partial`, exits 1.
- **`run all` publishes the manifest last** (preserved per-group after the v2 split).
- **DB semantics prove out in `db/checks/*.sql`** — rollback-safe, against the disposable PostGIS
  container.
- **Design law stays test-enforced.** Where Lane A bends it (map chroma, tier count, height
  expression), the bend is bounded by a *new* test, not by deleting the old one.

New verification surfaces:

- `apps/web/e2e/cartography.e2e.ts` — one golden screenshot at fixed camera + daylight hour, so
  building color and label placement become reviewable in a PR diff.
- `e2e/perf.e2e.ts` extended to record p50/p95 **per map step**, so regressions are attributable
  rather than discovered at the end. Plus a `getStyle().layers.length ≤ 40` ceiling.
- `ingest/tests/gazetteer/test_sql_resolver_parity.py` — replays the resolver corpus through both
  the Python `PlaceResolver` and SQL `resolve_place()` and asserts identical results.

---

## Deferred, with reasons

| Item | Why not now |
|---|---|
| 3D building models (I3S / deck.gl `Tile3DLayer`) | Needs `interleaved: true` (unverified against maplibre v6) and `@loaders.gl/i3s` + draco wasm is the single biggest bundle-budget threat in the plan. Brown's `3D_Buildings` FeatureServer flattens multipatch to Z=0, so heights must come from the area derivation regardless. Registered as a spike. |
| 3D terrain (`setTerrain`) | College Hill is ~60 m over ~1 km — visible but subtle. Free terrarium DEM tops out near z13, so campus zoom would sample mush, and terrain re-projects every extrusion vertex per frame. The `sky` property buys most of the atmosphere for free, with no second external dependency. |
| `PlaceOut.polygon` in the read API | The map reads the static GeoJSON, which works offline and in fixture mode without fattening `/api/places`. A worthwhile separate change; zero risk to skip now. |
| Engagement-weighted feed ranking | No telemetry exists. The weight slot is documented and zero rather than inventing a proxy; `score_components` makes the first week of real data replayable offline. |
| Meilisearch, RISD CampusGroups, push notifications | Unchanged from the original post-MVP backlog. |

---

## Open spikes (time-boxed, off the critical path)

- **`theindy.org/api/article`** returns `{"message":"article API is working properly"}` but the
  listing routes were not found. robots.txt fully permissive. 10 minutes with devtools; drop it
  if the route doesn't surface.
- **`goprovidence.com` JSON-LD.** Both Simpleview REST probes returned 403 and there is no ICS —
  **but the recon tool strips `<script>` tags, so `<script type="application/ld+json">` Event
  markup may well exist and has not actually been checked.** This is the most promising remaining
  off-campus path. Needs a raw-HTML fetch. Do not treat the 403s as proof of absence.
- **MapLibre Native `pmtiles://`** — `MLN_WITH_PMTILES` is CMake-default ON, but it is unverified
  that the released 6.28.0 binary xcframework has it compiled in. 10-minute spike before Lane C
  commits to the approach.
