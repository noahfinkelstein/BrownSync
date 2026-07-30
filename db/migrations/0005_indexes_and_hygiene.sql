-- 0005_indexes_and_hygiene.sql — index hygiene. No contract change.
--
-- ADDITIVE ONLY: no contract §1 table is altered. Four indexes, each paying
-- for a read pattern that already exists or is about to:
--
--  1. places_polygon_gist — the load-bearing one. `polygon` is a
--     geometry(MultiPolygon,4326) with NO spatial index today, so every
--     ST_Contains / ST_Intersects against a footprint is a sequential scan
--     over all of `places` with a full polygon comparison per row. Point-in-
--     footprint is how amenities, shuttle stops and LibCal locations will get
--     their place_id, and it is how the map answers "what building is this".
--     PARTIAL (`where polygon is not null`): most gazetteer rows are
--     centroid-only, and a partial index keeps the tree to the rows that can
--     ever match while staying usable for exactly those queries.
--
--  2. places_name_trgm — `events_title_trgm` (0001) already indexes event
--     titles, but place NAMES had no trigram index, so contract §2's
--     "trigram similarity >= 0.55 against places.name+aliases" resolution
--     path was a seq scan. 0007 builds the alias index proper; this one
--     covers direct name lookups and ILIKE search over places.
--
--  3. events_source_idx — /api/health, the cancellation sweep and every
--     per-source query filter on `source` and range on `start_ts`.
--     `events_time_idx` (0001) leads with start_ts, so a single-source query
--     cannot use it as an access path.
--
--  4. source_runs_source_idx — api_health()'s two `distinct on (source)
--     ... order by source, started_at desc` scans. DESC on started_at so the
--     index order matches the query's, making each rollup an index-only
--     jump to the newest row per source instead of a sort of the whole table.
--
-- `if not exists` throughout: migrations are applied in filename order by
-- plain psql with ON_ERROR_STOP=1 and must be re-runnable.

create index if not exists places_polygon_gist
  on places using gist (polygon)
  where polygon is not null;

create index if not exists places_name_trgm
  on places using gin (name gin_trgm_ops);

create index if not exists events_source_idx
  on events (source, start_ts);

create index if not exists source_runs_source_idx
  on source_runs (source, started_at desc);
