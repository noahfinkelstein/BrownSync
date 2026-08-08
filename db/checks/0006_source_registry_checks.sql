-- 0006_source_registry_checks.sql — semantic checks for the source registry.
--
-- Run by CI's postgis job right after migrations:
--   psql -v ON_ERROR_STOP=1 -f db/checks/0006_source_registry_checks.sql
--
-- ROLLBACK-SAFE: one transaction that always rolls back; fixtures are
-- prefixed chk_ and assertions test MEMBERSHIP, so this is safe against a
-- live database.
--
-- Two kinds of assertion here, and the distinction matters:
--  * FIXTURE assertions (chk_ rows) prove api_health()'s join behaviour;
--  * SEEDED-DATA assertions read the real registry rows shipped by 0006 —
--    specifically that both recorded refusals are present, disabled, and
--    carry their reason verbatim. Those are the assertions that keep a future
--    edit from quietly deleting a refusal and turning it back into a silent
--    omission.

begin;

-- ---------------------------------------------------------------------------
-- Seeded refusals: registered, disabled, and explained.
-- ---------------------------------------------------------------------------
do $chk$
declare
  r record;
begin
  select * into r from source_registry where source = 'providence_gov';
  if not found then
    raise exception '0006: providence_gov refusal row is missing from the registry';
  end if;
  if r.enabled then
    raise exception '0006: providence_gov is enabled — robots.txt disallows it';
  end if;
  if r.lane <> 'blocked' then
    raise exception '0006: providence_gov lane = %, want blocked', r.lane;
  end if;
  if r.robots_note is null or r.robots_note !~ 'Disallow|disallow' then
    raise exception '0006: providence_gov carries no robots.txt evidence (%)', r.robots_note;
  end if;
  -- The verbatim paths are the evidence; losing them loses the refusal.
  if r.robots_note !~ '/event/' or r.robots_note !~ '/events/' then
    raise exception '0006: providence_gov robots_note lost the disallowed paths (%)', r.robots_note;
  end if;

  select * into r from source_registry where source = 'today_brown';
  if not found then
    raise exception '0006: today_brown refusal row is missing from the registry';
  end if;
  if r.enabled then
    raise exception '0006: today_brown is enabled — the host is behind Shibboleth SSO';
  end if;
  if r.lane <> 'blocked' then
    raise exception '0006: today_brown lane = %, want blocked', r.lane;
  end if;
  if coalesce(r.tos_note, r.robots_note) !~ 'Shibboleth' then
    raise exception '0006: today_brown lost its SSO refusal reason (%)', r.tos_note;
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- Seeded policy: the BDH legal gate and the athletics etiquette cadence.
-- ---------------------------------------------------------------------------
do $chk$
declare
  r record;
begin
  select * into r from source_registry where source = 'bdh';
  if not found then
    raise exception '0006: bdh registry row is missing';
  end if;
  -- POLICY CHANGE, recorded: 0006 seeded bdh disabled (pre-P1 stance). On
  -- 2026-08-07 the owner approved the headline-only interim posture while the
  -- written-permission email is out (G1; reports/ops/2026-08-07-launch-
  -- session-1.md), applied by migration 0022. The pin flips direction — bdh
  -- must be ENABLED with the decision recorded in its tos_note — and the
  -- licence/note pins stay as strong as before.
  if not r.enabled then
    raise exception
      '0006: bdh is disabled — the 2026-08-07 owner decision (migration 0022) enables the headline-only interim';
  end if;
  if r.license <> 'headline_only' then
    raise exception '0006: bdh license = %, want headline_only', r.license;
  end if;
  if r.tos_note is null or position('2026-08-07 owner decision' in r.tos_note) = 0 then
    raise exception '0006: bdh ToS note must record the 2026-08-07 interim decision (got %)', r.tos_note;
  end if;

  select * into r from source_registry where source = 'athletics_ics';
  if r.cadence_seconds <> 7200 then
    raise exception
      '0006: athletics_ics cadence = %, want 7200 (X-PUBLISHED-TTL PT120M)', r.cadence_seconds;
  end if;
  if r.etiquette_min_interval_seconds < 30 then
    raise exception
      '0006: athletics_ics etiquette interval = %, want >= 30 (robots Crawl-delay 30)',
      r.etiquette_min_interval_seconds;
  end if;

  select * into r from source_registry where source = 'livewhale';
  if r.cadence_seconds > 600 then
    raise exception
      '0006: livewhale cadence = %, contract §5 allows at most every 600s', r.cadence_seconds;
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- Every enabled row is schedulable, every row's staleness horizon is sane.
-- ---------------------------------------------------------------------------
do $chk$
declare
  bad text[];
begin
  select coalesce(array_agg(source order by source), '{}') into bad
  from source_registry
  where enabled and (cadence_seconds <= 0 or stale_after_seconds <= 0);
  if array_length(bad, 1) is not null then
    raise exception '0006: enabled rows with no usable cadence/staleness: %', bad;
  end if;

  -- A staleness horizon shorter than the cadence marks a source stale
  -- between two on-time runs — always a configuration bug.
  select coalesce(array_agg(source order by source), '{}') into bad
  from source_registry
  where enabled and stale_after_seconds <= cadence_seconds;
  if array_length(bad, 1) is not null then
    raise exception '0006: stale_after_seconds <= cadence_seconds for: %', bad;
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- The CHECK constraints actually bite.
-- ---------------------------------------------------------------------------
do $chk$
declare
  rejected boolean;
