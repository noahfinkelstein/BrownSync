-- 0017_org_assets.sql — safe organization media and opt-in Instagram cards.
--
-- Product writes enter through owner-only SECURITY DEFINER routines called by
-- the verified Worker. Client roles receive no table access and no routine
-- execution. Public HTTP reads also use owner-side, actorless projections so
-- raw provider material, paths, leases, and attribution IDs never cross the
-- public contract.

begin;

revoke create on schema public from public, anon, authenticated;

create table public.org_media_collections (
  organization_id text primary key
                    references public.organizations(id) on delete cascade,
  revision        bigint not null default 0,
  updated_by      uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null
                    default pg_catalog.clock_timestamp(),
  constraint org_media_collections_revision_ck check (revision >= 0),
  constraint org_media_collections_time_ck
    check (pg_catalog.isfinite(updated_at))
);

create table public.org_media_uploads (
  id                              uuid primary key,
  organization_id                 text not null
                                    references public.organizations(id)
                                    on delete cascade,
  actor_user_id                   uuid
                                    references public.profiles(id)
                                    on delete set null,
  client_request_id               uuid not null,
  kind                            text not null,
  alt_text                        text not null,
  expected_organization_revision bigint,
  expected_gallery_revision      bigint,
  object_path                     text not null,
  status                          text not null default 'reserved',
  failure_code                    text,
  result_organization_revision    bigint,
  result_gallery_revision         bigint,
  result_media_id                 uuid,
  result_public_url               text,
  result_width                    integer,
  result_height                   integer,
  result_byte_size                integer,
  result_alt_text                 text,
  result_position                 integer,
  result_asset_revision           bigint,
  expires_at                      timestamptz not null,
  created_at                      timestamptz not null
                                    default pg_catalog.clock_timestamp(),
  updated_at                      timestamptz not null
                                    default pg_catalog.clock_timestamp(),
  unique (organization_id, client_request_id),
  constraint org_media_uploads_kind_ck
    check (kind in ('avatar', 'banner', 'gallery')),
  constraint org_media_uploads_alt_ck check (
    pg_catalog.char_length(alt_text) between 1 and 500
    and alt_text = pg_catalog.btrim(alt_text)
  ),
  constraint org_media_uploads_revision_domain_ck check (
    (
      kind in ('avatar', 'banner')
      and expected_organization_revision is not null
      and expected_organization_revision >= 0
      and expected_gallery_revision is null
    )
    or (
      kind = 'gallery'
      and expected_organization_revision is null
      and expected_gallery_revision is not null
      and expected_gallery_revision >= 0
    )
  ),
  constraint org_media_uploads_path_ck check (
    pg_catalog.char_length(object_path) between 1 and 512
    and object_path = pg_catalog.btrim(object_path)
    and object_path !~ '[\\[:space:]]'
  ),
  constraint org_media_uploads_status_ck
    check (status in ('reserved', 'processing', 'finalized', 'failed')),
  constraint org_media_uploads_failure_ck check (
    (
      status = 'failed'
      and failure_code in (
        'input_too_large',
        'unsupported_media_type',
        'invalid_image',
        'dimension_limit',
        'pixel_limit',
        'transform_failed',
        'output_too_large',
        'storage_unavailable',
        'storage_failed',
        'finalization_failed',
        'account_deleted',
        'expired'
      )
    )
    or (
      status <> 'failed'
      and failure_code is null
    )
  ),
  constraint org_media_uploads_result_revision_ck check (
    (
      status = 'finalized'
      and result_media_id is not null
      and result_public_url is not null
      and result_width is not null
      and result_height is not null
      and result_byte_size is not null
      and result_alt_text is not null
      and result_asset_revision is not null
      and (
        (
          kind in ('avatar', 'banner')
          and result_organization_revision is not null
          and result_organization_revision > 0
          and result_gallery_revision is null
          and result_position is null
        )
        or (
          kind = 'gallery'
          and result_organization_revision is null
          and result_gallery_revision is not null
          and result_gallery_revision > 0
          and result_position between 0 and 11
        )
      )
    )
    or (
      status <> 'finalized'
      and result_organization_revision is null
      and result_gallery_revision is null
      and result_media_id is null
      and result_public_url is null
      and result_width is null
      and result_height is null
      and result_byte_size is null
      and result_alt_text is null
      and result_position is null
      and result_asset_revision is null
    )
  ),
  constraint org_media_uploads_actor_ck check (
    actor_user_id is not null
    or status in ('finalized', 'failed')
  ),
  constraint org_media_uploads_time_ck check (
    pg_catalog.isfinite(expires_at)
    and pg_catalog.isfinite(created_at)
    and pg_catalog.isfinite(updated_at)
    and expires_at > created_at
  )
);

create unique index org_media_uploads_one_live_uidx
  on public.org_media_uploads (organization_id)
  where status in ('reserved', 'processing');

create index org_media_uploads_expiry_idx
  on public.org_media_uploads (expires_at, id)
  where status in ('reserved', 'processing');

create index org_media_uploads_actor_idx
  on public.org_media_uploads (actor_user_id)
  where actor_user_id is not null;

create table public.org_media_assets (
  id              uuid primary key,
  organization_id text not null
                    references public.organizations(id) on delete cascade,
  upload_id       uuid not null unique
                    references public.org_media_uploads(id) on delete cascade,
  kind            text not null,
  object_path     text not null unique,
  public_url      text not null,
  width           integer not null,
  height          integer not null,
  byte_size       integer not null,
  alt_text        text not null,
  position        integer,
  revision        bigint not null default 1,
  status          text not null default 'ready',
  created_by      uuid references public.profiles(id) on delete set null,
  deleted_by      uuid references public.profiles(id) on delete set null,
  deleted_at      timestamptz,
  created_at      timestamptz not null
                    default pg_catalog.clock_timestamp(),
  updated_at      timestamptz not null
                    default pg_catalog.clock_timestamp(),
  constraint org_media_assets_kind_ck
    check (kind in ('avatar', 'banner', 'gallery')),
  constraint org_media_assets_url_ck check (
    pg_catalog.char_length(public_url) between 1 and 2048
    and public_url = pg_catalog.btrim(public_url)
    and public_url ~ '^https://[^[:space:]]+$'
  ),
  constraint org_media_assets_geometry_ck check (
    width between 1 and 12000
    and height between 1 and 12000
    and width::bigint * height::bigint <= 40000000
    and (
      (kind = 'avatar' and width <= 1024 and height <= 1024)
      or (kind = 'banner' and width <= 1920 and height <= 1080)
      or (kind = 'gallery' and width <= 1920 and height <= 1920)
    )
  ),
  constraint org_media_assets_bytes_ck
    check (byte_size between 1 and 2097152),
  constraint org_media_assets_alt_ck check (
    pg_catalog.char_length(alt_text) between 1 and 500
    and alt_text = pg_catalog.btrim(alt_text)
  ),
  constraint org_media_assets_position_ck check (
    (
      kind = 'gallery'
      and status = 'ready'
      and position between 0 and 11
    )
    or (
      kind = 'gallery'
      and status = 'deleted'
      and position is null
    )
    or (kind in ('avatar', 'banner') and position is null)
  ),
  constraint org_media_assets_revision_ck check (revision > 0),
  constraint org_media_assets_status_ck
    check (status in ('ready', 'deleted')),
  constraint org_media_assets_soft_delete_ck check (
    (status = 'deleted') = (deleted_at is not null)
  ),
  constraint org_media_assets_time_ck check (
    pg_catalog.isfinite(created_at)
    and pg_catalog.isfinite(updated_at)
    and (
      deleted_at is null
      or pg_catalog.isfinite(deleted_at)
    )
  ),
  constraint org_media_assets_gallery_position_uq
    unique (organization_id, kind, position)
    deferrable initially immediate
);

create unique index org_media_assets_active_slot_uidx
  on public.org_media_assets (organization_id, kind)
  where kind in ('avatar', 'banner')
    and status = 'ready'
    and deleted_at is null;

create index org_media_assets_public_idx
  on public.org_media_assets (organization_id, kind, position, id)
  where status = 'ready' and deleted_at is null;

create index org_media_assets_created_by_idx
  on public.org_media_assets (created_by)
  where created_by is not null;

create table public.org_media_cleanup_queue (
  id                       uuid primary key
                             default pg_catalog.gen_random_uuid(),
  organization_id          text,
  upload_id                uuid
                             references public.org_media_uploads(id)
                             on delete set null,
  media_id                 uuid
                             references public.org_media_assets(id)
                             on delete set null,
  object_path              text not null unique,
  reason                   text not null,
  status                   text not null default 'pending',
  attempt_count            integer not null default 0,
  next_attempt_at          timestamptz not null
                             default pg_catalog.clock_timestamp(),
  worker_id                uuid,
  lease_token              uuid,
  lease_expires_at         timestamptz,
  last_disposition         text,
  last_succeeded           boolean,
  last_error_code          text,
  last_next_attempt_at     timestamptz,
  completed_at             timestamptz,
  created_at               timestamptz not null
                             default pg_catalog.clock_timestamp(),
  updated_at               timestamptz not null
                             default pg_catalog.clock_timestamp(),
  constraint org_media_cleanup_path_ck check (
    pg_catalog.char_length(object_path) between 1 and 512
    and object_path = pg_catalog.btrim(object_path)
    and object_path !~ '[\\[:space:]]'
  ),
  constraint org_media_cleanup_reason_ck check (
    reason in (
      'replaced',
      'deleted',
      'failed_finalization',
      'failed_upload',
      'expired_upload',
      'account_deleted'
    )
  ),
  constraint org_media_cleanup_status_ck
    check (status in ('pending', 'leased', 'completed')),
  constraint org_media_cleanup_attempt_ck
    check (attempt_count between 0 and 1000),
  constraint org_media_cleanup_lease_ck check (
    (
      status = 'leased'
      and worker_id is not null
      and lease_token is not null
      and lease_expires_at is not null
    )
    or status <> 'leased'
  ),
  constraint org_media_cleanup_error_ck check (
    last_error_code is null
    or (
      pg_catalog.char_length(last_error_code) between 1 and 64
      and last_error_code ~ '^[a-z][a-z0-9_]*$'
    )
  ),
  constraint org_media_cleanup_time_ck check (
    pg_catalog.isfinite(next_attempt_at)
    and pg_catalog.isfinite(created_at)
    and pg_catalog.isfinite(updated_at)
    and (
      lease_expires_at is null
      or pg_catalog.isfinite(lease_expires_at)
    )
    and (
      last_next_attempt_at is null
      or pg_catalog.isfinite(last_next_attempt_at)
    )
    and (
      completed_at is null
      or pg_catalog.isfinite(completed_at)
    )
  )
);

create index org_media_cleanup_due_idx
  on public.org_media_cleanup_queue (next_attempt_at, id)
  where status in ('pending', 'leased');

