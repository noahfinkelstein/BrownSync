-- 0011_rls_checks.sql — rollback-safe semantic checks for grants and RLS.
begin;

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not exists (
        select 1
        from pg_depend d
        join pg_extension e on e.oid = d.refobjid
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.refclassid = 'pg_extension'::regclass
          and d.deptype = 'e'
      )
      and not c.relrowsecurity
  ) then
    raise exception 'one or more application-owned public tables lack RLS';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not exists (
        select 1
        from pg_depend d
        join pg_extension e on e.oid = d.refobjid
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.refclassid = 'pg_extension'::regclass
          and d.deptype = 'e'
      )
      and c.relforcerowsecurity
  ) then
    raise exception 'FORCE ROW LEVEL SECURITY must remain disabled for owner paths';
  end if;

  if to_regclass('public.board_identity_escrow') is not null then
    raise exception 'future board_identity_escrow relation exists during Step 3';
  end if;
end
$$;

do $$
declare
  table_name text;
  role_name text;
begin
  foreach table_name in array array[
    'places',
    'organizations',
    'events',
    'course_meetings',
    'term_calendar'
  ] loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if not has_table_privilege(
        role_name,
        format('public.%I', table_name),
        'select'
      ) then
        raise exception '% lacks SELECT on public.%', role_name, table_name;
      end if;
    end loop;
  end loop;

  foreach table_name in array array[
    'source_runs',
    'source_registry',
    'place_aliases'
  ] loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if has_table_privilege(
        role_name,
        format('public.%I', table_name),
        'select'
      ) then
        raise exception '% unexpectedly has SELECT on public.%', role_name, table_name;
      end if;
    end loop;
  end loop;

  if has_table_privilege('anon', 'public.profiles', 'select')
     or not has_table_privilege('authenticated', 'public.profiles', 'select') then
    raise exception 'profile SELECT grants are not member-only';
  end if;

  if has_table_privilege('authenticated', 'public.profiles', 'insert')
     or has_table_privilege('authenticated', 'public.profiles', 'delete')
     or has_table_privilege('authenticated', 'public.profiles', 'update') then
    raise exception 'authenticated received a table-wide profile write grant';
  end if;

  foreach table_name in array array[
    'display_name',
    'avatar_url',
    'class_year',
    'concentration',
    'bio'
  ] loop
    if not has_column_privilege(
      'authenticated',
      'public.profiles',
      table_name,
      'update'
    ) then
      raise exception 'authenticated lacks profile UPDATE on editable column %', table_name;
    end if;
  end loop;

  foreach table_name in array array[
    'id',
    'handle',
    'created_at',
    'updated_at'
  ] loop
    if has_column_privilege(
      'authenticated',
      'public.profiles',
      table_name,
      'update'
    ) then
      raise exception 'authenticated can UPDATE protected profile column %', table_name;
    end if;
  end loop;
end
$$;

insert into public.places (
  id, name, aliases, kind, lat, lng, source
) values (
  'rls-check-place', 'RLS Check Place', '{}', 'other', 41.0, -71.0, 'rls-check'
);

insert into public.organizations (
  id, name, kind, source
) values (
  'rls-check-org', 'RLS Check Org', 'club', 'rls-check'
);

insert into public.events (
  id, source, source_id, title, start_ts
) values (
  '40000000-0000-4000-8000-000000000001',
  'rls-check',
  'event-1',
  'RLS Check Event',
  '2026-07-29 12:00:00+00'
);

insert into public.course_meetings (
  id, srcdb, crn, course_code, title, days, start_time, end_time
) values (
  'rls-check-meeting',
  'rls-check-term',
  'rls-check-crn',
  'TEST 0001',
  'RLS Check Meeting',
  'W',
  '12:00',
  '13:00'
);

insert into public.term_calendar (srcdb, start_date, end_date)
values ('rls-check-term', '2026-07-01', '2026-08-01');

insert into public.source_runs (
  source, started_at, status
) values (
  'rls-check', '2026-07-29 12:00:00+00', 'ok'
);

insert into public.source_registry (
  source,
  label,
  lane,
  enabled,
  cadence_seconds,
  stale_after_seconds
) values (
  'rls-check',
  'RLS Check',
  'sql',
  true,
  60,
  120
);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  (
    '50000000-0000-4000-8000-000000000001',
    'rls.owner@brown.edu',
    '{"full_name":"RLS Owner"}',
    '{"provider":"google"}'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    'rls.other@brown.edu',
    '{"full_name":"RLS Other"}',
    '{"providers":["google"]}'
  );

