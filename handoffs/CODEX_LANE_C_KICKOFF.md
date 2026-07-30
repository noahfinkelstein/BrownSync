# Codex kickoff — Lane C: Accounts, social, and iOS

**This is the operational brief. The full spec is
[CODEX_LANE_C_SOCIAL_IOS.md](CODEX_LANE_C_SOCIAL_IOS.md) — read it before writing code.**
Repo: `/Users/noah_finkelstein/Developer/projects/BrownSync`. Also read
`BROWNSYNC_V2_PLAN.md`, `ARCHITECTURE.md` §2, `DATA_CONTRACT.md`.

---

## 1. Repo state as of 2026-07-29 — what you are building on

Two other lanes are active **in this same repository**. Read §2 before touching anything.

### Landed and green (do not redo, do not undo)

| Change | Where | Why it matters to you |
|---|---|---|
| **Named OpenAPI components** | `packages/contract/src/api.ts`, `taxonomy.ts` | **This is your unblock.** `components.schemas` went 0 → 18; every response body is a `$ref`. Swift codegen now yields `Components.Schemas.Event`, not `Operations.getEvents.Output.Ok.Body.jsonPayload.eventsPayload`. |
| Naming mechanism | zod v4 native `.meta({ id: "Event" })` | **Verified empirically** to register through `@hono/zod-openapi` 1.5.1 without `packages/contract` taking a hono dependency. `.extend()` does NOT inherit the id, so every derived schema needs its own. |
| Guard test | `apps/api/test/openapi-components.test.ts` | Fails if any response inlines a schema, if a `$ref` dangles, or if the committed doc drifts from the emitter. **Any new schema without `.meta({ id })` fails this.** |
| BDH headline-only | `services/poller/src/bdh/normalize.ts`, `db/migrations/0004`, `db/checks/0004` | Legal gate G1. Never re-add body storage. |
| **Campus building layer** | `ingest/brownsync_ingest/campus/**`, `db/seeds/campus_buildings.geojson`, `apps/web/src/map/campusBuildings.ts` | **This is your presence dependency.** 262 Brown buildings with polygons, labels, and a stable `propertyCode`. Served as a static asset at `/data/campus-buildings.geojson`, 319 kB raw / 58 kB gz. |

Current test baseline — **both must stay green**:
- `cd ingest && uv run pytest -q` → **1118 passed, 34 skipped**
- `pnpm turbo run typecheck test` → **13/13 tasks** (contract 30, api 56+, ui 15, poller 106, web 348)
- Bundle: **244.14 kB gz** of a 450 kB budget. `@supabase/supabase-js` is the biggest threat in your lane — measure it.

### Known-broken, being fixed by Lane B right now — do not work around them

- `/api/events` returns `placeId: null` on every row (the poller nulls resolved places on refresh).
- `livewhale` can never report `ok` (1000-row cap trips the truncation guard forever).
- The web health strip has a single global 45-minute staleness threshold.

If your work appears blocked by one of these, say so rather than patching around it.

---

## 2. File ownership — THREE agents share this repo

**You own, exclusively:**
```
db/migrations/0010_*.sql … 0019_*.sql      db/checks/0010_*.sql …
apps/ios/**                                 (everything, new)
apps/api/src/auth.ts                        (new)
scripts/gen-swift-tokens.mjs                (new)
.github/workflows/ios.yml                   (new)
packages/contract/src/social.ts             (new — NOT api.ts)
```

**Shared, coordinate before editing** — announce in your report if you must:
```
apps/api/src/app.ts, routes.ts, queries.ts   (Lane B is adding read routes)
packages/contract/src/seeds.ts                (Lane B)
db/seed-check.ts                              (Lane B)
ingest/brownsync_ingest/contract.py           (Lane B)
```

**Off limits — other agents own these:**
```
apps/web/**            packages/ui/**         map/style.json
packages/contract/src/{tokens,taxonomy,api}.ts
ingest/brownsync_ingest/campus/**
db/migrations/0001-0009, db/checks/0001-0009
services/poller/**     BROWNSYNC_V2_PLAN.md   handoffs/**
```

**Migration numbers 0001–0004 are used. Lane B holds 0005–0009. You start at 0010.**
Never renumber a migration that has been pushed.

---

## 3. Do these in order

Each step must be independently correct, tested, and revertible. Do **not** start
the next until the previous is green.

### Step 1 — `apps/ios` scaffold (no backend dependency, start here)

Nothing blocks this and it de-risks the rest.

