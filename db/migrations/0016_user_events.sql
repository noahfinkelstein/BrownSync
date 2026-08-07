-- 0016_user_events.sql — authenticated student-created events.
--
-- Product writes enter through owner-only SECURITY DEFININER routines called
-- by the verified Worker. Direct client access is read-only, column-limited,
-- and protected by RLS. The singleton control is deliberately locked with
-- FOR SHARE by enabling writes so a concurrent disabling UPDATE is a barrier.

begin;

-- The legacy resolver contains unqualified references from before hardened
-- callers used an empty path. Pin it to built-ins first and a non-writable
-- public schema second, then keep every new SECURITY DEFINER path empty.
revoke create on schema public from public, anon, authenticated;
alter function public.resolve_place(text)
  set search_path = pg_catalog, public;

create table public.user_event_controls (
  id              boolean primary key default true,
  posting_enabled boolean not null default true,
  updated_by      uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null default pg_catalog.clock_timestamp(),
  constraint user_event_controls_singleton_ck check (id),
  constraint user_event_controls_updated_at_ck
    check (pg_catalog.isfinite(updated_at))
);

insert into public.user_event_controls default values;

create table public.user_event_create_limits (
  user_id           uuid primary key
                      references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null
                      default pg_catalog.clock_timestamp(),
  count             integer not null default 1,
  updated_at        timestamptz not null
                      default pg_catalog.clock_timestamp(),
  constraint user_event_create_limits_count_ck
    check (count between 1 and 10),
  constraint user_event_create_limits_time_ck check (
    pg_catalog.isfinite(window_started_at)
    and pg_catalog.isfinite(updated_at)
  )
);

create table public.user_events (
  id                  uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id     text
                        references public.organizations(id) on delete cascade,
  created_by           uuid
                        references public.profiles(id) on delete set null,
  client_request_id    uuid not null,
  payload_fingerprint  text not null,
  title                text not null,
  description          text,
  start_ts             timestamptz not null,
  end_ts               timestamptz,
  place_id              text not null
                        references public.places(id) on delete no action,
  location_raw         text,
  category             text not null,
  url                  text,
  status               text not null default 'draft',
  moderation_state     text not null default 'active',
  revision             bigint not null default 0,
  updated_by           uuid
                        references public.profiles(id) on delete set null,
  deleted_by           uuid
                        references public.profiles(id) on delete set null,
  deleted_at           timestamptz,
  moderated_by         uuid
                        references public.profiles(id) on delete set null,
  moderated_at         timestamptz,
  created_at           timestamptz not null
                        default pg_catalog.clock_timestamp(),
  updated_at           timestamptz not null
                        default pg_catalog.clock_timestamp(),
  constraint user_events_fingerprint_ck check (
    payload_fingerprint ~ '^[0-9a-f]{32}$'
  ),
  constraint user_events_title_ck check (
    pg_catalog.char_length(title) between 1 and 200
    and title = pg_catalog.btrim(title)
  ),
  constraint user_events_description_ck check (
    description is null
    or pg_catalog.char_length(description) <= 10000
  ),
  constraint user_events_time_ck check (
    pg_catalog.isfinite(start_ts)
    and (
      end_ts is null
      or (
        pg_catalog.isfinite(end_ts)
        and end_ts > start_ts
      )
    )
  ),
  constraint user_events_location_raw_ck check (
    location_raw is null
    or (
      pg_catalog.char_length(location_raw) between 1 and 500
      and location_raw = pg_catalog.btrim(location_raw)
    )
  ),
  constraint user_events_category_ck check (
    category in (
      'academic',
      'class',
      'club',
      'arts',
      'athletics',
      'food',
      'social',
      'career',
      'wellness',
      'admin'
    )
  ),
  constraint user_events_url_ck check (
    url is null
    or (
      pg_catalog.char_length(url) <= 2048
      and url = pg_catalog.btrim(url)
      and url ~ '^https://[^[:space:]]+$'
    )
  ),
  constraint user_events_status_ck
    check (status in ('draft', 'published', 'canceled')),
  constraint user_events_moderation_state_ck
    check (moderation_state in ('active', 'hidden')),
  constraint user_events_revision_ck check (revision >= 0),
  constraint user_events_soft_delete_ck check (
    (status = 'canceled') = (deleted_at is not null)
  ),
  constraint user_events_attribution_ck check (
    organization_id is not null
    or created_by is not null
    or (status = 'canceled' and deleted_at is not null)
  ),
  constraint user_events_audit_time_ck check (
    pg_catalog.isfinite(created_at)
    and pg_catalog.isfinite(updated_at)
    and (
      deleted_at is null
      or pg_catalog.isfinite(deleted_at)
    )
    and (
      moderated_at is null
      or pg_catalog.isfinite(moderated_at)
    )
  )
);