set local role anon;

do $$
begin
  if (select count(*) from public.places where id = 'rls-check-place') <> 1
     or (select count(*) from public.organizations where id = 'rls-check-org') <> 1
     or (select count(*) from public.events where id = '40000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.course_meetings where id = 'rls-check-meeting') <> 1
     or (select count(*) from public.term_calendar where srcdb = 'rls-check-term') <> 1 then
    raise exception 'anon public-read behavior did not return seeded rows';
  end if;
end
$$;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"50000000-0000-4000-8000-000000000001","email":"rls.owner@brown.edu","app_metadata":{"provider":"google"}}',
  true
);

do $$
declare
  affected integer;
begin
  if (select count(*) from public.places where id = 'rls-check-place') <> 1
     or (select count(*) from public.organizations where id = 'rls-check-org') <> 1
     or (select count(*) from public.events where id = '40000000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.course_meetings where id = 'rls-check-meeting') <> 1
     or (select count(*) from public.term_calendar where srcdb = 'rls-check-term') <> 1 then
    raise exception 'authenticated public-read behavior did not return seeded rows';
  end if;

  if (select count(*) from public.profiles) < 2 then
    raise exception 'eligible member could not read profiles';
  end if;

  update public.profiles
  set display_name = 'RLS Owner Updated',
      bio = 'editable'
  where id = '50000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'owner could not update own editable profile fields';
  end if;

  update public.profiles
  set display_name = 'Cross-user write'
  where id = '50000000-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'owner updated another profile';
  end if;
end
$$;

do $$
declare
  blocked boolean := false;
begin
  begin
    update public.profiles
    set handle = 'protected_handle'
    where id = '50000000-0000-4000-8000-000000000001';
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'authenticated client updated protected profile column';
  end if;
end
$$;

do $$
declare
  blocked boolean := false;
begin
  begin
    insert into public.profiles (id, handle, display_name)
    values (
      '50000000-0000-4000-8000-000000000003',
      'direct_insert',
      'Direct Insert'
    );
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'authenticated client inserted profile directly';
  end if;
end
$$;

do $$
declare
  blocked boolean := false;
begin
  begin
    delete from public.profiles
    where id = '50000000-0000-4000-8000-000000000001';
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'authenticated client deleted profile directly';
  end if;
end
$$;

reset role;
set local role anon;

do $$
declare
  table_name text;
  blocked boolean;
begin
  foreach table_name in array array[
    'source_runs',
    'source_registry',
    'place_aliases'
  ] loop
    blocked := false;
    begin
      execute format('select 1 from public.%I limit 1', table_name);
    exception when insufficient_privilege then
      blocked := true;
    end;
    if not blocked then
      raise exception 'anon directly read internal table public.%', table_name;
    end if;
  end loop;
end
$$;

reset role;
set local role authenticated;

do $$
declare
  table_name text;
  blocked boolean;
begin
  foreach table_name in array array[
    'source_runs',
    'source_registry',
    'place_aliases'
  ] loop
    blocked := false;
    begin
      execute format('select 1 from public.%I limit 1', table_name);
    exception when insufficient_privilege then
      blocked := true;
    end;
    if not blocked then
      raise exception 'authenticated directly read internal table public.%', table_name;
    end if;
  end loop;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"50000000-0000-4000-8000-000000000001","email":"attacker@example.com","app_metadata":{"provider":"google"},"user_metadata":{"email_verified":true}}',
  true
);

do $$
begin
  if (select count(*) from public.profiles) <> 0 then
    raise exception 'non-Brown JWT read member profiles';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"50000000-0000-4000-8000-000000000001","email":"rls.owner@brown.edu","app_metadata":{"provider":"github"},"user_metadata":{"provider":"google","email_verified":true}}',
  true
);

do $$
begin
  if (select count(*) from public.profiles) <> 0 then
    raise exception 'non-Google JWT read member profiles';
  end if;
end
$$;

reset role;

update public.profiles
set handle = 'owner_path_ok'
where id = '50000000-0000-4000-8000-000000000001';

do $$
begin
  if (
    select handle <> 'owner_path_ok'
    from public.profiles
    where id = '50000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'database owner path could not update protected profile field';
  end if;

  if not exists (
    select 1
    from public.source_runs
    where source = 'rls-check'
  ) then
    raise exception 'database owner path could not read internal table';
  end if;
end
$$;

rollback;
