\set ON_ERROR_STOP on

-- 0019_p1_hardening_checks.sql
-- Rollback-safe semantic checks for the four 0019 P1 hardening fixes.

begin;

-- Structural admission: everything 0019 promises must exist.
do $$
begin
  if pg_catalog.to_regprocedure(
       'public.brownsync_board_moderators_guard_last_owner()'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.brownsync_profiles_direct_write_limit()'
     ) is null
     or not exists (
       select 1
       from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.board_moderators'::regclass
         and t.tgname = 'brownsync_board_moderators_last_owner_guard'
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.profiles'::regclass
         and t.tgname = 'brownsync_profiles_direct_write_limit'
     ) then
    raise exception 'BROWNSYNC_0019_MIGRATION_MISSING: triggers or routines';
  end if;

  -- In a disposable container every pre-existing row satisfies the new
  -- profile constraints, so the guarded VALIDATE must have completed.
  if exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.conname in (
        'profiles_display_name_ck',
        'profiles_avatar_url_ck',
        'profiles_class_year_ck',
        'profiles_concentration_ck',
        'profiles_bio_ck'
      )
      and not c.convalidated
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.conname in (
        'profiles_display_name_ck',
        'profiles_avatar_url_ck',
        'profiles_class_year_ck',
        'profiles_concentration_ck',
        'profiles_bio_ck'
      )
  ) <> 5 then
    raise exception 'BROWNSYNC_0019_MIGRATION_MISSING: profile constraints';
  end if;

  -- The shared limiter stays an internal helper (0012 pins this): the
  -- profiles trigger reaches it through SECURITY DEFINER, never a grant.
  if pg_catalog.has_function_privilege(
    'authenticated',
    'public.brownsync_consume_social_write_limit(text)',
    'execute'
  ) then
    raise exception
      'the shared social write limiter became client-executable';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  (
    'c9000000-0000-4000-8000-000000000001',
    'hardening.owner@brown.edu',
    '{"full_name":"Hardening Owner"}',
    '{"provider":"google"}'
  ),
  (
    'c9000000-0000-4000-8000-000000000002',
    'hardening.successor@brown.edu',
    '{"full_name":"Hardening Successor"}',
    '{"provider":"google"}'
  ),
  (
    'c9000000-0000-4000-8000-000000000003',
    'hardening.moderator@brown.edu',
    '{"full_name":"Hardening Moderator"}',
    '{"providers":["google"]}'
  ),
  (
    'c9000000-0000-4000-8000-000000000004',
    'hardening.member@brown.edu',
    '{"full_name":"Hardening Member"}',
    '{"provider":"google"}'
  ),
  (
    'c9000000-0000-4000-8000-000000000005',
    'hardening.events@brown.edu',
    '{"full_name":"Hardening Events"}',
    '{"provider":"google"}'
  );

insert into public.board_moderators (user_id, role)
values
  ('c9000000-0000-4000-8000-000000000001', 'owner'),
  ('c9000000-0000-4000-8000-000000000003', 'moderator');

-- ---------------------------------------------------------------------------
-- (1) The board owner set can never cascade (or be deleted) to zero.
-- ---------------------------------------------------------------------------

do $$
declare
  v_owner constant uuid := 'c9000000-0000-4000-8000-000000000001';
  v_successor constant uuid := 'c9000000-0000-4000-8000-000000000002';
  v_moderator constant uuid := 'c9000000-0000-4000-8000-000000000003';
  v_owner_token constant text := pg_catalog.repeat('9', 64);
  v_blocked boolean;
  v_row record;