create table public.org_social_posts (
  id                            uuid primary key,
  organization_id               text not null
                                  references public.organizations(id)
                                  on delete cascade,
  added_by                      uuid
                                  references public.profiles(id)
                                  on delete set null,
  client_request_id             uuid not null,
  permalink                     text not null,
  status                        text not null default 'pending',
  revision                      bigint not null default 0,
  render_html                   text,
  cache_expires_at              timestamptz,
  attribution                   text,
  last_error_code               text,
  next_refresh_at               timestamptz not null
                                  default pg_catalog.clock_timestamp(),
  refresh_actor_id              uuid
                                  references public.profiles(id)
                                  on delete set null,
  refresh_worker_id             uuid,
  refresh_lease_token           uuid,
  refresh_lease_expires_at      timestamptz,
  capacity_consumed_lease_token uuid,
  capacity_remaining            integer,
  last_finalized_lease_token    uuid,
  last_finalize_fingerprint     text,
  deleted_by                    uuid
                                  references public.profiles(id)
                                  on delete set null,
  deleted_at                    timestamptz,
  created_at                    timestamptz not null
                                  default pg_catalog.clock_timestamp(),
  updated_at                    timestamptz not null
                                  default pg_catalog.clock_timestamp(),
  unique (organization_id, client_request_id),
  constraint org_social_posts_permalink_ck check (
    permalink ~ '^https://www[.]instagram[.]com/(p|reel)/[A-Za-z0-9_-]{1,64}/$'
  ),
  constraint org_social_posts_status_ck check (
    status in ('pending', 'ready', 'link_only', 'disabled', 'deleted')
  ),
  constraint org_social_posts_revision_ck check (revision >= 0),
  constraint org_social_posts_cache_ck check (
    render_html is null
    or pg_catalog.char_length(render_html) between 1 and 50000
  ),
  constraint org_social_posts_attribution_ck check (
    attribution is null
    or (
      pg_catalog.char_length(attribution) between 1 and 200
      and attribution = pg_catalog.btrim(attribution)
    )
  ),
  constraint org_social_posts_error_ck check (
    last_error_code is null
    or (
      pg_catalog.char_length(last_error_code) between 1 and 64
      and last_error_code ~ '^[a-z][a-z0-9_]*$'
    )
  ),
  constraint org_social_posts_lease_ck check (
    (
      refresh_lease_token is null
      and refresh_lease_expires_at is null
      and refresh_actor_id is null
      and refresh_worker_id is null
    )
    or (
      refresh_lease_token is not null
      and refresh_lease_expires_at is not null
      and (
        (refresh_actor_id is not null and refresh_worker_id is null)
        or (refresh_actor_id is null and refresh_worker_id is not null)
      )
    )
  ),
  constraint org_social_posts_capacity_ck check (
    capacity_remaining is null
    or capacity_remaining between 0 and 899
  ),
  constraint org_social_posts_deleted_ck check (
    (status = 'deleted') = (deleted_at is not null)
  ),
  constraint org_social_posts_time_ck check (
    pg_catalog.isfinite(next_refresh_at)
    and pg_catalog.isfinite(created_at)
    and pg_catalog.isfinite(updated_at)
    and (
      cache_expires_at is null
      or pg_catalog.isfinite(cache_expires_at)
    )
    and (
      refresh_lease_expires_at is null
      or pg_catalog.isfinite(refresh_lease_expires_at)
    )
    and (
      deleted_at is null
      or pg_catalog.isfinite(deleted_at)
    )
  )
);

create unique index org_social_posts_live_permalink_uidx
  on public.org_social_posts (organization_id, permalink)
  where status <> 'deleted';

create index org_social_posts_public_idx
  on public.org_social_posts (organization_id, created_at, id)
  where status <> 'deleted';

create index org_social_posts_due_idx
  on public.org_social_posts (next_refresh_at, id)
  where status in ('pending', 'ready', 'link_only');

create index org_social_posts_added_by_idx
  on public.org_social_posts (added_by)
  where added_by is not null;

create index org_social_posts_refresh_actor_idx
  on public.org_social_posts (refresh_actor_id)
  where refresh_actor_id is not null;

create table public.org_asset_mutation_limits (
  user_id           uuid not null
                      references public.profiles(id) on delete cascade,
  bucket            text not null,
  window_started_at timestamptz not null,
  count             integer not null,
  updated_at        timestamptz not null,
  primary key (user_id, bucket),
  constraint org_asset_mutation_limits_bucket_ck
    check (bucket in ('media_hour', 'social_hour')),
  constraint org_asset_mutation_limits_count_ck
    check (count between 1 and 30),
  constraint org_asset_mutation_limits_time_ck check (
    pg_catalog.isfinite(window_started_at)
    and pg_catalog.isfinite(updated_at)
  )
);

create table public.org_oembed_control (
  id                   boolean primary key default true,
  enabled              boolean not null default false,
  circuit_open_until   timestamptz,
  window_started_at    timestamptz not null
                         default pg_catalog.clock_timestamp(),
  request_count        integer not null default 0,
  updated_at           timestamptz not null
                         default pg_catalog.clock_timestamp(),
  constraint org_oembed_control_singleton_ck check (id),
  constraint org_oembed_control_count_ck
    check (request_count between 0 and 900),
  constraint org_oembed_control_time_ck check (
    pg_catalog.isfinite(window_started_at)
    and pg_catalog.isfinite(updated_at)
    and (
      circuit_open_until is null
      or pg_catalog.isfinite(circuit_open_until)
    )
  )
);

insert into public.org_oembed_control default values;

create table public.org_asset_edits (
  id              uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id text not null
                    references public.organizations(id) on delete cascade,
  actor_user_id   uuid references public.profiles(id) on delete set null,
  upload_id       uuid
                    references public.org_media_uploads(id) on delete set null,
  media_id        uuid
                    references public.org_media_assets(id) on delete set null,
  social_post_id  uuid
                    references public.org_social_posts(id) on delete set null,
  client_request_id uuid,
  requested_resource_id uuid,
  action          text not null,
  before_state    jsonb not null default '{}'::jsonb,
  after_state     jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null
                    default pg_catalog.clock_timestamp(),
  constraint org_asset_edits_action_ck check (
    action in (
      'media_upload_reserved',
      'media_upload_failed',
      'media_finalized',
      'media_deleted',
      'gallery_reordered',
      'social_post_added',
      'social_post_request_mapped',
      'social_post_finalized',
      'social_post_deleted'
    )
  ),
  constraint org_asset_edits_state_ck check (
    pg_catalog.jsonb_typeof(before_state) = 'object'
    and pg_catalog.jsonb_typeof(after_state) = 'object'
  ),
  constraint org_asset_edits_request_map_ck check (
    (
      action = 'social_post_request_mapped'
      and client_request_id is not null
      and requested_resource_id is not null
      and social_post_id is not null
    )
    or (
      action <> 'social_post_request_mapped'
      and client_request_id is null
      and requested_resource_id is null
    )
  ),
  constraint org_asset_edits_time_ck
    check (pg_catalog.isfinite(created_at))
);

create index org_asset_edits_org_created_idx
  on public.org_asset_edits (organization_id, created_at, id);

create index org_asset_edits_actor_idx
  on public.org_asset_edits (actor_user_id)
  where actor_user_id is not null;

create unique index org_asset_edits_social_request_uidx
  on public.org_asset_edits (organization_id, client_request_id)
  where action = 'social_post_request_mapped'
    and client_request_id is not null;

alter table public.org_media_collections enable row level security;
alter table public.org_media_uploads enable row level security;
alter table public.org_media_assets enable row level security;
alter table public.org_media_cleanup_queue enable row level security;
alter table public.org_social_posts enable row level security;
alter table public.org_asset_mutation_limits enable row level security;
alter table public.org_oembed_control enable row level security;
alter table public.org_asset_edits enable row level security;

