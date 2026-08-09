-- 0024_seed_lane_registry_checks.sql — semantic checks for the ingest CLI's
-- bootstrap-source registry rows (migration 0024).
--
-- Run by CI's postgis job right after migrations:
--   psql -v ON_ERROR_STOP=1 -f db/checks/0024_seed_lane_registry_checks.sql
--
-- ROLLBACK-SAFE: one transaction that always rolls back.

begin;

do $chk$
declare
  r record;
  src text;
  seed_sources text[] := array['places', 'cab', 'clubs', 'athletics',
                                'buildings', 'events'];
begin
  foreach src in array seed_sources loop
    select * into r from source_registry where source = src;
    if not found then
      raise exception '0024: % registry row is missing', src;
    end if;
    if r.lane <> 'ingest' then
      raise exception '0024: % lane = %, want ingest', src, r.lane;
    end if;
    if not r.enabled then
      raise exception '0024: % is disabled — it is a live, running seed source', src;
    end if;
    if r.cadence_seconds <> 15552000 then
      raise exception '0024: % cadence = %s, want 15552000', src, r.cadence_seconds;
    end if;
    if r.stale_after_seconds <> 31104000 then
      raise exception '0024: % stale_after = %s, want 31104000', src, r.stale_after_seconds;
    end if;
    -- The invariant migration 0006 enforces for every enabled row: staleness
    -- must exceed cadence, or a source reads stale immediately after a run.
    if r.stale_after_seconds <= r.cadence_seconds then
      raise exception '0024: % stale_after (%) <= cadence (%)', src,
        r.stale_after_seconds, r.cadence_seconds;
    end if;
  end loop;

  -- api_health() must now surface a real horizon for these six instead of
  -- NULL — the whole point of the migration. Uses the Jul 29 launch-load
  -- source_runs rows, which are already present in any environment where
  -- these sources have run (CI's poller fixture pass does not touch them,
  -- so this only asserts registry presence, not an actual source_runs row).
  if exists (
    select 1 from api_health()
    where source = any(seed_sources) and stale_after_seconds is null
  ) then
    raise exception '0024: a seed-lane source still reports stale_after_seconds NULL';
  end if;
end
$chk$;

rollback;

\echo '0024_seed_lane_registry_checks: all assertions passed (transaction rolled back)'
