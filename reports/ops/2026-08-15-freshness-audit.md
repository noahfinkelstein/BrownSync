# BrownSync freshness audit — 2026-08-15

Automated daily audit. Run at ~2026-08-15T12:08Z.

## Per-source table

| source | status | age vs threshold | verdict |
|---|---|---|---|
| athletics_ics | ok | 72m / 4h | FRESH |
| bdh | ok | 72m / 2h | FRESH |
| brown_news | ok | 12m / 2h | FRESH |
| dedup | ok | 7m / 1h | FRESH |
| livewhale | ok | 11m / 40m | FRESH |
| athletics | ok | 16.9d / 7d (NULL→default) | STALE — known, fix in unmerged #12 |
| buildings | ok | 16.9d / 7d (NULL→default) | STALE — known, fix in unmerged #12 |
| cab | ok | 16.9d / 7d (NULL→default) | STALE — known, fix in unmerged #12 |
| clubs | ok | 16.9d / 7d (NULL→default) | STALE — known, fix in unmerged #12 |
| events (producer) | ok | 16.9d / 7d (NULL→default) | STALE — known, fix in unmerged #12 |
| places | ok | 16.9d / 7d (NULL→default) | STALE — known, fix in unmerged #12 |
| academic_calendar | never | — | NEVER — producer not yet deployed |
| arcgis | never | — | NEVER — blocked on refresh.yml PR pipeline (see below) |
| bjwa | never | — | NEVER — producer not yet deployed |
| bpr | never | — | NEVER — producer not yet deployed |
| dining | never | — | NEVER — blocked on refresh.yml PR pipeline |
| libcal | never | — | NEVER — blocked on refresh.yml PR pipeline |
| passiogo | never | — | NEVER — producer not yet deployed |
| ppl | never | — | NEVER — producer not yet deployed |
| feed_rank | — | — | paused by design (disabled) |
| providence_gov | — | — | paused by design (disabled) |
| today_brown | — | — | paused by design (disabled) |

The six "seed-lane" `NULL`-threshold sources (athletics/buildings/cab/clubs/
events/places) are one-shot bootstrap imports from 2026-07-29 with no
`source_registry` row, so they read against the 7-day audit default (app
falls back to 45 min, reads even worse). This is not a new finding — it is
migration `0024` in **#12**, open since 2026-08-09, `mergeable_state: clean`.

## Workflow health

- **Poll**: green, every run today (last 12:04Z). livewhale/athletics_ics/
  bdh/dedup all fresh off it.
- **CI**: green, last run 2026-08-14T17:23Z.
- **Deploy**: green, last run 2026-08-08 (nothing has merged to `main` since
  launch sign-off, so no redeploy expected).
- **Refresh data artifacts**: **red, 8/8 scheduled runs failed since
  inception (2026-08-08)**, including today's 09:36Z run. Failure signature
  is byte-for-byte the same as every prior day:
  - `test_every_stored_fixture_is_manifested` — two orphaned library-grid
    fixtures (`hours-grid-2026-07-26.html`, `hours-grid-2026-08-02.html`)
    left on disk by the un-pruned rolling capture window.
  - `test_the_hit_rate_over_real_data_is_pinned` / three sibling dedupe
    tests — the live publications RSS recapture no longer contains the one
    cross-outlet duplicate the regression corpus is pinned against
    (155 articles, 0 dupes found vs. the pinned 154/1).
  - Two `libraries/test_hours.py` assertions drifted because the recorded
    week now includes real semester-approach hours (Hay reopening,
    Rock's grid catching up to Champlin's).

  **This is not a new defect.** It is the exact failure **#16**
  (`ops/freshness-audit-2026-08-13`) already fixes: prune stale library
  grids on capture, and take `publications` off the daily cron (it's a
  frozen regression corpus, not a live smoke test — recapturing it
  unattended guarantees this exact drift). #16 has been open, green,
  `mergeable_state: clean`, since 2026-08-13 with no review.

## Data currency

- `brownsync.pages.dev` → 200.
- `GET /api/events`, default 7-day window → **93 upcoming events**. Healthy.

## What was NOT fixed today (and why)

No new code change opened. Both root causes hit today (seed-lane thresholds,
refresh.yml red streak) already have complete, tested, conflict-free fixes
sitting unmerged: **#12** (2026-08-09) and **#16** (2026-08-13). Re-deriving
either fix again in an 8th PR would just add another unreviewed duplicate —
the actual defect at this point is process, not code.

## The live risk

**7 open, unreviewed `ops/freshness-audit-*` PRs (#11–#17) have accumulated
since 2026-08-08**, all `mergeable_state: clean`, none merged. Every day the
same two already-fixed bugs get rediscovered and re-reported because `main`
never moves. This report is the 8th. The backlog — not any code defect — is
now the single biggest freshness risk to the project.

## Overall verdict: **AMBER**

Live/polled data (poll.yml lane: livewhale, athletics_ics, bdh, brown_news,
dedup) is fresh and the site is up with a healthy events window. The
artifact-refresh lane (dining/libcal/arcgis/library hours/publications) has
been fully red since launch, and six seed-lane sources read stale, both for
reasons already fixed in code sitting unreviewed.

**Single most important next action:** merge **#12** and **#16** (both
zero-conflict, clean) and enable "Allow GitHub Actions to create and approve
pull requests" (Settings → Actions → General → Workflow permissions) so
future `refresh.yml` runs can land their own artifact PRs.
