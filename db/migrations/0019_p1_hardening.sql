-- 0019_p1_hardening.sql — four confirmed P1 hardening fixes.
--
-- 1. Board authority can no longer cascade to zero owners: a BEFORE DELETE
--    trigger on board_moderators blocks removal of the LAST owner row with
--    the same BROWNSYNC_BOARD_TERMINAL_CONFLICT the moderator RPCs raise, and
--    brownsync_delete_board_account rejects a sole owner up front so the API
--    can answer with a typed conflict instead of an opaque failure.
-- 2. (App-side change; no SQL) account-deletion board cleanup no longer keys
--    on the BOARD_ENABLED runtime flag.
-- 3. public.profiles direct-write hardening: the five client-updatable
--    columns gain value constraints (mirroring 0014's org_overrides URL
--    pattern), the signup path clamps display_name to the new bound, and a
--    BEFORE UPDATE trigger routes direct PostgREST writes through the
--    existing 0012 social write limiter.
-- 4. brownsync_list_user_events pages on a millisecond-truncated
--    (updated_at, id) keyset so the Worker's JS-Date cursor (millisecond
--    precision) can never skip boundary rows that share a millisecond
--    (0015_board.sql already stores millisecond-truncated timestamps; 0016
--    stores raw clock_timestamp(), so truncation happens at the read seam).
--
-- Additive and rollback-safe: only new triggers/constraints plus
-- CREATE OR REPLACE of two routines; constraints are added NOT VALID and
-- validated in a guarded block so existing rows can never block the apply.

begin;

-- ---------------------------------------------------------------------------
-- (1) Last-owner guard on board_moderators.
--
-- brownsync_add_board_moderator / brownsync_remove_board_moderator already
-- fail closed on sole-owner demotion/removal ("concurrent owner demotions
-- cannot strand the board without an owner", 0015_board.sql), but the
-- profiles ON DELETE CASCADE path bypassed both guards: the sole owner
-- deleting their account stranded the board with no in-band recovery.
-- ---------------------------------------------------------------------------

create function public.brownsync_board_moderators_guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' then
    -- Same deterministic authority-set lock order the moderator RPCs use, so
    -- concurrent owner removals serialize instead of both passing the check.
    perform 1
    from public.board_moderators as m
    order by m.user_id
    for update;

    if not exists (
      select 1
      from public.board_moderators as m
      where m.role = 'owner'
        and m.user_id <> old.user_id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
    end if;
  end if;

  return old;
end
$$;

create trigger brownsync_board_moderators_last_owner_guard
  before delete on public.board_moderators
  for each row
  execute function public.brownsync_board_moderators_guard_last_owner();

-- Same body as 0015_board.sql plus one admission check: a sole board owner
-- must transfer ownership before account deletion, surfaced as the lane's
-- TERMINAL_CONFLICT so the API can answer 409 BEFORE any fence is written or
-- the Supabase Auth Admin deletion is attempted. The check runs after the
-- fence-replay fast paths: a fenced token already completed cleanup and only
-- replays, and the DELETE trigger above still backstops the final cascade.
create or replace function public.brownsync_delete_board_account(
  p_actor uuid,
  p_author_token text
)
returns table (
  posts_tombstoned integer,
  comments_tombstoned integer,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_posts integer;
  v_comments integer;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
begin
  perform public.brownsync_validate_board_token(p_author_token, 1);

  -- The exact durable fence is the retry record. It must be resolved before
  -- admission because the outer Auth deletion may have committed while its
  -- HTTP response was lost.
  if exists (
    select 1
    from public.board_account_deletion_fences as f
    where f.author_token = p_author_token
      and f.token_version = 1
  ) then
    delete from public.board_rate_limits
    where board_rate_limits.author_token = p_author_token;
    return query select 0, 0, true;
    return;
  end if;

  perform public.brownsync_require_board_actor(p_actor);
  perform public.brownsync_lock_board_control(false);
  perform public.brownsync_lock_board_author(p_author_token, 1);

  if exists (
    select 1
    from public.board_account_deletion_fences as f
    where f.author_token = p_author_token
      and f.token_version = 1
  ) then
    delete from public.board_rate_limits
    where board_rate_limits.author_token = p_author_token;
    return query select 0, 0, true;
    return;
  end if;

  -- 0019: a sole owner cannot delete their account before transferring board
  -- ownership; otherwise the profiles cascade would strand the board with
  -- zero owners (the invariant brownsync_add/remove_board_moderator enforce).
  if exists (
    select 1
    from public.board_moderators as m
    where m.user_id = p_actor
  ) then
    perform 1
    from public.board_moderators as m
    order by m.user_id
    for update;

    if exists (
      select 1
      from public.board_moderators as m
      where m.user_id = p_actor
        and m.role = 'owner'
    ) and not exists (
      select 1
      from public.board_moderators as m
      where m.role = 'owner'
        and m.user_id <> p_actor
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
    end if;
  end if;

  insert into public.board_account_deletion_fences (
    author_token,
    token_version
  ) values (
    p_author_token,
    1
  );

  perform 1
  from public.board_posts as p
  where p.author_token = p_author_token
  order by p.id
  for update;

  perform 1
  from public.board_comments as c
  where c.author_token = p_author_token
  order by c.post_id, c.id
  for update;

  select pg_catalog.count(*)::integer
  into v_posts
  from public.board_posts as p
  where p.author_token = p_author_token;

  select pg_catalog.count(*)::integer
  into v_comments
  from public.board_comments as c
  where c.author_token = p_author_token;

  update public.board_reports
  set state = 'dismissed',
      reviewed_at = v_now,
      updated_at = v_now
  where state = 'open'
    and (
      post_id in (
        select p.id
        from public.board_posts as p
        where p.author_token = p_author_token
      )
      or comment_id in (
        select c.id
        from public.board_comments as c
        where c.author_token = p_author_token
           or c.post_id in (
             select p.id
             from public.board_posts as p
             where p.author_token = p_author_token
           )
      )
    );

  delete from public.board_appeals
  where board_appeals.state = 'pending'
    and (
      board_appeals.post_id in (
        select p.id
        from public.board_posts as p
        where p.author_token = p_author_token
      )
      or board_appeals.comment_id in (
        select c.id
        from public.board_comments as c
        where c.author_token = p_author_token
           or c.post_id in (
             select p.id
             from public.board_posts as p
             where p.author_token = p_author_token
           )
      )
    );

  delete from public.board_votes
  where author_token = p_author_token;

  delete from public.board_reports
  where reporter_token = p_author_token;

  delete from public.board_appeals
  where author_token = p_author_token
    and state = 'pending';

  -- Decided content appeals may remain as body-free moderation history, but
  -- each receives its own unlinkable token. Ban appeals disappear with bans.
  update public.board_appeals
  set author_token = pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(
            pg_catalog.gen_random_uuid()::text,
            'UTF8'
          )
        ),
        'hex'
      ),
      body = null,
      updated_at = v_now
  where author_token = p_author_token
    and state <> 'pending'
    and ban_id is null;

  delete from public.board_bans
  where author_token = p_author_token;

  update public.board_posts
  set author_token = pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(
            pg_catalog.gen_random_uuid()::text,
            'UTF8'
          )
        ),
        'hex'
      ),
      create_fingerprint = null,
      title = null,
      body = null,
      visibility = 'account_deleted',
      revision = board_posts.revision + 1,
      updated_at = v_now
  where author_token = p_author_token;

  update public.board_comments
  set author_token = pg_catalog.encode(
        pg_catalog.sha256(
          pg_catalog.convert_to(
            pg_catalog.gen_random_uuid()::text,
            'UTF8'
          )
        ),
        'hex'
      ),
      create_fingerprint = null,
      body = null,
      visibility = 'account_deleted',
      revision = board_comments.revision + 1,
      updated_at = v_now
  where author_token = p_author_token;

  delete from public.board_rate_limits
  where author_token = p_author_token;

  return query
  select coalesce(v_posts, 0), coalesce(v_comments, 0), false;