```
apps/ios/
  project.yml                    # XcodeGen — the ONLY file you hand-edit
  BrownSync.xcodeproj/           # committed, generated, never hand-edited
  Sources/BrownSync/…
  packages/BrownSyncAPI/         # local SwiftPM package
    Package.swift
    Sources/BrownSyncAPI/
      openapi.json               # copied from packages/contract/openapi.json
      openapi-generator-config.yaml
  Resources/{providence.pmtiles, style.json, glyphs/}
  Generated/Tokens.swift         # generated + committed
```

Pinned versions (verified 2026-07-29):
`apple/swift-openapi-generator` **1.13.0** · `swift-openapi-runtime` **1.12.0** ·
`swift-openapi-urlsession` **1.3.1** · `maplibre/maplibre-gl-native-distribution`
**6.28.0** · `supabase/supabase-swift` **2.54.0** (note: repo moved from
`supabase-community/`) · XcodeGen **2.46.0**. Requires **iOS 16+, Xcode 16.4+, Swift 6.1+**.

Three things that will cost you an afternoon if you skip them:
1. **`openapi.json` and `openapi-generator-config.yaml` must sit in the target's
   source directory.** The plugin discovers them by filename convention. This is
   the single most common setup failure.
2. **Put the generator plugin in the local package, not the app target** — plugin
   trust then resolves once at package level and headless CI needs no
   `-skipPackagePluginValidation`.
3. **A `Package.swift`-only package cannot produce an `.app`.** SwiftPM has no iOS
   application product type. Commit the generated `.xcodeproj` so a human clones
   and hits ⌘R with zero tooling, and add a CI check that `xcodegen generate`
   is a no-op.

**Spike before committing to the map approach (10 min):** `MLN_WITH_PMTILES` is
CMake-default ON, but it is **unverified** that the released 6.28.0 binary
xcframework has it compiled in. Load a `pmtiles://` source and confirm. If it
fails, report it — do not silently fall back to raster tiles.

Also: **`sky` is not implemented on MapLibre Native iOS/Android.** The web lane's
daylight work is partly web-only; `light` and paint changes do port.

### Step 2 — token codegen

`scripts/gen-swift-tokens.mjs`: `packages/contract/src/tokens.ts` (a flat 48-line
`as const`) → `apps/ios/Generated/Tokens.swift`. **Commit the output** so Xcode
never needs Node, and add a CI check that regeneration is a no-op. This mirrors
the existing `apps/web/src/map/buildingColors.ts` + `test/buildingColors.test.ts`
convention across the language boundary.

⚠️ Lane A is changing the type scale (5 sizes → 6, body 13→14px). Generate from
whatever `tokens.ts` says at your merge point; do not hardcode.

### Step 3 — identity (`0010_identity.sql`, `0011_rls.sql`)

Full DDL is in the spec §1. The decisions that matter:

- **One enforcement point**: a trigger on `auth.users` that refuses non-`@brown.edu`.
  `hd=brown.edu` is a **UI hint, not a security control**, and the web flow
  (`queryParams`) and iOS flow (`GIDConfiguration.hostedDomain` →
  `signInWithIdToken`) differ — which is exactly why the check cannot live in a
  client. `is_brown_member()` in RLS and JWKS validation in the Worker are
  defense in depth, not the gate.
- ⚠️ **Verify first**: Supabase may now offer a "Before User Created" Auth Hook,
  which is a cleaner home than an `after insert` trigger that raises. Check the
  project dashboard. Either way the check must exist.
- **RLS from zero on EVERY table**, including the existing public ones. RLS-on
  with a permissive `select` is not the same as RLS-off: it makes a future write
  policy opt-in rather than a hole.
- ⚠️ **`places`/`events`/`organizations` are read by the deployed Worker right
  now.** Enable RLS **with its permissive select policy in the same migration**,
  and verify against the deployed API before merging. An enable without a policy
  is an instant production outage.
- **Test that PostgREST is actually closed.** Today that is inherited default
  behavior nothing verifies. Add `db/checks/0011_rls_checks.sql` asserting a
  synthetic `authenticated` role cannot read another user's rows, plus a blanket
  assertion that every table in `public` has `relrowsecurity = true` — so a
  future migration adding a table without RLS fails CI.

### Step 4 — profiles, friends, place-level presence (`0012_social.sql`)

**The privacy guarantee is structural: there is no `lat`/`lng` column anywhere in
the user tables, and there will not be one.** The client snaps its own position
to a `place_id` on-device against `/data/campus-buildings.geojson` (262 polygons,
already shipped) and sends only the slug. Raw GPS never reaches a server, so it
cannot leak from one. This is the same technique the BDH licence CHECK uses —
make the promise a property of the schema, not of a code path.