begin
  -- The sole owner's account deletion cascade (auth.users -> profiles ->
  -- board_moderators) must fail closed with the lane's terminal conflict.
  v_blocked := false;
  begin
    delete from auth.users where id = v_owner;
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
  end;
  if not v_blocked
     or not exists (
       select 1 from public.board_moderators m
       where m.user_id = v_owner and m.role = 'owner'
     ) then
    raise exception 'sole-owner cascade was not blocked';
  end if;

  -- A direct owner-connection delete of the last owner row is equally blocked.
  v_blocked := false;
  begin
    delete from public.board_moderators where user_id = v_owner;
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
  end;
  if not v_blocked then
    raise exception 'direct sole-owner row delete was not blocked';
  end if;

  -- The cleanup routine reports the conflict up front (the API's typed 409)
  -- and must not install a deletion fence for the rejected attempt.
  v_blocked := false;
  begin
    perform * from public.brownsync_delete_board_account(v_owner, v_owner_token);
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_BOARD_TERMINAL_CONFLICT';
  end;
  if not v_blocked
     or exists (
       select 1 from public.board_account_deletion_fences f
       where f.author_token = v_owner_token
     ) then
    raise exception 'sole-owner cleanup did not conflict fence-free';
  end if;

  -- A sole MODERATOR (non-owner) account still deletes freely.
  delete from auth.users where id = v_moderator;
  if exists (
    select 1 from public.board_moderators m where m.user_id = v_moderator
  ) then
    raise exception 'moderator cascade did not remove the authority row';
  end if;

  -- After ownership transfer the original owner can clean up and delete.
  insert into public.board_moderators (user_id, role)
  values (v_successor, 'owner');

  select * into v_row
  from public.brownsync_delete_board_account(v_owner, v_owner_token);
  if v_row.replayed
     or not exists (
       select 1 from public.board_account_deletion_fences f
       where f.author_token = v_owner_token and f.token_version = 1
     ) then
    raise exception 'post-transfer cleanup did not fence';
  end if;

  delete from auth.users where id = v_owner;
  if exists (select 1 from public.board_moderators m where m.user_id = v_owner)
     or (
       select pg_catalog.count(*) from public.board_moderators m
       where m.role = 'owner'
     ) <> 1 then
    raise exception 'post-transfer account deletion drifted';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- (3) Direct client profile writes are value-constrained and rate-limited.
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c9000000-0000-4000-8000-000000000004","email":"hardening.member@brown.edu","app_metadata":{"provider":"google"}}',
  true
);

do $$
declare
  v_member constant uuid := 'c9000000-0000-4000-8000-000000000004';
  v_hostile text;
  v_blocked boolean;
  affected integer;
begin
  -- A well-formed self-update stays possible.
  update public.profiles
  set display_name = 'Hardened Member',
      avatar_url = 'https://cdn.example.edu/avatar.png',
      class_year = 2027,
      concentration = 'Computer Science',
      bio = 'A perfectly reasonable bio.'
  where id = v_member;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'owner could not perform a valid direct profile update';
  end if;

  -- Hostile or absurd values must be rejected by CHECK constraints.
  foreach v_hostile in array array[
    'javascript:fetch(''https://evil.example'')',
    'data:text/html,<script>alert(1)</script>',
    'http://insecure.example/avatar.png',
    'https://example.edu/' || pg_catalog.repeat('a', 2048)
  ] loop
    v_blocked := false;
    begin
      update public.profiles
      set avatar_url = v_hostile
      where id = v_member;
    exception when check_violation then
      v_blocked := true;
    end;
    if not v_blocked then
      raise exception 'hostile avatar_url was stored: %',
        pg_catalog.left(v_hostile, 40);
    end if;
  end loop;

  v_blocked := false;
  begin
    update public.profiles
    set bio = pg_catalog.repeat('b', 2001)
    where id = v_member;
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'unbounded bio was stored';
  end if;

  v_blocked := false;
  begin
    update public.profiles
    set display_name = pg_catalog.repeat('d', 81)
    where id = v_member;
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'unbounded display_name was stored';
  end if;

  v_blocked := false;
  begin
    update public.profiles
    set concentration = pg_catalog.repeat('c', 121)
    where id = v_member;
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'unbounded concentration was stored';
  end if;

  foreach v_hostile in array array['1899', '2101'] loop
    v_blocked := false;
    begin
      update public.profiles
      set class_year = v_hostile::integer
      where id = v_member;
    exception when check_violation then
      v_blocked := true;
    end;
    if not v_blocked then
      raise exception 'absurd class_year % was stored', v_hostile;
    end if;
  end loop;
end
$$;

reset role;
-- The 0019 limiter trigger keys on auth.uid(); clear the impersonated claims
-- so owner-path statements below exercise the real owner-connection state.
select set_config('request.jwt.claims', '', true);

-- The successful direct write above consumed exactly one unit of the shared
-- social write budget; the constraint-rejected attempts rolled back theirs.
do $$
begin
  if (
    select l.count
    from public.social_write_limits l
    where l.user_id = 'c9000000-0000-4000-8000-000000000004'
      and l.bucket = 'shared'
  ) is distinct from 1 then
    raise exception 'direct profile write did not consume the shared budget';
  end if;
end
$$;

-- Exhausted shared budget blocks further direct profile writes.
update public.social_write_limits
set count = 20,
    window_started_at = pg_catalog.clock_timestamp()
where user_id = 'c9000000-0000-4000-8000-000000000004'
  and bucket = 'shared';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c9000000-0000-4000-8000-000000000004","email":"hardening.member@brown.edu","app_metadata":{"provider":"google"}}',
  true
);

do $$
declare
  v_blocked boolean := false;
begin
  begin
    update public.profiles
    set bio = 'one write too many'
    where id = 'c9000000-0000-4000-8000-000000000004';
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_SOCIAL_RATE_LIMITED';
  end;
  if not v_blocked then
    raise exception 'exhausted shared budget did not block a direct write';
  end if;