end
$$;

-- ---------------------------------------------------------------------------
-- (3) profiles direct-write hardening.
--
-- 0011 grants authenticated UPDATE on five profile columns straight through
-- PostgREST, but 0010 declared no value constraint beyond the handle shape
-- and no rate limit reaches a direct table write. Every other member-writable
-- field in the lane is validated (0014 org_overrides URL/length checks, 0012
-- presence note cap); profiles now matches.
-- ---------------------------------------------------------------------------

-- NOT VALID so pre-existing rows can never block the apply; a guarded
-- validation attempt follows. A constraint left NOT VALID still rejects every
-- new write, which is the security property this migration needs.
alter table public.profiles
  add constraint profiles_display_name_ck check (
    pg_catalog.char_length(display_name) <= 80
  ) not valid;

alter table public.profiles
  add constraint profiles_avatar_url_ck check (
    avatar_url is null
    or (
      pg_catalog.char_length(avatar_url) <= 2048
      and avatar_url ~ '^https://[^[:space:]]+$'
    )
  ) not valid;

alter table public.profiles
  add constraint profiles_class_year_ck check (
    class_year is null
    or class_year between 1900 and 2100
  ) not valid;

alter table public.profiles
  add constraint profiles_concentration_ck check (
    concentration is null
    or pg_catalog.char_length(concentration) <= 120
  ) not valid;

alter table public.profiles
  add constraint profiles_bio_ck check (
    bio is null
    or pg_catalog.char_length(bio) <= 2000
  ) not valid;

do $$
declare
  v_constraint text;
begin
  foreach v_constraint in array array[
    'profiles_display_name_ck',
    'profiles_avatar_url_ck',
    'profiles_class_year_ck',
    'profiles_concentration_ck',
    'profiles_bio_ck'
  ] loop
    begin
      execute pg_catalog.format(
        'alter table public.profiles validate constraint %I',
        v_constraint
      );
    exception when check_violation then
      raise warning
        'profiles constraint % left NOT VALID: pre-existing rows violate it',
        v_constraint;
    end;
  end loop;
