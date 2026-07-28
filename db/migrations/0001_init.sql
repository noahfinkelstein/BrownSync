create extension if not exists postgis;
create extension if not exists pg_trgm;

-- Campus gazetteer: every named place on/near College Hill
create table places (
  id            text primary key,              -- slug: 'barus-holley', 'sayles-hall'
  name          text not null,                 -- 'Barus & Holley'
  aliases       text[] not null default '{}',  -- {'B&H','BH','Barus and Holley'}
  kind          text not null,                 -- 'academic'|'residence'|'dining'|'athletic'|'library'|'admin'|'outdoor'|'other'
  lat           double precision not null,
  lng           double precision not null,
  polygon       geometry(MultiPolygon, 4326),  -- OSM footprint, nullable
  address       text,
  osm_id        text,
  source        text not null default 'osm'
);

-- Organizations: clubs, departments, offices
create table organizations (
  id            text primary key,              -- slug: 'brown-outing-club'
  name          text not null,
  kind          text not null,                 -- 'club'|'department'|'office'|'athletics'|'external'
  category      text,                          -- from taxonomy in §4
  description   text,
  url           text,
  instagram     text,
  default_place_id text references places(id),
  source        text not null
);

-- Canonical events (all sources normalize into this)
create table events (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,                 -- 'livewhale'|'athletics_ics'|'cab'|'clubs'|'bdh'|'manual'|...
  source_id     text not null,                 -- stable ID within that source
  canonical_id  uuid references events(id),    -- non-null => this row is a duplicate of canonical_id
  title         text not null,
  description   text,
  start_ts      timestamptz not null,
  end_ts        timestamptz,
  is_all_day    boolean not null default false,
  rrule         text,                          -- iCal RRULE if recurring
  location_raw  text,                          -- as reported by source
  place_id      text references places(id),    -- resolved by gazetteer; nullable
  lat           double precision,              -- direct coords if source provides (LiveWhale does)
  lng           double precision,
  org_id        text references organizations(id),
  category      text,                          -- taxonomy §4
  tags          text[] not null default '{}',
  url           text,
  cost          text,
  confidence    real not null default 1.0,     -- 1.0 structured feed; <1.0 LLM/NLP-extracted
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  is_canceled   boolean not null default false,
  raw           jsonb,                         -- original source payload
  unique (source, source_id)
);
create index events_time_idx  on events (start_ts, end_ts);
create index events_geo_idx   on events using gist (ST_SetSRID(ST_MakePoint(lng, lat), 4326));
create index events_title_trgm on events using gin (title gin_trgm_ops);

-- Course meetings: Fall term sections, expanded per weekly meeting pattern
create table course_meetings (
  id            text primary key,              -- '{srcdb}-{crn}-{meet_idx}'
  srcdb         text not null,                 -- CAB term code
  crn           text not null,
  course_code   text not null,                 -- 'CSCI 0150'
  title         text not null,
  instructor    text,
  days          text not null,                 -- 'MWF','TTh' (canonical: M,T,W,Th,F,S,Su)
  start_time    time not null,
  end_time      time not null,
  location_raw  text,                          -- 'Salomon Center 101'
  place_id      text references places(id),
  room          text,
  enrollment    int,
  raw           jsonb
);

-- Source health, for the ops dashboard + staleness display
create table source_runs (
  id          bigserial primary key,
  source      text not null,
  started_at  timestamptz not null,
  finished_at timestamptz,
  status      text not null,                   -- 'ok'|'error'|'partial'
  items_upserted int,
  error       text
);