begin
  -- an enabled source with no cadence
  rejected := false;
  begin
    insert into source_registry (source, label, lane, enabled, cadence_seconds, stale_after_seconds)
    values ('chk_no_cadence', 'Chk', 'worker', true, 0, 600);
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception '0006: an enabled source with cadence_seconds = 0 was accepted';
  end if;

  -- a blocked source that is somehow enabled
  rejected := false;
  begin
    insert into source_registry (source, label, lane, enabled, cadence_seconds,
                                 stale_after_seconds, robots_note)
    values ('chk_blocked_on', 'Chk', 'blocked', true, 600, 1200, 'nope');
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception '0006: a lane=blocked source was accepted with enabled = true';
  end if;

  -- a refusal with no recorded reason
  rejected := false;
  begin
    insert into source_registry (source, label, lane, enabled, cadence_seconds, stale_after_seconds)
    values ('chk_blocked_mute', 'Chk', 'blocked', false, 0, 0);
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception '0006: a lane=blocked source was accepted without a robots/ToS reason';
  end if;

  -- an unknown licence value
  rejected := false;
  begin
    insert into source_registry (source, label, lane, enabled, cadence_seconds,
                                 stale_after_seconds, license)
    values ('chk_bad_license', 'Chk', 'worker', true, 600, 1200, 'everything');
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception '0006: an unknown license value was accepted';
  end if;

  -- an unknown lane
  rejected := false;
  begin
    insert into source_registry (source, label, lane, enabled, cadence_seconds, stale_after_seconds)
    values ('chk_bad_lane', 'Chk', 'quantum', true, 600, 1200);
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception '0006: an unknown lane was accepted';
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- api_health(): registry join, 'never' from SQL, and the no-registry fallback.
-- ---------------------------------------------------------------------------
insert into source_registry (source, label, lane, enabled, cadence_seconds,
                             stale_after_seconds, robots_note) values
  ('chk_weekly',  'Chk Weekly Feed',  'actions', true,  604800, 1209600, null),
  ('chk_never',   'Chk Never Ran',    'worker',  true,  600,    2400,    null),
  ('chk_off',     'Chk Switched Off', 'blocked', false, 0,      0,       'chk refusal reason');

insert into source_runs (source, started_at, finished_at, status, items_upserted, error) values
  ('chk_weekly',    '2026-07-01T00:00:00Z', '2026-07-01T00:05:00Z', 'ok',    10,   null),
  ('chk_unlisted',  '2026-07-02T00:00:00Z', '2026-07-02T00:05:00Z', 'ok',    7,    null);

do $chk$
declare
  r record;
begin
  -- registered + has runs: registry columns join on
  select * into r from api_health() where source = 'chk_weekly';
  if not found then
    raise exception 'api_health: chk_weekly missing';
  end if;
  if r.stale_after_seconds <> 1209600 then
    raise exception 'api_health: chk_weekly stale_after_seconds = %, want 1209600',
      r.stale_after_seconds;
  end if;
  if r.label <> 'Chk Weekly Feed' then
    raise exception 'api_health: chk_weekly label = %, want the registry label', r.label;
  end if;
  if not r.enabled then
    raise exception 'api_health: chk_weekly reported disabled';
  end if;
  if r.status <> 'ok' then
    raise exception 'api_health: chk_weekly status = %, want ok', r.status;
  end if;

  -- registered, never ran: 'never' comes from SQL, not the API layer
  select * into r from api_health() where source = 'chk_never';
  if not found then
    raise exception 'api_health: a registered source that never ran was omitted';
  end if;
  if r.status <> 'never' then
    raise exception 'api_health: chk_never status = %, want never', r.status;
  end if;
  if r.last_run_at is not null or r.last_ok_at is not null then
    raise exception 'api_health: chk_never carries run timestamps';
  end if;
  if r.stale_after_seconds <> 2400 then
    raise exception 'api_health: chk_never stale_after_seconds = %, want 2400',
      r.stale_after_seconds;
  end if;

  -- a recorded refusal is REPORTED, disabled, with no bogus staleness horizon
  select * into r from api_health() where source = 'chk_off';
  if not found then
    raise exception 'api_health: a disabled source was silently omitted';
  end if;
  if r.enabled then
    raise exception 'api_health: chk_off reported enabled';
  end if;
  if r.stale_after_seconds is not null then
    raise exception
      'api_health: chk_off leaked a 0-second staleness horizon (%)', r.stale_after_seconds;
  end if;

  -- runs with no registry row: still reported, implicitly enabled, no horizon
  select * into r from api_health() where source = 'chk_unlisted';
  if not found then
    raise exception 'api_health: an unregistered source with runs was dropped';
  end if;
  if not r.enabled then
    raise exception 'api_health: an unregistered running source reported as disabled';
  end if;
  if r.stale_after_seconds is not null or r.label is not null then
    raise exception 'api_health: an unregistered source invented registry values';
  end if;
  if r.status <> 'ok' then
    raise exception 'api_health: chk_unlisted status = %, want ok', r.status;
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- Both recorded refusals surface through api_health(), which is the point.
-- ---------------------------------------------------------------------------
do $chk$
declare
  reported text[];
begin
  select coalesce(array_agg(source order by source), '{}') into reported
  from api_health()
  where source in ('providence_gov', 'today_brown') and not enabled;
  if reported <> array['providence_gov', 'today_brown'] then
    raise exception
      '0006: refusals not reported as disabled by api_health() (got %)', reported;
  end if;
end
$chk$;

rollback;

\echo '0006_source_registry_checks: all assertions passed (transaction rolled back)'