end
$$;

reset role;
select set_config('request.jwt.claims', '', true);

-- The owner/Worker path bypasses the client limiter but not the constraints.
do $$
declare
  v_blocked boolean := false;
begin
  update public.profiles
  set display_name = 'Owner Path Update'
  where id = 'c9000000-0000-4000-8000-000000000004';

  if (
    select l.count
    from public.social_write_limits l
    where l.user_id = 'c9000000-0000-4000-8000-000000000004'
      and l.bucket = 'shared'
  ) <> 20 then
    raise exception 'owner path consumed the client shared budget';
  end if;

  begin
    update public.profiles
    set avatar_url = 'javascript:alert(1)'
    where id = 'c9000000-0000-4000-8000-000000000004';
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'owner path stored a hostile avatar_url';
  end if;
end
$$;

-- Signup clamps an oversized Google display name instead of failing.
do $$
begin
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (
    'c9000000-0000-4000-8000-000000000006',
    'hardening.longname@brown.edu',
    pg_catalog.jsonb_build_object('full_name', pg_catalog.repeat('n', 200)),
    '{"provider":"google"}'
  );

  if (
    select pg_catalog.char_length(p.display_name)
    from public.profiles p
    where p.id = 'c9000000-0000-4000-8000-000000000006'
  ) is distinct from 80 then
    raise exception 'oversized signup display_name was not clamped to 80';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- (4) Management pagination never skips boundary-millisecond events.
-- ---------------------------------------------------------------------------

insert into public.places (
  id, name, aliases, kind, lat, lng, source
) values (
  'hardening-check-place', 'Hardening Check Place', '{}', 'other',
  41.0, -71.0, 'hardening-check'
);

insert into public.user_events (
  id, created_by, client_request_id, payload_fingerprint,
  title, start_ts, place_id, category, updated_at
) values
  (
    'c9100000-0000-4000-8000-000000000002',
    'c9000000-0000-4000-8000-000000000005',
    'c9200000-0000-4000-8000-000000000002',
    pg_catalog.repeat('a', 32),
    'Boundary high microseconds',
    '2026-09-01 12:00:00+00',
    'hardening-check-place',
    'social',
    '2026-08-01 12:00:00.123700+00'
  ),
  (
    'c9100000-0000-4000-8000-000000000001',
    'c9000000-0000-4000-8000-000000000005',
    'c9200000-0000-4000-8000-000000000001',
    pg_catalog.repeat('b', 32),
    'Boundary low microseconds',
    '2026-09-01 13:00:00+00',
    'hardening-check-place',
    'social',
    '2026-08-01 12:00:00.123200+00'
  ),
  (
    'c9100000-0000-4000-8000-000000000000',
    'c9000000-0000-4000-8000-000000000005',
    'c9200000-0000-4000-8000-000000000000',
    pg_catalog.repeat('c', 32),
    'Earlier millisecond',
    '2026-09-01 14:00:00+00',
    'hardening-check-place',
    'social',
    '2026-08-01 12:00:00.100000+00'
  );

do $$
declare
  v_actor constant uuid := 'c9000000-0000-4000-8000-000000000005';
  v_page1 record;
  v_page2 record;
  v_page3 record;
begin
  select * into v_page1
  from public.brownsync_list_user_events(v_actor, null, null, 1);

  -- The returned boundary timestamp must already be millisecond-exact so the
  -- Worker's JS-Date cursor (Date#toISOString) round-trips identically.
  if v_page1.event_id <> 'c9100000-0000-4000-8000-000000000002'
     or not v_page1.has_more
     or v_page1.updated_at
        <> pg_catalog.date_trunc('milliseconds', v_page1.updated_at)
     or v_page1.updated_at <> '2026-08-01 12:00:00.123+00'::timestamptz then
    raise exception 'page 1 boundary row or cursor precision drifted';
  end if;

  -- Page 2 must surface the OTHER event in the same millisecond — the exact
  -- row the pre-0019 raw-timestamp keyset silently skipped.
  select * into v_page2
  from public.brownsync_list_user_events(
    v_actor, v_page1.updated_at, v_page1.event_id, 1
  );
  if v_page2.event_id <> 'c9100000-0000-4000-8000-000000000001'
     or not v_page2.has_more then
    raise exception
      'pagination skipped the boundary-millisecond event (got %)',
      v_page2.event_id;
  end if;

  select * into v_page3
  from public.brownsync_list_user_events(
    v_actor, v_page2.updated_at, v_page2.event_id, 1
  );
  if v_page3.event_id <> 'c9100000-0000-4000-8000-000000000000'
     or v_page3.has_more then
    raise exception 'pagination tail drifted';
  end if;
end
$$;

rollback;
