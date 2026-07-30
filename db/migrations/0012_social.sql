-- 0012_social.sql — friendships and place-only, explicitly shared presence.
--
-- Social rows deliberately contain place identifiers, never coordinates.
-- Client writes are confined to the SECURITY DEFINER RPCs below.

begin;

create table public.friendships (
  requester    uuid not null references public.profiles(id) on delete cascade,
  addressee    uuid not null references public.profiles(id) on delete cascade,
  status       text not null,
  blocked_by   uuid references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default pg_catalog.clock_timestamp(),
  responded_at timestamptz,
  primary key (requester, addressee),
  constraint friendships_no_self_ck check (requester <> addressee),
  constraint friendships_status_ck
    check (status in ('pending', 'accepted', 'blocked')),
  constraint friendships_state_ck check (
    (
      status = 'pending'
      and blocked_by is null
      and responded_at is null
    )
    or (
      status = 'accepted'
      and blocked_by is null
      and responded_at is not null
    )
    or (
      status = 'blocked'
      and blocked_by is not null
      and blocked_by in (requester, addressee)
      and responded_at is not null
    )
  )
);

create unique index friendships_unordered_pair_uidx
  on public.friendships (
    least(requester, addressee),
    greatest(requester, addressee)
  );

create index friendships_addressee_status_idx
  on public.friendships (addressee, status);

create table public.presence_shares (
  owner      uuid not null references public.profiles(id) on delete cascade,
  viewer     uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (owner, viewer),
  constraint presence_shares_no_self_ck check (owner <> viewer),
  constraint presence_shares_expiry_ck check (
    pg_catalog.isfinite(expires_at)
    and expires_at > created_at
    and expires_at <= created_at + interval '7 days'
  )
);

create table public.presence_state (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  place_id   text references public.places(id),
  status     text,
  note       text,
  ghost      boolean not null default false,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  constraint presence_state_status_ck check (
    status is null or status in ('studying', 'eating', 'class', 'free')
  ),
  constraint presence_state_note_ck check (
    note is null or pg_catalog.char_length(note) <= 80
  ),
  constraint presence_state_expiry_ck check (
    pg_catalog.isfinite(expires_at)
    and expires_at >= updated_at
    and expires_at <= updated_at + interval '24 hours'
  )
);

create table public.checkins (
  id         uuid primary key default pg_catalog.gen_random_uuid(),
  owner      uuid not null references public.profiles(id) on delete cascade,
  place_id   text not null references public.places(id),
  note       text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  constraint checkins_note_ck check (
    note is null or pg_catalog.char_length(note) <= 140
  ),
  constraint checkins_expiry_ck check (
    pg_catalog.isfinite(expires_at)
    and expires_at > created_at
    and expires_at <= created_at + interval '24 hours'
  )
);

-- This is an internal enforcement domain. It is intentionally independent of
-- the Worker's native Cloudflare limiter.
create table public.social_write_limits (
  user_id           uuid not null references public.profiles(id)
                       on delete cascade,
  bucket            text not null,
  window_started_at timestamptz not null,
  count             integer not null default 0,
  last_success_at   timestamptz,
  primary key (user_id, bucket),
  constraint social_write_limits_bucket_ck
    check (bucket in ('shared', 'presence')),
  constraint social_write_limits_count_ck
    check (count >= 0 and count <= 20),
  constraint social_write_limits_time_ck check (
    pg_catalog.isfinite(window_started_at)
    and (
      last_success_at is null
      or pg_catalog.isfinite(last_success_at)
    )
  )
);

alter table public.friendships enable row level security;
alter table public.presence_shares enable row level security;
alter table public.presence_state enable row level security;
alter table public.checkins enable row level security;
alter table public.social_write_limits enable row level security;

