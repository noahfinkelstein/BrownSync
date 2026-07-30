# Codex handoff — Lane C: Accounts, social, and iOS

**Branch:** `lane/c-social` · **Migrations:** `0010`–`0019` (allocated, do not exceed)
**Depends on:** P0 (named OpenAPI schemas — Lane B) before any Swift codegen.
Lane A step 1 (`campus_buildings.geojson`) before presence snapping.
**Can start immediately on:** the migrations, RLS, and the org-enrichment work.

Read `BROWNSYNC_V2_PLAN.md` first.

---

## Verified external facts — build on these, do not re-derive

- **`supabase/supabase-swift` v2.54.0** (2026-07-27). Note the repo **moved** from
  `supabase-community/` to the `supabase/` org. Requires **iOS 16+, Xcode 16.4+, Swift 6.1+**.
- **Google `hd=brown.edu` is a UI hint, not a security control.** Supabase forwards arbitrary
  `queryParams` to the provider authorize URL, but `hd` specifically is *not* documented by
  Supabase (it's a Google param riding the same channel), and a determined user can complete the
  flow with a non-Brown account anyway.
  **On native iOS the flow differs entirely**: `GoogleSignIn-iOS` → ID token →
  `signInWithIdToken(...)`, where there are no `queryParams` at all — you set `hostedDomain` on
  `GIDConfiguration`. **This asymmetry is the whole reason the domain check must live server-side,
  in exactly one place.**
- **There is no session sharing between web and iOS, and none is needed.** Each platform
  authenticates independently against the same Supabase project (web → localStorage;
  iOS → Keychain, via `ASWebAuthenticationSession` or the native Google SDK). What *is* shared:
  the same `auth.users` row, same `user.id` UUID, same RLS policies, same JWT signing key — so
  both clients present a structurally identical bearer token and the Worker validates one way.
- **Supabase Realtime quotas** — Free: 200 concurrent connections / 100 msg-per-sec / 100
  channel-joins-per-sec / 100 channels-per-connection / 256 KB payload. Pro: 500/500/500/100/3MB.
  Pro-no-spend-cap and Team: 10,000/2,500/2,500/100/3MB.
- **Presence fanout is O(N²) in a shared channel.** Every `track()` pushes
  `presence_state`/`presence_diff` to *every* channel member. 40 students on one campus channel
  updating every 5 s ≈ 8 updates/s inbound but **~320 msg/s outbound — over Free AND Pro.**
  §2 explains why we sidestep this entirely.
- **iOS toolchain**: `apple/swift-openapi-generator` **1.13.0**, `swift-openapi-runtime` 1.12.0,
  `swift-openapi-urlsession` 1.3.1. **OpenAPI 3.1 is supported.**
- **MapLibre Native iOS**: `maplibre/maplibre-gl-native-distribution`, **6.28.0 / `ios-v6.28.0`
  (2026-07-23)**. `import MapLibre`, `MLN*` classes. **PMTiles supported natively via the
  `pmtiles://` scheme** (added 6.10.0, PR #2882; hardened by #3403/#4159/#4290 ambient cache/#4399).
- **Instagram**: `graph.facebook.com/instagram_oembed`, 1,000 req/hr, **single public post at a
  time, no feed/listing**. Meta reportedly dropped the token requirement 2026-06-15 but that is
  **only partially verified — test with a real permalink before building on it.** Private accounts
  and embed-disabled posts are unsupported.
- **Reddit**: free tier is **non-commercial only**, 100 queries/min per OAuth client id averaged
  over 10 minutes. **Self-service OAuth registration closed under the Responsible Builder Policy
  (late 2025)** — new clients need manual approval via Reddit's contact form. **Apply early.**
  Monetizing the app later flips you to the commercial tier ($0.24/1,000 calls).

---

## 1. Identity — one enforcement point

### The decision

**A trigger on `auth.users` is the single enforcement point.** Not the `hd` param (a hint), not
client code (two divergent flows), not the Worker alone (Supabase's own PostgREST surface would
bypass it).

`db/migrations/0010_identity.sql`:

```sql
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  handle        text unique not null,
  display_name  text not null,
  avatar_url    text,
  class_year    int,
  concentration text,
  bio           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_handle_ck check (handle ~ '^[a-z0-9_]{3,24}$')
);

-- THE enforcement point. Refuses the signup outright; the auth.users row never lands.
create function enforce_brown_domain() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if lower(coalesce(new.email, '')) !~ '@brown\.edu$' then
    raise exception 'BrownSync is limited to @brown.edu accounts';
  end if;
  insert into public.profiles (id, handle, display_name)
  values (new.id,
          public.derive_handle(new.email),
          coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function enforce_brown_domain();

-- Defense in depth, used by every RLS policy below.
create function is_brown_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'email', '') ~ '@brown\.edu$'
     and coalesce((auth.jwt() -> 'user_metadata' ->> 'email_verified')::boolean, false);
$$;
```

Three layers, one *point*: the trigger is the gate, `is_brown_member()` is the RLS guard, and the
Worker validates the JWT against the project JWKS and re-checks the claim. Only the trigger
decides who exists.

⚠️ **Verify before relying on it:** Supabase now also offers a "Before User Created" Auth Hook,
which would be a cleaner home for this than an `after insert` trigger that raises. Check the
project's dashboard for hook availability; if present, move the domain check there and keep the
trigger for profile creation only. Do not skip the check either way.

### RLS — from zero

There is **no RLS anywhere** in the repo today, and `supabase/config.toml:19-24` leaves
`auto_expose_new_tables` commented out so the PostgREST surface *should* be closed — but **nothing
asserts or tests that**.

`0011_rls.sql`:

1. `alter table … enable row level security` on **every** table, including the existing public
   ones (`places`, `organizations`, `events`, `course_meetings`, `source_runs`).
2. Public read tables get `create policy "public read" … for select using (true)` — RLS on with a
   permissive select is not the same as RLS off; it means a future write policy is opt-in rather
   than a hole.
3. All user tables: no policy is the default deny. Add only what §2–§4 need.
4. `revoke all on all tables in schema public from anon, authenticated;` then grant explicitly.
   The Worker connects through Hyperdrive as the owner and is unaffected.

**Test it, don't assume it.** New `db/checks/0011_rls_checks.sql` (rollback-safe, the existing
pattern): set `role authenticated` with a synthetic JWT claim, assert a user cannot select another
user's `presence_state`, cannot insert an `org_admins` row, and cannot read
`board_identity_escrow` at all. Plus a plain assertion that every table in `public` has
`relrowsecurity = true` — so a future migration adding a table without RLS fails CI.

### The Worker gains an authenticated surface

`apps/api/src/auth.ts`: verify the Supabase JWT against the project JWKS (cache the key set in the
Worker's module scope, refresh on `kid` miss), re-check the `@brown.edu` claim, and attach
`c.set("user", …)`. Public routes are unchanged; authenticated routes go behind a
`requireBrownUser` middleware.

Add `securitySchemes` to the OpenAPI doc (`bearerAuth`, `type: http`, `scheme: bearer`,
`bearerFormat: JWT`) and mark the authenticated routes — otherwise the Swift client has no way to
express the header.

`validated()` (`app.ts:50-53`) keeps working unchanged — it re-parses response bodies, and the new
routes get Out-schemas like every other.

**Rate limiting.** There is none today, in front of a per-request Postgres connection through
Hyperdrive. Now that writes exist, add Cloudflare's native rate limiting binding — per-IP on
unauthenticated reads, per-`user.id` on writes. Board posts get their own tighter bucket (§4).

---

## 2. Profiles, friends, and place-level presence

### The structural privacy guarantee

**There is no `lat`/`lng` column anywhere in the user tables. There will not be one.**

The client resolves its own position to a `place_id` **entirely on-device**, by point-in-polygon
against Lane A's `campus_buildings.geojson` (which both clients already load for the map), and
sends only the slug. Raw GPS never reaches a Brown-owned server, so it cannot leak from one.

This is the same technique Lane B uses for the BDH licence: make the promise a property of the
schema, not of a code path someone can change later. Say so in the privacy copy.

`0012_social.sql`:

```sql
create table friendships (
  requester   uuid not null references profiles(id) on delete cascade,
  addressee   uuid not null references profiles(id) on delete cascade,
  status      text not null check (status in ('pending','accepted','blocked')),
  created_at  timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester, addressee),
  constraint no_self_friend check (requester <> addressee)
);
create index friendships_addressee_idx on friendships (addressee, status);

-- Per-friend opt-in. Sharing is OFF until an explicit row exists.
create table presence_shares (
  owner      uuid not null references profiles(id) on delete cascade,
  viewer     uuid not null references profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (owner, viewer)
);

-- NOTE: no lat, no lng, no geometry. Deliberate and permanent.
create table presence_state (
  user_id    uuid primary key references profiles(id) on delete cascade,
  place_id   text references places(id),
  status     text,                       -- 'studying'|'eating'|'class'|'free'|null
  note       text check (length(note) <= 80),
  ghost      boolean not null default false,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table checkins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  place_id   text not null references places(id),
  note       text check (length(note) <= 140),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
```

### The visibility policy — where ghost mode actually lives

```sql
create policy "presence visible to opted-in accepted friends"
on presence_state for select using (
  user_id = auth.uid()
  or (
    not ghost
    and expires_at > now()
    and exists (
      select 1 from presence_shares s
      where s.owner = presence_state.user_id
        and s.viewer = auth.uid()
        and s.expires_at > now()
    )
    and exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and ((f.requester = presence_state.user_id and f.addressee = auth.uid())
          or (f.addressee = presence_state.user_id and f.requester = auth.uid()))
    )
  )
);
```

Ghost mode is **enforced in the database**, not by the client hiding a row it already fetched.
Same for expiry. Three independent conditions must all hold: not ghosted, not expired, an explicit
per-friend share that is itself unexpired, and an accepted friendship.

### Realtime — do not use Presence for this

Presence is designed for ephemeral "who is connected right now" state, and its fanout is O(N²) per
channel (see the quota facts above). Place-level location is **not** ephemeral — it is a durable
row with an expiry.

**Use RLS-filtered `postgres_changes` on `presence_state` instead.** Supabase Realtime applies RLS
to postgres_changes subscriptions, so each update fans out only to the friends the policy allows.
Combined with a **client update throttle of ≥60 s** (you don't change buildings every 10 seconds),
this stays trivially inside the Free tier and sidesteps the quota problem entirely.

⚠️ **Known scaling caveat, plan for it:** postgres_changes evaluates RLS *per subscriber per
change*, so it degrades at high subscriber counts. The migration path when it does is
broadcast-from-trigger (a `pg_notify`-style trigger writing to a per-user broadcast topic), which
moves the authorization decision to write time. Design `presence_state` writes to go through a
single `set_presence(place_id, status, note, ttl)` RPC now, so that change is one function body
later rather than a client rewrite.

### Retention and deletion

- `expires_at` is **mandatory** on `presence_state`, `presence_shares`, and `checkins` — there is
  no "share forever" option in the schema.
- A pg_cron job (`lane='sql'`, daily) hard-deletes expired `checkins` and nulls expired
  `presence_state.place_id`.
- `on delete cascade` from `profiles` means account deletion removes everything. Add a
  `delete_account()` RPC that also calls `auth.admin.deleteUser` so one action is sufficient.

### Privacy UX — what the user sees

| Surface | Behavior |
|---|---|
| First-run | Sharing is **off**. No prompt-on-launch; the user opts in from the friends screen. |
| Per-friend toggle | Each friend is a separate switch with its own expiry (4 h / 12 h / until midnight / 7 d). No "share with everyone". |
| Ghost mode | One tap in the header. Instantly sets `ghost = true`; friends see "hidden", not a stale location. |
| What a friend sees | Building name, optional status word, optional 80-char note, and "updated 6 min ago". Never a coordinate, never a trail, never history. |
| Your own view | A list of exactly who can see you right now and when each share expires. |

---

## 3. Club pages and org enrichment

`0013_org_enrichment.sql` — the columns contract v1 drops. `brown_all_student_groups.csv` already
carries these for all 457 orgs and seeding throws them away:

```sql
alter table organizations
  add column contact_emails   text[] not null default '{}',
  add column advisor          text,
  add column funding_category text,
  add column website_url      text,
  add column facebook_url     text,
  add column linkedin_url     text,
  add column youtube_url      text,
  add column twitter_url      text,
  add column tiktok_url       text,
  add column logo_url         text,
  add column about_md         text,
  add column meeting_info     text,
  add column updated_by       uuid references profiles(id),
  add column updated_at       timestamptz;
```

Coordinated change per the two-lane rule: `packages/contract/src/seeds.ts` +
`ingest/brownsync_ingest/contract.py` + `ingest/tests/test_contract.py` + `db/seed-check.ts` +
`DATA_CONTRACT.md`, all in one PR. **Coordinate with Lane B** — they are also editing
`contract.py` and `seed-check.ts`.

`0014_org_admin.sql`: `org_admins(org_id, user_id, role, granted_by, granted_at)`,
`org_claims(id, org_id, user_id, evidence, status, reviewed_by, reviewed_at, note)`,
`org_edits(id, org_id, user_id, before jsonb, after jsonb, created_at)`.

**The claim flow bootstraps itself.** 457 orgs already have `contact_emails`. If the signed-in
user's `@brown.edu` address appears in the target org's `contact_emails` array, **auto-approve** —
that's a real verification signal Brown already published, and it means club leaders can edit on
day one with no manual queue. Everything else goes to a review queue with free-text evidence.

`org_edits` is an append-only audit trail (before/after JSON), which makes vandalism revertible
and gives the review queue something to look at. RLS: org admins can update their own org;
everyone can read; only the audit function writes `org_edits`.

**Instagram opt-in.** `org_social_posts(org_id, permalink, added_by, added_at, oembed_cache jsonb,
cached_at)`. An org admin pastes a permalink; a Worker route calls
`graph.facebook.com/instagram_oembed`, caches the response, and the client renders the official
embed. **Test the no-token claim with a real permalink first** — the recon on that was only
partial. 1,000 req/hr means caching is mandatory, not optional.

---

## 4. The anonymous board

`0015_board.sql`: `board_posts`, `board_comments`, `board_votes`, `board_reports`,
`board_rate_limits`.

### How anonymity survives contact with the database — and where it stops

```
author_token = encode(hmac(user_id::text, <pepper>, 'sha256'), 'hex')
```

**The pepper is a Cloudflare Worker secret and is never stored in Supabase.** Posts carry
`author_token`, never `user_id`. A Supabase database dump alone therefore cannot map posts to
people — you would need to compromise a second, separate system.

**State the limit plainly in the privacy copy, because it is real:** an attacker holding *both*
the pepper *and* the user list could brute-force the mapping, since the Brown student body is only
~7,000 people and HMAC is fast. This design raises the bar to "compromise two independent trust
domains"; it is not cryptographic anonymity against an insider with both. Do not claim otherwise.

Token is **stable, not rotating**, because bans and rate limits need continuity. The tradeoff is
that all of one person's posts are linkable to each other — which is true of every pseudonymous
board and is worth saying in the UI ("your posts share a persistent anonymous identity").

Moderation: `board_reports` with auto-hide at N distinct reporters, a moderator queue, per-token
rate limits (posts/hour, comments/hour), and a `board_bans(author_token, until, reason)` table.
Moderators act on tokens, never on names — the escrow direction simply does not exist.

**The board is only visible to signed-in Brown members.** No public route, no SSR, no OG preview.

---

## 5. Sidechat — the revised adapter decision

Codex's spec at `docs/superpowers/specs/2026-07-29-sidechat-daily-top-10-design.md` proposes three
acquisition adapters. **They are not ethically or legally equivalent, and the spec treats them as
interchangeable. They are not.**

| Adapter | Verdict |
|---|---|
| **(A)** Public JSON — `https://web.sidechat.lol/api/home/posts?type=hot` | **One-time manual probe only. Do not schedule.** The spec itself notes this is the mixed/global home feed and that "a Brown-specific public JSON request has not yet been verified." Scheduled polling of an undocumented private API is exactly the ToS-problematic pattern. |
| **(B)** Logged-in native app API replay — extract the session credential from `/Applications/Sidechat.app` into Keychain and replay authenticated requests | **Do not build.** This is credential extraction from a third-party app plus unauthorized programmatic access to a private API. Drop it from the spec entirely. |
| **(C)** Native app Accessibility (+ Vision OCR only for fields Accessibility omits) | **Build only this.** The user, on their own Mac, in their own logged-in session, reading cards already rendered on their own screen. No auth bypass, no bot-detection evasion, no server load beyond normal app use. This is the same pattern the repo already blesses for CAB (AWS WAF → user export) and clubs (Pantheon 403 → user CSV). |

### The product question the spec does not ask

Sidechat posts are **anonymous posts by Brown students inside an identity-gated space**.
Republishing them on a public, unauthenticated website materially changes their audience — people
posted to a few thousand verified classmates, not to the open web and its crawlers.

**Any Sidechat surface must be gated behind the Brown SSO this lane is building. Never public, no
SSR, no OG preview, no unauthenticated API route.** Design the storage and API accordingly:
`GET /api/sidechat/top` goes behind `requireBrownUser`, not on the public read surface.

### Preserve from the spec

Its engineering decisions are good and should carry over unchanged: source order defines rank;
one snapshot per community/day; fail closed below ten posts; atomic JSON output
(`var/sidechat/YYYY-MM-DD.json`, gitignored, user-only permissions, temp-then-rename); credentials
only in Keychain; **no Sidechat rows in `events`**; and no `KNOWN_SOURCES` health registration
until per-source cadence exists — which **Lane B's `source_registry` now provides**, so register
it there with `stale_after_seconds ≈ 108000` (30 h).

Its proposed tables (`sidechat_posts`, `sidechat_snapshots`, `sidechat_snapshot_items`) and the
authenticated `POST /api/internal/sidechat/snapshots` ingest route with a bearer token and an
idempotency key are all sound. **Renumber the migration `0004` → `0015`** per the allocation in
the master plan.

---

## 6. iOS

### Layout

```
apps/ios/
  project.yml                       # XcodeGen spec — the ONLY file an agent edits
  BrownSync.xcodeproj/              # committed, generated, never hand-edited
  Sources/BrownSync/
    App/            BrownSyncApp.swift, RootView.swift
    Map/            MapViewRepresentable.swift, StyleLoader.swift, CampusBuildings.swift
    Time/           TimeCursor.swift, ScrubberView.swift
    Browse/         FeedView.swift, EventDetailView.swift, SearchView.swift
    Places/         PlaceView.swift, OrgView.swift
    Social/         AuthView.swift, FriendsView.swift, PresenceView.swift, BoardView.swift
    Ops/            HealthView.swift
    Generated/      Tokens.swift    # generated from packages/contract/src/tokens.ts, committed
  Resources/
    providence.pmtiles
    style.json                      # copied from map/style.json at build
    glyphs/                         # bundled for offline
  packages/BrownSyncAPI/            # local SwiftPM package
    Package.swift
    Sources/BrownSyncAPI/
      openapi.json                  # copied from packages/contract/openapi.json
      openapi-generator-config.yaml
```

**A `Package.swift`-only package is not enough** — SwiftPM has no iOS *application* product type;
an `.app` needs an Xcode target with a bundle id, Info.plist, entitlements, and signing, which
only lives in an `.xcodeproj`.

**Use XcodeGen and commit the generated `.xcodeproj` anyway.** That hybrid gets both columns: the
human clones and double-clicks with zero tooling installed, while an agent only ever edits the
flat declarative `project.yml` and re-runs `xcodegen generate`. Add a CI check that regeneration
is a no-op so drift is caught. Tuist is the better tool at 20+ modules but is more machinery than
one SwiftUI app warrants.

**Put the OpenAPI generator plugin in the local package, not the app target.** Plugin trust then
resolves once at package level, the app target stays plugin-free, and headless CI does not need
the `-skipPackagePluginValidation` / `-skipMacroValidation` dance.

```yaml
# Sources/BrownSyncAPI/openapi-generator-config.yaml
generate: [types, client]
accessModifier: public
namingStrategy: idiomatic
```

⚠️ **`openapi.json` and `openapi-generator-config.yaml` must sit in the target's source directory.**
The plugin discovers them by filename convention — this is the single most common setup failure.

`project.yml` `packages:` entries: `maplibre-gl-native-distribution` from `6.28.0`,
`supabase-swift` from `2.54.0`, `GoogleSignIn-iOS`, and a `path:`-based local reference to
`packages/BrownSyncAPI`.

### Design tokens

Generate `Tokens.swift` from `packages/contract/src/tokens.ts` (a flat 48-line `as const`, no
computed values) with a ~40-line Node script. **Commit the output** so Xcode never needs the Node
toolchain, and **add a CI check that regeneration is a no-op.** This matches the existing repo
convention — `apps/web/src/map/buildingColors.ts` already exists to hold a second copy of style
values, guarded by `test/buildingColors.test.ts`. Do the same across the language boundary.

Ship `map/style.json` into the bundle rather than re-authoring it. Port `buildMapStyle()` from
`apps/web/src/map/style.ts` to repoint `sources.protomaps.url` at a bundle-relative `pmtiles://`
path.

**Three style caveats for native:**
1. **`sky` is not implemented on MapLibre Native iOS/Android.** Lane A's daylight work is
   web-only for the sky component; `light` and paint changes *do* work, so port those.
2. Bundle the glyphs — the web app fetches them from `protomaps.github.io`, which is the wrong
   posture for an offline-first campus app.
3. The expressions the style uses (`coalesce`, `match`, `interpolate`, `in`) are all supported.

⚠️ **10-minute spike before committing:** `MLN_WITH_PMTILES` is CMake-default ON, but it is
**unverified that the released 6.28.0 binary xcframework has it compiled in.** Load a `pmtiles://`
source and confirm before building the map layer on it.

### Screen inventory (parity with web)

| Screen | Web equivalent | Notes |
|---|---|---|
| Map | `LiveMap` + `EventLayers` | `MLNMapView`, same style.json, same campus GeoJSON, `MLNShapeSource` + `MLNSymbolStyleLayer` for labels |
| Time cursor | `TimeMachineBar` | Port `time/cursor.ts` semantics; a bottom scrubber matches Lane A's new dock |
| Feed | `ListView` | `/api/feed` discriminated union → a Swift enum with associated values |
| Event detail | `EventDetailPanel` | + `EKEventStore` "add to calendar" (native win over the web ICS download) |
| Place / Org | `/p/$id`, `/o/$id` | |
| Search | `SearchPalette` | |
| Health | `HealthStrip` | |
| Auth | — | `GoogleSignIn-iOS` → `signInWithIdToken` |
| Friends / Presence | — | CoreLocation **significant-change** monitoring, snapped on-device to `campus_buildings.geojson`, sends only `place_id` |
| Board | — | |

**iOS-specific privacy requirements** (these are App Review gates, not nice-to-haves):
`NSLocationWhenInUseUsageDescription` explaining place-level-only sharing, a privacy manifest
(`PrivacyInfo.xcprivacy`) declaring the data types, and — since we never transmit coordinates —
"Precise Location: Off" should be genuinely honest for this app.

### What must land before Codex can start Swift

| Blocker | Owner | Why |
|---|---|---|
| **P0 named OpenAPI schemas** | Lane B | Otherwise codegen emits `Operations.getEvents.Output.Ok.Body.jsonPayload.eventsPayload` |
| `securitySchemes` in the OpenAPI doc | this lane, §1 | The client can't express the bearer header |
| `campus_buildings.geojson` | Lane A step 1 | On-device place snapping |

**Codex can start immediately, in parallel, on:** the XcodeGen scaffold, the token codegen script,
the PMTiles spike, and the map/feed screens against the *current* 9 public read routes.

### CI

`apps/ios` is **not** a pnpm workspace member — it has no `package.json` and turbo has nothing to
do with it. Add a separate `.github/workflows/ios.yml` on `macos-latest` that runs
`xcodegen generate --spec apps/ios/project.yml`, asserts `git diff --exit-code apps/ios/BrownSync.xcodeproj`
(the drift check), and builds for the simulator. Gate it on `paths: [apps/ios/**, packages/contract/**]`
so it doesn't run on every push — macOS runners are 10× the minute cost.

---

## 7. Cross-lane coordination

| File | Also touched by | Protocol |
|---|---|---|
| `packages/contract/src/api.ts` | A, B | B lands P0 first; then **append-only**, new schemas in new files |
| `packages/contract/src/tokens.ts` | A | **A owns it.** Rebase `Tokens.swift` codegen after A step 7 (the type-scale change) |
| `ingest/.../contract.py`, `db/seed-check.ts` | B | Both add validators. Merge by appending; never restructure |
| `db/migrations/` | B | **C uses `0010`–`0019`. B uses `0004`–`0009`.** Never renumber a pushed migration |
| `apps/api/src/queries.ts` | B | `Queries` is append-only. B adds reads, C adds authenticated methods |

Register a **BLOCKING entry in `reports/app_side_dependencies.md`** for each cross-lane dependency
until a consumer test passes. That protocol caught the real athletics-sidecar bug; skipping it is
how this breaks.

---

## 8. Risks

1. **Friend location is the highest-consequence feature in the whole plan.** The mitigations are
   structural on purpose — no coordinate column, DB-enforced ghost mode and expiry, per-friend
   opt-in with no "share with everyone", and no history. **Do not add a location trail, a
   heatmap, or a "seen at" history later without revisiting this section.** Each of those turns a
   privacy-preserving design into a tracking system.
2. **Anonymity on the board is bounded, not absolute.** ~7,000 possible users means HMAC is
   brute-forceable by anyone holding both the pepper and the roster. Keep the pepper in Cloudflare,
   never in Supabase, and **say the limit out loud in the UI** rather than implying more.
3. **Realtime cost.** Sidestepped by using RLS-filtered `postgres_changes` instead of Presence,
   plus a ≥60 s throttle. Route all writes through `set_presence()` now so the
   broadcast-from-trigger migration is a function body later, not a client rewrite.
4. **Bundle budget** (243.58 / 450 kB gz). `@supabase/supabase-js` is the single biggest threat in
   this lane. **Measure before committing** — and prefer `@supabase/auth-js` plus direct Worker
   calls over the full client if the delta is large, since the Worker already fronts every read.
5. **Reddit's approval lead time** is unknown and self-service registration is closed. **Apply on
   day one**, and design the r/brownu surface so it degrades to absent rather than broken.
6. **Instagram oEmbed's no-token status is only partially verified.** Test with a real permalink
   before building UI on it; have the opt-in flow degrade to a plain link card if it fails.
7. **RLS on existing public tables is a live-traffic change.** `places`/`events`/`organizations`
   are read by the deployed Worker right now. Enable RLS **with a permissive select policy in the
   same migration**, and verify against the deployed API in a staging pass before merging — an RLS
   enable without a policy is an instant outage.
