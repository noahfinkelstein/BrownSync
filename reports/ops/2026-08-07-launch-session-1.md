# Launch orchestration session 1 — 2026-08-07

Continuation of the ops-deck handoff (`handoffs/OPS_DECK_LAUNCH_HANDOFF.md`).
Baseline: `2026-08-07-baseline.md`.

## Workstream A — daytime map: DONE ✅

- Root cause: six page-token leaks into map paints from the light-chrome flip
  (`90689de`). Chief offender `DAY.earth = tokens.bg.base` (#FFFFFF at day).
- Fix `c9a4a88`: all map paints pinned to `tokens.map.*` / basemap hexes.
- New guards: `apps/web/test/map-token-scope.test.ts` (page-token scanner —
  caught the 6th leak during development), `earth` added to the WCAG ceiling
  loop, `apps/web/e2e/cartography.e2e.ts` (5 hours × 3 cameras, pixel-stat
  assertions, red-test verified against the pre-fix palette).
- Merged `95a0f71`, prod web deployed (Deploy run green 18:34Z).

## Workstream B — data freshness: substantially landed ✅ (dispatcher in review)

Root causes found and fixed:
1. **Three commits were never pushed** (incl. `90689de`): the livewhale
   sharding fix, refresh.yml, ios.yml existed locally only. Pushed in Phase 0;
   Refresh/iOS workflows now registered + active.
2. **Prod DB was at migration 0003 of 0017.** With owner approval, applied
   0004–0017 (`supabase db push`), including the G1-mandated BDH body purge
   (0004), source_registry (0006), SQL place resolution (0007), and the Lane C
   social/board tables (0010–0017, all fail-closed/RLS'd).
3. **Prod API Worker was stale.** With owner approval, deployed via
   `npx wrangler deploy` (version c6d3d467). `/api/health` is now registry-
   aware: `never` statuses, `enabled` flags, per-source `staleAfterSeconds`,
   refusal rows visible.
4. **livewhale reports `ok` in prod for the first time**: manual poll at
   19:27Z — 14 sharded windows, 1307 items (past the old 1000 cap), 95
   vanished events swept `is_canceled`. bdh/athletics_ics/dedup also ok.

Dispatcher (Lane B keystone) built by a worktree agent on `lane/b-dispatcher`:
`packages/sources` extraction + pure `due()` + Worker scheduled handler +
migration 0008 + checks. Full monorepo green (api 682). **Under adversarial
review before merge** — findings will gate the merge.

Daily freshness audit installed as a cloud routine (`0 12 * * *` UTC,
trig_01MFCfjQKR8maXxavQagyGtf) and test-fired. Audit-only for now: GitHub is
not connected for cloud routines, so it reports rather than fixes. Owner
action to upgrade: connect GitHub at claude.ai (web-setup / GitHub App), then
re-attach the repo source to the routine.

## Workstream C — sources: groundwork done

- `brown.edu/news` vetted and CLEARED (see `2026-08-07-source-vetting.md`):
  robots permits, no live RSS (root rss.xml is a dead 2019 channel), stable
  dateful listing hrefs → parse-with-gate producer per spec R2.
- BDH permission email + Reddit API application drafted for owner sign-off
  (`2026-08-07-drafts-for-owner.md`). NOT sent.
- Producers sequenced behind Lane B contract-v2 `articles` table.

## Workstream D — UI: audit in flight

Lane A steps 8–10 (NowBar, LayerPanel, bottom dock, unified feed) landed in
`90689de` — the audit evaluates current state. Two reviewer agents running on
captured desktop/mobile screenshots + DOM inventories.

## Owner decisions taken this session

- Prod DB migration push 0004–0017: **approved, applied**.
- Prod Worker deploy: **approved, deployed**.

## Open items / next session

- Merge `lane/b-dispatcher` after review findings are resolved; then deploy
  Worker again (picks up the `* * * * *` cron) and apply migration 0008.
- Act on UI audit findings (verify → fix → freshman-lens re-run).
- Lane B next: producers (dining/libcal/arcgis/publications), contract v2
  `articles` + friends, retire poll.yml dedup entry once dispatcher proven.
- Seed-lane sources (athletics/buildings/cab/clubs/events/places) still show
  Jul 29 — their refresh rides refresh.yml PRs + seed reloads; watch
  tomorrow's 09:12Z refresh run.
- Workstream E adversarial review of the whole repo (incl. the landed social
  lane's auth/RLS) still owed.
- 7-day freshness observation window starts today.

## Addendum — Workstream D acceptance (PASS WITH NOTES)

Freshman-lens re-run on the built result: desktop answers "what's happening
near me right now?" in ~4-6s, mobile signals in ~3s (content one tap away).
All five audited defects verified RESOLVED. Remaining polish queue (P2, non-
blocking): (1) the demoted header health dot is now an unlabeled red/amber
square a newcomer can't decode — needs a tooltip/aria affordance (partly
mitigated by the paused/per-threshold fix landing after the screenshot);
(2) "3 in class" phrasing ambiguous — "3 classes now"; (3) 24-hour times
where freshmen expect 12-hour; (4) OSM attribution clipped behind the
happening-now bar on mobile (attribution should stay visible).

## Addendum — E adversarial review (14 agents, run wf_8956bfee-758)

30 findings; 9 P0/P1 verified → 4 CONFIRMED P1 (fix in flight on
ops/e-p1-fixes), 4 downgraded P2, 1 refuted. 21 unverified P2s recorded in
the workflow journal for backlog triage — notable clusters: board read
endpoints bypass rate limiting, vacuous ACL assertions in db/checks, RED-
suffixed tests carry no expected-fail contract, unstable moderation-queue
cursors, social RPC limiter gaps.

## Addendum — session close: P1 fixes merged and released

- `ops/e-p1-fixes` merged (`272538f`), CI green (run 31221932622). All four
  confirmed P1s fixed with red-proofs: last-owner guard (+ typed 409,
  contract v1.8), pepper-keyed deletion cleanup, profiles CHECKs + shared
  write limiter on direct PostgREST writes, millisecond-exact keyset cursor.
- The standing red 0004 guid assertion fixed via corrective migration 0020
  (independently re-confirmed by the P1 agent). CI fully green on main for
  the first time since the register flagged the blocker.
- Prod released with owner approval: migrations 0019+0020 applied (remote
  now at parity 0001–0020), Worker redeployed (version ad2312df). Health
  green, dispatcher ticking.
- E remaining for next session: 21 unverified P2s (journal
  wf_8956bfee-758) and a fresh find→verify round until dry; livewhale
  Worker-migration PR (flips the release-gate test, retires poll.yml's
  livewhale entry); Lane B producers + contract v2 articles table (unblocks
  Workstream C producers).
