-- 0002_api.sql — read-API layer (Phase 1 C).
--
-- ADDITIVE ONLY: this migration never alters the contract §1 tables from
-- 0001_init.sql. It adds the term calendar, the canonical-events view, the
-- API SQL functions, and two supporting indexes. Applied by CI with plain
-- psql -v ON_ERROR_STOP=1, in filename order, after 0001.

-- ---------------------------------------------------------------------------
-- Term calendar
--
-- CAB srcdb term codes are DISCOVERED AT RUNTIME by the ingestion scraper
-- (contract §5: read the <select> options / bootstrap JSON on cab.brown.edu —
-- never hardcode blind). This table lets ingestion (or an operator) record the
-- real teaching window per srcdb. We seed the conventional Banner-style code
-- for Fall 2026 ('202710' = fall term of academic year 2026-27) so the classes
-- layer works out of the box, but api_meetings_at() below must NOT depend on
-- this guess being right — see its fallback comment.
-- ---------------------------------------------------------------------------
create table if not exists term_calendar (
  srcdb      text primary key,   -- CAB term code, e.g. '202710'
  start_date date not null,      -- first day of classes (America/New_York)
  end_date   date not null       -- last day of exams (America/New_York)
);

insert into term_calendar (srcdb, start_date, end_date)
values ('202710', date '2026-09-09', date '2026-12-22')
on conflict (srcdb) do nothing;

-- ---------------------------------------------------------------------------
-- Supporting indexes (additive; contract tables themselves are untouched).
-- events_canonical_idx accelerates the merged_sources aggregation below;
-- course_meetings_srcdb_idx the term_calendar join.
-- ---------------------------------------------------------------------------
create index if not exists events_canonical_idx
  on events (canonical_id) where canonical_id is not null;
create index if not exists course_meetings_srcdb_idx
  on course_meetings (srcdb);

-- ---------------------------------------------------------------------------
-- v_events_api — canonical events joined to places + organizations.
--
-- Only canonical rows (canonical_id is null) are exposed; duplicate rows
-- contribute their `source` values via the merged_sources aggregate
-- (contract §3: "API returns only canonical rows ... with mergedSources").
-- Written as simple left joins + a lateral aggregate so outer predicates on
-- event columns push down onto the indexed base-table scan.
-- ---------------------------------------------------------------------------
create or replace view v_events_api as
select
  e.id,
  e.title,
  e.description,
  e.start_ts,
  e.end_ts,
  e.is_all_day,
  e.lat,
  e.lng,
  e.place_id,
  p.name as place_name,
  e.location_raw,
  e.org_id,
  o.name as org_name,
  e.category,
  e.tags,
  e.url,
  e.cost,
  e.source,
  e.confidence,
  e.is_canceled,
  coalesce(d.merged_sources, '{}'::text[]) as merged_sources
from events e
left join places p on p.id = e.place_id
left join organizations o on o.id = e.org_id
left join lateral (
  select array_agg(distinct dup.source order by dup.source) as merged_sources
  from events dup
  where dup.canonical_id = e.id
) d on true
where e.canonical_id is null;

-- ---------------------------------------------------------------------------
-- api_events — time / bbox / category / text filtering over v_events_api.
--
-- All parameters nullable = unfiltered. Time filter is OVERLAP semantics:
-- an event is in [p_from, p_to] when it starts before p_to and ends (or, if
-- open-ended, starts) after p_from — so in-progress events match p_from=now.
-- The bbox predicate is written against the same expression as the gist
-- index events_geo_idx; ilike hits the gin trgm index; similarity() ranks.
-- ---------------------------------------------------------------------------
create or replace function api_events(
  p_from     timestamptz default null,
  p_to       timestamptz default null,
  p_bbox_w   float8      default null,
  p_bbox_s   float8      default null,
  p_bbox_e   float8      default null,
  p_bbox_n   float8      default null,
  p_category text        default null,
  p_q        text        default null
) returns setof v_events_api
language sql
stable
as $$
  select v.*
  from v_events_api v
  where (p_from is null or coalesce(v.end_ts, v.start_ts) >= p_from)
    and (p_to   is null or v.start_ts <= p_to)
    and (p_category is null or v.category = p_category)
    and (
      p_bbox_w is null or (
        v.lat is not null and v.lng is not null
        and ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)
            && ST_MakeEnvelope(p_bbox_w, p_bbox_s, p_bbox_e, p_bbox_n, 4326)
      )
    )
    and (
      p_q is null
      -- Escape ilike metacharacters in the user's text, then substring-match
      -- (gin_trgm_ops serves ilike) OR fuzzy-match via trigram similarity.
      or v.title ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or similarity(v.title, p_q) >= 0.3
    )
  order by
    -- With a text query: exact substring hits first (similarity of a short
    -- query inside a long title can be low), then by trigram similarity.
    case
      when p_q is null then null::real
      when v.title ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        then 2.0::real + similarity(v.title, p_q)
      else similarity(v.title, p_q)
    end desc nulls last,
    v.start_ts asc,
    v.id asc
  limit 500;