create unique index user_events_creator_request_uidx
  on public.user_events (created_by, client_request_id)
  where created_by is not null;

create index user_events_management_idx
  on public.user_events (updated_at desc, id desc);

create index user_events_public_idx
  on public.user_events (start_ts, id)
  where status = 'published'
    and moderation_state = 'active'
    and deleted_at is null;

create index user_events_organization_idx
  on public.user_events (organization_id, updated_at desc, id desc)
  where organization_id is not null;

create index user_events_updated_by_idx
  on public.user_events (updated_by)
  where updated_by is not null;

create index user_events_deleted_by_idx
  on public.user_events (deleted_by)
  where deleted_by is not null;

create index user_events_moderated_by_idx
  on public.user_events (moderated_by)
  where moderated_by is not null;

alter table public.user_events enable row level security;
alter table public.user_event_controls enable row level security;
alter table public.user_event_create_limits enable row level security;

-- Translate the organization subsystem's admission error into this API
-- family's stable namespace while retaining its auth.users -> profiles locks.
create function public.brownsync_require_user_event_actor(p_actor uuid)
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
          message = 'BROWNSYNC_USER_EVENT_UNAUTHORIZED';
      end if;
      raise;
  end;
end
$$;

create function public.brownsync_lock_user_event_control()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  select c.posting_enabled
  into v_enabled
  from public.user_event_controls as c
  where c.id = true
  for share;

  return coalesce(v_enabled, false);
end
$$;

-- This non-locking, fail-closed helper is the only control-state surface
-- available to client RLS policies.
create function public.brownsync_user_event_posting_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.posting_enabled
    from public.user_event_controls as c
    where c.id = true
  ), false)
$$;

