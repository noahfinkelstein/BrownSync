-- 0010_identity_checks.sql — rollback-safe semantic checks for identity.
begin;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values (
  '10000000-0000-4000-8000-000000000001',
  'First.Last+tag@brown.edu',
  '{"full_name":"First Student"}',
  '{"provider":"google","providers":["google"]}'
);

do $$
begin
  if (
    select count(*) <> 1
    from public.profiles
    where id = '10000000-0000-4000-8000-000000000001'
      and handle = 'first_last_tag'
      and display_name = 'First Student'
  ) then
    raise exception 'eligible Brown/Google insert did not create exactly one profile';
  end if;
end
$$;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values (
  '10000000-0000-4000-8000-000000000002',
  'CASE.TEST@BROWN.EDU',
  '{"name":"Case Student"}',
  '{"providers":["google"]}'
);

do $$
begin
  if not exists (
    select 1
    from public.profiles
    where id = '10000000-0000-4000-8000-000000000002'
      and handle = 'case_test'
  ) then
    raise exception 'case-insensitive Brown email was not admitted';
  end if;
end
$$;

do $$
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
    values (
      '10000000-0000-4000-8000-000000000003',
      'outsider@example.com',
      '{"email_verified":true}',
      '{"provider":"google"}'
    );
    raise exception 'non-Brown email was admitted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'BROWNSYNC_ADMISSION_DENIED' then
        raise;
      end if;
  end;

  if exists (
    select 1 from auth.users
    where id = '10000000-0000-4000-8000-000000000003'
  ) or exists (
    select 1 from public.profiles
    where id = '10000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'rejected non-Brown user left a partial row';
  end if;
end
$$;

do $$
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
    values (
      '10000000-0000-4000-8000-000000000004',
      'spoofed@brown.edu',
      '{"email_verified":true,"provider":"google"}',
      '{"provider":"email","providers":["email"]}'
    );
    raise exception 'user-editable Google/verified spoof was admitted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'BROWNSYNC_ADMISSION_DENIED' then
        raise;
      end if;
  end;

  if exists (
    select 1 from auth.users
    where id = '10000000-0000-4000-8000-000000000004'
  ) or exists (
    select 1 from public.profiles
    where id = '10000000-0000-4000-8000-000000000004'
  ) then
    raise exception 'rejected untrusted-provider user left a partial row';
  end if;
end
$$;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  (
    '20000000-0000-4000-8000-000000000001',
    'a@brown.edu',
    '{}',
    '{"provider":"google"}'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'this.local-part-is-far-too-long-for-a-handle@brown.edu',
    '{}',
    '{"provider":"google"}'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '___Punctuation...And+++Runs___@brown.edu',
    '{}',
    '{"provider":"google"}'
  );

do $$
begin
  if exists (
    select 1
    from public.profiles
    where id in (
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000003'
    )
      and (
        handle !~ '^[a-z0-9_]{3,24}$'
        or handle ~ '^_'
        or handle ~ '_$'
        or handle ~ '__'
      )
  ) then
    raise exception 'derived handle violated normalization rules';
  end if;

  if (
    select length(handle) <> 24
    from public.profiles
    where id = '20000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'long handle was not bounded to 24 characters';
  end if;

  if (
    select handle <> 'punctuation_and_runs'
    from public.profiles
    where id = '20000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'punctuation/underscore normalization was not deterministic';
  end if;
end
$$;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  (
    '30000000-0000-4000-8000-000000000001',
    'collision@brown.edu',
    '{}',
    '{"provider":"google"}'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    'collision@brown.edu',
    '{}',
    '{"provider":"google"}'
  );

do $$
begin
  if (
    select handle <> 'collision'
    from public.profiles
    where id = '30000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'first collision fixture did not receive the base handle';
  end if;

  if (
    select handle <> 'collision_bf78d351'
    from public.profiles
    where id = '30000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'collision suffix was not the deterministic UUID-derived value';
  end if;

  if (
    select count(distinct handle) <> 2
    from public.profiles
    where id in (
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002'
    )
  ) then
    raise exception 'collision handling did not produce unique handles';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","email":"MEMBER@BROWN.EDU","app_metadata":{"providers":["google"]}}',
  true
);

do $$
begin
  if not public.is_brown_member() then
    raise exception 'trusted Brown/Google JWT was rejected';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","email":"member@brown.edu","app_metadata":{"provider":"email"},"user_metadata":{"email_verified":true,"provider":"google"}}',
  true
);

do $$
begin
  if public.is_brown_member() then
    raise exception 'user_metadata spoof satisfied is_brown_member()';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","email":"member@example.com","app_metadata":{"provider":"google"}}',
  true
);

do $$
begin
  if public.is_brown_member() then
    raise exception 'non-Brown JWT satisfied is_brown_member()';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","email":"member@brown.edu","app_metadata":{"providers":["github"]}}',
  true
);

do $$
begin
  if public.is_brown_member() then
    raise exception 'non-Google JWT satisfied is_brown_member()';
  end if;
end
$$;

delete from auth.users
where id = '10000000-0000-4000-8000-000000000002';

do $$
begin
  if exists (
    select 1 from public.profiles
    where id = '10000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'profile did not cascade when auth user was deleted';
  end if;
end
$$;

rollback;
