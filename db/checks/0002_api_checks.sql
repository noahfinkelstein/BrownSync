-- 0002_api_checks.sql — semantic checks for the read-API SQL layer.
--
-- The vitest suite in apps/api exercises route handlers over an injected
-- fake, so nothing there executes the SQL in db/migrations/0002_api.sql.
-- This script closes that gap: CI's postgis job runs it with plain
--   psql -v ON_ERROR_STOP=1 -f db/checks/0002_api_checks.sql
-- right after applying migrations. Any failed assertion raises an exception
-- and fails the job.
--
-- ROLLBACK-SAFE: everything runs inside one transaction that always rolls
-- back, so it can also be pointed at a live database without leaving fixture
-- rows behind. Fixture identifiers are prefixed chk- / chk_ and assertions
-- test set MEMBERSHIP (not counts), so pre-existing rows never break them.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

-- Pin the Fall 2026 term window the assertions below assume (0002 seeds this
-- row, but a live DB may have updated it; the pin rolls back with the rest).
insert into term_calendar (srcdb, start_date, end_date)
values ('202710', date '2026-09-09', date '2026-12-22')
on conflict (srcdb) do update
  set start_date = excluded.start_date, end_date = excluded.end_date;

insert into places (id, name, aliases, kind, lat, lng) values
  ('chk-salomon', 'Chk Salomon Center', '{Salomon}', 'academic', 41.8262, -71.4032),
  ('chk-far',     'Chk Far Away Hall',  '{}',        'academic', 41.9000, -71.3000);

insert into organizations (id, name, kind, category, source) values
  ('chk-org', 'Chk Org', 'club', 'club', 'manual');

insert into events (id, source, source_id, canonical_id, title, start_ts, end_ts,
                    lat, lng, place_id, org_id, category) values
  -- canonical + duplicate pair
  ('00000000-0000-4000-8000-0000000000e1', 'chk',  'canon', null,
   'Chk Canonical Lecture', '2026-09-15T18:00:00Z', '2026-09-15T19:00:00Z',
   41.8262, -71.4032, 'chk-salomon', 'chk-org', 'academic'),
  ('00000000-0000-4000-8000-0000000000e2', 'chk2', 'dup',
   '00000000-0000-4000-8000-0000000000e1',
   'Chk Duplicate Of Canonical', '2026-09-15T18:00:00Z', '2026-09-15T19:00:00Z',
   null, null, null, null, 'academic'),
  -- time-overlap semantics
  ('00000000-0000-4000-8000-0000000000e3', 'chk', 'inprogress', null,
   'Chk In Progress', '2026-09-15T17:00:00Z', '2026-09-15T19:00:00Z',
   null, null, null, null, 'academic'),
  ('00000000-0000-4000-8000-0000000000e4', 'chk', 'past', null,
   'Chk Fully Past', '2026-09-15T10:00:00Z', '2026-09-15T11:00:00Z',
   null, null, null, null, 'academic'),
  ('00000000-0000-4000-8000-0000000000e5', 'chk', 'openended', null,
   'Chk Open Ended', '2026-09-15T17:00:00Z', null,
   null, null, null, null, 'academic'),
  -- bbox
  ('00000000-0000-4000-8000-0000000000e6', 'chk', 'farcoords', null,
   'Chk Far Coords', '2026-09-15T18:00:00Z', '2026-09-15T19:00:00Z',
   41.9000, -71.3000, 'chk-far', null, 'academic'),
  ('00000000-0000-4000-8000-0000000000e7', 'chk', 'nocoords', null,
   'Chk No Coords', '2026-09-15T18:00:00Z', '2026-09-15T19:00:00Z',
   null, null, null, null, 'academic'),
  -- category
  ('00000000-0000-4000-8000-0000000000e8', 'chk', 'arts', null,
   'Chk Arts Show', '2026-09-15T18:00:00Z', '2026-09-15T19:00:00Z',
   null, null, null, null, 'arts'),
  -- q: ilike-metacharacter escaping + substring-over-fuzzy ranking
  ('00000000-0000-4000-8000-0000000000e9', 'chk', 'underscore', null,
   'Chk ABC_DEF', '2026-10-01T00:00:00Z', null, null, null, null, null, 'academic'),
  ('00000000-0000-4000-8000-0000000000ea', 'chk', 'nounderscore', null,
   'Chk ABCXDEF', '2026-10-01T00:00:00Z', null, null, null, null, null, 'academic'),
  ('00000000-0000-4000-8000-0000000000eb', 'chk', 'backslash', null,
   'Chk Back\Slash', '2026-10-01T00:00:00Z', null, null, null, null, null, 'academic'),
  ('00000000-0000-4000-8000-0000000000ec', 'chk', 'jazzsub', null,
   'Chk Evening Jazz', '2026-10-05T00:00:00Z', null, null, null, null, null, 'academic'),
  -- single-word title: similarity('jaz','jazz') = 0.5, safely over the 0.3
  -- threshold, while 'Jaz' is not an ilike substring hit for q='Jazz'
  ('00000000-0000-4000-8000-0000000000ed', 'chk', 'jazfuzzy', null,
   'Jaz', '2026-10-02T00:00:00Z', null, null, null, null, null, 'academic');