-- Every pair operation calls this single protocol before reading pair state.
-- The sort occurs before LockRows, so concurrent reverse-direction operations
-- acquire the same two profile locks in the same order.
create function public.brownsync_lock_social_pair(
  p_actor uuid,
  p_other uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform p.id
  from public.profiles as p
  where p.id in (p_actor, p_other)
  order by p.id
  for update;

  if p_actor is null or not exists (
    select 1 from public.profiles as p where p.id = p_actor
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;
end
$$;

-- Race-safe first-row creation is followed by a row lock before either the
-- fixed-window counter or strict last-success cooldown is evaluated.
create function public.brownsync_consume_social_write_limit(p_bucket text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor             uuid;
  v_count             integer;
  v_last_success_at   timestamptz;
  v_now               timestamptz;
  v_window_started_at timestamptz;
begin
  v_actor := auth.uid();
  if v_actor is null
     or not coalesce(public.is_brown_member(), false) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;

  if p_bucket not in ('shared', 'presence') then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_LIMIT_BUCKET_INVALID';
  end if;

  v_now := pg_catalog.clock_timestamp();

  insert into public.social_write_limits (
    user_id,
    bucket,
    window_started_at,
    count,
    last_success_at
  ) values (
    v_actor,
    p_bucket,
    v_now,
    0,
    null
  )
  on conflict (user_id, bucket) do nothing;

  select
    l.window_started_at,
    l.count,
    l.last_success_at
  into
    v_window_started_at,
    v_count,
    v_last_success_at
  from public.social_write_limits as l
  where l.user_id = v_actor
    and l.bucket = p_bucket
  for update;

  -- A concurrent writer can hold this row across a window/cooldown boundary.
  -- Evaluate against lock-acquisition time, never the stale pre-wait sample
  -- used only to seed a brand-new row.
  v_now := pg_catalog.clock_timestamp();

  if p_bucket = 'shared' then
    if v_count = 0
       or v_now >= v_window_started_at + interval '60 seconds' then
      update public.social_write_limits
      set window_started_at = v_now,
          count = 1,
          last_success_at = null
      where user_id = v_actor
        and bucket = p_bucket;
    elsif v_count >= 20 then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_SOCIAL_RATE_LIMITED';
    else
      update public.social_write_limits
      set count = count + 1
      where user_id = v_actor
        and bucket = p_bucket;
    end if;
  else
    if v_last_success_at is not null
       and v_now < v_last_success_at + interval '60 seconds' then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_PRESENCE_RATE_LIMITED';
    end if;

    update public.social_write_limits
    set window_started_at = v_now,
        count = 1,
        last_success_at = v_now
    where user_id = v_actor
      and bucket = p_bucket;
  end if;
end
$$;

create function public.request_friend(p_addressee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_pair  public.friendships%rowtype;
begin
  v_actor := auth.uid();
  if v_actor is null
     or not coalesce(public.is_brown_member(), false) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;
  perform public.brownsync_lock_social_pair(v_actor, p_addressee);

  if p_addressee = v_actor then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_FRIEND_SELF';
  end if;

  if not exists (
    select 1 from public.profiles as p where p.id = p_addressee
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_FRIEND_TARGET_NOT_FOUND';
  end if;

  select f.*
  into v_pair
  from public.friendships as f
  where least(f.requester, f.addressee) = least(v_actor, p_addressee)
    and greatest(f.requester, f.addressee) = greatest(v_actor, p_addressee);

  if found then
    if v_pair.status = 'pending'
       and v_pair.requester = v_actor then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_FRIEND_REQUEST_EXISTS';
    elsif v_pair.status = 'pending' then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_FRIEND_REVERSE_PENDING';
    else
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_FRIEND_PAIR_EXISTS';
    end if;
  end if;

  perform public.brownsync_consume_social_write_limit('shared');

  insert into public.friendships (
    requester,
    addressee,
    status,
    created_at
  ) values (
    v_actor,
    p_addressee,
    'pending',
    pg_catalog.clock_timestamp()
  );
end
$$;

create function public.respond_friend(
  p_requester uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null
     or not coalesce(public.is_brown_member(), false) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;
  perform public.brownsync_lock_social_pair(v_actor, p_requester);

  if p_accept is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_FRIEND_RESPONSE_INVALID';
  end if;

  if not exists (
    select 1
    from public.friendships as f
    where f.requester = p_requester
      and f.addressee = v_actor
      and f.status = 'pending'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_FRIEND_PENDING_NOT_FOUND';
  end if;

  if p_accept then
    perform public.brownsync_consume_social_write_limit('shared');

    update public.friendships
    set status = 'accepted',
        blocked_by = null,
        responded_at = pg_catalog.clock_timestamp()
    where requester = p_requester
      and addressee = v_actor
      and status = 'pending';
  else
    delete from public.friendships
    where requester = p_requester
      and addressee = v_actor
      and status = 'pending';
  end if;

  delete from public.presence_shares
  where (owner = v_actor and viewer = p_requester)
     or (owner = p_requester and viewer = v_actor);
end
$$;

create function public.remove_friend(p_other uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_pair  public.friendships%rowtype;
begin
  v_actor := auth.uid();
  if v_actor is null
     or not coalesce(public.is_brown_member(), false) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;

  perform public.brownsync_lock_social_pair(v_actor, p_other);

  select f.*
  into v_pair
  from public.friendships as f
  where least(f.requester, f.addressee) = least(v_actor, p_other)
    and greatest(f.requester, f.addressee) = greatest(v_actor, p_other);

  if not found
     or v_pair.status = 'blocked'
     or (
       v_pair.status = 'pending'
       and v_pair.requester <> v_actor
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_FRIEND_REMOVE_NOT_ALLOWED';
  end if;

  delete from public.presence_shares
  where (owner = v_actor and viewer = p_other)
     or (owner = p_other and viewer = v_actor);

  delete from public.friendships
  where requester = v_pair.requester
    and addressee = v_pair.addressee;
end
$$;

create function public.block_user(p_other uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid;
  v_pair       public.friendships%rowtype;
  v_pair_found boolean;
begin
  v_actor := auth.uid();
  if v_actor is null
     or not coalesce(public.is_brown_member(), false) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;
  perform public.brownsync_lock_social_pair(v_actor, p_other);

  if p_other = v_actor then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_FRIEND_SELF';
  end if;

  if not exists (
    select 1 from public.profiles as p where p.id = p_other
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_FRIEND_TARGET_NOT_FOUND';
  end if;

  select f.*
  into v_pair
  from public.friendships as f
  where least(f.requester, f.addressee) = least(v_actor, p_other)
    and greatest(f.requester, f.addressee) = greatest(v_actor, p_other);
  v_pair_found := found;

  if v_pair_found and v_pair.status = 'blocked' then
    if v_pair.blocked_by <> v_actor then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_FRIEND_PAIR_BLOCKED';
    end if;

    -- Same-blocker replay is idempotent. Purging impossible stale consent is
    -- safe, while the blocked row and its timestamps remain untouched.
    delete from public.presence_shares
    where (owner = v_actor and viewer = p_other)
       or (owner = p_other and viewer = v_actor);
    return;
  end if;

  delete from public.presence_shares
  where (owner = v_actor and viewer = p_other)
     or (owner = p_other and viewer = v_actor);

  if v_pair_found then
    delete from public.friendships
    where requester = v_pair.requester
      and addressee = v_pair.addressee;
  end if;

  insert into public.friendships (
    requester,
    addressee,
    status,
    blocked_by,
    created_at,
    responded_at
  ) values (
    v_actor,
    p_other,
    'blocked',
    v_actor,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  );
end
$$;

create function public.unblock_user(p_other uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_pair  public.friendships%rowtype;
begin
  v_actor := auth.uid();
  if v_actor is null
     or not coalesce(public.is_brown_member(), false) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;

  perform public.brownsync_lock_social_pair(v_actor, p_other);

  select f.*
  into v_pair
  from public.friendships as f
  where least(f.requester, f.addressee) = least(v_actor, p_other)
    and greatest(f.requester, f.addressee) = greatest(v_actor, p_other);

  if not found
     or v_pair.status <> 'blocked'
     or v_pair.blocked_by <> v_actor then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_UNBLOCK_NOT_ALLOWED';
  end if;

  perform public.brownsync_consume_social_write_limit('shared');

  delete from public.presence_shares
  where (owner = v_actor and viewer = p_other)
     or (owner = p_other and viewer = v_actor);

  delete from public.friendships
  where requester = v_pair.requester
    and addressee = v_pair.addressee;
end
$$;

create function public.set_presence_share(
  p_viewer uuid,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_now   timestamptz;
begin
  v_actor := auth.uid();
  if v_actor is null
     or not coalesce(public.is_brown_member(), false) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;
  perform public.brownsync_lock_social_pair(v_actor, p_viewer);

  if p_viewer = v_actor then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SHARE_SELF';
  end if;
  v_now := pg_catalog.clock_timestamp();

  if p_expires_at is null
     or not pg_catalog.isfinite(p_expires_at)
     or p_expires_at <= v_now
     or p_expires_at > v_now + interval '7 days' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SHARE_EXPIRY_INVALID';
  end if;

  if not exists (
    select 1
    from public.friendships as f
    where least(f.requester, f.addressee) = least(v_actor, p_viewer)
      and greatest(f.requester, f.addressee) = greatest(v_actor, p_viewer)
      and f.status = 'accepted'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SHARE_FRIEND_REQUIRED';
  end if;

  perform public.brownsync_consume_social_write_limit('shared');

  insert into public.presence_shares (
    owner,
    viewer,
    expires_at,
    created_at
  ) values (
    v_actor,
    p_viewer,
    p_expires_at,
    v_now
  )
  on conflict (owner, viewer) do update
  set expires_at = excluded.expires_at,
      created_at = excluded.created_at;
end
$$;

create function public.revoke_presence_share(p_viewer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null
     or not coalesce(public.is_brown_member(), false) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;

  perform public.brownsync_lock_social_pair(v_actor, p_viewer);

  delete from public.presence_shares
  where owner = v_actor
    and viewer = p_viewer;
end
$$;

create function public.set_presence(
  p_place_id text,
  p_status text,
  p_note text,
  p_ttl interval
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_expires_at timestamptz;
  v_ghost boolean;
  v_now   timestamptz;
begin
  v_actor := auth.uid();
  if v_actor is null
     or not coalesce(public.is_brown_member(), false) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;

  -- The profile lock is the serialization sentinel even before a state row
  -- exists.
  perform p.id
  from public.profiles as p
  where p.id = v_actor
  for update;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;

  if p_status is not null
     and p_status not in ('studying', 'eating', 'class', 'free') then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_PRESENCE_STATUS_INVALID';
  end if;
  if p_note is not null
     and pg_catalog.char_length(p_note) > 80 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_PRESENCE_NOTE_INVALID';
  end if;
  -- The place key-share lock permits unrelated check-in concurrency.
  perform p.id
  from public.places as p
  where p.id = p_place_id
  for key share;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_PRESENCE_PLACE_NOT_FOUND';
  end if;

  select s.ghost
  into v_ghost
  from public.presence_state as s
  where s.user_id = v_actor
  for update;

  if p_ttl is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_PRESENCE_TTL_INVALID';
  end if;
  v_now := pg_catalog.clock_timestamp();
  begin
    v_expires_at := v_now + p_ttl;
  exception
    when datetime_field_overflow or numeric_value_out_of_range then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_PRESENCE_TTL_INVALID';
  end;
  if not pg_catalog.isfinite(v_expires_at)
     or v_expires_at <= v_now
     or v_expires_at > v_now + interval '24 hours' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_PRESENCE_TTL_INVALID';
  end if;

  if found and v_ghost then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_PRESENCE_GHOSTED';
  end if;

  perform public.brownsync_consume_social_write_limit('shared');
  perform public.brownsync_consume_social_write_limit('presence');

  insert into public.presence_state (
    user_id,
    place_id,
    status,
    note,
    ghost,
    updated_at,
    expires_at
  ) values (
    v_actor,
    p_place_id,
    p_status,
    p_note,
    false,
    v_now,
    v_expires_at
  )
  on conflict (user_id) do update
  set place_id = excluded.place_id,
      status = excluded.status,
      note = excluded.note,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at;
end
$$;

create function public.clear_presence()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_now   timestamptz;
begin
  v_actor := auth.uid();
  if v_actor is null
     or not coalesce(public.is_brown_member(), false) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;

  perform p.id
  from public.profiles as p
  where p.id = v_actor
  for update;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;

  perform 1
  from public.presence_state as s
  where s.user_id = v_actor
  for update;

  v_now := pg_catalog.clock_timestamp();
  insert into public.presence_state (
    user_id,
    place_id,
    status,
    note,
    ghost,
    updated_at,
    expires_at
  ) values (
    v_actor,
    null,
    null,
    null,
    false,
    v_now,
    v_now
  )
  on conflict (user_id) do update
  set place_id = null,
      status = null,
      note = null,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at;
end
$$;

create function public.set_ghost(p_ghost boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_now   timestamptz;
begin
  v_actor := auth.uid();
  if v_actor is null
     or not coalesce(public.is_brown_member(), false) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;

  perform p.id
  from public.profiles as p
  where p.id = v_actor
  for update;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;

  perform 1
  from public.presence_state as s
  where s.user_id = v_actor
  for update;

  if p_ghost is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_PRESENCE_GHOST_INVALID';
  end if;
  if not p_ghost then
    perform public.brownsync_consume_social_write_limit('shared');
  end if;

  v_now := pg_catalog.clock_timestamp();
  insert into public.presence_state (
    user_id,
    place_id,
    status,
    note,
    ghost,
    updated_at,
    expires_at
  ) values (
    v_actor,
    null,
    null,
    null,
    p_ghost,
    v_now,
    v_now
  )
  on conflict (user_id) do update
  set place_id = null,
      status = null,
      note = null,
      ghost = excluded.ghost,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at;
end
$$;

create function public.create_checkin(
  p_place_id text,
  p_note text,
  p_ttl interval
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid;
  v_checkin_id uuid;
  v_expires_at timestamptz;
  v_now        timestamptz;
begin
  v_actor := auth.uid();
  if v_actor is null
     or not coalesce(public.is_brown_member(), false) then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;

  -- KEY SHARE validates the caller FK without serializing otherwise
  -- independent check-in calls; the limiter row is the shared write lock.
  perform p.id
  from public.profiles as p
  where p.id = v_actor
  for key share;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_SOCIAL_UNAUTHORIZED';
  end if;

  if p_note is not null
     and pg_catalog.char_length(p_note) > 140 then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_CHECKIN_NOTE_INVALID';
  end if;
  -- The place FK uses the same compatible lock mode.
  perform p.id
  from public.places as p
  where p.id = p_place_id
  for key share;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_CHECKIN_PLACE_NOT_FOUND';
  end if;

  if p_ttl is null then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_CHECKIN_TTL_INVALID';
  end if;
  v_now := pg_catalog.clock_timestamp();
  begin
    v_expires_at := v_now + p_ttl;
  exception
    when datetime_field_overflow or numeric_value_out_of_range then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_CHECKIN_TTL_INVALID';
  end;
  if not pg_catalog.isfinite(v_expires_at)
     or v_expires_at <= v_now
     or v_expires_at > v_now + interval '24 hours' then
    raise exception using
      errcode = 'P0001',
      message = 'BROWNSYNC_CHECKIN_TTL_INVALID';
  end if;

  perform public.brownsync_consume_social_write_limit('shared');

  insert into public.checkins (
    owner,
    place_id,
    note,
    created_at,
    expires_at
  ) values (
    v_actor,
    p_place_id,
    p_note,
    v_now,
    v_expires_at
  )
  returning id into v_checkin_id;

  return v_checkin_id;
end
$$;

create function public.cleanup_expired_social()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  delete from public.checkins where expires_at <= v_now;
  delete from public.presence_shares where expires_at <= v_now;

  -- Preserve the row, ghost preference, and serialization timestamps.
  update public.presence_state
  set place_id = null,
      status = null,
      note = null
  where expires_at <= v_now
    and (
      place_id is not null
      or status is not null
      or note is not null
    );
end
$$;

-- Optional hosted integrations are one owner-only, rerunnable operation. All
-- extension/catalog-dependent statements stay behind dynamic guards so plain
-- PostgreSQL/PostGIS is a safe no-op.
create function public.brownsync_configure_social_integrations()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_published boolean;
begin
  if pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is not null then
    execute $cron$
      select cron.schedule(
        'brownsync-social-cleanup-daily',
        '17 3 * * *',
        'select public.cleanup_expired_social()'
      )
    $cron$;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_publication as p
    where p.pubname = 'supabase_realtime'
  ) then
    select
      p.puballtables
      or exists (
        select 1
        from pg_catalog.pg_publication_rel as pr
        where pr.prpubid = p.oid
          and pr.prrelid = 'public.presence_state'::pg_catalog.regclass
      )
    into v_is_published
    from pg_catalog.pg_publication as p
    where p.pubname = 'supabase_realtime';

    if not coalesce(v_is_published, false) then
      execute
        'alter publication supabase_realtime add table public.presence_state';
    end if;
  end if;
end
$$;

-- Membership is mandatory even on each caller's own rows.
create policy "members read own friendships"
  on public.friendships
  for select
  to authenticated
  using (
    public.is_brown_member()
    and auth.uid() in (requester, addressee)
  );

create policy "members read addressed presence shares"
  on public.presence_shares
  for select
  to authenticated
  using (
    public.is_brown_member()
    and auth.uid() in (owner, viewer)
  );

create policy "members read permitted current presence"
  on public.presence_state
  for select
  to authenticated
  using (
    public.is_brown_member()
    and (
      user_id = auth.uid()
      or (
        not ghost
        and expires_at > pg_catalog.clock_timestamp()
        and exists (
          select 1
          from public.presence_shares as s
          where s.owner = presence_state.user_id
            and s.viewer = auth.uid()
            and s.expires_at > pg_catalog.clock_timestamp()
        )
        and exists (
          select 1
          from public.friendships as f
          where least(f.requester, f.addressee)
                  = least(presence_state.user_id, auth.uid())
            and greatest(f.requester, f.addressee)
                  = greatest(presence_state.user_id, auth.uid())
            and f.status = 'accepted'
        )
      )
    )
  );

create policy "members read own current checkins"
  on public.checkins
  for select
  to authenticated
  using (
    public.is_brown_member()
    and owner = auth.uid()
    and expires_at > pg_catalog.clock_timestamp()
  );

grant select on table
  public.friendships,
  public.presence_shares,
  public.presence_state,
  public.checkins
to authenticated;

revoke all on table
  public.friendships,
  public.presence_shares,
  public.presence_state,
  public.checkins,
  public.social_write_limits
from public, anon, authenticated;

grant select on table
  public.friendships,
  public.presence_shares,
  public.presence_state,
  public.checkins
to authenticated;

revoke all on function public.brownsync_lock_social_pair(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.brownsync_consume_social_write_limit(text)
  from public, anon, authenticated;
revoke all on function public.cleanup_expired_social()
  from public, anon, authenticated;
revoke all on function public.brownsync_configure_social_integrations()
  from public, anon, authenticated;

revoke all on function public.request_friend(uuid)
  from public, anon, authenticated;
revoke all on function public.respond_friend(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.remove_friend(uuid)
  from public, anon, authenticated;
revoke all on function public.block_user(uuid)
  from public, anon, authenticated;
revoke all on function public.unblock_user(uuid)
  from public, anon, authenticated;
revoke all on function public.set_presence_share(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.revoke_presence_share(uuid)
  from public, anon, authenticated;
revoke all on function public.set_presence(text, text, text, interval)
  from public, anon, authenticated;
revoke all on function public.clear_presence()
  from public, anon, authenticated;
revoke all on function public.set_ghost(boolean)
  from public, anon, authenticated;
revoke all on function public.create_checkin(text, text, interval)
  from public, anon, authenticated;

grant execute on function public.request_friend(uuid)
  to authenticated;
grant execute on function public.respond_friend(uuid, boolean)
  to authenticated;
grant execute on function public.remove_friend(uuid)
  to authenticated;
grant execute on function public.block_user(uuid)
  to authenticated;
grant execute on function public.unblock_user(uuid)
  to authenticated;
grant execute on function public.set_presence_share(uuid, timestamptz)
  to authenticated;
grant execute on function public.revoke_presence_share(uuid)
  to authenticated;
grant execute on function public.set_presence(text, text, text, interval)
  to authenticated;
grant execute on function public.clear_presence()
  to authenticated;
grant execute on function public.set_ghost(boolean)
  to authenticated;
grant execute on function public.create_checkin(text, text, interval)
  to authenticated;

select public.brownsync_configure_social_integrations();

commit;
