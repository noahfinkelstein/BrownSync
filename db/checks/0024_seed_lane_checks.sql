-- 0024_seed_lane_checks.sql — the six seed-lane sources are registered sanely.
--
-- Run by CI's migrate job right after the 0006 registry checks:
--   psql -v ON_ERROR_STOP=1 -f db/checks/0024_seed_lane_checks.sql
--
-- ROLLBACK-SAFE: reads the real rows shipped by 0024; no fixtures inserted.

begin;

do $chk$
declare
  bad text[];
  seeded text[] := array['athletics', 'buildings', 'cab', 'clubs', 'events', 'places'];
begin
  -- All six are present and enabled — an unregistered-but-run source is
  -- exactly the api_health() reading (stale_after_seconds = NULL) that
  -- caused the launch-report false amber this migration fixes.
  select coalesce(array_agg(s order by s), '{}') into bad
  from unnest(seeded) s
  where not exists (
    select 1 from source_registry r where r.source = s and r.enabled
  );
  if array_length(bad, 1) is not null then
    raise exception '0024: seed-lane sources missing or disabled: %', bad;
  end if;

  -- Every one carries a real, sane staleness horizon: never 0/null (the
  -- exact bug being fixed) and never shorter than its own cadence (0006's
  -- "stale between two on-time runs" configuration-bug check, restated here
  -- since these six are new rows).
  select coalesce(array_agg(source order by source), '{}') into bad
  from source_registry
  where source = any(seeded)
    and (cadence_seconds <= 0 or stale_after_seconds <= 0
         or stale_after_seconds <= cadence_seconds);
  if array_length(bad, 1) is not null then
    raise exception '0024: seed-lane rows with an unusable cadence/staleness: %', bad;
  end if;

  -- lane = 'actions': seed-load.yml is the runtime, same reasoning as arcgis.
  select coalesce(array_agg(source order by source), '{}') into bad
  from source_registry
  where source = any(seeded) and lane <> 'actions';
  if array_length(bad, 1) is not null then
    raise exception '0024: seed-lane rows not on lane=actions: %', bad;
  end if;
end
$chk$;

-- api_health() now reports a real horizon for these instead of NULL.
do $chk$
declare
  r record;
  s text;
begin
  foreach s in array array['athletics', 'buildings', 'cab', 'clubs', 'events', 'places']
  loop
    select * into r from api_health() where source = s;
    if not found then
      raise exception '0024: api_health() dropped %', s;
    end if;
    if r.stale_after_seconds is null then
      raise exception '0024: api_health() still reports NULL staleness for %', s;
    end if;
    if not r.enabled then
      raise exception '0024: api_health() reports % as disabled', s;
    end if;
  end loop;
end
$chk$;

rollback;

\echo '0024_seed_lane_checks: all assertions passed (transaction rolled back)'