insert into course_meetings (id, srcdb, crn, course_code, title, days,
                             start_time, end_time, place_id) values
  ('chk-tth',  '202710', 'c1', 'CHK 0001', 'Chk TTh',        'TTh', '14:00', '14:50', 'chk-salomon'),
  ('chk-th',   '202710', 'c2', 'CHK 0002', 'Chk Th only',    'Th',  '14:00', '14:50', null),
  ('chk-t',    '202710', 'c3', 'CHK 0003', 'Chk T only',     'T',   '14:00', '14:50', null),
  ('chk-mwf',  '202710', 'c4', 'CHK 0004', 'Chk MWF',        'MWF', '14:00', '14:50', null),
  ('chk-su',   '202710', 'c5', 'CHK 0005', 'Chk Su only',    'Su',  '14:00', '14:50', null),
  ('chk-s',    '202710', 'c6', 'CHK 0006', 'Chk S only',     'S',   '14:00', '14:50', null),
  -- srcdb with no term_calendar row -> wide Fall 2026 fallback window
  ('chk-nosrc', 'chk999', 'c7', 'CHK 0007', 'Chk unknown srcdb', 'MWF', '14:00', '14:50', null);

insert into source_runs (source, started_at, finished_at, status, items_upserted, error) values
  ('chk_lw',   '2026-07-01T00:00:00Z', '2026-07-01T00:05:00Z', 'ok',    10,   null),
  ('chk_lw',   '2026-07-02T00:00:00Z', '2026-07-02T00:05:00Z', 'error', null, 'boom'),
  ('chk_solo', '2026-07-03T00:00:00Z', null,                   'ok',    3,    null);

-- ---------------------------------------------------------------------------
-- v_events_api: canonical rows only, merged_sources, place/org join
-- ---------------------------------------------------------------------------
do $chk$
declare
  r record;
begin
  select * into r from v_events_api
  where id = '00000000-0000-4000-8000-0000000000e1';
  if not found then
    raise exception 'v_events_api: canonical event missing';
  end if;
  if r.merged_sources <> array['chk2'] then
    raise exception 'v_events_api: merged_sources = %, want {chk2}', r.merged_sources;
  end if;
  if r.place_name <> 'Chk Salomon Center' or r.org_name <> 'Chk Org' then
    raise exception 'v_events_api: joined names wrong (place=%, org=%)', r.place_name, r.org_name;
  end if;
  if exists (select 1 from v_events_api
             where id = '00000000-0000-4000-8000-0000000000e2') then
    raise exception 'v_events_api: duplicate (non-canonical) row exposed';
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- api_events: overlap-time semantics
-- ---------------------------------------------------------------------------
do $chk$
declare
  ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into ids
  from api_events(p_from => '2026-09-15T18:30:00Z', p_to => '2026-09-15T20:00:00Z');
  if not ('00000000-0000-4000-8000-0000000000e3' = any (ids)) then
    raise exception 'api_events overlap: in-progress event not returned';
  end if;
  if not ('00000000-0000-4000-8000-0000000000e1' = any (ids)) then
    raise exception 'api_events overlap: event ending inside window not returned';
  end if;
  if '00000000-0000-4000-8000-0000000000e4' = any (ids) then
    raise exception 'api_events overlap: fully-past event returned';
  end if;
  -- open-ended events use start_ts as their effective end (documented in 0002)
  if '00000000-0000-4000-8000-0000000000e5' = any (ids) then
    raise exception 'api_events overlap: open-ended event started before window returned';
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- api_events: bbox + category
-- ---------------------------------------------------------------------------
do $chk$
declare
  ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into ids
  from api_events(p_bbox_w => -71.41, p_bbox_s => 41.82, p_bbox_e => -71.39, p_bbox_n => 41.83);
  if not ('00000000-0000-4000-8000-0000000000e1' = any (ids)) then
    raise exception 'api_events bbox: point inside envelope not returned';
  end if;
  if '00000000-0000-4000-8000-0000000000e6' = any (ids) then
    raise exception 'api_events bbox: point outside envelope returned';
  end if;
  if '00000000-0000-4000-8000-0000000000e7' = any (ids) then
    raise exception 'api_events bbox: null-coords event returned under bbox filter';
  end if;

  select coalesce(array_agg(id), '{}') into ids from api_events(p_category => 'arts');
  if not ('00000000-0000-4000-8000-0000000000e8' = any (ids)) then
    raise exception 'api_events category: arts event not returned';
  end if;
  if '00000000-0000-4000-8000-0000000000e1' = any (ids) then
    raise exception 'api_events category: academic event returned for category=arts';
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- api_events: q — ilike metacharacter escaping and substring-first ranking
-- ---------------------------------------------------------------------------
do $chk$
declare
  ids uuid[];
  pos_sub int;
  pos_fuzzy int;
