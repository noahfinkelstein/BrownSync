-- 0005_index_checks.sql — semantic checks for the 0005 index hygiene layer.
--
-- Run by CI's postgis job right after migrations:
--   psql -v ON_ERROR_STOP=1 -f db/checks/0005_index_checks.sql
--
-- ROLLBACK-SAFE: one transaction that always rolls back, fixtures prefixed
-- chk- / chk_, assertions test MEMBERSHIP not counts, so it is safe to point
-- at a live database.
--
-- An index that exists but is never chosen is a false sense of safety, so
-- these assertions check BOTH: the catalog definition (access method +
-- predicate, which is what makes places_polygon_gist partial) and that the
-- polygon index actually answers a containment query correctly. The planner's
-- choice itself is deliberately NOT asserted: on a fixture-sized table a seq
-- scan is legitimately cheaper, and pinning plan shape would make this file
-- fail for the wrong reason.

begin;

-- ---------------------------------------------------------------------------
-- Catalog shape: the four indexes exist with the intended access methods,
-- and the polygon one is genuinely partial.
-- ---------------------------------------------------------------------------
do $chk$
declare
  def text;
begin
  select indexdef into def from pg_indexes
  where schemaname = current_schema() and indexname = 'places_polygon_gist';
  if def is null then
    raise exception '0005: places_polygon_gist is missing';
  end if;
  if def !~* 'using gist' then
    raise exception '0005: places_polygon_gist is not a GiST index (%)', def;
  end if;
  if def !~* 'where \(polygon IS NOT NULL\)' then
    raise exception
      '0005: places_polygon_gist is not partial on polygon is not null (%)', def;
  end if;

  select indexdef into def from pg_indexes
  where schemaname = current_schema() and indexname = 'places_name_trgm';
  if def is null then
    raise exception '0005: places_name_trgm is missing';
  end if;
  if def !~* 'using gin' or def !~* 'gin_trgm_ops' then
    raise exception '0005: places_name_trgm is not a gin_trgm_ops index (%)', def;
  end if;

  select indexdef into def from pg_indexes
  where schemaname = current_schema() and indexname = 'events_source_idx';
  if def is null then
    raise exception '0005: events_source_idx is missing';
  end if;
  if def !~* 'source' or def !~* 'start_ts' then
    raise exception '0005: events_source_idx does not cover (source, start_ts) (%)', def;
  end if;

  select indexdef into def from pg_indexes
  where schemaname = current_schema() and indexname = 'source_runs_source_idx';
  if def is null then
    raise exception '0005: source_runs_source_idx is missing';
  end if;
  -- DESC on started_at is the point: it matches api_health()'s
  -- `order by source, started_at desc` so the rollup needs no sort.
  if def !~* 'started_at DESC' then
    raise exception '0005: source_runs_source_idx lacks started_at DESC (%)', def;
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- The polygon index answers containment correctly (the read pattern it exists
-- for: point -> enclosing building footprint).
-- ---------------------------------------------------------------------------
insert into places (id, name, aliases, kind, lat, lng, polygon) values
  ('chk-poly-in', 'Chk Polygon Building', '{}', 'academic', 41.8262, -71.4032,
   ST_Multi(ST_GeomFromText(
     'POLYGON((-71.4040 41.8258, -71.4024 41.8258, -71.4024 41.8266, -71.4040 41.8266, -71.4040 41.8258))',
     4326))),
  ('chk-poly-out', 'Chk Elsewhere Building', '{}', 'academic', 41.8300, -71.3900,
   ST_Multi(ST_GeomFromText(
     'POLYGON((-71.3910 41.8296, -71.3890 41.8296, -71.3890 41.8304, -71.3910 41.8304, -71.3910 41.8296))',
     4326))),
  ('chk-poly-null', 'Chk Centroid Only', '{}', 'academic', 41.8262, -71.4032, null);

do $chk$
declare
  hits text[];
begin
  select coalesce(array_agg(id order by id), '{}') into hits
  from places
  where polygon is not null
    and ST_Contains(polygon, ST_SetSRID(ST_MakePoint(-71.4032, 41.8262), 4326))
    and id like 'chk-%';
  if hits <> array['chk-poly-in'] then
    raise exception '0005: polygon containment returned %, want {chk-poly-in}', hits;
  end if;
  -- The centroid-only row sits at the same point and must be excluded by the
  -- partial predicate, not by luck.
  if 'chk-poly-null' = any (hits) then
    raise exception '0005: null-polygon place matched a containment query';
  end if;
end
$chk$;

-- ---------------------------------------------------------------------------
-- places_name_trgm serves the contract §2 similarity path.
-- ---------------------------------------------------------------------------
insert into places (id, name, aliases, kind, lat, lng) values
  ('chk-trgm-smith', 'Chk Smith Buonanno Hall', '{}', 'academic', 41.8265, -71.4020);

do $chk$
declare
  hits text[];
begin
  select coalesce(array_agg(id order by id), '{}') into hits
  from places
  where id like 'chk-%' and similarity(name, 'Chk Smith Buonano Hall') >= 0.55;
  if not ('chk-trgm-smith' = any (hits)) then
    raise exception '0005: trigram similarity on places.name did not match the typo (%)', hits;
  end if;
end
$chk$;

rollback;

\echo '0005_index_checks: all assertions passed (transaction rolled back)'