-- Translate the organization subsystem's errors into this API family's stable
-- namespace while retaining its auth.users -> profiles lock ordering.
create function public.brownsync_require_org_asset_actor(p_actor uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    return public.brownsync_require_org_actor(p_actor);
  exception
    when raise_exception then
      if sqlerrm = 'BROWNSYNC_ORG_UNAUTHORIZED' then
        raise exception using
          errcode = 'P0001',
          message = 'BROWNSYNC_ORG_ASSET_UNAUTHORIZED';
      end if;
      raise;
  end;
end
$$;

create function public.brownsync_lock_org_asset_organization(
  p_organization_id text
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    return public.brownsync_lock_organization(p_organization_id);
  exception
    when raise_exception then
      if sqlerrm = 'BROWNSYNC_ORG_NOT_FOUND' then
        raise exception using
          errcode = 'P0001',
          message = 'BROWNSYNC_ORG_ASSET_ORGANIZATION_NOT_FOUND';
      end if;
      raise;
  end;
end
$$;

create function public.brownsync_consume_org_asset_limit(
  p_actor uuid,
  p_bucket text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_inserted boolean := false;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_window_started_at timestamptz;
begin
  if p_actor is null
     or p_bucket not in ('media_hour', 'social_hour') then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_RATE_LIMITED';
  end if;

  insert into public.org_asset_mutation_limits (
    user_id,
    bucket,
    window_started_at,
    count,
    updated_at
  ) values (
    p_actor,
    p_bucket,
    v_now,
    1,
    v_now
  )
  on conflict (user_id, bucket) do nothing
  returning true into v_inserted;

  if coalesce(v_inserted, false) then
    return;
  end if;

  select l.window_started_at, l.count
  into v_window_started_at, v_count
  from public.org_asset_mutation_limits as l
  where l.user_id = p_actor
    and l.bucket = p_bucket
  for update;

  v_now := pg_catalog.clock_timestamp();
  if v_now >= v_window_started_at + interval '1 hour' then
    update public.org_asset_mutation_limits
    set window_started_at = v_now,
        count = 1,
        updated_at = v_now
    where user_id = p_actor
      and bucket = p_bucket;
  elsif v_count >= 30 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_RATE_LIMITED';
  else
    update public.org_asset_mutation_limits
    set count = count + 1,
        updated_at = v_now
    where user_id = p_actor
      and bucket = p_bucket;
  end if;
end
$$;

create function public.brownsync_enqueue_media_cleanup(
  p_organization_id text,
  p_upload_id uuid,
  p_media_id uuid,
  p_object_path text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted boolean := false;
begin
  insert into public.org_media_cleanup_queue (
    organization_id,
    upload_id,
    media_id,
    object_path,
    reason
  ) values (
    p_organization_id,
    p_upload_id,
    p_media_id,
    p_object_path,
    p_reason
  )
  on conflict (object_path) do nothing
  returning true into v_inserted;

  return coalesce(v_inserted, false);
end
$$;

create function public.brownsync_org_asset_error_is_normalized(
  p_error_code text
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select p_error_code is not null
    and pg_catalog.char_length(p_error_code) between 1 and 64
    and p_error_code ~ '^[a-z][a-z0-9_]*$'
$$;

create function public.brownsync_get_org_media(
  p_organization_id text
)
returns table (
  organization_id text,
  organization_revision bigint,
  gallery_revision bigint,
  media_id uuid,
  kind text,
  public_url text,
  width integer,
  height integer,
  byte_size integer,
  alt_text text,
  "position" integer,
  asset_revision bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.organizations as o
    where o.id = p_organization_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_ORGANIZATION_NOT_FOUND';
  end if;

  return query
  select
    p_organization_id,
    coalesce(x.revision, 0::bigint),
    coalesce(c.revision, 0::bigint),
    a.id,
    a.kind,
    a.public_url,
    a.width,
    a.height,
    a.byte_size,
    a.alt_text,
    a.position,
    a.revision
  from (values (true)) as sentinel(one)
  left join public.org_overrides as x
    on x.organization_id = p_organization_id
  left join public.org_media_collections as c
    on c.organization_id = p_organization_id
  left join public.org_media_assets as a
    on a.organization_id = p_organization_id
   and a.status = 'ready'
   and a.deleted_at is null
  order by
    case a.kind
      when 'avatar' then 0
      when 'banner' then 1
      when 'gallery' then 2
      else 3
    end,
    a.position nulls first,
    a.id;
end
$$;

create function public.brownsync_reserve_org_media_upload(
  p_actor uuid,
  p_organization_id text,
  p_client_request_id uuid,
  p_upload_id uuid,
  p_kind text,
  p_alt_text text,
  p_expected_organization_revision bigint,
  p_expected_gallery_revision bigint,
  p_object_path text
)
returns table (
  upload_id uuid,
  kind text,
  expires_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alt_text text;
  v_current_revision bigint;
  v_existing public.org_media_uploads%rowtype;
  v_now timestamptz;
begin
  perform public.brownsync_require_org_asset_actor(p_actor);

  if p_organization_id is null
     or p_organization_id !~ '^[a-z0-9][a-z0-9-]{0,159}$'
     or p_client_request_id is null
     or p_upload_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_INPUT_INVALID';
  end if;
  if p_kind is null
     or p_kind not in ('avatar', 'banner', 'gallery') then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_KIND_INVALID';
  end if;

  v_alt_text := pg_catalog.btrim(coalesce(p_alt_text, ''));
  if pg_catalog.char_length(v_alt_text) not between 1 and 500 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_ALT_TEXT_INVALID';
  end if;

  if (
    p_kind in ('avatar', 'banner')
    and (
      p_expected_organization_revision is null
      or p_expected_organization_revision < 0
      or p_expected_gallery_revision is not null
    )
  ) or (
    p_kind = 'gallery'
    and (
      p_expected_organization_revision is not null
      or p_expected_gallery_revision is null
      or p_expected_gallery_revision < 0
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_INPUT_INVALID';
  end if;

  if p_object_path is distinct from (
    'org/' || p_organization_id || '/' || p_kind || '/'
      || p_upload_id::text || '.webp'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_PATH_INVALID';
  end if;

  perform public.brownsync_lock_org_asset_organization(p_organization_id);
  if not public.brownsync_is_org_admin(
    p_actor, p_organization_id, null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FORBIDDEN';
  end if;

  select u.*
  into v_existing
  from public.org_media_uploads as u
  where u.organization_id = p_organization_id
    and u.client_request_id = p_client_request_id
  for update;

  if found then
    if v_existing.id = p_upload_id
       and v_existing.actor_user_id = p_actor
       and v_existing.kind = p_kind
       and v_existing.alt_text = v_alt_text
       and v_existing.expected_organization_revision
             is not distinct from p_expected_organization_revision
       and v_existing.expected_gallery_revision
             is not distinct from p_expected_gallery_revision
       and v_existing.object_path = p_object_path then
      return query
        select
          v_existing.id,
          v_existing.kind,
          v_existing.expires_at,
          true;
      return;
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_REQUEST_CONFLICT';
  end if;

  if exists (
    select 1
    from public.org_media_uploads as u
    where u.id = p_upload_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_REQUEST_CONFLICT';
  end if;

  if p_kind in ('avatar', 'banner') then
    select coalesce(x.revision, 0::bigint)
    into v_current_revision
    from (values (true)) as sentinel(one)
    left join public.org_overrides as x
      on x.organization_id = p_organization_id;
    if v_current_revision is distinct from
         p_expected_organization_revision then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_ASSET_REVISION_CONFLICT';
    end if;
  else
    insert into public.org_media_collections (organization_id)
    values (p_organization_id)
    on conflict (organization_id) do nothing;

    select c.revision
    into v_current_revision
    from public.org_media_collections as c
    where c.organization_id = p_organization_id
    for update;
    if v_current_revision is distinct from p_expected_gallery_revision then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_ASSET_REVISION_CONFLICT';
    end if;
  end if;

  if exists (
    select 1
    from public.org_media_uploads as u
    where u.organization_id = p_organization_id
      and u.status in ('reserved', 'processing')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_UPLOAD_BUSY';
  end if;

  v_now := pg_catalog.clock_timestamp();
  insert into public.org_media_uploads (
    id,
    organization_id,
    actor_user_id,
    client_request_id,
    kind,
    alt_text,
    expected_organization_revision,
    expected_gallery_revision,
    object_path,
    expires_at,
    created_at,
    updated_at
  ) values (
    p_upload_id,
    p_organization_id,
    p_actor,
    p_client_request_id,
    p_kind,
    v_alt_text,
    p_expected_organization_revision,
    p_expected_gallery_revision,
    p_object_path,
    v_now + interval '10 minutes',
    v_now,
    v_now
  );

  perform public.brownsync_consume_org_asset_limit(
    p_actor, 'media_hour'
  );

  insert into public.org_asset_edits (
    organization_id,
    actor_user_id,
    upload_id,
    action,
    after_state,
    created_at
  ) values (
    p_organization_id,
    p_actor,
    p_upload_id,
    'media_upload_reserved',
    pg_catalog.jsonb_build_object(
      'kind', p_kind,
      'alt_text', v_alt_text
    ),
    v_now
  );

  return query
    select p_upload_id, p_kind, v_now + interval '10 minutes', false;
end
$$;

create function public.brownsync_begin_org_media_upload(
  p_actor uuid,
  p_upload_id uuid
)
returns table (
  upload_id uuid,
  organization_id text,
  kind text,
  object_path text,
  alt_text text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id text;
  v_upload public.org_media_uploads%rowtype;
begin
  perform public.brownsync_require_org_asset_actor(p_actor);

  if p_upload_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_INPUT_INVALID';
  end if;

  select u.organization_id
  into v_organization_id
  from public.org_media_uploads as u
  where u.id = p_upload_id;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_UPLOAD_NOT_FOUND';
  end if;

  perform public.brownsync_lock_org_asset_organization(v_organization_id);
  select u.*
  into v_upload
  from public.org_media_uploads as u
  where u.id = p_upload_id
    and u.organization_id = v_organization_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_UPLOAD_NOT_FOUND';
  end if;

  if v_upload.actor_user_id is distinct from p_actor then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FORBIDDEN';
  end if;
  if not public.brownsync_is_org_admin(
    p_actor, v_organization_id, null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FORBIDDEN';
  end if;

  if v_upload.status = 'processing' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_UPLOAD_CLAIMED';
  elsif v_upload.status <> 'reserved'
        or v_upload.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_UPLOAD_TERMINAL';
  end if;

  update public.org_media_uploads as u
  set status = 'processing',
      updated_at = pg_catalog.clock_timestamp()
  where u.id = v_upload.id;

  return query
    select
      v_upload.id,
      v_upload.organization_id,
      v_upload.kind,
      v_upload.object_path,
      v_upload.alt_text,
      v_upload.expires_at;
end
$$;

create function public.brownsync_finalize_org_media_upload(
  p_actor uuid,
  p_upload_id uuid,
  p_media_id uuid,
  p_public_url text,
  p_width integer,
  p_height integer,
  p_byte_size integer
)
returns table (
  media_id uuid,
  kind text,
  public_url text,
  width integer,
  height integer,
  byte_size integer,
  alt_text text,
  "position" integer,
  asset_revision bigint,
  organization_revision bigint,
  gallery_revision bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.org_media_assets%rowtype;
  v_before jsonb;
  v_current_revision bigint;
  v_found_override boolean;
  v_new_revision bigint;
  v_now timestamptz;
  v_old_asset public.org_media_assets%rowtype;
  v_organization_id text;
  v_override public.org_overrides%rowtype;
  v_position integer;
  v_upload public.org_media_uploads%rowtype;
begin
  perform public.brownsync_require_org_asset_actor(p_actor);

  if p_upload_id is null or p_media_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_INPUT_INVALID';
  end if;

  select u.organization_id
  into v_organization_id
  from public.org_media_uploads as u
  where u.id = p_upload_id;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_UPLOAD_NOT_FOUND';
  end if;

  perform public.brownsync_lock_org_asset_organization(v_organization_id);
  select u.*
  into v_upload
  from public.org_media_uploads as u
  where u.id = p_upload_id
    and u.organization_id = v_organization_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_UPLOAD_NOT_FOUND';
  end if;

  if v_upload.actor_user_id is distinct from p_actor then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FORBIDDEN';
  end if;
  if not public.brownsync_is_org_admin(
    p_actor, v_organization_id, null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FORBIDDEN';
  end if;

  if v_upload.status = 'finalized' then
    if v_upload.result_media_id = p_media_id
       and v_upload.result_public_url = p_public_url
       and v_upload.result_width = p_width
       and v_upload.result_height = p_height
       and v_upload.result_byte_size = p_byte_size then
      return query
        select
          v_upload.result_media_id,
          v_upload.kind,
          v_upload.result_public_url,
          v_upload.result_width,
          v_upload.result_height,
          v_upload.result_byte_size,
          v_upload.result_alt_text,
          v_upload.result_position,
          v_upload.result_asset_revision,
          v_upload.result_organization_revision,
          v_upload.result_gallery_revision,
          true;
      return;
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FINALIZATION_CONFLICT';
  elsif v_upload.status = 'reserved' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_UPLOAD_CLAIMED';
  elsif v_upload.status <> 'processing'
        or v_upload.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_UPLOAD_TERMINAL';
  end if;

  if p_public_url is null
     or pg_catalog.char_length(p_public_url) not between 1 and 2048
     or p_public_url <> pg_catalog.btrim(p_public_url)
     or p_public_url !~ '^https://[^[:space:]]+$'
     or p_width is null
     or p_height is null
     or p_width not between 1 and 12000
     or p_height not between 1 and 12000
     or p_width::bigint * p_height::bigint > 40000000
     or p_byte_size is null
     or p_byte_size not between 1 and 2097152
     or (
       v_upload.kind = 'avatar'
       and (p_width > 1024 or p_height > 1024)
     )
     or (
       v_upload.kind = 'banner'
       and (p_width > 1920 or p_height > 1080)
     )
     or (
       v_upload.kind = 'gallery'
       and (p_width > 1920 or p_height > 1920)
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_OUTPUT_INVALID';
  end if;

  if exists (
    select 1
    from public.org_media_assets as a
    where a.id = p_media_id
       or a.object_path = v_upload.object_path
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FINALIZATION_CONFLICT';
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_position := null;

  if v_upload.kind in ('avatar', 'banner') then
    select x.*
    into v_override
    from public.org_overrides as x
    where x.organization_id = v_organization_id
    for update;
    v_found_override := found;
    v_current_revision := case
      when v_found_override then v_override.revision
      else 0
    end;

    if v_current_revision is distinct from
         v_upload.expected_organization_revision then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_ASSET_REVISION_CONFLICT';
    end if;

    select a.*
    into v_old_asset
    from public.org_media_assets as a
    where a.organization_id = v_organization_id
      and a.kind = v_upload.kind
      and a.status = 'ready'
      and a.deleted_at is null
    for update;

    v_before := public.brownsync_org_override_snapshot(
      case when v_found_override then v_override.description else null end,
      case when v_found_override then v_override.about_md else null end,
      case when v_found_override then v_override.meeting_info else null end,
      case when v_found_override then v_override.links else null end,
      case when v_found_override then v_override.avatar_url else null end,
      case when v_found_override then v_override.banner_url else null end
    );

    if found then
      update public.org_media_assets as a
      set status = 'deleted',
          revision = a.revision + 1,
          deleted_by = p_actor,
          deleted_at = v_now,
          updated_at = v_now
      where a.id = v_old_asset.id;

      perform public.brownsync_enqueue_media_cleanup(
        v_organization_id,
        v_old_asset.upload_id,
        v_old_asset.id,
        v_old_asset.object_path,
        'replaced'
      );
    end if;

    v_new_revision := v_current_revision + 1;
    insert into public.org_media_assets (
      id,
      organization_id,
      upload_id,
      kind,
      object_path,
      public_url,
      width,
      height,
      byte_size,
      alt_text,
      position,
      revision,
      status,
      created_by,
      created_at,
      updated_at
    ) values (
      p_media_id,
      v_organization_id,
      v_upload.id,
      v_upload.kind,
      v_upload.object_path,
      p_public_url,
      p_width,
      p_height,
      p_byte_size,
      v_upload.alt_text,
      null,
      1,
      'ready',
      p_actor,
      v_now,
      v_now
    );

    insert into public.org_overrides (
      organization_id,
      description,
      about_md,
      meeting_info,
      links,
      avatar_url,
      banner_url,
      revision,
      updated_by,
      updated_at
    ) values (
      v_organization_id,
      case when v_found_override then v_override.description else null end,
      case when v_found_override then v_override.about_md else null end,
      case when v_found_override then v_override.meeting_info else null end,
      case when v_found_override then v_override.links else null end,
      case
        when v_upload.kind = 'avatar' then p_public_url
        when v_found_override then v_override.avatar_url
        else null
      end,
      case
        when v_upload.kind = 'banner' then p_public_url
        when v_found_override then v_override.banner_url
        else null
      end,
      v_new_revision,
      p_actor,
      v_now
    )
    on conflict (organization_id) do update
    set avatar_url = case
          when v_upload.kind = 'avatar' then excluded.avatar_url
          else public.org_overrides.avatar_url
        end,
        banner_url = case
          when v_upload.kind = 'banner' then excluded.banner_url
          else public.org_overrides.banner_url
        end,
        revision = excluded.revision,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

    insert into public.org_edits (
      organization_id,
      actor_user_id,
      target_user_id,
      action,
      revision,
      before_state,
      after_state,
      created_at
    )
    select
      v_organization_id,
      p_actor,
      p_actor,
      'content_edited',
      v_new_revision,
      v_before,
      public.brownsync_org_override_snapshot(
        x.description,
        x.about_md,
        x.meeting_info,
        x.links,
        x.avatar_url,
        x.banner_url
      ),
      v_now
    from public.org_overrides as x
    where x.organization_id = v_organization_id;

    update public.org_media_uploads as u
    set status = 'finalized',
        result_organization_revision = v_new_revision,
        result_gallery_revision = null,
        result_media_id = p_media_id,
        result_public_url = p_public_url,
        result_width = p_width,
        result_height = p_height,
        result_byte_size = p_byte_size,
        result_alt_text = v_upload.alt_text,
        result_position = null,
        result_asset_revision = 1,
        updated_at = v_now
    where u.id = v_upload.id;
  else
    insert into public.org_media_collections (organization_id)
    values (v_organization_id)
    on conflict (organization_id) do nothing;

    select c.revision
    into v_current_revision
    from public.org_media_collections as c
    where c.organization_id = v_organization_id
    for update;

    if v_current_revision is distinct from
         v_upload.expected_gallery_revision then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_ASSET_REVISION_CONFLICT';
    end if;

    select pg_catalog.count(*)::integer
    into v_position
    from public.org_media_assets as a
    where a.organization_id = v_organization_id
      and a.kind = 'gallery'
      and a.status = 'ready'
      and a.deleted_at is null;
    if v_position >= 12 then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_ASSET_GALLERY_LIMIT';
    end if;

    v_new_revision := v_current_revision + 1;
    insert into public.org_media_assets (
      id,
      organization_id,
      upload_id,
      kind,
      object_path,
      public_url,
      width,
      height,
      byte_size,
      alt_text,
      position,
      revision,
      status,
      created_by,
      created_at,
      updated_at
    ) values (
      p_media_id,
      v_organization_id,
      v_upload.id,
      'gallery',
      v_upload.object_path,
      p_public_url,
      p_width,
      p_height,
      p_byte_size,
      v_upload.alt_text,
      v_position,
      1,
      'ready',
      p_actor,
      v_now,
      v_now
    );

    update public.org_media_collections as c
    set revision = v_new_revision,
        updated_by = p_actor,
        updated_at = v_now
    where c.organization_id = v_organization_id;

    update public.org_media_uploads as u
    set status = 'finalized',
        result_organization_revision = null,
        result_gallery_revision = v_new_revision,
        result_media_id = p_media_id,
        result_public_url = p_public_url,
        result_width = p_width,
        result_height = p_height,
        result_byte_size = p_byte_size,
        result_alt_text = v_upload.alt_text,
        result_position = v_position,
        result_asset_revision = 1,
        updated_at = v_now
    where u.id = v_upload.id;
  end if;

  insert into public.org_asset_edits (
    organization_id,
    actor_user_id,
    upload_id,
    media_id,
    action,
    before_state,
    after_state,
    created_at
  ) values (
    v_organization_id,
    p_actor,
    v_upload.id,
    p_media_id,
    'media_finalized',
    case
      when v_old_asset.id is null then '{}'::jsonb
      else pg_catalog.jsonb_build_object(
        'replaced_media_id', v_old_asset.id
      )
    end,
    pg_catalog.jsonb_build_object(
      'kind', v_upload.kind,
      'public_url', p_public_url,
      'width', p_width,
      'height', p_height,
      'byte_size', p_byte_size,
      'position', v_position
    ),
    v_now
  );

  return query
    select
      p_media_id,
      v_upload.kind,
      p_public_url,
      p_width,
      p_height,
      p_byte_size,
      v_upload.alt_text,
      v_position,
      1::bigint,
      case
        when v_upload.kind in ('avatar', 'banner') then v_new_revision
        else null::bigint
      end,
      case
        when v_upload.kind = 'gallery' then v_new_revision
        else null::bigint
      end,
      false;
end
$$;

create function public.brownsync_fail_org_media_upload(
  p_actor uuid,
  p_upload_id uuid,
  p_failure_code text,
  p_object_may_exist boolean
)
returns table (
  upload_id uuid,
  status text,
  changed boolean,
  cleanup_enqueued boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cleanup boolean := false;
  v_now timestamptz;
  v_organization_id text;
  v_upload public.org_media_uploads%rowtype;
begin
  perform public.brownsync_require_org_asset_actor(p_actor);

  if p_upload_id is null
     or p_object_may_exist is null
     or p_failure_code is null
     or p_failure_code not in (
       'input_too_large',
       'unsupported_media_type',
       'invalid_image',
       'dimension_limit',
       'pixel_limit',
       'transform_failed',
       'output_too_large',
       'storage_unavailable',
       'storage_failed',
       'finalization_failed',
       'account_deleted',
       'expired'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FAILURE_INVALID';
  end if;

  select u.organization_id
  into v_organization_id
  from public.org_media_uploads as u
  where u.id = p_upload_id;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_UPLOAD_NOT_FOUND';
  end if;

  perform public.brownsync_lock_org_asset_organization(v_organization_id);
  select u.*
  into v_upload
  from public.org_media_uploads as u
  where u.id = p_upload_id
    and u.organization_id = v_organization_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_UPLOAD_NOT_FOUND';
  end if;

  if v_upload.actor_user_id is distinct from p_actor then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FORBIDDEN';
  end if;
  if v_upload.status = 'finalized' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_UPLOAD_TERMINAL';
  end if;

  if v_upload.status = 'failed' then
    if p_object_may_exist then
      v_cleanup := public.brownsync_enqueue_media_cleanup(
        v_upload.organization_id,
        v_upload.id,
        null,
        v_upload.object_path,
        case
          when p_failure_code = 'account_deleted' then 'account_deleted'
          when p_failure_code = 'expired' then 'expired_upload'
          when p_failure_code = 'finalization_failed'
            then 'failed_finalization'
          else 'failed_upload'
        end
      );
    end if;
    return query
      select v_upload.id, 'failed'::text, false, v_cleanup;
    return;
  end if;

  v_now := pg_catalog.clock_timestamp();
  update public.org_media_uploads as u
  set status = 'failed',
      failure_code = p_failure_code,
      updated_at = v_now
  where u.id = v_upload.id;

  if p_object_may_exist then
    v_cleanup := public.brownsync_enqueue_media_cleanup(
      v_upload.organization_id,
      v_upload.id,
      null,
      v_upload.object_path,
      case
        when p_failure_code = 'account_deleted' then 'account_deleted'
        when p_failure_code = 'expired' then 'expired_upload'
        when p_failure_code = 'finalization_failed'
          then 'failed_finalization'
        else 'failed_upload'
      end
    );
  end if;

  insert into public.org_asset_edits (
    organization_id,
    actor_user_id,
    upload_id,
    action,
    after_state,
    created_at
  ) values (
    v_upload.organization_id,
    p_actor,
    v_upload.id,
    'media_upload_failed',
    pg_catalog.jsonb_build_object(
      'failure_code', p_failure_code,
      'cleanup_enqueued', v_cleanup
    ),
    v_now
  );

  return query select v_upload.id, 'failed'::text, true, v_cleanup;
end
$$;

create function public.brownsync_delete_org_media(
  p_actor uuid,
  p_organization_id text,
  p_media_id uuid,
  p_expected_revision bigint
)
returns table (
  media_id uuid,
  kind text,
  organization_revision bigint,
  gallery_revision bigint,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.org_media_assets%rowtype;
  v_before jsonb;
  v_current_revision bigint;
  v_found_override boolean;
  v_new_revision bigint;
  v_now timestamptz;
  v_override public.org_overrides%rowtype;
begin
  perform public.brownsync_require_org_asset_actor(p_actor);
  if p_media_id is null
     or p_expected_revision is null
     or p_expected_revision < 0 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_INPUT_INVALID';
  end if;

  perform public.brownsync_lock_org_asset_organization(p_organization_id);
  if not public.brownsync_is_org_admin(
    p_actor, p_organization_id, null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FORBIDDEN';
  end if;

  select a.*
  into v_asset
  from public.org_media_assets as a
  where a.id = p_media_id
    and a.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_MEDIA_NOT_FOUND';
  end if;

  if v_asset.status = 'deleted' and v_asset.deleted_at is not null then
    if v_asset.kind = 'gallery' then
      select coalesce(c.revision, 0::bigint)
      into v_current_revision
      from (values (true)) as sentinel(one)
      left join public.org_media_collections as c
        on c.organization_id = p_organization_id;
      return query
        select v_asset.id, v_asset.kind, null::bigint,
               v_current_revision, false;
    else
      select coalesce(x.revision, 0::bigint)
      into v_current_revision
      from (values (true)) as sentinel(one)
      left join public.org_overrides as x
        on x.organization_id = p_organization_id;
      return query
        select v_asset.id, v_asset.kind, v_current_revision,
               null::bigint, false;
    end if;
    return;
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_asset.kind in ('avatar', 'banner') then
    select x.*
    into v_override
    from public.org_overrides as x
    where x.organization_id = p_organization_id
    for update;
    v_found_override := found;
    v_current_revision := case
      when v_found_override then v_override.revision
      else 0
    end;

    if p_expected_revision is distinct from v_current_revision then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_ASSET_REVISION_CONFLICT';
    end if;

    perform public.brownsync_consume_org_asset_limit(
      p_actor, 'media_hour'
    );
    v_new_revision := v_current_revision + 1;
    v_before := public.brownsync_org_override_snapshot(
      case when v_found_override then v_override.description else null end,
      case when v_found_override then v_override.about_md else null end,
      case when v_found_override then v_override.meeting_info else null end,
      case when v_found_override then v_override.links else null end,
      case when v_found_override then v_override.avatar_url else null end,
      case when v_found_override then v_override.banner_url else null end
    );

    update public.org_media_assets as a
    set status = 'deleted',
        position = null,
        revision = a.revision + 1,
        deleted_by = p_actor,
        deleted_at = v_now,
        updated_at = v_now
    where a.id = v_asset.id;

    update public.org_overrides as x
    set avatar_url = case
          when v_asset.kind = 'avatar' then null
          else x.avatar_url
        end,
        banner_url = case
          when v_asset.kind = 'banner' then null
          else x.banner_url
        end,
        revision = v_new_revision,
        updated_by = p_actor,
        updated_at = v_now
    where x.organization_id = p_organization_id;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_ASSET_REVISION_CONFLICT';
    end if;

    insert into public.org_edits (
      organization_id,
      actor_user_id,
      target_user_id,
      action,
      revision,
      before_state,
      after_state,
      created_at
    )
    select
      p_organization_id,
      p_actor,
      p_actor,
      'content_edited',
      v_new_revision,
      v_before,
      public.brownsync_org_override_snapshot(
        x.description,
        x.about_md,
        x.meeting_info,
        x.links,
        x.avatar_url,
        x.banner_url
      ),
      v_now
    from public.org_overrides as x
    where x.organization_id = p_organization_id;
  else
    insert into public.org_media_collections (organization_id)
    values (p_organization_id)
    on conflict (organization_id) do nothing;
    select c.revision
    into v_current_revision
    from public.org_media_collections as c
    where c.organization_id = p_organization_id
    for update;

    if p_expected_revision is distinct from v_current_revision then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_ASSET_REVISION_CONFLICT';
    end if;

    perform public.brownsync_consume_org_asset_limit(
      p_actor, 'media_hour'
    );
    v_new_revision := v_current_revision + 1;

    set constraints all deferred;
    update public.org_media_assets as a
    set status = 'deleted',
        position = null,
        revision = a.revision + 1,
        deleted_by = p_actor,
        deleted_at = v_now,
        updated_at = v_now
    where a.id = v_asset.id;

    update public.org_media_assets as a
    set position = a.position - 1,
        revision = a.revision + 1,
        updated_at = v_now
    where a.organization_id = p_organization_id
      and a.kind = 'gallery'
      and a.status = 'ready'
      and a.deleted_at is null
      and a.position > v_asset.position;

    update public.org_media_collections as c
    set revision = v_new_revision,
        updated_by = p_actor,
        updated_at = v_now
    where c.organization_id = p_organization_id;
  end if;

  perform public.brownsync_enqueue_media_cleanup(
    p_organization_id,
    v_asset.upload_id,
    v_asset.id,
    v_asset.object_path,
    'deleted'
  );

  insert into public.org_asset_edits (
    organization_id,
    actor_user_id,
    upload_id,
    media_id,
    action,
    before_state,
    after_state,
    created_at
  ) values (
    p_organization_id,
    p_actor,
    v_asset.upload_id,
    v_asset.id,
    'media_deleted',
    pg_catalog.jsonb_build_object(
      'kind', v_asset.kind,
      'position', v_asset.position,
      'public_url', v_asset.public_url
    ),
    '{}'::jsonb,
    v_now
  );

  return query
    select
      v_asset.id,
      v_asset.kind,
      case
        when v_asset.kind in ('avatar', 'banner') then v_new_revision
        else null::bigint
      end,
      case
        when v_asset.kind = 'gallery' then v_new_revision
        else null::bigint
      end,
      true;
end
$$;

create function public.brownsync_reorder_org_gallery(
  p_actor uuid,
  p_organization_id text,
  p_expected_gallery_revision bigint,
  p_media_ids uuid[]
)
returns table (
  gallery_revision bigint,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_ids uuid[];
  v_current_revision bigint;
  v_new_revision bigint;
  v_now timestamptz;
begin
  perform public.brownsync_require_org_asset_actor(p_actor);
  if p_expected_gallery_revision is null
     or p_expected_gallery_revision < 0
     or p_media_ids is null
     or pg_catalog.cardinality(p_media_ids) > 12
     or pg_catalog.array_position(p_media_ids, null::uuid) is not null
     or (
       select pg_catalog.count(*) <> pg_catalog.count(distinct item)
       from pg_catalog.unnest(p_media_ids) as item
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_GALLERY_INVALID';
  end if;

  perform public.brownsync_lock_org_asset_organization(p_organization_id);
  if not public.brownsync_is_org_admin(
    p_actor, p_organization_id, null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FORBIDDEN';
  end if;

  insert into public.org_media_collections (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;
  select c.revision
  into v_current_revision
  from public.org_media_collections as c
  where c.organization_id = p_organization_id
  for update;

  perform 1
  from public.org_media_assets as a
  where a.organization_id = p_organization_id
    and a.kind = 'gallery'
    and a.status = 'ready'
    and a.deleted_at is null
  order by a.position, a.id
  for update;

  select coalesce(
    pg_catalog.array_agg(a.id order by a.position, a.id),
    '{}'::uuid[]
  )
  into v_current_ids
  from public.org_media_assets as a
  where a.organization_id = p_organization_id
    and a.kind = 'gallery'
    and a.status = 'ready'
    and a.deleted_at is null;

  if v_current_ids = p_media_ids then
    return query select v_current_revision, false;
    return;
  end if;

  if pg_catalog.cardinality(v_current_ids)
       <> pg_catalog.cardinality(p_media_ids)
     or exists (
       select 1
       from pg_catalog.unnest(v_current_ids) as current_id
       where not current_id = any(p_media_ids)
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_GALLERY_INVALID';
  end if;

  if p_expected_gallery_revision is distinct from v_current_revision then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_REVISION_CONFLICT';
  end if;

  perform public.brownsync_consume_org_asset_limit(
    p_actor, 'media_hour'
  );
  v_now := pg_catalog.clock_timestamp();
  v_new_revision := v_current_revision + 1;

  set constraints all deferred;
  update public.org_media_assets as a
  set position = desired.position,
      revision = a.revision + case
        when a.position is distinct from desired.position then 1
        else 0
      end,
      updated_at = case
        when a.position is distinct from desired.position then v_now
        else a.updated_at
      end
  from (
    select item.id, item.ordinality::integer - 1 as position
    from pg_catalog.unnest(p_media_ids)
      with ordinality as item(id, ordinality)
  ) as desired
  where a.id = desired.id
    and a.organization_id = p_organization_id;

  update public.org_media_collections as c
  set revision = v_new_revision,
      updated_by = p_actor,
      updated_at = v_now
  where c.organization_id = p_organization_id;

  insert into public.org_asset_edits (
    organization_id,
    actor_user_id,
    action,
    before_state,
    after_state,
    created_at
  ) values (
    p_organization_id,
    p_actor,
    'gallery_reordered',
    pg_catalog.jsonb_build_object('media_ids', v_current_ids),
    pg_catalog.jsonb_build_object('media_ids', p_media_ids),
    v_now
  );

  return query select v_new_revision, true;
end
$$;

create function public.brownsync_claim_media_cleanup(
  p_worker_id uuid,
  p_limit integer default 100
)
returns table (
  cleanup_id uuid,
  object_path text,
  attempt_count integer,
  lease_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate record;
  v_now timestamptz;
  v_upload public.org_media_uploads%rowtype;
begin
  if p_worker_id is null
     or p_limit is null
     or p_limit not between 1 and 100 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_CLAIM_INVALID';
  end if;

  -- Keep actorless maintenance in organization -> upload order so it cannot
  -- deadlock actor continuations. The initial scan is only a locator read.
  for v_candidate in
    select u.id, u.organization_id
    from public.org_media_uploads as u
    where u.status in ('reserved', 'processing')
      and u.expires_at <= pg_catalog.clock_timestamp()
    order by u.expires_at, u.id
    limit p_limit
  loop
    perform public.brownsync_lock_org_asset_organization(
      v_candidate.organization_id
    );
    select u.*
    into v_upload
    from public.org_media_uploads as u
    where u.id = v_candidate.id
      and u.organization_id = v_candidate.organization_id
    for update;

    if found
       and v_upload.status in ('reserved', 'processing')
       and v_upload.expires_at <= pg_catalog.clock_timestamp() then
      v_now := pg_catalog.clock_timestamp();
      update public.org_media_uploads as u
      set status = 'failed',
          failure_code = 'expired',
          updated_at = v_now
      where u.id = v_upload.id;

      if v_upload.status = 'processing' then
        perform public.brownsync_enqueue_media_cleanup(
          v_upload.organization_id,
          v_upload.id,
          null,
          v_upload.object_path,
          'expired_upload'
        );
      end if;

      insert into public.org_asset_edits (
        organization_id,
        actor_user_id,
        upload_id,
        action,
        after_state,
        created_at
      ) values (
        v_upload.organization_id,
        null,
        v_upload.id,
        'media_upload_failed',
        pg_catalog.jsonb_build_object(
          'failure_code', 'expired',
          'cleanup_enqueued', v_upload.status = 'processing'
        ),
        v_now
      );
    end if;
  end loop;

  v_now := pg_catalog.clock_timestamp();
  return query
  with candidates as (
    select q.id
    from public.org_media_cleanup_queue as q
    where (
      q.status = 'pending'
      and q.next_attempt_at <= v_now
    ) or (
      q.status = 'leased'
      and q.lease_expires_at <= v_now
    )
    order by q.next_attempt_at, q.id
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.org_media_cleanup_queue as q
    set status = 'leased',
        attempt_count = q.attempt_count + 1,
        worker_id = p_worker_id,
        lease_token = pg_catalog.gen_random_uuid(),
        lease_expires_at = v_now + interval '5 minutes',
        last_disposition = null,
        last_succeeded = null,
        last_error_code = null,
        last_next_attempt_at = null,
        updated_at = v_now
    from candidates as c
    where q.id = c.id
    returning q.*
  )
  select
    claimed.id,
    claimed.object_path,
    claimed.attempt_count,
    claimed.lease_token,
    claimed.lease_expires_at
  from claimed
  order by claimed.next_attempt_at, claimed.id;
end
$$;

create function public.brownsync_complete_media_cleanup(
  p_worker_id uuid,
  p_cleanup_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_error_code text
)
returns table (
  cleanup_id uuid,
  disposition text,
  attempt_count integer,
  next_attempt_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_backoff_seconds integer;
  v_now timestamptz;
  v_queue public.org_media_cleanup_queue%rowtype;
  v_next timestamptz;
begin
  if p_worker_id is null
     or p_cleanup_id is null
     or p_lease_token is null
     or p_succeeded is null
     or (
       p_succeeded
       and p_error_code is not null
     )
     or (
       not p_succeeded
       and not public.brownsync_org_asset_error_is_normalized(p_error_code)
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FAILURE_INVALID';
  end if;

  select q.*
  into v_queue
  from public.org_media_cleanup_queue as q
  where q.id = p_cleanup_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_CLEANUP_NOT_FOUND';
  end if;

  if v_queue.worker_id = p_worker_id
     and v_queue.lease_token = p_lease_token
     and v_queue.last_disposition is not null
     and v_queue.last_succeeded is not distinct from p_succeeded
     and v_queue.last_error_code is not distinct from p_error_code then
    return query
      select
        v_queue.id,
        v_queue.last_disposition,
        v_queue.attempt_count,
        v_queue.last_next_attempt_at,
        true;
    return;
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_queue.status <> 'leased'
     or v_queue.worker_id is distinct from p_worker_id
     or v_queue.lease_token is distinct from p_lease_token
     or v_queue.lease_expires_at <= v_now then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_LEASE_CONFLICT';
  end if;

  if p_succeeded then
    update public.org_media_cleanup_queue as q
    set status = 'completed',
        next_attempt_at = v_now,
        lease_expires_at = null,
        last_disposition = 'completed',
        last_succeeded = true,
        last_error_code = null,
        last_next_attempt_at = null,
        completed_at = v_now,
        updated_at = v_now
    where q.id = v_queue.id;

    return query
      select
        v_queue.id,
        'completed'::text,
        v_queue.attempt_count,
        null::timestamptz,
        false;
  else
    v_backoff_seconds := least(
      86400,
      60 * pg_catalog.power(
        2::numeric,
        least(v_queue.attempt_count - 1, 10)
      )::integer
    );
    v_next := v_now
      + pg_catalog.make_interval(secs => v_backoff_seconds);

    update public.org_media_cleanup_queue as q
    set status = 'pending',
        next_attempt_at = v_next,
        lease_expires_at = null,
        last_disposition = 'retry_scheduled',
        last_succeeded = false,
        last_error_code = p_error_code,
        last_next_attempt_at = v_next,
        completed_at = null,
        updated_at = v_now
    where q.id = v_queue.id;

    return query
      select
        v_queue.id,
        'retry_scheduled'::text,
        v_queue.attempt_count,
        v_next,
        false;
  end if;
end
$$;

create function public.brownsync_list_org_social_posts(
  p_organization_id text
)
returns table (
  organization_id text,
  post_id uuid,
  permalink text,
  status text,
  revision bigint,
  cache_expires_at timestamptz,
  attribution text,
  embed_available boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.organizations as o
    where o.id = p_organization_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_ORGANIZATION_NOT_FOUND';
  end if;

  return query
  select
    s.organization_id,
    s.id,
    s.permalink,
    s.status,
    s.revision,
    s.cache_expires_at,
    s.attribution,
    (
      s.status = 'ready'
      and s.render_html is not null
      and s.cache_expires_at > pg_catalog.clock_timestamp()
      and coalesce(c.enabled, false)
      and (
        c.circuit_open_until is null
        or c.circuit_open_until <= pg_catalog.clock_timestamp()
      )
    )
  from public.org_social_posts as s
  left join public.org_oembed_control as c
    on c.id = true
  where s.organization_id = p_organization_id
    and s.status <> 'deleted'
    and s.deleted_at is null
  order by s.created_at, s.id;
end
$$;

create function public.brownsync_add_org_social_post(
  p_actor uuid,
  p_organization_id text,
  p_client_request_id uuid,
  p_post_id uuid,
  p_permalink text
)
returns table (
  post_id uuid,
  organization_id text,
  permalink text,
  status text,
  revision bigint,
  lease_token uuid,
  cache_expires_at timestamptz,
  attribution text,
  replayed boolean,
  refresh_required boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.org_social_posts%rowtype;
  v_lease_token uuid;
  v_mapping public.org_asset_edits%rowtype;
  v_now timestamptz;
begin
  perform public.brownsync_require_org_asset_actor(p_actor);
  if p_client_request_id is null or p_post_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_INPUT_INVALID';
  end if;
  if p_permalink is null
     or p_permalink !~
       '^https://www[.]instagram[.]com/(p|reel)/[A-Za-z0-9_-]{1,64}/$' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_PERMALINK_INVALID';
  end if;

  perform public.brownsync_lock_org_asset_organization(p_organization_id);
  if not public.brownsync_is_org_admin(
    p_actor, p_organization_id, null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FORBIDDEN';
  end if;

  select e.*
  into v_mapping
  from public.org_asset_edits as e
  where e.organization_id = p_organization_id
    and e.action = 'social_post_request_mapped'
    and e.client_request_id = p_client_request_id
  for update;
  if found then
    if v_mapping.actor_user_id is distinct from p_actor
       or v_mapping.requested_resource_id is distinct from p_post_id
       or v_mapping.after_state ->> 'permalink' is distinct from
            p_permalink then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_ASSET_REQUEST_CONFLICT';
    end if;

    select s.*
    into v_existing
    from public.org_social_posts as s
    where s.id = v_mapping.social_post_id
    for update;
    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_ASSET_REQUEST_CONFLICT';
    end if;

    if v_existing.status = 'pending'
       and (
         v_existing.refresh_lease_token is null
         or v_existing.refresh_lease_expires_at
              <= pg_catalog.clock_timestamp()
       ) then
      v_lease_token := pg_catalog.gen_random_uuid();
      update public.org_social_posts as s
      set refresh_actor_id = p_actor,
          refresh_worker_id = null,
          refresh_lease_token = v_lease_token,
          refresh_lease_expires_at =
            pg_catalog.clock_timestamp() + interval '15 minutes',
          capacity_consumed_lease_token = null,
          capacity_remaining = null,
          updated_at = pg_catalog.clock_timestamp()
      where s.id = v_existing.id;
    elsif v_existing.status = 'pending'
          and v_existing.refresh_actor_id = p_actor
          and v_existing.refresh_lease_expires_at
                > pg_catalog.clock_timestamp() then
      v_lease_token := v_existing.refresh_lease_token;
    else
      v_lease_token := null;
    end if;

    return query
      select
        v_existing.id,
        v_existing.organization_id,
        v_existing.permalink,
        v_existing.status,
        v_existing.revision,
        v_lease_token,
        v_existing.cache_expires_at,
        v_existing.attribution,
        true,
        v_lease_token is not null;
    return;
  end if;

  select s.*
  into v_existing
  from public.org_social_posts as s
  where s.organization_id = p_organization_id
    and s.client_request_id = p_client_request_id
  for update;
  if found then
    if v_existing.id <> p_post_id
       or v_existing.added_by is distinct from p_actor
       or v_existing.permalink <> p_permalink then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_ORG_ASSET_REQUEST_CONFLICT';
    end if;

    insert into public.org_asset_edits (
      organization_id,
      actor_user_id,
      social_post_id,
      client_request_id,
      requested_resource_id,
      action,
      after_state
    ) values (
      p_organization_id,
      p_actor,
      v_existing.id,
      p_client_request_id,
      p_post_id,
      'social_post_request_mapped',
      pg_catalog.jsonb_build_object('permalink', p_permalink)
    );

    if v_existing.status = 'pending'
       and (
         v_existing.refresh_lease_token is null
         or v_existing.refresh_lease_expires_at
              <= pg_catalog.clock_timestamp()
       ) then
      v_lease_token := pg_catalog.gen_random_uuid();
      update public.org_social_posts as s
      set refresh_actor_id = p_actor,
          refresh_worker_id = null,
          refresh_lease_token = v_lease_token,
          refresh_lease_expires_at =
            pg_catalog.clock_timestamp() + interval '15 minutes',
          capacity_consumed_lease_token = null,
          capacity_remaining = null,
          updated_at = pg_catalog.clock_timestamp()
      where s.id = v_existing.id;
    elsif v_existing.status = 'pending'
          and v_existing.refresh_actor_id = p_actor
          and v_existing.refresh_lease_expires_at
                > pg_catalog.clock_timestamp() then
      v_lease_token := v_existing.refresh_lease_token;
    else
      v_lease_token := null;
    end if;

    return query
      select
        v_existing.id,
        v_existing.organization_id,
        v_existing.permalink,
        v_existing.status,
        v_existing.revision,
        v_lease_token,
        v_existing.cache_expires_at,
        v_existing.attribution,
        true,
        v_lease_token is not null;
    return;
  end if;

  if exists (
    select 1
    from public.org_social_posts as s
    where s.id = p_post_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_REQUEST_CONFLICT';
  end if;

  select s.*
  into v_existing
  from public.org_social_posts as s
  where s.organization_id = p_organization_id
    and s.permalink = p_permalink
    and s.status <> 'deleted'
  for update;
  if found then
    insert into public.org_asset_edits (
      organization_id,
      actor_user_id,
      social_post_id,
      client_request_id,
      requested_resource_id,
      action,
      after_state
    ) values (
      p_organization_id,
      p_actor,
      v_existing.id,
      p_client_request_id,
      p_post_id,
      'social_post_request_mapped',
      pg_catalog.jsonb_build_object('permalink', p_permalink)
    );

    return query
      select
        v_existing.id,
        v_existing.organization_id,
        v_existing.permalink,
        v_existing.status,
        v_existing.revision,
        null::uuid,
        v_existing.cache_expires_at,
        v_existing.attribution,
        true,
        false;
    return;
  end if;

  if (
    select pg_catalog.count(*)
    from public.org_social_posts as s
    where s.organization_id = p_organization_id
      and s.status <> 'deleted'
  ) >= 12 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_GALLERY_LIMIT';
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_lease_token := pg_catalog.gen_random_uuid();
  insert into public.org_social_posts (
    id,
    organization_id,
    added_by,
    client_request_id,
    permalink,
    status,
    revision,
    next_refresh_at,
    refresh_actor_id,
    refresh_lease_token,
    refresh_lease_expires_at,
    created_at,
    updated_at
  ) values (
    p_post_id,
    p_organization_id,
    p_actor,
    p_client_request_id,
    p_permalink,
    'pending',
    0,
    v_now,
    p_actor,
    v_lease_token,
    v_now + interval '15 minutes',
    v_now,
    v_now
  );

  insert into public.org_asset_edits (
    organization_id,
    actor_user_id,
    social_post_id,
    client_request_id,
    requested_resource_id,
    action,
    after_state,
    created_at
  ) values (
    p_organization_id,
    p_actor,
    p_post_id,
    p_client_request_id,
    p_post_id,
    'social_post_request_mapped',
    pg_catalog.jsonb_build_object('permalink', p_permalink),
    v_now
  );

  perform public.brownsync_consume_org_asset_limit(
    p_actor, 'social_hour'
  );
  insert into public.org_asset_edits (
    organization_id,
    actor_user_id,
    social_post_id,
    action,
    after_state,
    created_at
  ) values (
    p_organization_id,
    p_actor,
    p_post_id,
    'social_post_added',
    pg_catalog.jsonb_build_object('permalink', p_permalink),
    v_now
  );

  return query
    select
      p_post_id,
      p_organization_id,
      p_permalink,
      'pending'::text,
      0::bigint,
      v_lease_token,
      null::timestamptz,
      null::text,
      false,
      true;
end
$$;

create function public.brownsync_begin_org_social_post_refresh(
  p_actor uuid,
  p_organization_id text,
  p_post_id uuid
)
returns table (
  post_id uuid,
  organization_id text,
  permalink text,
  status text,
  revision bigint,
  lease_token uuid,
  claimed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease_token uuid;
  v_now timestamptz;
  v_post public.org_social_posts%rowtype;
begin
  perform public.brownsync_require_org_asset_actor(p_actor);
  if p_post_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_INPUT_INVALID';
  end if;

  perform public.brownsync_lock_org_asset_organization(p_organization_id);
  if not public.brownsync_is_org_admin(
    p_actor, p_organization_id, null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FORBIDDEN';
  end if;

  select s.*
  into v_post
  from public.org_social_posts as s
  where s.id = p_post_id
    and s.organization_id = p_organization_id
  for update;
  if not found
     or v_post.status = 'deleted'
     or v_post.deleted_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_SOCIAL_POST_NOT_FOUND';
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_post.refresh_lease_token is not null
     and v_post.refresh_lease_expires_at > v_now then
    return query
      select
        v_post.id,
        v_post.organization_id,
        v_post.permalink,
        v_post.status,
        v_post.revision,
        null::uuid,
        false;
    return;
  end if;

  v_lease_token := pg_catalog.gen_random_uuid();
  update public.org_social_posts as s
  set refresh_actor_id = p_actor,
      refresh_worker_id = null,
      refresh_lease_token = v_lease_token,
      refresh_lease_expires_at = v_now + interval '15 minutes',
      capacity_consumed_lease_token = null,
      capacity_remaining = null,
      updated_at = v_now
  where s.id = v_post.id;

  return query
    select
      v_post.id,
      v_post.organization_id,
      v_post.permalink,
      v_post.status,
      v_post.revision,
      v_lease_token,
      true;
end
$$;

create function public.brownsync_finalize_org_social_post(
  p_actor uuid,
  p_post_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_render_html text,
  p_attribution text,
  p_error_code text
)
returns table (
  post_id uuid,
  organization_id text,
  permalink text,
  status text,
  revision bigint,
  cache_expires_at timestamptz,
  attribution text,
  changed boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attribution text;
  v_changed boolean;
  v_fingerprint text;
  v_new_cache_expiry timestamptz;
  v_new_revision bigint;
  v_new_status text;
  v_now timestamptz;
  v_organization_id text;
  v_post public.org_social_posts%rowtype;
begin
  if p_actor is not null then
    perform public.brownsync_require_org_asset_actor(p_actor);
  end if;
  if p_post_id is null
     or p_lease_token is null
     or p_outcome is null
     or p_outcome not in ('ready', 'link_only', 'deferred') then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_INPUT_INVALID';
  end if;

  v_attribution := case
    when p_attribution is null then null
    else pg_catalog.btrim(p_attribution)
  end;
  if p_attribution is not null
     and pg_catalog.char_length(v_attribution) not between 1 and 200 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_CACHE_INVALID';
  end if;

  if (
    p_outcome = 'ready'
    and (
      p_render_html is null
      or pg_catalog.char_length(p_render_html) not between 1 and 50000
      or p_error_code is not null
    )
  ) or (
    p_outcome in ('link_only', 'deferred')
    and (
      p_render_html is not null
      or not public.brownsync_org_asset_error_is_normalized(p_error_code)
    )
  ) or (
    p_outcome = 'deferred'
    and p_attribution is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_CACHE_INVALID';
  end if;

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_array(
      p_outcome,
      p_render_html,
      v_attribution,
      p_error_code
    )::text
  );

  select s.organization_id
  into v_organization_id
  from public.org_social_posts as s
  where s.id = p_post_id;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_SOCIAL_POST_NOT_FOUND';
  end if;

  perform public.brownsync_lock_org_asset_organization(v_organization_id);
  select s.*
  into v_post
  from public.org_social_posts as s
  where s.id = p_post_id
    and s.organization_id = v_organization_id
  for update;
  if not found
     or v_post.status = 'deleted'
     or v_post.deleted_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_SOCIAL_POST_NOT_FOUND';
  end if;

  if p_actor is not null
     and not public.brownsync_is_org_admin(
       p_actor, v_organization_id, null
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FORBIDDEN';
  end if;

  if v_post.last_finalized_lease_token = p_lease_token then
    if v_post.last_finalize_fingerprint = v_fingerprint then
      return query
        select
          v_post.id,
          v_post.organization_id,
          v_post.permalink,
          v_post.status,
          v_post.revision,
          v_post.cache_expires_at,
          v_post.attribution,
          false,
          true;
      return;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FINALIZATION_CONFLICT';
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_post.refresh_lease_token is distinct from p_lease_token
     or v_post.refresh_lease_expires_at <= v_now
     or (
       p_actor is not null
       and v_post.refresh_actor_id is distinct from p_actor
     )
     or (
       p_actor is null
       and v_post.refresh_worker_id is null
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_LEASE_CONFLICT';
  end if;

  if p_outcome = 'ready' then
    v_new_status := 'ready';
    v_new_cache_expiry := v_now + interval '24 hours';
    v_changed := true;
  elsif p_outcome = 'link_only' then
    v_new_status := 'link_only';
    v_new_cache_expiry := null;
    v_changed := v_post.status <> 'link_only'
      or v_post.render_html is not null
      or v_post.cache_expires_at is not null
      or v_post.attribution is distinct from v_attribution;
  else
    v_new_status := v_post.status;
    v_new_cache_expiry := v_post.cache_expires_at;
    v_changed := false;
  end if;

  v_new_revision := v_post.revision
    + case when v_changed then 1 else 0 end;

  update public.org_social_posts as s
  set status = v_new_status,
      revision = v_new_revision,
      render_html = case
        when p_outcome = 'ready' then p_render_html
        when p_outcome = 'link_only' then null
        else s.render_html
      end,
      cache_expires_at = v_new_cache_expiry,
      attribution = case
        when p_outcome in ('ready', 'link_only') then v_attribution
        else s.attribution
      end,
      last_error_code = case
        when p_outcome = 'ready' then null
        else p_error_code
      end,
      next_refresh_at = case
        when p_outcome = 'ready' then v_new_cache_expiry
        when p_outcome = 'link_only' then v_now + interval '1 hour'
        else v_now + interval '15 minutes'
      end,
      refresh_actor_id = null,
      refresh_worker_id = null,
      refresh_lease_token = null,
      refresh_lease_expires_at = null,
      last_finalized_lease_token = p_lease_token,
      last_finalize_fingerprint = v_fingerprint,
      updated_at = v_now
  where s.id = v_post.id;

  if v_changed then
    insert into public.org_asset_edits (
      organization_id,
      actor_user_id,
      social_post_id,
      action,
      before_state,
      after_state,
      created_at
    ) values (
      v_post.organization_id,
      p_actor,
      v_post.id,
      'social_post_finalized',
      pg_catalog.jsonb_build_object(
        'status', v_post.status,
        'revision', v_post.revision
      ),
      pg_catalog.jsonb_build_object(
        'status', v_new_status,
        'revision', v_new_revision,
        'cache_expires_at', v_new_cache_expiry
      ),
      v_now
    );
  end if;

  return query
    select
      v_post.id,
      v_post.organization_id,
      v_post.permalink,
      v_new_status,
      v_new_revision,
      v_new_cache_expiry,
      case
        when p_outcome in ('ready', 'link_only') then v_attribution
        else v_post.attribution
      end,
      v_changed,
      false;
end
$$;

create function public.brownsync_delete_org_social_post(
  p_actor uuid,
  p_organization_id text,
  p_post_id uuid,
  p_expected_revision bigint
)
returns table (
  post_id uuid,
  revision bigint,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_revision bigint;
  v_now timestamptz;
  v_post public.org_social_posts%rowtype;
begin
  perform public.brownsync_require_org_asset_actor(p_actor);
  if p_post_id is null
     or p_expected_revision is null
     or p_expected_revision < 0 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_INPUT_INVALID';
  end if;

  perform public.brownsync_lock_org_asset_organization(p_organization_id);
  if not public.brownsync_is_org_admin(
    p_actor, p_organization_id, null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_FORBIDDEN';
  end if;

  select s.*
  into v_post
  from public.org_social_posts as s
  where s.id = p_post_id
    and s.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_SOCIAL_POST_NOT_FOUND';
  end if;

  if v_post.status = 'deleted' and v_post.deleted_at is not null then
    return query select v_post.id, v_post.revision, false;
    return;
  end if;
  if p_expected_revision is distinct from v_post.revision then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_REVISION_CONFLICT';
  end if;

  perform public.brownsync_consume_org_asset_limit(
    p_actor, 'social_hour'
  );
  v_now := pg_catalog.clock_timestamp();
  v_new_revision := v_post.revision + 1;
  update public.org_social_posts as s
  set status = 'deleted',
      revision = v_new_revision,
      render_html = null,
      cache_expires_at = null,
      attribution = null,
      last_error_code = null,
      refresh_actor_id = null,
      refresh_worker_id = null,
      refresh_lease_token = null,
      refresh_lease_expires_at = null,
      capacity_consumed_lease_token = null,
      capacity_remaining = null,
      deleted_by = p_actor,
      deleted_at = v_now,
      updated_at = v_now
  where s.id = v_post.id;

  insert into public.org_asset_edits (
    organization_id,
    actor_user_id,
    social_post_id,
    action,
    before_state,
    after_state,
    created_at
  ) values (
    p_organization_id,
    p_actor,
    v_post.id,
    'social_post_deleted',
    pg_catalog.jsonb_build_object(
      'status', v_post.status,
      'revision', v_post.revision,
      'permalink', v_post.permalink
    ),
    '{}'::jsonb,
    v_now
  );

  return query select v_post.id, v_new_revision, true;
end
$$;

create function public.brownsync_claim_due_instagram_posts(
  p_worker_id uuid,
  p_limit integer default 100
)
returns table (
  post_id uuid,
  organization_id text,
  permalink text,
  revision bigint,
  lease_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
begin
  if p_worker_id is null
     or p_limit is null
     or p_limit not between 1 and 100 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_CLAIM_INVALID';
  end if;

  v_now := pg_catalog.clock_timestamp();
  return query
  with candidates as (
    select s.id
    from public.org_social_posts as s
    where s.status in ('pending', 'ready', 'link_only')
      and s.deleted_at is null
      and s.next_refresh_at <= v_now
      and (
        s.refresh_lease_token is null
        or s.refresh_lease_expires_at <= v_now
      )
    order by s.next_refresh_at, s.id
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.org_social_posts as s
    set refresh_actor_id = null,
        refresh_worker_id = p_worker_id,
        refresh_lease_token = pg_catalog.gen_random_uuid(),
        refresh_lease_expires_at = v_now + interval '15 minutes',
        capacity_consumed_lease_token = null,
        capacity_remaining = null,
        updated_at = v_now
    from candidates as c
    where s.id = c.id
    returning s.*
  )
  select
    claimed.id,
    claimed.organization_id,
    claimed.permalink,
    claimed.revision,
    claimed.refresh_lease_token,
    claimed.refresh_lease_expires_at
  from claimed
  order by claimed.next_refresh_at, claimed.id;
end
$$;

create function public.brownsync_consume_oembed_capacity(
  p_post_id uuid,
  p_lease_token uuid
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control public.org_oembed_control%rowtype;
  v_now timestamptz;
  v_post public.org_social_posts%rowtype;
  v_remaining integer;
  v_retry integer;
begin
  if p_post_id is null or p_lease_token is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_CLAIM_INVALID';
  end if;

  select s.*
  into v_post
  from public.org_social_posts as s
  where s.id = p_post_id
  for update;
  if not found
     or v_post.status in ('disabled', 'deleted')
     or v_post.deleted_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_SOCIAL_POST_NOT_FOUND';
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_post.refresh_lease_token is distinct from p_lease_token
     or v_post.refresh_lease_expires_at <= v_now then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_ORG_ASSET_LEASE_CONFLICT';
  end if;

  if v_post.capacity_consumed_lease_token = p_lease_token then
    return query
      select true, v_post.capacity_remaining, 0;
    return;
  end if;

  select c.*
  into v_control
  from public.org_oembed_control as c
  where c.id = true
  for update;
  if not found then
    return query select false, 0, 3600;
    return;
  end if;

  if v_now >= v_control.window_started_at + interval '1 hour' then
    update public.org_oembed_control as c
    set window_started_at = v_now,
        request_count = 0,
        updated_at = v_now
    where c.id = true;
    v_control.window_started_at := v_now;
    v_control.request_count := 0;
  end if;

  v_remaining := greatest(
    0, 900 - v_control.request_count
  );
  if not v_control.enabled then
    return query select false, v_remaining, 3600;
    return;
  end if;
  if v_control.circuit_open_until is not null
     and v_control.circuit_open_until > v_now then
    v_retry := greatest(
      1,
      pg_catalog.ceil(
        extract(epoch from (v_control.circuit_open_until - v_now))
      )::integer
    );
    return query select false, v_remaining, v_retry;
    return;
  end if;
  if v_control.request_count >= 900 then
    v_retry := greatest(
      1,
      pg_catalog.ceil(
        extract(
          epoch from (
            v_control.window_started_at + interval '1 hour' - v_now
          )
        )
      )::integer
    );
    return query select false, 0, v_retry;
    return;
  end if;

  update public.org_oembed_control as c
  set request_count = c.request_count + 1,
      updated_at = v_now
  where c.id = true
  returning 900 - c.request_count into v_remaining;

  update public.org_social_posts as s
  set capacity_consumed_lease_token = p_lease_token,
      capacity_remaining = v_remaining,
      updated_at = v_now
  where s.id = v_post.id;

  return query select true, v_remaining, 0;
end
$$;

create function public.brownsync_get_org_social_embed(
  p_post_id uuid
)
returns table (
  post_id uuid,
  permalink text,
  render_html text,
  revision bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.permalink,
    s.render_html,
    s.revision
  from public.org_social_posts as s
  join public.org_oembed_control as c
    on c.id = true
  where s.id = p_post_id
    and s.status = 'ready'
    and s.deleted_at is null
    and s.render_html is not null
    and s.cache_expires_at > pg_catalog.clock_timestamp()
    and c.enabled
    and (
      c.circuit_open_until is null
      or c.circuit_open_until <= pg_catalog.clock_timestamp()
    )
$$;

-- auth.users deletion cascades to profiles. This BEFORE DELETE trigger
-- converts live personal claims while the profile still exists, then clears
-- attribution. Organization-owned ready assets and fresh social caches remain.
create function public.brownsync_org_assets_before_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  with failed as (
    update public.org_media_uploads as u
    set status = 'failed',
        failure_code = 'account_deleted',
        actor_user_id = null,
        updated_at = v_now
    where u.actor_user_id = old.id
      and u.status = 'processing'
    returning u.id, u.organization_id, u.object_path
  )
  insert into public.org_media_cleanup_queue (
    organization_id,
    upload_id,
    object_path,
    reason,
    next_attempt_at,
    created_at,
    updated_at
  )
  select
    failed.organization_id,
    failed.id,
    failed.object_path,
    'account_deleted',
    v_now,
    v_now,
    v_now
  from failed
  on conflict (object_path) do nothing;

  update public.org_media_uploads as u
  set status = 'failed',
      failure_code = 'account_deleted',
      actor_user_id = null,
      updated_at = v_now
  where u.actor_user_id = old.id
    and u.status = 'reserved';

  update public.org_media_uploads as u
  set actor_user_id = null
  where u.actor_user_id = old.id;

  update public.org_media_assets as a
  set created_by = case
        when a.created_by = old.id then null
        else a.created_by
      end,
      deleted_by = case
        when a.deleted_by = old.id then null
        else a.deleted_by
      end
  where a.created_by = old.id
     or a.deleted_by = old.id;

  update public.org_media_collections as c
  set updated_by = null
  where c.updated_by = old.id;

  -- A pending card has no cache worth preserving. Existing ready/link-only
  -- organization content survives; only actor-owned refresh claims are lost.
  update public.org_social_posts as s
  set status = 'link_only',
      revision = s.revision + 1,
      render_html = null,
      cache_expires_at = null,
      attribution = null,
      last_error_code = 'account_deleted',
      next_refresh_at = v_now + interval '1 hour',
      refresh_actor_id = null,
      refresh_worker_id = null,
      refresh_lease_token = null,
      refresh_lease_expires_at = null,
      capacity_consumed_lease_token = null,
      capacity_remaining = null,
      added_by = case
        when s.added_by = old.id then null
        else s.added_by
      end,
      updated_at = v_now
  where (s.added_by = old.id or s.refresh_actor_id = old.id)
    and s.status = 'pending';

  update public.org_social_posts as s
  set added_by = case
        when s.added_by = old.id then null
        else s.added_by
      end,
      deleted_by = case
        when s.deleted_by = old.id then null
        else s.deleted_by
      end,
      refresh_actor_id = case
        when s.refresh_actor_id = old.id then null
        else s.refresh_actor_id
      end,
      refresh_worker_id = case
        when s.refresh_actor_id = old.id then null
        else s.refresh_worker_id
      end,
      refresh_lease_token = case
        when s.refresh_actor_id = old.id then null
        else s.refresh_lease_token
      end,
      refresh_lease_expires_at = case
        when s.refresh_actor_id = old.id then null
        else s.refresh_lease_expires_at
      end,
      capacity_consumed_lease_token = case
        when s.refresh_actor_id = old.id then null
        else s.capacity_consumed_lease_token
      end,
      capacity_remaining = case
        when s.refresh_actor_id = old.id then null
        else s.capacity_remaining
      end
  where s.added_by = old.id
     or s.deleted_by = old.id
     or s.refresh_actor_id = old.id;

  update public.org_asset_edits as e
  set actor_user_id = null
  where e.actor_user_id = old.id;

  delete from public.org_asset_mutation_limits
  where user_id = old.id;

  return old;
end
$$;

create trigger brownsync_org_assets_before_profile_delete
  before delete on public.profiles
  for each row execute function
    public.brownsync_org_assets_before_profile_delete();

revoke all on table
  public.org_media_collections,
  public.org_media_uploads,
  public.org_media_assets,
  public.org_media_cleanup_queue,
  public.org_social_posts,
  public.org_asset_mutation_limits,
  public.org_oembed_control,
  public.org_asset_edits
from public, anon, authenticated;

revoke all on function public.brownsync_require_org_asset_actor(uuid)
  from public, anon, authenticated;
revoke all on function
  public.brownsync_lock_org_asset_organization(text)
  from public, anon, authenticated;
revoke all on function
  public.brownsync_consume_org_asset_limit(uuid, text)
  from public, anon, authenticated;
revoke all on function public.brownsync_enqueue_media_cleanup(
  text, uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function
  public.brownsync_org_asset_error_is_normalized(text)
  from public, anon, authenticated;
revoke all on function
  public.brownsync_org_assets_before_profile_delete()
  from public, anon, authenticated;

revoke all on function public.brownsync_get_org_media(text)
  from public, anon, authenticated;
revoke all on function public.brownsync_reserve_org_media_upload(
  uuid, text, uuid, uuid, text, text, bigint, bigint, text
) from public, anon, authenticated;
revoke all on function
  public.brownsync_begin_org_media_upload(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.brownsync_finalize_org_media_upload(
  uuid, uuid, uuid, text, integer, integer, integer
) from public, anon, authenticated;
revoke all on function public.brownsync_fail_org_media_upload(
  uuid, uuid, text, boolean
) from public, anon, authenticated;
revoke all on function public.brownsync_delete_org_media(
  uuid, text, uuid, bigint
) from public, anon, authenticated;
revoke all on function public.brownsync_reorder_org_gallery(
  uuid, text, bigint, uuid[]
) from public, anon, authenticated;
revoke all on function public.brownsync_claim_media_cleanup(
  uuid, integer
) from public, anon, authenticated;
revoke all on function public.brownsync_complete_media_cleanup(
  uuid, uuid, uuid, boolean, text
) from public, anon, authenticated;
revoke all on function public.brownsync_list_org_social_posts(text)
  from public, anon, authenticated;
revoke all on function public.brownsync_add_org_social_post(
  uuid, text, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function
  public.brownsync_begin_org_social_post_refresh(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.brownsync_finalize_org_social_post(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.brownsync_delete_org_social_post(
  uuid, text, uuid, bigint
) from public, anon, authenticated;
revoke all on function public.brownsync_claim_due_instagram_posts(
  uuid, integer
) from public, anon, authenticated;
revoke all on function public.brownsync_consume_oembed_capacity(
  uuid, uuid
) from public, anon, authenticated;
revoke all on function public.brownsync_get_org_social_embed(uuid)
  from public, anon, authenticated;

commit;