begin
  -- '_' escaped: 'C_D' must match literal 'C_D' only, not 'CXD'
  select coalesce(array_agg(id), '{}') into ids from api_events(p_q => 'C_D');
  if not ('00000000-0000-4000-8000-0000000000e9' = any (ids)) then
    raise exception 'api_events q: literal-underscore title not matched';
  end if;
  if '00000000-0000-4000-8000-0000000000ea' = any (ids) then
    raise exception 'api_events q: unescaped underscore acted as wildcard';
  end if;

  -- trailing backslash must not blow up ("LIKE pattern must not end with escape")
  select coalesce(array_agg(id), '{}') into ids from api_events(p_q => '\');
  if not ('00000000-0000-4000-8000-0000000000eb' = any (ids)) then
    raise exception 'api_events q: backslash query did not match literal backslash title';
  end if;

  -- substring hit ranks above trigram-only hit even when it starts later
  select coalesce(array_agg(id order by ord), '{}') into ids
  from (select id, row_number() over () as ord from api_events(p_q => 'Jazz')) s;
  pos_sub   := array_position(ids, '00000000-0000-4000-8000-0000000000ec');
  pos_fuzzy := array_position(ids, '00000000-0000-4000-8000-0000000000ed');
  if pos_sub is null or pos_fuzzy is null then
    raise exception 'api_events q: expected both substring and fuzzy hits for Jazz (got %)', ids;
  end if;
  if pos_sub >= pos_fuzzy then
    raise exception 'api_events q: substring hit ranked below fuzzy hit';
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- api_meetings_at: day tokenization, term windows, DST wall time, place join
-- All instants below are UTC; Sep 2026 is EDT (UTC-4), Nov 2026 is EST (UTC-5).
-- ---------------------------------------------------------------------------
do $chk$
declare
  ids text[];
  r record;
begin
  -- Tuesday 2026-09-15 14:00 ET: TTh and T match; Th-only and MWF do not
  select coalesce(array_agg(id), '{}') into ids
  from api_meetings_at('2026-09-15T18:00:00Z') where id like 'chk-%';
  if not (ids @> array['chk-tth', 'chk-t']) then
    raise exception 'meetings Tue: want {chk-tth,chk-t} within %, missing', ids;
  end if;
  if ids && array['chk-th', 'chk-mwf'] then
    raise exception 'meetings Tue: Th-only or MWF matched on a Tuesday (%)', ids;
  end if;

  -- Thursday 2026-09-17 14:00 ET: TTh and Th match; T-only does not
  -- (catches the classic 'TTh' -> T,T,h mis-tokenization)
  select coalesce(array_agg(id), '{}') into ids
  from api_meetings_at('2026-09-17T18:00:00Z') where id like 'chk-%';
  if not (ids @> array['chk-tth', 'chk-th']) then
    raise exception 'meetings Thu: want {chk-tth,chk-th} within %, missing', ids;
  end if;
  if 'chk-t' = any (ids) then
    raise exception 'meetings Thu: T-only matched on a Thursday';
  end if;

  -- Saturday 2026-09-12 vs Sunday 2026-09-13: S vs Su never cross-match
  select coalesce(array_agg(id), '{}') into ids
  from api_meetings_at('2026-09-12T18:00:00Z') where id like 'chk-%';
  if not ('chk-s' = any (ids)) or 'chk-su' = any (ids) then
    raise exception 'meetings Sat: want chk-s only, got %', ids;
  end if;
  select coalesce(array_agg(id), '{}') into ids
  from api_meetings_at('2026-09-13T18:00:00Z') where id like 'chk-%';
  if not ('chk-su' = any (ids)) or 'chk-s' = any (ids) then
    raise exception 'meetings Sun: want chk-su only, got %', ids;
  end if;

  -- end_time is exclusive: 14:50 ET exactly -> not in session
  if exists (select 1 from api_meetings_at('2026-09-15T18:50:00Z') where id = 'chk-tth') then
    raise exception 'meetings: end_time not exclusive';
  end if;

  -- term windows: Wed 2026-09-02 is before 202710 classes start (Sep 9) but
  -- inside the wide fallback window for an unknown srcdb
  select coalesce(array_agg(id), '{}') into ids
  from api_meetings_at('2026-09-02T18:00:00Z') where id like 'chk-%';
  if 'chk-mwf' = any (ids) then
    raise exception 'meetings term: 202710 meeting active before term start_date';
  end if;
  if not ('chk-nosrc' = any (ids)) then
    raise exception 'meetings term: unknown-srcdb meeting not covered by fallback window';
  end if;

  -- DST: Wed 2026-11-04 is EST. 19:00Z = 14:00 EST -> in session; 18:00Z = 13:00 EST -> not
  if not exists (select 1 from api_meetings_at('2026-11-04T19:00:00Z') where id = 'chk-mwf') then
    raise exception 'meetings DST: 14:00 EST meeting missed after fall-back';
  end if;
  if exists (select 1 from api_meetings_at('2026-11-04T18:00:00Z') where id = 'chk-mwf') then
    raise exception 'meetings DST: 13:00 EST wrongly in session (EDT offset applied in EST)';
  end if;

  -- place join: name + coords for placed meetings, nulls for unplaced
  select * into r from api_meetings_at('2026-09-15T18:00:00Z') where id = 'chk-tth';
  if r.place_name <> 'Chk Salomon Center' or r.lat is null or r.lng is null then
    raise exception 'meetings: place join wrong (name=%, lat=%, lng=%)', r.place_name, r.lat, r.lng;
  end if;
  select * into r from api_meetings_at('2026-09-15T18:00:00Z') where id = 'chk-t';
  if r.place_name is not null or r.lat is not null then
    raise exception 'meetings: unplaced meeting has non-null place fields';
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- api_health: latest run + latest ok per source
-- ---------------------------------------------------------------------------
do $chk$
declare
  r record;
begin
  select * into r from api_health() where source = 'chk_lw';
  if not found then
    raise exception 'api_health: chk_lw missing';
  end if;
  if r.status <> 'error' or r.error <> 'boom' then
    raise exception 'api_health: latest run not reflected (status=%, error=%)', r.status, r.error;
  end if;
  if r.last_run_at <> '2026-07-02T00:00:00Z'::timestamptz then
    raise exception 'api_health: last_run_at = %, want 2026-07-02T00:00:00Z', r.last_run_at;
  end if;
  if r.last_ok_at <> '2026-07-01T00:05:00Z'::timestamptz then
    raise exception 'api_health: last_ok_at = %, want finished_at of latest ok run', r.last_ok_at;
  end if;

  -- ok run with null finished_at falls back to started_at
  select * into r from api_health() where source = 'chk_solo';
  if r.status <> 'ok' or r.last_ok_at <> '2026-07-03T00:00:00Z'::timestamptz then
    raise exception 'api_health: chk_solo rollup wrong (status=%, last_ok_at=%)', r.status, r.last_ok_at;
  end if;
end
$chk$;

rollback;

\echo '0002_api_checks: all assertions passed (transaction rolled back)'
