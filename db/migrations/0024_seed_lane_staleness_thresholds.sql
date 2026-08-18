-- 0024_seed_lane_staleness_thresholds.sql — register the seed-lane sources.
--
-- ADDITIVE ONLY: six new source_registry rows. No table, column, or function
-- is touched; api_health() (0006) already joins source_registry, so these
-- rows are picked up with no other code change.
--
-- ROOT CAUSE (2026-08-08 launch report, P2 backlog, reports/ops/
-- 2026-08-08-launch.md): 'athletics', 'buildings', 'cab', 'clubs', 'events'
-- and 'places' were upserted straight from db/seeds/ by seed-load.yml
-- (2026-07-29) but were never given a source_registry row. api_health()
-- reports an unregistered-but-run source with stale_after_seconds = NULL
-- (0006's `known` CTE union), so every client-side staleness check either
-- invents its own fallback or, per the launch report, misreads these six
-- as permanently amber. The backlog entry recorded two ways to close it —
-- "seed real thresholds or refresh cadence" — this migration takes the
-- first: no live producer exists yet for any of the six (services/poller
-- only runs livewhale/athletics_ics/bdh; the others are one-time NDJSON/JSON
-- loads reviewed by a human and re-run on demand via seed-load.yml), so
-- inventing a cron here would just be a second unreviewed writer to prod.
--
-- lane = 'actions': seed-load.yml (a GitHub Action) is the runtime that
-- would reload these, same as arcgis's weekly refresh.yml run — it is just
-- dispatched on demand instead of on a schedule, because a diff in a
-- 350 KB clubs NDJSON deserves a human glance before it reaches prod.
--
-- Cadence reflects how often the underlying data actually changes, not a
-- polling interval nothing enforces — same convention as academic_calendar
-- (0006): stale_after_seconds is 2x cadence_seconds throughout.
--   - athletics (venue list) / buildings (Brown-owned buildings): near-
--     permanent reference data, changes on the order of a year.
--   - cab (course meetings) / clubs (student orgs) / places (rooms tied to
--     the current term's course locations): turn over on the academic
--     term, roughly every 4 months.
--   - events: the 2026-07-29 seed batch of upcoming events (contract
--     source='events', distinct from the livewhale/athletics_ics/bdh
--     pollers that keep adding to the same table). Re-seeded alongside cab
--     each term for the same reason: it is a term-scoped snapshot, not a
--     live feed.

insert into source_registry (
  source, label, lane, enabled, cadence_seconds, stale_after_seconds,
  etiquette_min_interval_seconds, robots_note, tos_note, license,
  feed_weight, endpoint, notes
) values
  ('athletics', 'Athletics venues (seed)', 'actions', true,
   31536000, 63072000, 1, null, null, null, 1.0, null,
   'One-time seed of athletics_venues.json via seed-load.yml (2026-07-29). '
   'No live producer — distinct from the athletics_ics poller. Venue list '
   'changes on the order of a year; re-seed on demand when it does.'),

  ('buildings', 'Brown-owned buildings (seed)', 'actions', true,
   31536000, 63072000, 1, null, null, null, 1.0, null,
   'One-time seed of brown_owned_buildings.json via seed-load.yml '
   '(2026-07-29). No live producer. Building ownership changes on the '
   'order of a year; re-seed on demand when it does.'),

  ('cab', 'Courses @ Brown (seed)', 'actions', true,
   10368000, 20736000, 1, null, null, null, 1.0, null,
   'One-time seed of course_meetings.ndjson via seed-load.yml (2026-07-29). '
   'No live producer — cab_extract_*.js is a reviewed, human-run capture, '
   'not a scheduled job. Course schedule turns over each term (~120d); '
   're-seed at the start of the next term.'),

  ('clubs', 'Student organizations (seed)', 'actions', true,
   10368000, 20736000, 1, null, null, null, 1.0, null,
   'One-time seed of organizations.ndjson via seed-load.yml (2026-07-29). '
   'No live producer. Org roster turns over each term (~120d); re-seed at '
   'the start of the next term.'),

  ('places', 'Campus places (seed)', 'actions', true,
   10368000, 20736000, 1, null, null, null, 1.0, null,
   'One-time seed of places.ndjson via seed-load.yml (2026-07-29). No live '
   'producer. Room/place set follows the term''s course locations (~120d); '
   're-seed alongside cab.'),

  ('events', 'Upcoming events (seed batch)', 'actions', true,
   10368000, 20736000, 1, null, null, null, 1.0, null,
   'One-time seed of events.ndjson via seed-load.yml (2026-07-29) — the '
   'launch-day snapshot of upcoming events, distinct from the ongoing '
   'livewhale/athletics_ics/bdh pollers that write the same table. '
   'Term-scoped like cab; re-seed alongside it.')
on conflict (source) do nothing;
