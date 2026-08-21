# Freshness audit — 2026-08-21

## Source health (`/api/health`)

| source | status | age vs threshold | verdict |
|---|---|---|---|
| livewhale | ok | 32min / 40min | FRESH |
| dedup | ok | 10min / 1h | FRESH |
| athletics_ics | ok | 1h30 / 4h | FRESH |
| bdh | ok | 1h30 / 2h | FRESH |
| **brown_news** | **partial** | **~17.5h / 2h** | **ERROR — fixed this session, see below** |
| athletics | ok | ~23d / 7d default | STALE (seed-lane, known — see #12/#19/#20) |
| buildings | ok | ~23d / 7d default | STALE (seed-lane, known) |
| cab | ok | ~23d / 7d default | STALE (seed-lane, known) |
| clubs | ok | ~23d / 7d default | STALE (seed-lane, known) |
| events | ok | ~23d / 7d default | STALE (seed-lane, known) |
| places | ok | ~23d / 7d default | STALE (seed-lane, known) |
| academic_calendar | never | — | NEVER (producer not yet deployed) |
| arcgis | never | — | NEVER (producer not yet deployed) |
| bjwa | never | — | NEVER (producer not yet deployed) |
| bpr | never | — | NEVER (producer not yet deployed) |
| dining | never | — | NEVER (producer not yet deployed) |
| libcal | never | — | NEVER (producer not yet deployed) |
| passiogo | never | — | NEVER (producer not yet deployed) |
| ppl | never | — | NEVER (producer not yet deployed) |
| feed_rank | disabled | — | paused by design |
| providence_gov | disabled | — | paused by design |
| today_brown | disabled | — | paused by design |

Web: `brownsync.pages.dev` → 200. `/api/events` next 7 days → 111 events
(academic 61, arts 36, athletics 5, admin 5, food 3, wellness 1) — healthy,
not empty.

## New defect found and fixed: `brown_news` selector drift

`brown_news` last succeeded 2026-08-20T19:07Z, then every poll since has
failed closed with `parsed 2 listing items (< 10) — selector drift
suspected`. Root-caused against a single polite diagnostic GET
(`BrownSync/1.0` UA) to `https://www.brown.edu/news`:

The CMS now renders most listing cards' hrefs with a URL-encoded
`/index.php` front-controller segment ahead of the story path
(`/index%2Ephp/news/YYYY-MM-DD/slug`) instead of the bare
`/news/YYYY-MM-DD/slug` alias the parser's regex required. Only the two
newest cards on the page still render the bare alias — everything else
(43 of 45 observed items) now fails the anchor match, which is exactly why
the item count cratered under `MIN_LISTING_ITEMS`. Confirmed the prefixed
form is a live, valid 200 for the same story (not a redirect), so this is
a CMS rendering inconsistency, not a real content change.

**Fix** (`packages/sources/src/brown_news/parse.ts`): `ANCHOR_RE` now
consumes an optional `/index.php` (or its `%2E`-encoded form) prefix
before `/news/...` and discards it — the captured href, and therefore
`source_id`/`url`, always normalize to the canonical bare `/news/...`
form regardless of which way a given card rendered. This keeps one
story's identity stable even if the CMS flips its rendering between polls
(a bare-alias card today can render prefixed once it ages off the front
page). No change to the headline-only extraction, the `MAX_HEADLINE_CHARS`
licence guard, or the fail-closed gate itself — a genuine redesign that
drops the dateful path shape still yields zero and still fails closed.

Added 4 regression tests in `services/poller/test/brown-news.test.ts`
covering: the `%2E`-encoded prefix, the literal `/index.php` prefix,
collapsing a bare+prefixed pair of anchors for the same story into one
item, and confirming an unrelated `/index.php/about` link still fails
closed. Full existing 2026-08-07 fixture suite (43 items) still passes
unchanged. `packages/sources` typecheck and `services/poller` package
tests (146 passed, 17 pre-existing DB-integration skips) are green.

## What's still broken (nothing new here — do not re-fix)

Per `reports/ops/2026-08-20-freshness-audit.md` (referenced from PR #22,
not yet on `main`):

- **`Refresh data artifacts`**: still failing (run #16, 2026-08-21T09:49Z,
  `conclusion: failure`) — 16/16 scheduled runs failed since inception.
  Root cause unchanged since 2026-08-11; already fixed cleanly in **#21**.
- **Seed-lane sources** (`athletics`, `buildings`, `cab`, `clubs`,
  `events`, `places`) read falsely STALE (no `source_registry` row) under
  the 7-day default threshold — actually fine, just unregistered. Fixed
  independently in **#12**, **#19**, **#20** (same migration number,
  will conflict with each other).
- **`main` has had zero merges since launch (2026-08-08), 13 days now.**
  This session's fix is PR #23 — a 13th open draft PR. **Not** reopening
  or re-implementing #12/#19/#20/#21; those fixes are correct and ready.

Workflows: CI, Deploy green on their last runs. Poll (every ~20-40min)
green and on schedule — 1148 consecutive successful scheduled runs, no
gap pattern suggesting GitHub's 60-day cron-disable. `Refresh data
artifacts` (daily) is genuinely red, not disabled.

## Single most important next action

**Merge the backlog.** The code is not the bottleneck: #21 (refresh.yml
fix) and one of #12/#19/#20 (seed-lane registration) are both clean and
tested. This session adds #23 (brown_news selector-drift fix, tested,
zero-conflict) for the same reason. Every day this waits, brown_news stays
stuck on 2026-08-20's headlines and refresh.yml keeps recording a false
daily failure.
