-- 0006_source_registry.sql — the source registry (contract v2 §1).
--
-- ADDITIVE ONLY: one new table, its seed rows, and a rebuilt api_health().
-- No contract §1 table is altered.
--
-- WHY THIS TABLE EXISTS
--
-- Every operational fact about a feed — how often it may be polled, when its
-- silence becomes a problem, what its robots.txt and ToS actually permit, and
-- whether we are allowed to run it at all — lives today as a constant in code
-- or as a cron string in a workflow file. That has three consequences this
-- table fixes:
--
--  1. Per-source cadence becomes DATA. apps/web's health model has a single
--     global 45-minute staleness constant, so a weekly ArcGIS pull and a
--     daily dining pull are permanently yellow. api_health() below returns
--     `stale_after_seconds` per source instead.
--  2. Tuning becomes a SQL update, not a deploy.
--  3. A REFUSAL becomes a reported state instead of a silent omission. The
--     two sources we are not permitted to crawl are registered here as
--     enabled=false rows carrying the verbatim reason, mirroring the
--     BlockedJob philosophy in ingest/brownsync_ingest/cli.py. Someone who
--     later wonders "why don't we have city events?" finds the answer in the
--     database rather than rediscovering the endpoint and crawling it.
--
-- DELIBERATELY NOT FK'D FROM events.source. A new source must never fail to
-- upsert because nobody remembered to register it first; the registry
-- describes sources, it does not gate writes.
--
-- NO POSTGRES ENUM TYPES (contract v2 decision, DATA_CONTRACT.md §1): enum
-- types cannot be altered inside a transaction on older PG and fight the
-- additive-only rule the moment a lane or licence is added. CHECK constraints
-- on this NEW table only; existing tables are left alone.

create table if not exists source_registry (
  -- Matches events.source / source_runs.source, but by convention only.
  source                          text primary key,
  -- Human label for the ops strip; the client keeps its own map as fallback.
  label                           text not null,
  -- Which runtime owns this source. 'blocked' = a recorded refusal: there is
  -- no lane because we are not permitted to fetch it.
  lane                            text not null,
  enabled                         boolean not null default true,
  -- Target poll interval. 0 is only meaningful on a row that is not enabled.
  cadence_seconds                 int  not null,
  -- Silence beyond this is stale, per source. 0 = not applicable (blocked).
  stale_after_seconds             int  not null,
  -- Floor between two requests to this host, from the site's own etiquette
  -- (Crawl-delay, published TTL). Separate from cadence: cadence is how often
  -- a sweep starts, this is how fast a sweep may issue requests inside it.
  etiquette_min_interval_seconds  int  not null default 1,
  -- Verbatim robots.txt finding. For a refusal this is the evidence.
  robots_note                     text,
  tos_note                        text,
  -- How much of a fetched item we are permitted to store and redistribute.
  license                         text,
  -- Ranking weight for the unified feed; tunable by UPDATE, not by deploy.
  feed_weight                     real not null default 1.0,
  endpoint                        text,
  last_started_at                 timestamptz,
  last_ok_at                      timestamptz,
  consecutive_failures            int  not null default 0,
  backoff_until                   timestamptz,
  notes                           text,
  constraint source_registry_lane_ck
    check (lane in ('worker', 'actions', 'ingest', 'realtime', 'sql', 'blocked')),
  constraint source_registry_license_ck
    check (license is null or license in ('headline_only', 'excerpt', 'full')),
  -- The invariant, not a formality: an ENABLED source must carry a real
  -- cadence and a real staleness horizon. A disabled or blocked row may leave
  -- them at 0 because nothing will ever schedule it.
  constraint source_registry_cadence_ck
    check (cadence_seconds > 0 or not enabled),
  constraint source_registry_stale_ck
    check (stale_after_seconds > 0 or not enabled),
  constraint source_registry_nonneg_ck
    check (cadence_seconds >= 0
           and stale_after_seconds >= 0
           and etiquette_min_interval_seconds >= 0
           and consecutive_failures >= 0),
  constraint source_registry_weight_ck
    check (feed_weight >= 0),
  -- A blocked source is by definition one we do not run.
  constraint source_registry_blocked_ck
    check (lane <> 'blocked' or not enabled),
  -- A recorded refusal must carry its reason. This is the whole point of
  -- registering refusals: an unexplained disabled row is indistinguishable
  -- from someone having flipped a switch and forgotten why.
  constraint source_registry_refusal_reason_ck
    check (lane <> 'blocked' or coalesce(robots_note, tos_note) is not null)
);

