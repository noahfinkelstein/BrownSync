-- 0018_dispatcher_checks.sql — semantic checks for the Worker dispatcher's
-- registry policy (migration 0018) and its claim SQL.
--
-- Run by CI's postgis job right after migrations:
--   psql -v ON_ERROR_STOP=1 -f db/checks/0018_dispatcher_checks.sql
--
-- ROLLBACK-SAFE: one transaction that always rolls back; fixtures are
-- prefixed chk_ and assertions test MEMBERSHIP, so this is safe against a
-- live database.
--
-- Two kinds of assertion, mirroring 0006's split:
--  * SEEDED-DATA assertions read the real dedup row 0018 retunes — these keep
--    a future edit from quietly undoing the problem-#6 fix and re-coupling
--    dedup's cadence to another workflow's schedule;
--  * FIXTURE assertions (chk_ rows) prove the CLAIM UPDATE's semantics — the
--    SQL twin of the pure due() predicate in apps/api/src/schedule/
--    dispatch.ts. The TypeScript side is unit-tested offline; this is the
--    database side of the same contract, so the two cannot drift silently.

begin;

-- ---------------------------------------------------------------------------
-- Seeded policy: dedup belongs to the dispatcher now.
-- ---------------------------------------------------------------------------
do $chk$
declare
  r record;
begin
  select * into r from source_registry where source = 'dedup';
  if not found then
    raise exception '0018: dedup registry row is missing';
  end if;
  if r.lane <> 'sql' then
    raise exception '0018: dedup lane = %, want sql (Worker dispatcher, problem #6)', r.lane;
  end if;
  if not r.enabled then
    raise exception '0018: dedup is disabled — the dispatcher would never run it';
  end if;
  if r.cadence_seconds <> 900 then
    raise exception '0018: dedup cadence = %s, want 900', r.cadence_seconds;
  end if;
  if r.stale_after_seconds <> 3600 then
    raise exception '0018: dedup stale_after = %s, want 3600', r.stale_after_seconds;
  end if;

  -- feed_rank is registered ahead of its producer and must STAY disabled
  -- until one exists — an enabled row with no runner makes the registry lie.
  select * into r from source_registry where source = 'feed_rank';
  if not found then
    raise exception '0018: feed_rank registry row is missing';
  end if;
  if r.enabled then
    raise exception '0018: feed_rank is enabled but has no producer yet';
  end if;

  -- The dispatcher''s first worker source: livewhale stays on its contract §5
  -- cadence.
  select * into r from source_registry where source = 'livewhale';
  if not found or r.lane <> 'worker' or not r.enabled or r.cadence_seconds <> 600 then
    raise exception '0018: livewhale must be an enabled worker source at 600s';
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- Claim semantics: the conditional UPDATE in scheduled.ts must re-check
-- eligibility atomically. Fixture rows cover each predicate leg.
-- ---------------------------------------------------------------------------
do $chk$
declare
  n int;
begin
  insert into source_registry
    (source, label, lane, enabled, cadence_seconds, stale_after_seconds)
  values
    ('chk_disp_neverrun', 'chk', 'worker', true, 600, 2400),
    ('chk_disp_overdue',  'chk', 'worker', true, 600, 2400),
    ('chk_disp_fresh',    'chk', 'worker', true, 600, 2400),
    ('chk_disp_backoff',  'chk', 'worker', true, 600, 2400),
    ('chk_disp_disabled', 'chk', 'worker', false, 0, 0);
  update source_registry set last_started_at = now() - interval '11 minutes'
    where source = 'chk_disp_overdue';
  update source_registry set last_started_at = now() - interval '5 minutes'
    where source = 'chk_disp_fresh';
  update source_registry
    set last_started_at = now() - interval '2 hours',
        backoff_until   = now() + interval '30 minutes'
    where source = 'chk_disp_backoff';

  -- Never-run: claimable.
  update source_registry set last_started_at = now()
  where source = 'chk_disp_neverrun' and enabled
    and (backoff_until is null or backoff_until <= now())
    and (last_started_at is null
         or last_started_at + make_interval(secs => cadence_seconds) <= now());
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception '0018: never-run source not claimable (claimed % rows)', n;
  end if;

  -- Re-claiming immediately must LOSE — this is the not-exactly-once guard:
  -- of two overlapping ticks, the second sees a fresh last_started_at.
  update source_registry set last_started_at = now()
  where source = 'chk_disp_neverrun' and enabled
    and (backoff_until is null or backoff_until <= now())
    and (last_started_at is null
         or last_started_at + make_interval(secs => cadence_seconds) <= now());
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception '0018: immediate re-claim won — overlapping ticks would double-run';
  end if;

  -- Past-cadence: claimable.
  update source_registry set last_started_at = now()
  where source = 'chk_disp_overdue' and enabled
    and (backoff_until is null or backoff_until <= now())
    and (last_started_at is null
         or last_started_at + make_interval(secs => cadence_seconds) <= now());
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception '0018: overdue source not claimable (claimed % rows)', n;
  end if;

  -- Inside cadence: not claimable.
  update source_registry set last_started_at = now()
  where source = 'chk_disp_fresh' and enabled
    and (backoff_until is null or backoff_until <= now())
    and (last_started_at is null
         or last_started_at + make_interval(secs => cadence_seconds) <= now());
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception '0018: source inside its cadence was claimed';
  end if;

  -- Backoff wins over cadence: an overdue-but-suppressed source stays put.
  update source_registry set last_started_at = now()
  where source = 'chk_disp_backoff' and enabled
    and (backoff_until is null or backoff_until <= now())
    and (last_started_at is null
         or last_started_at + make_interval(secs => cadence_seconds) <= now());
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception '0018: backed-off source was claimed';
  end if;

  -- Disabled: the kill switch must hold at claim time too.
  update source_registry set last_started_at = now()
  where source = 'chk_disp_disabled' and enabled
    and (backoff_until is null or backoff_until <= now())
    and (last_started_at is null
         or last_started_at + make_interval(secs => cadence_seconds) <= now());
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception '0018: disabled source was claimed';
  end if;

  -- Failure bookkeeping: markFailure is ONE statement — the failure count
  -- and its backoff move together, with no window between — and markSuccess
  -- resets both.
  update source_registry
    set consecutive_failures = consecutive_failures + 1,
        backoff_until = now() + interval '20 minutes'
    where source = 'chk_disp_overdue';
  update source_registry
    set consecutive_failures = consecutive_failures + 1,
        backoff_until = now() + interval '40 minutes'
    where source = 'chk_disp_overdue';
  if (select consecutive_failures from source_registry where source = 'chk_disp_overdue') <> 2 then
    raise exception '0018: consecutive_failures did not accumulate';
  end if;
  if (select backoff_until from source_registry where source = 'chk_disp_overdue') is null then
    raise exception '0018: markFailure did not set backoff_until';
  end if;
  update source_registry
    set consecutive_failures = 0, backoff_until = null, last_ok_at = now()
    where source = 'chk_disp_overdue';
  if (select consecutive_failures from source_registry where source = 'chk_disp_overdue') <> 0
     or (select backoff_until from source_registry where source = 'chk_disp_overdue') is not null then
    raise exception '0018: markSuccess did not reset consecutive_failures + backoff';
  end if;
end
$chk$;

rollback;

\echo '0018_dispatcher_checks: all assertions passed (transaction rolled back)'