- Ghost mode and expiry are enforced **in the RLS policy**, not by the client
  hiding a row it already fetched.
- **Do not use Realtime Presence for friend locations.** Fanout is O(N²) per
  channel — 40 students updating every 5 s is ~320 msg/s outbound, over Free
  *and* Pro. Place-level state is durable rows with an expiry, so use
  RLS-filtered `postgres_changes` with a **≥60 s client throttle**. Route all
  writes through a single `set_presence()` RPC so the eventual
  broadcast-from-trigger migration is one function body, not a client rewrite.

### Step 5 — club editing (`0013`, `0014`)

The claim flow bootstraps itself: 457 orgs already carry `contact_emails` in the
source CSV. If the signed-in `@brown.edu` address is in the target org's
`contact_emails`, **auto-approve**. Everything else goes to a review queue.
Adding the dropped CSV columns (contact_emails, advisor, funding_category, six
social URLs) is a coordinated two-lane change — **check with Lane B first**,
they own `contract.py` and `seed-check.ts`.

### Step 6 — anonymous board (`0015`)

`author_token = hmac(pepper, user_id)`, **pepper in a Cloudflare Worker secret,
never in Supabase**, so a database dump alone cannot deanonymize. **State the
limit plainly in the UI**: with ~7,000 students, an attacker holding both the
pepper and the roster can brute-force it. This raises the bar to compromising two
independent trust domains; it is not cryptographic anonymity. Do not overclaim.

Board and any Sidechat surface are **Brown-SSO-gated only** — no public route, no
SSR, no OG preview.

### Sidechat — read spec §5 before touching it

Codex's earlier design at
`docs/superpowers/specs/2026-07-29-sidechat-daily-top-10-design.md` proposes three
acquisition adapters and treats them as interchangeable. They are not.

- **Adapter B (extract the session credential from the installed app and replay
  its private API) — do not build. Drop it from the spec.**
- Adapter A (`web.sidechat.lol/api/home/posts`) — one-time manual probe only,
  never a scheduled crawler. The spec itself admits it is the global feed and
  Brown-specific public access is unverified.
- **Adapter C (macOS Accessibility over the user's own logged-in app) is the only
  one to build.** Same pattern the repo already blesses for CAB (WAF → user
  export) and clubs (403 → user CSV).
- Renumber its migration `0004` → **`0015`**.

---

## 4. House rules (non-negotiable)

- **Two lanes, one contract.** Schema changes ship as one change touching
  `DATA_CONTRACT.md` + `packages/contract/src/` + `ingest/…/contract.py` +
  `ingest/tests/test_contract.py` + `db/seed-check.ts` together.
- **Gates fail closed.** CI never touches a live server. Fixtures are hash-pinned.
  Bot detection is never bypassed.
- Additive migrations only. Rollback-safe checks use `chk-`-prefixed fixtures and
  end in `rollback;` — see `db/checks/0002_api_checks.sql`.
- No Postgres `enum` types. CHECK constraints on new tables only.
- Every new response schema gets `.meta({ id })` at birth.
- Design law is test-enforced: 5 (soon 6) type sizes, one shadow, accent
  `#D96C3D` reserved for live/now, `--text-faint` banned for text.

## 5. Verification before you report done

```bash
cd ingest && uv run pytest -q          # 1118 passed, 34 skipped
pnpm turbo run typecheck test          # 13/13 tasks
npx biome check <your changed dirs>    # NOT `pnpm lint` — see below
```

⚠️ `pnpm lint` at the repo root reports ~854 errors from the user's **untracked
scratch files** (`scrape-work/`, `cab_*.js`). Those are pre-existing and not
yours. Lint your paths only.

⚠️ **Docker is not running on this machine**, so SQL cannot be exercised locally.
Write migrations and rollback-safe checks so CI's postgis job proves them, and
**say clearly in your report that the SQL is CI-verified only**.

## 6. What to report

What landed; every threshold/gate and why it has that value; **anywhere the spec
was wrong when it met real data** (the campus lane found six such cases —
`Year_of_Construction` zero sentinels, an 8-key alias vocabulary, an
over-matching address regex, many-places-per-building, outdoor places snapping
to churches, and an override that relabelled the wrong building); test counts
before and after; and anything deliberately deferred.

**Do not commit.** Do not touch another lane's files.
