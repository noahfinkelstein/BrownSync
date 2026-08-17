-- 0024_seed_lane_staleness.sql — register the seed-lane sources so they stop
-- reading falsely stale.
--
-- ADDITIVE ONLY: six new source_registry rows. No table, column or function
-- changes.
--
-- WHY (P2 backlog item, reports/ops/2026-08-08-launch.md "Deferred
-- post-launch"): athletics, buildings, cab, clubs, events and places are
-- one-time db/seeds/*.ndjson|*.json loads applied by `pnpm db:seed`
-- (.github/workflows/seed-load.yml — workflow_dispatch only, human-confirmed,
-- never on a cron because it writes straight to prod). They were never given
-- source_registry rows, so api_health() left-joins them to NULL and both the
-- ops audit's 7-day default AND the web client's real 45-minute fallback
-- (apps/web/src/ops/health-model.ts STALE_AFTER_MS) mark them stale the
-- moment they age past 45 minutes — which is every day of their existence,
-- since nothing re-runs the loader on a schedule. Flagged at launch
-- (2026-08-08), unfixed for 9 days as of this audit (2026-08-17); the health
-- strip has been showing 6 false positives that whole time.
--
-- FIX: register real cadence/staleness per source, `lane = 'ingest'` —
-- the same lane academic_calendar already uses for "hand-curated / re-loaded
-- by human action, not by a scheduled fetch" (0006). The dispatcher
-- (apps/api/src/schedule/dispatch.ts) only claims lane in ('worker','sql'),
-- so an 'ingest' row is never auto-polled — these stay exactly as
-- seed-load-only as they are today. This does not touch prod: it is a code
-- change to a migration file, not a `supabase db push`.
--
-- CADENCE CHOICES (stale_after = 2x cadence, the convention every other row
-- in 0006 follows):
--   athletics/buildings/places — facilities-style reference data (team
--     venues, owned-building list, campus place list); changes on the order
--     of a year. cadence 365d, stale 730d — same horizon as academic_calendar.
--   cab/clubs/events — term-cadenced (course catalog, club directory, the
--     events seed baseline); Brown runs on a ~4-month term cycle. cadence
--     180d, stale 365d — generous enough that a term boundary landing a
--     week late from the human-run loader never trips false-stale.
--
-- LABELS: deliberately match what apps/web/src/ops/health-model.ts already
-- displays for an unregistered source today (its SOURCE_LABELS map for
-- cab/clubs, else title-cased slug) — sourceLabel() prefers the registry's
-- wire label over both, so a descriptive label here would silently rename
-- the health-strip text. That rename is out of scope for a staleness fix;
-- keep the row additive to cadence/threshold only.
--
-- No robots_note/tos_note/endpoint: these are committed repo artifacts
-- (db/seeds/*), not live-fetched, so there is no etiquette policy to record.
insert into source_registry (
  source, label, lane, enabled, cadence_seconds, stale_after_seconds,
  etiquette_min_interval_seconds, license, feed_weight, notes
) values
  ('athletics', 'Athletics', 'ingest', true, 31536000, 63072000, 1, null, 1.0,
   'db/seeds/athletics_venues.json, loaded by seed-load.yml (workflow_dispatch '
   'only — writes to prod, human-confirmed). Team/venue roster, changes about '
   'once a year; distinct from athletics_ics (the live calendar poll).'),

  ('buildings', 'Buildings', 'ingest', true, 31536000, 63072000, 1, null, 1.0,
   'db/seeds/brown_owned_buildings.json, loaded by seed-load.yml. Facilities '
   'ownership list, changes about once a year.'),

  ('places', 'Places', 'ingest', true, 31536000, 63072000, 1, null, 1.0,
   'db/seeds/places.ndjson, loaded by seed-load.yml. Campus place index, '
   'changes about once a year.'),

  ('cab', 'CAB', 'ingest', true, 15552000, 31536000, 1, null, 1.0,
   'db/seeds/course_meetings.ndjson, loaded by seed-load.yml. Course catalog '
   'turns over on Brown''s ~4-month term cycle.'),

  ('clubs', 'Clubs', 'ingest', true, 15552000, 31536000, 1, null, 1.0,
   'db/seeds/organizations.ndjson, loaded by seed-load.yml. Club directory, '
   'term-cadenced.'),

  ('events', 'Events', 'ingest', true, 15552000, 31536000, 1, null, 1.0,
   'db/seeds/events.ndjson, loaded by seed-load.yml. One-time seed baseline '
   'of department/calendar events; livewhale is the live incremental feed for '
   'this table, this row only covers the seeded baseline batch.')
on conflict (source) do nothing;