-- Canonical fingerprints use epoch values for timestamptz fields, avoiding
-- TimeZone-dependent textual representations.
create function public.brownsync_user_event_fingerprint(
  p_client_request_id uuid,
  p_organization_id text,
  p_title text,
  p_description text,
  p_start_ts timestamptz,
  p_end_ts timestamptz,
  p_category text,
  p_url text,
  p_place_id text,
  p_location_raw text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select pg_catalog.md5(
    pg_catalog.jsonb_build_array(
      p_client_request_id::text,
      nullif(pg_catalog.btrim(p_organization_id), ''),
      pg_catalog.btrim(p_title),
      p_description,
      extract(epoch from p_start_ts),
      extract(epoch from p_end_ts),
      pg_catalog.btrim(p_category),
      nullif(pg_catalog.btrim(p_url), ''),
      nullif(pg_catalog.btrim(p_place_id), ''),
      nullif(pg_catalog.btrim(p_location_raw), '')
    )::text
  )
$$;

-- Called only after an event row has been inserted. Lock order is therefore
-- event -> counter, and a failed quota increment rolls the event back too.
create function public.brownsync_consume_user_event_create_limit(
  p_actor uuid,
  p_observed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_inserted boolean := false;
  v_now timestamptz;
  v_window_started_at timestamptz;
begin
  if p_actor is null then
    return;
  end if;

  v_now := coalesce(p_observed_at, pg_catalog.clock_timestamp());
  insert into public.user_event_create_limits (
    user_id,
    window_started_at,
    count,
    updated_at
  ) values (
    p_actor,
    v_now,
    1,
    v_now
  )
  on conflict (user_id) do nothing
  returning true into v_inserted;

  if coalesce(v_inserted, false) then
    return;
  end if;

  select l.window_started_at, l.count
  into v_window_started_at, v_count
  from public.user_event_create_limits as l
  where l.user_id = p_actor
  for update;

  v_now := pg_catalog.clock_timestamp();
  if v_now >= v_window_started_at + interval '24 hours' then
    update public.user_event_create_limits
    set window_started_at = v_now,
        count = 1,
        updated_at = v_now
    where user_id = p_actor;
  elsif v_count >= 10 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_RATE_LIMITED';
  else
    update public.user_event_create_limits
    set count = count + 1,
        updated_at = v_now
    where user_id = p_actor;
  end if;
end
$$;

create function public.brownsync_user_event_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    perform public.brownsync_consume_user_event_create_limit(
      new.created_by,
      new.created_at
    );
  end if;
  return new;
end
$$;

create trigger brownsync_user_event_consume_create_limit
  after insert on public.user_events
  for each row execute function public.brownsync_user_event_after_insert();

create function public.brownsync_create_user_event(
  p_actor uuid,
  p_client_request_id uuid,
  p_organization_id text,
  p_title text,
  p_description text,
  p_start_ts timestamptz,
  p_end_ts timestamptz,
  p_category text,
  p_url text,
  p_place_id text,
  p_location_raw text
)
returns table (
  event_id uuid,
  revision bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_description text;
  v_enabled boolean;
  v_existing public.user_events%rowtype;
  v_fingerprint text;
  v_location_raw text;
  v_now timestamptz;
  v_organization_id text;
  v_place_id text;
  v_resolved_place_id text;
  v_title text;
  v_url text;
  v_inserted_id uuid;
begin
  perform public.brownsync_require_user_event_actor(p_actor);

  v_organization_id := nullif(pg_catalog.btrim(p_organization_id), '');
  v_title := pg_catalog.btrim(p_title);
  v_description := p_description;
  v_url := case
    when p_url is null then null
    else pg_catalog.btrim(p_url)
  end;
  v_place_id := nullif(pg_catalog.btrim(p_place_id), '');
  v_location_raw := nullif(pg_catalog.btrim(p_location_raw), '');

  if p_client_request_id is null
     or v_title is null
     or pg_catalog.char_length(v_title) not between 1 and 200
     or pg_catalog.char_length(v_description) > 10000
     or p_start_ts is null
     or not pg_catalog.isfinite(p_start_ts)
     or (
       p_end_ts is not null
       and (
         not pg_catalog.isfinite(p_end_ts)
         or p_end_ts <= p_start_ts
       )
     )
     or p_category is null
     or pg_catalog.btrim(p_category) not in (
       'academic',
       'class',
       'club',
       'arts',
       'athletics',
       'food',
       'social',
       'career',
       'wellness',
       'admin'
     )
     or (
       v_url is not null
       and (
         pg_catalog.char_length(v_url) > 2048
         or v_url !~ '^https://[^[:space:]]+$'
       )
     )
     or (
       v_location_raw is not null
       and pg_catalog.char_length(v_location_raw) > 500
     )
     or ((v_place_id is null) = (v_location_raw is null)) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_INPUT_INVALID';
  end if;

  v_fingerprint := public.brownsync_user_event_fingerprint(
    p_client_request_id,
    v_organization_id,
    v_title,
    v_description,
    p_start_ts,
    p_end_ts,
    pg_catalog.btrim(p_category),
    v_url,
    v_place_id,
    v_location_raw
  );

  select e.*
  into v_existing
  from public.user_events as e
  where e.created_by = p_actor
    and e.client_request_id = p_client_request_id
  for update;

  if found then
    if v_existing.payload_fingerprint <> v_fingerprint then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_USER_EVENT_REQUEST_CONFLICT';
    end if;
    return query
      select v_existing.id, v_existing.revision, true;
    return;
  end if;

  v_enabled := public.brownsync_lock_user_event_control();

  if v_organization_id is not null then
    perform 1
    from public.organizations as o
    where o.id = v_organization_id
    for update;
    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_USER_EVENT_ORGANIZATION_NOT_FOUND';
    end if;
  end if;

  if not v_enabled then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_POSTING_DISABLED';
  end if;

  if v_organization_id is null then
    v_now := pg_catalog.clock_timestamp();
    if not exists (
      select 1
      from public.profiles as p
      where p.id = p_actor
        and v_now >= p.created_at + interval '24 hours'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_USER_EVENT_ACCOUNT_TOO_NEW';
    end if;
  elsif not public.brownsync_is_org_admin(
    p_actor,
    v_organization_id,
    null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_FORBIDDEN';
  end if;

  if v_place_id is not null then
    perform 1
    from public.places as p
    where p.id = v_place_id
    for key share;
    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_USER_EVENT_PLACE_NOT_FOUND';
    end if;
  else
    select r.place_id
    into v_resolved_place_id
    from public.resolve_place(v_location_raw) as r;
    if v_resolved_place_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_USER_EVENT_LOCATION_UNRESOLVED';
    end if;
    v_place_id := v_resolved_place_id;
    perform 1
    from public.places as p
    where p.id = v_place_id
    for key share;
    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_USER_EVENT_LOCATION_UNRESOLVED';
    end if;
  end if;

  v_now := pg_catalog.clock_timestamp();
  insert into public.user_events (
    organization_id,
    created_by,
    client_request_id,
    payload_fingerprint,
    title,
    description,
    start_ts,
    end_ts,
    place_id,
    location_raw,
    category,
    url,
    status,
    moderation_state,
    revision,
    updated_by,
    created_at,
    updated_at
  ) values (
    v_organization_id,
    p_actor,
    p_client_request_id,
    v_fingerprint,
    v_title,
    v_description,
    p_start_ts,
    p_end_ts,
    v_place_id,
    v_location_raw,
    pg_catalog.btrim(p_category),
    v_url,
    'published',
    'active',
    0,
    p_actor,
    v_now,
    v_now
  )
  on conflict (created_by, client_request_id)
    where created_by is not null
  do nothing
  returning id into v_inserted_id;

  if v_inserted_id is not null then
    return query select v_inserted_id, 0::bigint, false;
    return;
  end if;

  -- A concurrent request with the same partial-unique key committed first.
  select e.*
  into v_existing
  from public.user_events as e
  where e.created_by = p_actor
    and e.client_request_id = p_client_request_id
  for update;

  if not found or v_existing.payload_fingerprint <> v_fingerprint then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_REQUEST_CONFLICT';
  end if;

  return query select v_existing.id, v_existing.revision, true;
end
$$;

create function public.brownsync_edit_user_event(
  p_actor uuid,
  p_event_id uuid,
  p_expected_revision bigint,
  p_patch jsonb
)
returns table (
  event_id uuid,
  revision bigint,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category text;
  v_description text;
  v_enabled boolean;
  v_end_ts timestamptz;
  v_event public.user_events%rowtype;
  v_location_raw text;
  v_now timestamptz;
  v_organization_id text;
  v_place_id text;
  v_resolved_place_id text;
  v_start_ts timestamptz;
  v_title text;
  v_url text;
begin
  perform public.brownsync_require_user_event_actor(p_actor);
  v_enabled := public.brownsync_lock_user_event_control();

  if p_event_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_NOT_FOUND';
  end if;

  select e.organization_id
  into v_organization_id
  from public.user_events as e
  where e.id = p_event_id;

  if found and v_organization_id is not null then
    perform 1
    from public.organizations as o
    where o.id = v_organization_id
    for update;
  end if;

  select e.*
  into v_event
  from public.user_events as e
  where e.id = p_event_id
  for update;

  if not found
     or v_event.status = 'canceled'
     or v_event.deleted_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_NOT_FOUND';
  end if;

  if v_event.created_by is distinct from p_actor
     and (
       v_event.organization_id is null
       or not public.brownsync_is_org_admin(
         p_actor,
         v_event.organization_id,
         null
       )
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_FORBIDDEN';
  end if;

  if p_expected_revision is null
     or p_expected_revision < 0
     or p_patch is null
     or pg_catalog.jsonb_typeof(p_patch) <> 'object'
     or p_patch = '{}'::jsonb
     or (
       p_patch - array[
         'title',
         'description',
         'start_ts',
         'end_ts',
         'category',
         'url',
         'place_id',
         'location_raw'
       ]::text[]
     ) <> '{}'::jsonb
     or (
       p_patch ? 'place_id'
       and p_patch ? 'location_raw'
     )
     or (
       p_patch ? 'title'
       and pg_catalog.jsonb_typeof(p_patch -> 'title') <> 'string'
     )
     or (
       p_patch ? 'description'
       and pg_catalog.jsonb_typeof(p_patch -> 'description')
             not in ('string', 'null')
     )
     or (
       p_patch ? 'start_ts'
       and pg_catalog.jsonb_typeof(p_patch -> 'start_ts') <> 'string'
     )
     or (
       p_patch ? 'end_ts'
       and pg_catalog.jsonb_typeof(p_patch -> 'end_ts')
             not in ('string', 'null')
     )
     or (
       p_patch ? 'category'
       and pg_catalog.jsonb_typeof(p_patch -> 'category') <> 'string'
     )
     or (
       p_patch ? 'url'
       and pg_catalog.jsonb_typeof(p_patch -> 'url')
             not in ('string', 'null')
     )
     or (
       p_patch ? 'place_id'
       and pg_catalog.jsonb_typeof(p_patch -> 'place_id') <> 'string'
     )
     or (
       p_patch ? 'location_raw'
       and pg_catalog.jsonb_typeof(p_patch -> 'location_raw') <> 'string'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_PATCH_INVALID';
  end if;

  v_title := case
    when p_patch ? 'title' then pg_catalog.btrim(p_patch ->> 'title')
    else v_event.title
  end;
  v_description := case
    when p_patch ? 'description'
      then p_patch ->> 'description'
    else v_event.description
  end;
  v_category := case
    when p_patch ? 'category'
      then p_patch ->> 'category'
    else v_event.category
  end;
  v_url := case
    when p_patch ? 'url'
      then case
        when pg_catalog.jsonb_typeof(p_patch -> 'url') = 'null' then null
        else pg_catalog.btrim(p_patch ->> 'url')
      end
    else v_event.url
  end;

  begin
    v_start_ts := case
      when p_patch ? 'start_ts'
        then (p_patch ->> 'start_ts')::timestamptz
      else v_event.start_ts
    end;
    v_end_ts := case
      when p_patch ? 'end_ts'
        then (p_patch ->> 'end_ts')::timestamptz
      else v_event.end_ts
    end;
  exception
    when invalid_datetime_format
      or datetime_field_overflow
      or invalid_text_representation then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_USER_EVENT_PATCH_INVALID';
  end;

  if v_title is null
     or pg_catalog.char_length(v_title) not between 1 and 200
     or pg_catalog.char_length(v_description) > 10000
     or v_start_ts is null
     or not pg_catalog.isfinite(v_start_ts)
     or (
       v_end_ts is not null
       and (
         not pg_catalog.isfinite(v_end_ts)
         or v_end_ts <= v_start_ts
       )
     )
     or v_category is null
     or v_category not in (
       'academic',
       'class',
       'club',
       'arts',
       'athletics',
       'food',
       'social',
       'career',
       'wellness',
       'admin'
     )
     or (
       v_url is not null
       and (
         pg_catalog.char_length(v_url) > 2048
         or v_url !~ '^https://[^[:space:]]+$'
       )
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_PATCH_INVALID';
  end if;

  v_place_id := v_event.place_id;
  v_location_raw := v_event.location_raw;

  if p_patch ? 'place_id' then
    v_place_id := nullif(pg_catalog.btrim(p_patch ->> 'place_id'), '');
    v_location_raw := null;
    if v_place_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_USER_EVENT_PATCH_INVALID';
    end if;
    perform 1
    from public.places as p
    where p.id = v_place_id
    for key share;
    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_USER_EVENT_PLACE_NOT_FOUND';
    end if;
  elsif p_patch ? 'location_raw' then
    v_location_raw := nullif(
      pg_catalog.btrim(p_patch ->> 'location_raw'),
      ''
    );
    if v_location_raw is null
       or pg_catalog.char_length(v_location_raw) > 500 then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_USER_EVENT_PATCH_INVALID';
    end if;
    select r.place_id
    into v_resolved_place_id
    from public.resolve_place(v_location_raw) as r;
    if v_resolved_place_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_USER_EVENT_LOCATION_UNRESOLVED';
    end if;
    v_place_id := v_resolved_place_id;
    perform 1
    from public.places as p
    where p.id = v_place_id
    for key share;
    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_USER_EVENT_LOCATION_UNRESOLVED';
    end if;
  end if;

  if v_event.title is not distinct from v_title
     and v_event.description is not distinct from v_description
     and v_event.start_ts is not distinct from v_start_ts
     and v_event.end_ts is not distinct from v_end_ts
     and v_event.category is not distinct from v_category
     and v_event.url is not distinct from v_url
     and v_event.place_id is not distinct from v_place_id
     and v_event.location_raw is not distinct from v_location_raw then
    return query select v_event.id, v_event.revision, false;
    return;
  end if;

  if p_expected_revision <> v_event.revision then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_REVISION_CONFLICT';
  end if;

  if not v_enabled then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_POSTING_DISABLED';
  end if;

  v_now := pg_catalog.clock_timestamp();
  update public.user_events as e
  set title = v_title,
      description = v_description,
      start_ts = v_start_ts,
      end_ts = v_end_ts,
      place_id = v_place_id,
      location_raw = v_location_raw,
      category = v_category,
      url = v_url,
      revision = e.revision + 1,
      updated_by = p_actor,
      updated_at = v_now
  where e.id = v_event.id
  returning e.revision into revision;

  event_id := v_event.id;
  changed := true;
  return next;
end
$$;

create function public.brownsync_delete_user_event(
  p_actor uuid,
  p_event_id uuid
)
returns table (
  event_id uuid,
  revision bigint,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.user_events%rowtype;
  v_now timestamptz;
  v_organization_id text;
begin
  perform public.brownsync_require_user_event_actor(p_actor);
  perform public.brownsync_lock_user_event_control();

  if p_event_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_NOT_FOUND';
  end if;

  select e.organization_id
  into v_organization_id
  from public.user_events as e
  where e.id = p_event_id;

  if found and v_organization_id is not null then
    perform 1
    from public.organizations as o
    where o.id = v_organization_id
    for update;
  end if;

  select e.*
  into v_event
  from public.user_events as e
  where e.id = p_event_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_NOT_FOUND';
  end if;

  if v_event.created_by is distinct from p_actor
     and (
       v_event.organization_id is null
       or not public.brownsync_is_org_admin(
         p_actor,
         v_event.organization_id,
         null
       )
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_FORBIDDEN';
  end if;

  if v_event.status = 'canceled'
     and v_event.deleted_at is not null then
    return query select v_event.id, v_event.revision, false;
    return;
  end if;

  v_now := pg_catalog.clock_timestamp();
  update public.user_events as e
  set status = 'canceled',
      revision = e.revision + 1,
      updated_by = p_actor,
      deleted_by = p_actor,
      deleted_at = v_now,
      updated_at = v_now
  where e.id = v_event.id
  returning e.revision into revision;

  event_id := v_event.id;
  changed := true;
  return next;
end
$$;

create function public.brownsync_moderate_user_event(
  p_actor uuid,
  p_event_id uuid,
  p_hidden boolean
)
returns table (
  event_id uuid,
  revision bigint,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_event public.user_events%rowtype;
  v_now timestamptz;
  v_organization_id text;
  v_target_state text;
begin
  perform public.brownsync_require_user_event_actor(p_actor);
  v_enabled := public.brownsync_lock_user_event_control();

  if p_hidden is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_INPUT_INVALID';
  end if;

  select e.organization_id
  into v_organization_id
  from public.user_events as e
  where e.id = p_event_id;

  if found and v_organization_id is not null then
    perform 1
    from public.organizations as o
    where o.id = v_organization_id
    for update;
  end if;

  select e.*
  into v_event
  from public.user_events as e
  where e.id = p_event_id
  for update;

  if not found
     or v_event.status = 'canceled'
     or v_event.deleted_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_NOT_FOUND';
  end if;

  if not public.brownsync_is_org_reviewer(p_actor) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_FORBIDDEN';
  end if;

  v_target_state := case when p_hidden then 'hidden' else 'active' end;
  if v_event.moderation_state = v_target_state then
    return query select v_event.id, v_event.revision, false;
    return;
  end if;

  if not p_hidden and not v_enabled then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_POSTING_DISABLED';
  end if;

  v_now := pg_catalog.clock_timestamp();
  update public.user_events as e
  set moderation_state = v_target_state,
      revision = e.revision + 1,
      updated_by = p_actor,
      moderated_by = p_actor,
      moderated_at = v_now,
      updated_at = v_now
  where e.id = v_event.id
  returning e.revision into revision;

  event_id := v_event.id;
  changed := true;
  return next;
end
$$;

create function public.brownsync_list_user_events(
  p_actor uuid,
  p_before_updated_at timestamptz,
  p_before_event_id uuid,
  p_limit integer default 50
)
returns table (
  event_id uuid,
  organization_id text,
  organization_name text,
  title text,
  description text,
  start_ts timestamptz,
  end_ts timestamptz,
  place_id text,
  place_name text,
  location_raw text,
  category text,
  url text,
  status text,
  moderation_state text,
  revision bigint,
  deleted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  has_more boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.brownsync_require_user_event_actor(p_actor);

  if p_limit is null
     or p_limit not between 1 and 100
     or ((p_before_updated_at is null) <> (p_before_event_id is null))
     or (
       p_before_updated_at is not null
       and not pg_catalog.isfinite(p_before_updated_at)
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_QUEUE_INVALID';
  end if;

  return query
  with eligible as (
    select
      e.id as event_id,
      e.organization_id,
      o.name as organization_name,
      e.title,
      e.description,
      e.start_ts,
      e.end_ts,
      e.place_id,
      p.name as place_name,
      e.location_raw,
      e.category,
      e.url,
      e.status,
      e.moderation_state,
      e.revision,
      e.deleted_at,
      e.created_at,
      e.updated_at
    from public.user_events as e
    left join public.organizations as o
      on o.id = e.organization_id
    left join public.places as p
      on p.id = e.place_id
    where (
      e.created_by = p_actor
      or exists (
        select 1
        from public.org_admins as a
        where a.organization_id = e.organization_id
          and a.user_id = p_actor
      )
    )
      and (
        p_before_updated_at is null
        or e.updated_at < p_before_updated_at
        or (
          e.updated_at = p_before_updated_at
          and e.id < p_before_event_id
        )
      )
    order by e.updated_at desc, e.id desc
    limit p_limit + 1
  ),
  numbered as (
    select
      eligible.*,
      pg_catalog.row_number() over (
        order by eligible.updated_at desc, eligible.event_id desc
      ) as row_number,
      pg_catalog.count(*) over () > p_limit as has_more
    from eligible
  )
  select
    numbered.event_id,
    numbered.organization_id,
    numbered.organization_name,
    numbered.title,
    numbered.description,
    numbered.start_ts,
    numbered.end_ts,
    numbered.place_id,
    numbered.place_name,
    numbered.location_raw,
    numbered.category,
    numbered.url,
    numbered.status,
    numbered.moderation_state,
    numbered.revision,
    numbered.deleted_at,
    numbered.created_at,
    numbered.updated_at,
    numbered.has_more
  from numbered
  where numbered.row_number <= p_limit
  order by numbered.updated_at desc, numbered.event_id desc;
end
$$;

create function public.brownsync_get_user_event(
  p_actor uuid,
  p_event_id uuid
)
returns table (
  event_id uuid,
  organization_id text,
  organization_name text,
  title text,
  description text,
  start_ts timestamptz,
  end_ts timestamptz,
  place_id text,
  place_name text,
  location_raw text,
  category text,
  url text,
  status text,
  moderation_state text,
  revision bigint,
  deleted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.user_events%rowtype;
begin
  perform public.brownsync_require_user_event_actor(p_actor);

  select e.*
  into v_event
  from public.user_events as e
  where e.id = p_event_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_NOT_FOUND';
  end if;

  if v_event.created_by is distinct from p_actor
     and (
       v_event.organization_id is null
       or not public.brownsync_is_org_admin(
         p_actor,
         v_event.organization_id,
         null
       )
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_USER_EVENT_FORBIDDEN';
  end if;

  return query
  select
    e.id,
    e.organization_id,
    o.name,
    e.title,
    e.description,
    e.start_ts,
    e.end_ts,
    e.place_id,
    p.name,
    e.location_raw,
    e.category,
    e.url,
    e.status,
    e.moderation_state,
    e.revision,
    e.deleted_at,
    e.created_at,
    e.updated_at
  from public.user_events as e
  left join public.organizations as o
    on o.id = e.organization_id
  left join public.places as p
    on p.id = e.place_id
  where e.id = v_event.id;
end
$$;

-- auth.users deletion cascades to profiles. This BEFORE DELETE trigger
-- transforms personal content while the creator still exists, then clears
-- attribution explicitly. Organization content survives without attribution.
create function public.brownsync_user_events_before_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  update public.user_events as e
  set status = 'canceled',
      revision = e.revision + case
        when e.status = 'canceled' and e.deleted_at is not null then 0
        else 1
      end,
      created_by = null,
      updated_by = case when e.updated_by = old.id then null else e.updated_by end,
      deleted_by = null,
      deleted_at = coalesce(e.deleted_at, v_now),
      moderated_by = case
        when e.moderated_by = old.id then null
        else e.moderated_by
      end,
      updated_at = case
        when e.status = 'canceled' and e.deleted_at is not null
          then e.updated_at
        else v_now
      end
  where e.organization_id is null
    and e.created_by = old.id;

  update public.user_events as e
  set created_by = case when e.created_by = old.id then null else e.created_by end,
      updated_by = case when e.updated_by = old.id then null else e.updated_by end,
      deleted_by = case when e.deleted_by = old.id then null else e.deleted_by end,
      moderated_by = case
        when e.moderated_by = old.id then null
        else e.moderated_by
      end
  where e.organization_id is not null
    and (
      e.created_by = old.id
      or e.updated_by = old.id
      or e.deleted_by = old.id
      or e.moderated_by = old.id
    );

  -- Clear attribution on events created by somebody else as well.
  update public.user_events as e
  set updated_by = case when e.updated_by = old.id then null else e.updated_by end,
      deleted_by = case when e.deleted_by = old.id then null else e.deleted_by end,
      moderated_by = case
        when e.moderated_by = old.id then null
        else e.moderated_by
      end
  where e.created_by is distinct from old.id
    and (
      e.updated_by = old.id
      or e.deleted_by = old.id
      or e.moderated_by = old.id
    );

  delete from public.user_event_create_limits
  where user_id = old.id;

  return old;
end
$$;

create trigger brownsync_user_events_before_profile_delete
  before delete on public.profiles
  for each row execute function
    public.brownsync_user_events_before_profile_delete();

-- Preserve the exact existing 21-column view contract while adding only
-- explicitly public student rows. The user branch has an owner-visible
-- predicate instead of relying on RLS, because the view owner bypasses it.
create or replace view public.v_events_api as
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
from public.events as e
left join public.places as p on p.id = e.place_id
left join public.organizations as o on o.id = e.org_id
left join lateral (
  select pg_catalog.array_agg(
    distinct dup.source
    order by dup.source
  ) as merged_sources
  from public.events as dup
  where dup.canonical_id = e.id
) as d on true
where e.canonical_id is null

union all

select
  e.id,
  e.title,
  e.description,
  e.start_ts,
  e.end_ts,
  false as is_all_day,
  p.lat,
  p.lng,
  e.place_id,
  p.name as place_name,
  e.location_raw,
  e.organization_id as org_id,
  o.name as org_name,
  e.category,
  '{}'::text[] as tags,
  e.url,
  null::text as cost,
  'brownsync'::text as source,
  1::real as confidence,
  false as is_canceled,
  '{}'::text[] as merged_sources
from public.user_events as e
join public.places as p on p.id = e.place_id
left join public.organizations as o on o.id = e.organization_id
where e.status = 'published'
  and e.moderation_state = 'active'
  and e.deleted_at is null
  and coalesce((
    select c.posting_enabled
    from public.user_event_controls as c
    where c.id = true
  ), false);

create policy "user events public read"
  on public.user_events
  for select
  to anon, authenticated
  using (
    public.brownsync_user_event_posting_enabled()
    and status = 'published'
    and moderation_state = 'active'
    and deleted_at is null
  );

create policy "members read own user events"
  on public.user_events
  for select
  to authenticated
  using (
    public.is_brown_member()
    and auth.uid() = created_by
    and status = 'draft'
    and moderation_state = 'active'
    and deleted_at is null
  );

-- No direct table-wide SELECT grant is used because it would expose private
-- idempotency and attribution fields. Only the safe read projection is
-- available, and RLS still decides which rows pass.
grant select (
  id,
  organization_id,
  title,
  description,
  start_ts,
  end_ts,
  place_id,
  location_raw,
  category,
  url,
  status,
  moderation_state,
  revision,
  deleted_at,
  created_at,
  updated_at
) on table public.user_events to anon, authenticated;

revoke all on table public.user_event_controls
  from public, anon, authenticated;
revoke all on table public.user_event_create_limits
  from public, anon, authenticated;

revoke all on function public.brownsync_require_user_event_actor(uuid)
  from public, anon, authenticated;
revoke all on function public.brownsync_lock_user_event_control()
  from public, anon, authenticated;
revoke all on function public.brownsync_user_event_fingerprint(
  uuid, text, text, text, timestamptz, timestamptz, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.brownsync_consume_user_event_create_limit(
  uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.brownsync_user_event_after_insert()
  from public, anon, authenticated;
revoke all on function public.brownsync_user_events_before_profile_delete()
  from public, anon, authenticated;

revoke all on function public.brownsync_create_user_event(
  uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text
) from public, anon, authenticated;
revoke all on function public.brownsync_edit_user_event(
  uuid, uuid, bigint, jsonb
) from public, anon, authenticated;
revoke all on function public.brownsync_delete_user_event(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.brownsync_list_user_events(
  uuid, timestamptz, uuid, integer
) from public, anon, authenticated;
revoke all on function public.brownsync_get_user_event(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.brownsync_moderate_user_event(
  uuid, uuid, boolean
) from public, anon, authenticated;

revoke all on function public.brownsync_user_event_posting_enabled()
  from public;
grant execute on function public.brownsync_user_event_posting_enabled()
  to anon, authenticated;

commit;