comment on table source_registry is
  'Per-source operational policy: cadence, staleness horizon, etiquette, '
  'licence, and recorded refusals. Not FK''d from events.source on purpose.';

-- ---------------------------------------------------------------------------
-- Seed rows. Every verified etiquette fact from the source survey, as data.
--
-- `on conflict do nothing` so re-running the migration never clobbers an
-- operator's live tuning — that tuning being a plain UPDATE is the point.
-- ---------------------------------------------------------------------------
insert into source_registry (
  source, label, lane, enabled, cadence_seconds, stale_after_seconds,
  etiquette_min_interval_seconds, robots_note, tos_note, license,
  feed_weight, endpoint, notes
) values
  ('livewhale', 'LiveWhale events', 'worker', true, 600, 2400, 1,
   null, null, null, 1.0,
   'https://events.brown.edu/live/json/events',
   'Contract §5 permits <= every 10 minutes. Primary events feed. Sweeps are '
   'date-window sharded (0007 / services/poller/src/livewhale/shard.ts), so '
   'one cadence tick issues 8-20 spaced requests, not one.'),

  ('athletics_ics', 'Brown Bears athletics', 'actions', true, 7200, 14400, 30,
   'brownbears.com robots.txt: Crawl-delay 30', null, null, 1.0,
   'https://brownbears.com/calendar.ashx/calendar.ics',
   'Cadence follows the feed''s own X-PUBLISHED-TTL of PT120M; polling faster '
   'than the publisher refreshes buys nothing and ignores a stated wish. '
   'Paired with .github/workflows/poll.yml cron "37 */2 * * *".'),

  -- DISABLED: legal gate. The RSS carries full article text in CDATA and the
  -- BDH Terms of Use prohibit automated obtaining/copying/indexing of the
  -- site. ToS governs over a permissive robots.txt. Migration 0004 purged the
  -- stored bodies; this row is the switch that keeps the poller off until
  -- written permission arrives, at which point licence moves to 'excerpt' by
  -- UPDATE — an explicit, auditable act.
  ('bdh', 'Brown Daily Herald', 'worker', false, 1800, 7200, 10,
   'browndailyherald.com robots.txt: Crawl-delay 10 (permissive)',
   'Terms of Use prohibit obtaining, copying, monitoring, indexing or '
   'data-mining the site by robot or automated device; content is '
   '(c) The Brown Daily Herald, Inc. ToS governs over the permissive '
   'robots.txt. Headline-only until written permission is granted.',
   'headline_only', 0.9,
   'https://www.browndailyherald.com/feed',
   'Awaiting written permission (herald@browndailyherald.com). Re-enable by '
   'UPDATE once granted; see reports/app_side_dependencies.md.'),

  ('bpr', 'Brown Political Review', 'worker', true, 1800, 7200, 1,
   null, null, 'excerpt', 0.8,
   'https://brownpoliticalreview.org/wp-json/wp/v2/posts',
   'WP REST is richer than the feed (coauthors, categories, tags, '
   'yoast_head_json canonical + OG image).'),

  ('bjwa', 'Brown Journal of World Affairs', 'worker', true, 1800, 7200, 1,
   null, null, 'excerpt', 0.7,
   'https://bjwa.brown.edu/feed/',
   'Quarterly publication — once a producer exists, cadence should relax to '
   '86400; registered at the survey default until then.'),

  ('ppl', 'Providence Public Library', 'worker', true, 1800, 7200, 1,
   null, null, 'excerpt', 0.7,
   'https://www.provlib.org/feed/', null),

  ('dining', 'Brown Dining menus', 'worker', true, 86400, 172800, 1,
   null, null, null, 1.0, null,
   'ESB payload is ~520 KB. Fetched once daily server-side and served from '
   'dining_menus; a per-request CORS proxy is explicitly rejected (it would '
   'put Brown''s internal ESB in every page load''s critical path).'),

  ('libcal', 'LibCal library hours', 'worker', true, 3600, 10800, 1,
   null, null, null, 1.0, null,
   'CORS access-control-allow-origin: *.'),

  ('arcgis', 'Brown ArcGIS layers', 'actions', true, 604800, 1209600, 1,
   null, null, null, 1.0, null,
   'Building footprints enrich places; amenity layers land in their own '
   'table so numeric point names never enter the place alias index.'),

  ('passiogo', 'Brown shuttle (PassioGo)', 'realtime', true, 20, 300, 1,
   null,
   'Undocumented private API with no published terms. Hard ceiling of 3 '
   'requests/minute regardless of subscriber count; any 4xx other than 404 '
   'disables the lane rather than retrying into a refusal.',
   null, 1.0, null,
   'Vehicle positions are never written to Postgres (30-second shelf life); '
   'one source_runs row per 5-minute window so health rolls up normally.'),

  ('academic_calendar', 'Academic calendar', 'ingest', true, 31536000, 63072000, 1,
   null, null, null, 1.0, null,
   'Hand-curated JSON in-repo; changes about once a year. stale_after is 2x '
   'cadence by the same convention as every other row.'),

  -- RECORDED REFUSAL #1. Not a gap, a decision.
  ('providence_gov', 'City of Providence events', 'blocked', false, 0, 0, 1,
   'robots.txt explicitly disallows /event/, /events/ and /*?* — recorded '
   'refusal, never crawled',
   null, null, 1.0, null,
   'Registered so the absence of city events is a reported state rather than '
   'a silent omission someone rediscovers and crawls by accident.'),

  -- RECORDED REFUSAL #2.
  ('today_brown', 'Today@Brown', 'blocked', false, 0, 0, 1,
   null,
   'Shibboleth SSO on the whole host — unavailable to an unauthenticated '
   'client. Bot detection and auth walls are never bypassed.',
   null, 1.0, null,
   'Registered so the absence is a reported state, not a silent omission.'),

  ('dedup', 'Cross-source dedup', 'actions', true, 3600, 7200, 1,
   null, null, null, 1.0, null,
   'Derived job, no fetch. Runs on its own poll.yml cron ("52 * * * *") so '
   'that moving athletics to a 2-hour cadence does not halve dedup''s — it '
   'used to ride the hourly athletics tick. Target once the Worker '
   'dispatcher lands: lane=sql at 900s.'),

  ('feed_rank', 'Feed ranking job', 'sql', false, 900, 3600, 1,
   null, null, null, 1.0, null,
   'Registered ahead of its producer. Deliberately disabled: an enabled row '
   'with no job behind it would make the registry lie about what runs.')