end
$$;

-- Same body as 0010_identity.sql plus one clamp: Google metadata may carry an
-- arbitrarily long full_name and profiles_display_name_ck must never abort a
-- signup, so the derived display name is bounded before insert.
create or replace function public.brownsync_insert_profile(
  p_id uuid,
  p_email text,
  p_user_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt      int;
  v_base         text;
  v_candidate    text;
  v_display_name text;
  v_inserted     int;
  v_suffix       text;
  v_uuid_hex     text := pg_catalog.replace(p_id::text, '-', '');
begin
  v_base := pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.split_part(coalesce(p_email, ''), '@', 1)),
    '[^a-z0-9_]+',
    '_',
    'g'
  );
  v_base := pg_catalog.regexp_replace(v_base, '_+', '_', 'g');
  v_base := pg_catalog.btrim(v_base, '_');
  v_base := pg_catalog.rtrim(pg_catalog.left(v_base, 24), '_');

  if pg_catalog.length(v_base) < 3 then
    if v_base = '' then
      v_base := 'member_' || pg_catalog.left(v_uuid_hex, 8);
    else
      v_base := v_base || '_' || pg_catalog.left(v_uuid_hex, 8);
    end if;
  end if;
  v_base := pg_catalog.rtrim(pg_catalog.left(v_base, 24), '_');

  v_display_name := coalesce(
    nullif(
      pg_catalog.btrim(
        coalesce(
          p_user_metadata ->> 'full_name',
          p_user_metadata ->> 'name',
          ''
        )
      ),
      ''
    ),
    nullif(
      pg_catalog.split_part(coalesce(p_email, ''), '@', 1),
      ''
    ),
    'Brown Student'
  );

  -- 0019: profiles_display_name_ck bounds the column; signup must clamp, not
  -- fail, when the Google-provided name exceeds it.
  v_display_name := pg_catalog.left(v_display_name, 80);

  for v_attempt in 0..8 loop
    if v_attempt = 0 then
      v_candidate := v_base;
    else
      v_suffix := pg_catalog.left(
        pg_catalog.md5(p_id::text || ':' || v_attempt::text),
        8
      );
      v_candidate :=
        pg_catalog.left(v_base, 24 - 1 - pg_catalog.length(v_suffix))
        || '_'
        || v_suffix;
    end if;

    v_inserted := null;
    insert into public.profiles (id, handle, display_name)
    values (p_id, v_candidate, v_display_name)
    on conflict do nothing
    returning 1 into v_inserted;

    if v_inserted = 1 then
      return;
    end if;
  end loop;

  raise exception using
    errcode = 'P0001',
    message = 'BROWNSYNC_PROFILE_HANDLE_EXHAUSTED';
end
$$;

-- Direct PostgREST profile writes share the 0012 'shared' social write
-- budget. SECURITY DEFINER so brownsync_consume_social_write_limit stays a
-- client-unexecutable internal helper (the 0012 checks pin that). The gate is
-- auth.uid(): a PostgREST client write always carries a JWT subject (and the
-- owner-update RLS policy pins it to the row id), while the Worker/owner
-- connection carries no request.jwt claims and passes through untouched.
create function public.brownsync_profiles_direct_write_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and auth.uid() = old.id then
    perform public.brownsync_consume_social_write_limit('shared');
  end if;
  return new;
end
$$;

create trigger brownsync_profiles_direct_write_limit
  before update on public.profiles
  for each row
  execute function public.brownsync_profiles_direct_write_limit();

-- ---------------------------------------------------------------------------
-- (4) Millisecond-safe user-event management keyset.
--
-- Same body as 0016_user_events.sql except the keyset compares and orders on
-- date_trunc('milliseconds', e.updated_at) and returns the truncated value,
-- so the Worker cursor (Date#toISOString, millisecond floor) round-trips
-- exactly and boundary rows sharing a millisecond are never skipped.
-- ---------------------------------------------------------------------------

create or replace function public.brownsync_list_user_events(
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
      pg_catalog.date_trunc('milliseconds', e.updated_at) as updated_at
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
        or pg_catalog.date_trunc('milliseconds', e.updated_at)
             < p_before_updated_at
        or (
          pg_catalog.date_trunc('milliseconds', e.updated_at)
            = p_before_updated_at
          and e.id < p_before_event_id
        )
      )
    order by pg_catalog.date_trunc('milliseconds', e.updated_at) desc,
             e.id desc
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

-- New helpers stay owner-only, matching the lane conventions. The replaced
-- routines keep their existing (already revoked) ACLs.
revoke all on function public.brownsync_board_moderators_guard_last_owner()
  from public, anon, authenticated;
revoke all on function public.brownsync_profiles_direct_write_limit()
  from public, anon, authenticated;

commit;
