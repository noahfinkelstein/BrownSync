-- 0024_seed_lane_registry.sql — register the ingest CLI's bootstrap sources.
--
-- ADDITIVE ONLY: six new source_registry rows, no table/column/function
-- touched.
--
-- WHY THIS EXISTS
--
-- `athletics`, `buildings`, `cab`, `clubs`, `events`, and `places` are the six
-- jobs of `uv run ingest run all` (ingest/README.md) — Python producers that
-- publish from hand-curated, hash-pinned CSV/JSON exports (the Fall 2026 CAB
-- export, the 2026-07-29 student-groups pack, etc.), not a live poll. They
-- ran once at launch (2026-07-29) and have no scheduled trigger: poll.yml
-- covers the DB-backed *live* sources (livewhale, athletics_ics, bdh) and
-- refresh.yml covers the file-based artifacts (dining, publications, library
-- hours, ArcGIS); neither invokes the ingest CLI's `run all --out postgres`.
--
-- None of the six had a source_registry row, so api_health() (migration
-- 0006) emitted stale_after_seconds = NULL for all of them and every client
-- fell back to its own default horizon — apps/web's is 45 minutes
-- (apps/web/src/ops/health-model.ts STALE_AFTER_MS), which reads an
-- 11-day-old bootstrap load as "stale" every single day. Recorded as backlog
-- in reports/ops/2026-08-08-launch.md ("seed-lane staleness thresholds ...
-- seed real thresholds or refresh cadence").
--
-- Of the two options the report names, "seed real thresholds" is the correct
-- one here, not "refresh cadence": there is no live endpoint behind these six
-- to re-poll on a timer — re-running them means capturing a new hand-curated
-- export (next semester's CAB extract, a refreshed student-groups roster),
-- which is an operator action, not something a cron job can originate.
-- `academic_calendar` (migration 0006) already set this precedent for
-- hand-curated, in-repo data: a long cadence with stale_after at 2x.
--
-- All six run together as one bundle (`run all` order: places -> cab ->
-- clubs -> athletics -> buildings -> events, per ingest/README.md) and are
-- re-captured together whenever the underlying export bundle turns over, so
-- they share one cadence: ~180 days (roughly a semester, the natural
-- refresh point for course/org data), stale_after at 2x = ~360 days. This is
-- looser than a live feed and tighter than `academic_calendar`'s
-- once-a-year change rate — the ops health strip stops crying wolf on a
-- Jul 29 timestamp without masking a genuine season-over-season miss.
--
-- `lane = 'ingest'` matches academic_calendar: these are Python ingest-CLI
-- jobs, not the TS Worker/Actions pollers.
insert into source_registry (
  source, label, lane, enabled, cadence_seconds, stale_after_seconds,
  etiquette_min_interval_seconds, robots_note, tos_note, license,
  feed_weight, endpoint, notes
) values
  ('places', 'Campus places directory', 'ingest', true, 15552000, 31104000, 1,
   null, null, null, 1.0, null,
   'ingest CLI job (ingest/brownsync_ingest/gazetteer): gazetteer + Overpass '
   '+ CAB place resolution, published as db/seeds/places.ndjson. Re-run is a '
   'manual `run all`, alongside cab/clubs/athletics/buildings/events — not '
   'on a poll cadence.'),

  ('cab', 'Course meetings (CAB)', 'ingest', true, 15552000, 31104000, 1,
   null, null, null, 1.0, null,
   'ingest CLI job (ingest/brownsync_ingest/cab): user-provided CAB CSV '
   'export (currently the Fall 2026 export). Turns over once a semester when '
   'a new export is captured, not on a poll cadence.'),

  ('clubs', 'Student organizations', 'ingest', true, 15552000, 31104000, 1,
   null, null, null, 1.0, null,
   'ingest CLI job (ingest/brownsync_ingest/clubs): user-provided student- '
   'groups CSV + LiveWhale groups sidecar. Re-captured with the CAB export '
   'bundle, not on a poll cadence.'),

  ('athletics', 'Athletics home venues', 'ingest', true, 15552000, 31104000, 1,
   null, null, null, 1.0, null,
   'ingest CLI job (ingest/brownsync_ingest/athletics_venues.py): venue-to- '
   'place sidecar derived from the athletics ICS capture. Distinct from the '
   'live `athletics_ics` poller row — this one only turns over when venues '
   'change, which is rare.'),

  ('buildings', 'Brown-owned buildings', 'ingest', true, 15552000, 31104000, 1,
   null, null, null, 1.0, null,
   'ingest CLI job (ingest/brownsync_ingest/brown_owned_buildings.py): '
   'map-tint classification from a user-provided CSV + Overpass footprints. '
   'Changes on the order of new construction, i.e. rarely.'),

  ('events', 'Events bootstrap (LiveWhale + registrar)', 'ingest', true,
   15552000, 31104000, 1, null, null, null, 1.0, null,
   'ingest CLI job (ingest/brownsync_ingest/events): one-time bootstrap from '
   'two hash-pinned CSV exports. Ongoing event freshness comes from the live '
   '`livewhale` Worker poller layered on top (ingest/README.md "Events '
   'bootstrap and poller parity"); this row only reflects the bootstrap '
   'load, not the app''s live event data.')
on conflict (source) do nothing;