$$;

-- ---------------------------------------------------------------------------
-- api_meetings_at — course meetings in session at instant p_at.
--
-- Expands course_meetings' weekly pattern (canonical day tokens M,T,W,Th,F,
-- S,Su concatenated, e.g. 'MWF', 'TTh') + America/New_York wall times
-- against term_calendar.
--
-- Term-window fallback: a meeting's srcdb may have NO term_calendar row —
-- srcdb values are discovered at runtime by the CAB scraper, so ingestion can
-- legitimately load meetings under a code we did not anticipate. In that case
-- we fall back to a WIDE default Fall 2026 window (Sep 1 – Dec 23 2026), NOT
-- to a "now ± 1 day" guess: a wide window keeps the classes layer alive and
-- merely overshoots by a few days at the term edges, whereas an "always
-- active" hack would show phantom classes year-round.
-- ---------------------------------------------------------------------------
create or replace function api_meetings_at(
  p_at timestamptz default now()
) returns table (
  id           text,
  course_code  text,
  title        text,
  instructor   text,
  days         text,
  start_time   time,
  end_time     time,
  location_raw text,
  place_id     text,
  place_name   text,
  room         text,
  lat          float8,
  lng          float8
)
language sql
stable
as $$
  with local_ctx as (
    -- Wall-clock date/time + canonical day token in America/New_York.
    -- isodow: 1=Mon .. 7=Sun, mapped onto the contract's day tokens.
    select
      (p_at at time zone 'America/New_York')::date as local_date,
      (p_at at time zone 'America/New_York')::time as local_time,
      (array['M','T','W','Th','F','S','Su'])[
        extract(isodow from p_at at time zone 'America/New_York')::int
      ] as day_token
  )
  select
    cm.id,
    cm.course_code,
    cm.title,
    cm.instructor,
    cm.days,
    cm.start_time,
    cm.end_time,
    cm.location_raw,
    cm.place_id,
    p.name as place_name,
    cm.room,
    p.lat,
    p.lng
  from course_meetings cm
  cross join local_ctx ctx
  left join places p on p.id = cm.place_id
  left join term_calendar tc on tc.srcdb = cm.srcdb
  where
    -- Term window (calendar row, else the wide Fall 2026 default — see above).
    ctx.local_date >= coalesce(tc.start_date, date '2026-09-01')
    and ctx.local_date <= coalesce(tc.end_date, date '2026-12-23')
    -- In session right now (start inclusive, end exclusive).
    and ctx.local_time >= cm.start_time
    and ctx.local_time <  cm.end_time
    -- Day-token match. Tokenize the concatenated pattern with an alternation
    -- that lists 'Su' before 'S' and 'Th' before 'T', so the two-character
    -- tokens always win: 'TTh' parses as T,Th — never T,T,h. (Postgres regex
    -- longest-match preference agrees, but the ordering makes it explicit.)
    and ctx.day_token = any (
      array(select (regexp_matches(cm.days, 'Su|Th|M|T|W|F|S', 'g'))[1])
    )
  order by cm.course_code asc, cm.id asc;
$$;

-- ---------------------------------------------------------------------------
-- api_health — per-source rollup of source_runs for /api/health.
-- One row per source that has EVER run: its latest run (status/error/count)
-- plus the timestamp of its latest successful run. Sources that have never
-- run are synthesized as status 'never' in the API layer, not here.
-- ---------------------------------------------------------------------------
create or replace function api_health()
returns table (
  source         text,
  status         text,
  last_run_at    timestamptz,
  last_ok_at     timestamptz,
  items_upserted int,
  error          text
)
language sql
stable
as $$
  with latest as (
    select distinct on (sr.source)
      sr.source, sr.status, sr.started_at, sr.items_upserted, sr.error
    from source_runs sr
    order by sr.source, sr.started_at desc, sr.id desc
  ),
  latest_ok as (
    select distinct on (sr.source)
      sr.source,
      coalesce(sr.finished_at, sr.started_at) as ok_at
    from source_runs sr
    where sr.status = 'ok'
    order by sr.source, sr.started_at desc, sr.id desc
  )
  select
    l.source,
    l.status,
    l.started_at as last_run_at,
    lo.ok_at     as last_ok_at,
    l.items_upserted,
    l.error
  from latest l
  left join latest_ok lo on lo.source = l.source
  order by l.source asc;
$$;