on conflict (source) do nothing;

-- ---------------------------------------------------------------------------
-- api_health() — now registry-aware.
--
-- NOTE: this is a DROP + CREATE, not a CREATE OR REPLACE. Postgres refuses to
-- replace a function whose OUT columns changed ("cannot change return type of
-- existing function"), and this adds three. Dropping and recreating a function
-- is still additive with respect to the schema: no table, column or row is
-- touched, and the previous definition is fully superseded.
--
-- Two changes:
--  1. Left-joins source_registry for `stale_after_seconds`, `enabled` and
--     `label`, so the client stops applying one global staleness constant to
--     a weekly feed. All three are OPTIONAL in the contract — a client that
--     ignores them behaves exactly as before.
--  2. The result set is now the UNION of sources that have run and sources
--     that are registered, so a registered source reports 'never' from SQL
--     instead of being synthesized client-side. This is what makes the two
--     refusals visible: they have never run and never will, and they now say
--     so with `enabled = false` and a reason in the registry.
--
-- `stale_after_seconds` is emitted as NULL when it is 0 (blocked rows) so a
-- nonsense "stale after 0 seconds" can never reach a client; a null means
-- "no per-source horizon — use your default".
-- ---------------------------------------------------------------------------
drop function if exists api_health();

create function api_health()
returns table (
  source              text,
  status              text,
  last_run_at         timestamptz,
  last_ok_at          timestamptz,
  items_upserted      int,
  error               text,
  stale_after_seconds int,
  enabled             boolean,
  label               text
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
  ),
  known as (
    select l.source from latest l
    union
    select r.source from source_registry r
  )
  select
    k.source,
    -- A registered source with no runs is 'never', straight from SQL.
    coalesce(l.status, 'never')          as status,
    l.started_at                         as last_run_at,
    lo.ok_at                             as last_ok_at,
    l.items_upserted,
    l.error,
    nullif(r.stale_after_seconds, 0)     as stale_after_seconds,
    -- An unregistered source that is actively running is implicitly enabled;
    -- absence from the registry must never read as "switched off".
    coalesce(r.enabled, true)            as enabled,
    r.label
  from known k
  left join latest l          on l.source = k.source
  left join latest_ok lo      on lo.source = k.source
  left join source_registry r on r.source = k.source
  order by k.source asc;
$$;
