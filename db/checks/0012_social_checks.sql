-- 0012_social_checks.sql — rollback-safe semantic checks for friendship and
-- place-only presence.
begin;

-- This is deliberately first: before 0012_social.sql exists, ON_ERROR_STOP
-- must fail for the missing implementation rather than a later fixture error.
do $$
begin
  if to_regclass('public.friendships') is null
     or to_regclass('public.presence_shares') is null
     or to_regclass('public.presence_state') is null
     or to_regclass('public.checkins') is null
     or to_regclass('public.social_write_limits') is null
     or to_regprocedure('public.request_friend(uuid)') is null
     or to_regprocedure('public.create_checkin(text,text,interval)') is null
     or to_regprocedure('public.brownsync_consume_social_write_limit(text)') is null
     or to_regprocedure(
       'public.brownsync_configure_social_integrations()'
     ) is null then
    raise exception 'BROWNSYNC_SOCIAL_MIGRATION_MISSING';
  end if;
end
$$;

-- Structural privacy, RLS, primary keys, and integration wiring.
do $$
declare
  cron_job_present boolean;
  table_name text;
begin
  foreach table_name in array array[
    'friendships',
    'presence_shares',
    'presence_state',
    'checkins',
    'social_write_limits'
  ] loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = table_name
        and c.relkind in ('r', 'p')
        and c.relrowsecurity
        and not c.relforcerowsecurity
    ) then
      raise exception 'public.% is missing, lacks RLS, or forces RLS', table_name;
    end if;
  end loop;

  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in (
        'profiles',
        'friendships',
        'presence_shares',
        'presence_state',
        'checkins',
        'social_write_limits'
      )
      and (
        c.column_name ~* '(^|_)(lat|lng|latitude|longitude|geom|geometry|geography)($|_)'
        or c.udt_name in ('geometry', 'geography')
        or c.data_type in ('point', 'path', 'polygon')
      )
  ) then
    raise exception 'a user/social table can represent raw coordinates or geometry';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'presence_history',
        'presence_audit',
        'location_history',
        'location_log',
        'last_seen_at',
        'heatmap'
      )
  ) then
    raise exception 'a forbidden social location-history relation exists';
  end if;

  if to_regprocedure('public.delete_account()') is not null then
    raise exception 'dangerous SQL delete_account() RPC exists';
  end if;

  if exists (
    select 1
    from pg_publication p
    where p.pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication p
    where p.pubname = 'supabase_realtime'
      and (
        p.puballtables
        or exists (
          select 1
          from pg_publication_rel pr
          join pg_class c on c.oid = pr.prrelid
          join pg_namespace n on n.oid = c.relnamespace
          where pr.prpubid = p.oid
            and n.nspname = 'public'
            and c.relname = 'presence_state'
        )
      )
  ) then
    raise exception 'presence_state was not added to existing supabase_realtime publication';
  end if;

  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    if to_regclass('cron.job') is null then
      raise exception 'cron.schedule exists without inspectable cron.job catalog';
    end if;
    execute $query$
      select exists (
        select 1
        from cron.job
        where jobname = 'brownsync-social-cleanup-daily'
      )
    $query$ into cron_job_present;
    if not cron_job_present then
      raise exception 'existing cron.schedule did not receive stable social cleanup job';
    end if;
  end if;
end
$$;

-- Exact columns/nullability and key/index shape.
do $$
begin
  if (
    select array_agg(column_name order by ordinal_position)
           <> array[
             'requester',
             'addressee',
             'status',
             'blocked_by',
             'created_at',
             'responded_at'
           ]::information_schema.sql_identifier[]
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'friendships'
  ) then
    raise exception 'friendships columns drifted';
  end if;

  if (
    select array_agg(column_name order by ordinal_position)
           <> array['owner', 'viewer', 'expires_at', 'created_at']
              ::information_schema.sql_identifier[]
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'presence_shares'
  ) then
    raise exception 'presence_shares columns drifted';
  end if;

  if (
    select array_agg(column_name order by ordinal_position)
           <> array[
             'user_id',
             'place_id',
             'status',
             'note',
             'ghost',
             'updated_at',
             'expires_at'
           ]::information_schema.sql_identifier[]
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'presence_state'
  ) then
    raise exception 'presence_state columns drifted';
  end if;

  if (
    select array_agg(column_name order by ordinal_position)
           <> array['id', 'owner', 'place_id', 'note', 'created_at', 'expires_at']
              ::information_schema.sql_identifier[]
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'checkins'
  ) then
    raise exception 'checkins columns drifted';
  end if;

  if (
    select array_agg(column_name order by ordinal_position)
           <> array[
             'user_id',
             'bucket',
             'window_started_at',
             'count',
             'last_success_at'
           ]::information_schema.sql_identifier[]
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'social_write_limits'
  ) then
    raise exception 'social_write_limits columns drifted';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'friendships'
          and column_name in ('requester', 'addressee', 'status', 'created_at')
          and is_nullable <> 'NO')
        or
        (table_name = 'presence_shares'
          and column_name in ('owner', 'viewer', 'expires_at', 'created_at')
          and is_nullable <> 'NO')
        or
        (table_name = 'presence_state'
          and column_name in ('user_id', 'ghost', 'updated_at', 'expires_at')
          and is_nullable <> 'NO')
        or
        (table_name = 'checkins'
          and column_name in ('id', 'owner', 'place_id', 'created_at', 'expires_at')
          and is_nullable <> 'NO')
        or
        (table_name = 'social_write_limits'
          and column_name in ('user_id', 'bucket', 'window_started_at', 'count')
          and is_nullable <> 'NO')
      )
  ) then
    raise exception 'required social column is nullable';
  end if;

  if (
    select count(*) <> 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'friendships'
      and lower(indexdef) like
        '%unique index%least(requester, addressee)%greatest(requester, addressee)%'
  ) then
    raise exception 'friendships lacks the unordered-pair unique expression index';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'friendships'
      and indexdef like '%(addressee, status)%'
  ) then
    raise exception 'friendships lacks addressee/status lookup index';
  end if;
end
$$;

-- Exact keys and deletion semantics are part of the account-erasure and
-- place-integrity contract, not merely implementation detail.
do $$
declare
  actual_columns text[];
  expected record;
begin
  for expected in
    select *
    from (
      values
        ('friendships', array['requester', 'addressee']::text[]),
        ('presence_shares', array['owner', 'viewer']::text[]),
        ('presence_state', array['user_id']::text[]),
        ('checkins', array['id']::text[]),
        ('social_write_limits', array['user_id', 'bucket']::text[])
    ) as required_pk(table_name, column_names)
  loop
    select array_agg(a.attname order by key_column.ordinality)
    into actual_columns
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral unnest(con.conkey)
      with ordinality as key_column(attnum, ordinality)
    join pg_attribute a
      on a.attrelid = c.oid
     and a.attnum = key_column.attnum
    where n.nspname = 'public'
      and c.relname = expected.table_name
      and con.contype = 'p';

    if actual_columns is distinct from expected.column_names then
      raise exception 'public.% primary key drifted: expected %, got %',
        expected.table_name,
        expected.column_names,
        actual_columns;
    end if;
  end loop;

  for expected in
    select *
    from (
      values
        ('friendships', 'requester', 'profiles', 'id', 'c'),
        ('friendships', 'addressee', 'profiles', 'id', 'c'),
        ('friendships', 'blocked_by', 'profiles', 'id', 'c'),
        ('presence_shares', 'owner', 'profiles', 'id', 'c'),
        ('presence_shares', 'viewer', 'profiles', 'id', 'c'),
        ('presence_state', 'user_id', 'profiles', 'id', 'c'),
        ('presence_state', 'place_id', 'places', 'id', 'a'),
        ('checkins', 'owner', 'profiles', 'id', 'c'),
        ('checkins', 'place_id', 'places', 'id', 'a'),
        ('social_write_limits', 'user_id', 'profiles', 'id', 'c')
    ) as required_fk(
      table_name,
      column_name,
      foreign_table,
      foreign_column,
      delete_action
    )
  loop
    if not exists (
      select 1
      from pg_constraint con
      join pg_class source_table on source_table.oid = con.conrelid
      join pg_namespace source_schema
        on source_schema.oid = source_table.relnamespace
      join pg_class target_table on target_table.oid = con.confrelid
      join pg_namespace target_schema
        on target_schema.oid = target_table.relnamespace
      join pg_attribute source_column
        on source_column.attrelid = source_table.oid
       and source_column.attnum = con.conkey[1]
      join pg_attribute target_column
        on target_column.attrelid = target_table.oid
       and target_column.attnum = con.confkey[1]
      where con.contype = 'f'
        and array_length(con.conkey, 1) = 1
        and array_length(con.confkey, 1) = 1
        and source_schema.nspname = 'public'
        and source_table.relname = expected.table_name
        and source_column.attname = expected.column_name
        and target_schema.nspname = 'public'
        and target_table.relname = expected.foreign_table
        and target_column.attname = expected.foreign_column
        and con.confdeltype::text = expected.delete_action
    ) then
      raise exception
        'public.%.% lacks expected FK to public.%.% with delete action %',
        expected.table_name,
        expected.column_name,
        expected.foreign_table,
        expected.foreign_column,
        expected.delete_action;
    end if;
  end loop;
end
$$;

-- Grant behavior is checked separately from RLS behavior so a missing grant
-- cannot make a visibility assertion pass by accident.
do $$
declare
  function_definition text;
  social_table_name text;
  function_name text;
  role_name text;
begin
  foreach social_table_name in array array[
    'friendships',
    'presence_shares',
    'presence_state',
    'checkins'
  ] loop
    if not has_table_privilege('authenticated', 'public.' || social_table_name, 'select') then
      raise exception 'authenticated lacks SELECT on public.%', social_table_name;
    end if;
    if has_table_privilege('authenticated', 'public.' || social_table_name, 'insert')
       or has_table_privilege('authenticated', 'public.' || social_table_name, 'update')
       or has_table_privilege('authenticated', 'public.' || social_table_name, 'delete')
       or has_table_privilege('authenticated', 'public.' || social_table_name, 'truncate')
       or has_table_privilege('authenticated', 'public.' || social_table_name, 'references')
       or has_table_privilege('authenticated', 'public.' || social_table_name, 'trigger') then
      raise exception 'authenticated exceeds SELECT-only on public.%', social_table_name;
    end if;
    if has_table_privilege('anon', 'public.' || social_table_name, 'select')
       or has_table_privilege('anon', 'public.' || social_table_name, 'insert')
       or has_table_privilege('anon', 'public.' || social_table_name, 'update')
       or has_table_privilege('anon', 'public.' || social_table_name, 'delete')
       or has_table_privilege('anon', 'public.' || social_table_name, 'truncate')
       or has_table_privilege('anon', 'public.' || social_table_name, 'references')
       or has_table_privilege('anon', 'public.' || social_table_name, 'trigger') then
      raise exception 'anon has privileges on public.%', social_table_name;
    end if;
  end loop;

  foreach role_name in array array['anon', 'authenticated'] loop
    if has_table_privilege(role_name, 'public.social_write_limits', 'select')
       or has_table_privilege(role_name, 'public.social_write_limits', 'insert')
       or has_table_privilege(role_name, 'public.social_write_limits', 'update')
       or has_table_privilege(role_name, 'public.social_write_limits', 'delete')
       or has_table_privilege(role_name, 'public.social_write_limits', 'truncate')
       or has_table_privilege(role_name, 'public.social_write_limits', 'references')
       or has_table_privilege(role_name, 'public.social_write_limits', 'trigger') then
      raise exception '% has access to internal social_write_limits', role_name;
    end if;

    foreach social_table_name in array array[
      'friendships',
      'presence_shares',
      'presence_state',
      'checkins',
      'social_write_limits'
    ] loop
      if exists (
        select 1
        from information_schema.columns column_info
        where column_info.table_schema = 'public'
          and column_info.table_name = social_table_name
          and (
            has_column_privilege(
              role_name,
              'public.' || social_table_name,
              column_info.column_name,
              'insert'
            )
            or has_column_privilege(
              role_name,
              'public.' || social_table_name,
              column_info.column_name,
              'update'
            )
            or has_column_privilege(
              role_name,
              'public.' || social_table_name,
              column_info.column_name,
              'references'
            )
          )
      ) then
        raise exception '% has a column-level write grant on public.%',
          role_name,
          social_table_name;
      end if;
    end loop;
  end loop;

  foreach function_name in array array[
    'public.request_friend(uuid)',
    'public.respond_friend(uuid,boolean)',
    'public.remove_friend(uuid)',
    'public.block_user(uuid)',
    'public.unblock_user(uuid)',
    'public.set_presence_share(uuid,timestamp with time zone)',
    'public.revoke_presence_share(uuid)',
    'public.set_presence(text,text,text,interval)',
    'public.clear_presence()',
    'public.set_ghost(boolean)',
    'public.create_checkin(text,text,interval)'
  ] loop
    if not has_function_privilege('authenticated', function_name, 'execute') then
      raise exception 'authenticated lacks EXECUTE on %', function_name;
    end if;
    if has_function_privilege('anon', function_name, 'execute') then
      raise exception 'anon can execute %', function_name;
    end if;
    if position(
      'auth.uid()'
      in pg_catalog.lower(
        pg_catalog.pg_get_functiondef(
          pg_catalog.to_regprocedure(function_name)
        )
      )
    ) = 0 or position(
      'public.is_brown_member()'
      in pg_catalog.lower(
        pg_catalog.pg_get_functiondef(
          pg_catalog.to_regprocedure(function_name)
        )
      )
    ) = 0 then
      raise exception '% does not directly derive auth.uid() and check membership',
        function_name;
    end if;
  end loop;

  foreach function_name in array array[
    'public.request_friend(uuid)',
    'public.respond_friend(uuid,boolean)',
    'public.unblock_user(uuid)',
    'public.set_presence_share(uuid,timestamp with time zone)',
    'public.set_presence(text,text,text,interval)',
    'public.set_ghost(boolean)',
    'public.create_checkin(text,text,interval)'
  ] loop
    function_definition := pg_catalog.lower(
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(function_name)
      )
    );
    if function_definition !~
      $regex$brownsync_consume_social_write_limit[[:space:]]*\([[:space:]]*'shared'$regex$
    then
      raise exception '% is not wired to the shared database limiter',
        function_name;
    end if;
  end loop;

  foreach function_name in array array[
    'public.request_friend(uuid)',
    'public.respond_friend(uuid,boolean)',
    'public.remove_friend(uuid)',
    'public.block_user(uuid)',
    'public.unblock_user(uuid)',
    'public.set_presence_share(uuid,timestamp with time zone)',
    'public.revoke_presence_share(uuid)'
  ] loop
    function_definition := pg_catalog.lower(
      pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(function_name)
      )
    );
    if function_definition !~
      'public[.]brownsync_lock_social_pair[[:space:]]*[(]'
    then
      raise exception '% bypasses the canonical pair-lock helper',
        function_name;
    end if;
  end loop;

  function_definition := pg_catalog.lower(
    pg_catalog.pg_get_functiondef(
      'public.set_presence(text,text,text,interval)'::regprocedure
    )
  );
  if function_definition !~
    $regex$brownsync_consume_social_write_limit[[:space:]]*\([[:space:]]*'presence'$regex$
  then
    raise exception 'set_presence is not wired to the strict presence cooldown';
  end if;

  function_definition := pg_catalog.lower(
    pg_catalog.pg_get_functiondef(
      'public.brownsync_consume_social_write_limit(text)'::regprocedure
    )
  );
  if function_definition !~ 'auth[.]uid[[:space:]]*[(][[:space:]]*[)]'
     or function_definition !~ 'insert[[:space:]]+into[[:space:]]+public[.]social_write_limits'
     or function_definition !~ 'on[[:space:]]+conflict'
     or function_definition !~ 'for[[:space:]]+update'
     or function_definition !~
       'window_started_at[[:space:]]*\+[[:space:]]*interval[[:space:]]*''60 seconds'''
     or function_definition !~
       'last_success_at[[:space:]]*\+[[:space:]]*interval[[:space:]]*''60 seconds'''
  then
    raise exception 'social limiter lacks auth, race-safe row lock, or >=60s cooldown protocol';
  end if;

  function_definition := pg_catalog.lower(
    pg_catalog.pg_get_functiondef(
      'public.create_checkin(text,text,interval)'::regprocedure
    )
  );
  if function_definition !~ 'for[[:space:]]+key[[:space:]]+share'
     or function_definition ~ 'for[[:space:]]+update'
  then
    raise exception 'create_checkin prerequisite locks mask the limiter first-row race';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.cleanup_expired_social()',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.cleanup_expired_social()',
    'execute'
  ) then
    raise exception 'client can execute cleanup_expired_social()';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.brownsync_configure_social_integrations()',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.brownsync_configure_social_integrations()',
    'execute'
  ) then
    raise exception 'client can execute social integration configurator';
  end if;

  foreach function_name in array array[
    'public.brownsync_lock_social_pair(uuid,uuid)',
    'public.brownsync_consume_social_write_limit(text)',
    'public.brownsync_configure_social_integrations()'
  ] loop
    if has_function_privilege('anon', function_name, 'execute')
       or has_function_privilege('authenticated', function_name, 'execute')
       or exists (
         select 1
         from pg_proc p
         cross join lateral pg_catalog.aclexplode(
           coalesce(
             p.proacl,
             pg_catalog.acldefault('f', p.proowner)
           )
         ) privilege
         where p.oid = pg_catalog.to_regprocedure(function_name)
           and privilege.grantee = 0
           and privilege.privilege_type = 'EXECUTE'
       ) then
      raise exception 'PUBLIC or a client role can execute internal helper %',
        function_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.oid in (
        'public.request_friend(uuid)'::regprocedure,
        'public.respond_friend(uuid,boolean)'::regprocedure,
        'public.remove_friend(uuid)'::regprocedure,
        'public.block_user(uuid)'::regprocedure,
        'public.unblock_user(uuid)'::regprocedure,
        'public.set_presence_share(uuid,timestamp with time zone)'::regprocedure,
        'public.revoke_presence_share(uuid)'::regprocedure,
        'public.set_presence(text,text,text,interval)'::regprocedure,
        'public.clear_presence()'::regprocedure,
        'public.set_ghost(boolean)'::regprocedure,
        'public.create_checkin(text,text,interval)'::regprocedure,
        'public.cleanup_expired_social()'::regprocedure,
        'public.brownsync_lock_social_pair(uuid,uuid)'::regprocedure,
        'public.brownsync_consume_social_write_limit(text)'::regprocedure,
        'public.brownsync_configure_social_integrations()'::regprocedure
      )
      and (
        not p.prosecdef
        or not exists (
          select 1
          from unnest(coalesce(p.proconfig, '{}'::text[])) setting(value)
          where setting.value ~ $config$^search_path=(""|)$config$
        )
      )
  ) then
    raise exception 'social function lacks SECURITY DEFINER or empty search_path';
  end if;

  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_depend dependency
        on dependency.classid = 'pg_class'::regclass
       and dependency.objid = c.oid
       and dependency.refclassid = 'pg_class'::regclass
       and dependency.deptype in ('a', 'i')
      join pg_class owned_table on owned_table.oid = dependency.refobjid
      join pg_namespace owned_schema
        on owned_schema.oid = owned_table.relnamespace
      where n.nspname = 'public'
        and owned_schema.nspname = 'public'
        and owned_table.relname in (
          'friendships',
          'presence_shares',
          'presence_state',
          'checkins',
          'social_write_limits'
        )
        and case
          when c.relkind = 'S'
            then has_sequence_privilege(
              role_name,
              c.oid,
              'usage,select,update'
            )
          else false
        end
    ) then
      raise exception '% has access to a social-table sequence', role_name;
    end if;
  end loop;
end
$$;

-- The integration configurator is durable, owner-only, and idempotent. Build
-- transaction-local stand-ins when the optional extensions/publication are
-- absent so ordinary CI exercises the present path as well as migration-time
-- absence. All stand-ins disappear with the final rollback.
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    execute 'create schema if not exists cron';
    execute $create$
      create table cron.job (
        jobid bigint generated always as identity primary key,
        jobname text not null unique,
        schedule text not null,
        command text not null
      )
    $create$;
    execute $create$
      create function cron.schedule(
        p_jobname text,
        p_schedule text,
        p_command text
      )
      returns bigint
      language plpgsql
      set search_path = ''
      as $body$
      declare
        v_jobid bigint;
      begin
        insert into cron.job (jobname, schedule, command)
        values (p_jobname, p_schedule, p_command)
        on conflict (jobname) do update
        set schedule = excluded.schedule,
            command = excluded.command
        returning jobid into v_jobid;
        return v_jobid;
      end
      $body$
    $create$;
  end if;

  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    execute 'create publication supabase_realtime';
  end if;
end
$$;

select public.brownsync_configure_social_integrations();
select public.brownsync_configure_social_integrations();

do $$
declare
  cron_job_count bigint;
begin
  execute $query$
    select count(*)
    from cron.job
    where jobname = 'brownsync-social-cleanup-daily'
      and schedule = '17 3 * * *'
      and command = 'select public.cleanup_expired_social()'
  $query$ into cron_job_count;
  if cron_job_count <> 1 then
    raise exception 'social cron integration was absent or not idempotent';
  end if;

  if not exists (
    select 1
    from pg_publication p
    where p.pubname = 'supabase_realtime'
      and (
        p.puballtables
        or exists (
          select 1
          from pg_publication_rel pr
          join pg_class c on c.oid = pr.prrelid
          join pg_namespace n on n.oid = c.relnamespace
          where pr.prpubid = p.oid
            and n.nspname = 'public'
            and c.relname = 'presence_state'
        )
      )
  ) then
    raise exception 'social Realtime integration was not configured';
  end if;

  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
      and not puballtables
  ) and (
    select count(*) <> 1
    from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
    where p.pubname = 'supabase_realtime'
      and n.nspname = 'public'
      and c.relname in (
        'friendships',
        'presence_shares',
        'presence_state',
        'checkins',
        'social_write_limits'
      )
  ) then
    raise exception 'Realtime integration published more than presence_state';
  end if;
end
$$;

-- Every fixture has a chk- label/email/note even though UUID syntax itself
-- cannot carry that prefix.
insert into public.places (
  id, name, aliases, kind, lat, lng, source
) values (
  'chk-social-place',
  'chk-social-place',
  '{}',
  'other',
  41.0,
  -71.0,
  'chk-social'
);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  (
    '60000000-0000-4000-8000-000000000001',
    'chk-social-a@brown.edu',
    '{"full_name":"chk-social-a"}',
    '{"provider":"google"}'
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    'chk-social-b@brown.edu',
    '{"full_name":"chk-social-b"}',
    '{"providers":["google"]}'
  ),
  (
    '60000000-0000-4000-8000-000000000003',
    'chk-social-c@brown.edu',
    '{"full_name":"chk-social-c"}',
    '{"provider":"google"}'
  ),
  (
    '60000000-0000-4000-8000-000000000004',
    'chk-social-d@brown.edu',
    '{"full_name":"chk-social-d"}',
    '{"provider":"google"}'
  ),
  (
    '60000000-0000-4000-8000-000000000005',
    'chk-social-e@brown.edu',
    '{"full_name":"chk-social-e"}',
    '{"provider":"google"}'
  ),
  (
    '60000000-0000-4000-8000-000000000006',
    'chk-social-delete@brown.edu',
    '{"full_name":"chk-social-delete"}',
    '{"provider":"google"}'
  );

-- Database constraints remain the final defense even though clients cannot
-- write these tables directly.
do $$
declare
  rejected boolean;
begin
  rejected := false;
  begin
    insert into public.friendships (requester, addressee, status)
    values (
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
      'pending'
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'friendship self-pair constraint is missing';
  end if;

  rejected := false;
  begin
    insert into public.friendships (requester, addressee, status)
    values (
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      'invalid'
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'friendship status constraint is missing';
  end if;

  rejected := false;
  begin
    insert into public.friendships (
      requester, addressee, status, responded_at
    ) values (
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      'pending',
      now()
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'pending friendship accepted responded_at';
  end if;

  rejected := false;
  begin
    insert into public.friendships (
      requester, addressee, status, blocked_by, responded_at
    ) values (
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      'blocked',
      null,
      now()
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'blocked friendship accepted null blocked_by';
  end if;

  rejected := false;
  begin
    insert into public.friendships (
      requester, addressee, status, blocked_by, responded_at
    ) values (
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      'blocked',
      '60000000-0000-4000-8000-000000000003',
      now()
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'blocked friendship accepted an outside blocker';
  end if;

  rejected := false;
  begin
    insert into public.friendships (
      requester, addressee, status, blocked_by, responded_at
    ) values (
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      'blocked',
      '60000000-0000-4000-8000-000000000001',
      null
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'blocked friendship accepted null responded_at';
  end if;

  rejected := false;
  begin
    insert into public.friendships (
      requester, addressee, status, blocked_by, responded_at
    ) values (
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      'accepted',
      '60000000-0000-4000-8000-000000000001',
      now()
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'non-blocked friendship accepted blocked_by';
  end if;

  rejected := false;
  begin
    insert into public.friendships (requester, addressee, status, responded_at)
    values (
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      'accepted',
      null
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'accepted friendship accepted null responded_at';
  end if;

  insert into public.friendships (requester, addressee, status)
  values (
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    'pending'
  );
  rejected := false;
  begin
    insert into public.friendships (requester, addressee, status)
    values (
      '60000000-0000-4000-8000-000000000002',
      '60000000-0000-4000-8000-000000000001',
      'pending'
    );
  exception when unique_violation then
    rejected := true;
  end;
  delete from public.friendships
  where requester = '60000000-0000-4000-8000-000000000001'
    and addressee = '60000000-0000-4000-8000-000000000002';
  if not rejected then
    raise exception 'unordered friendship uniqueness is not enforced';
  end if;

  rejected := false;
  begin
    insert into public.presence_shares (owner, viewer, expires_at)
    values (
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
      now() + interval '1 day'
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'presence share self-pair constraint is missing';
  end if;

  rejected := false;
  begin
    insert into public.presence_shares (
      owner, viewer, created_at, expires_at
    ) values (
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      clock_timestamp(),
      'infinity'
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'presence share accepted infinite expiry';
  end if;

  rejected := false;
  begin
    insert into public.presence_shares (
      owner, viewer, created_at, expires_at
    ) values (
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      '2026-01-01 00:00:00+00',
      '2026-01-08 00:00:01+00'
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'presence share exceeded seven-day structural window';
  end if;

  rejected := false;
  begin
    insert into public.presence_state (
      user_id, place_id, status, note, expires_at
    ) values (
      '60000000-0000-4000-8000-000000000001',
      'chk-social-place',
      'invalid',
      'chk-invalid-status',
      now() + interval '1 hour'
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'presence status constraint is missing';
  end if;

  rejected := false;
  begin
    insert into public.presence_state (
      user_id, place_id, status, note, expires_at
    ) values (
      '60000000-0000-4000-8000-000000000001',
      'chk-social-place',
      'free',
      repeat('x', 81),
      now() + interval '1 hour'
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'presence note accepted more than 80 characters';
  end if;

  rejected := false;
  begin
    insert into public.presence_state (
      user_id, place_id, status, note, updated_at, expires_at
    ) values (
      '60000000-0000-4000-8000-000000000001',
      'chk-social-place',
      'free',
      'chk-infinite-presence',
      clock_timestamp(),
      'infinity'
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'presence state accepted infinite expiry';
  end if;

  rejected := false;
  begin
    insert into public.presence_state (
      user_id, place_id, status, note, updated_at, expires_at
    ) values (
      '60000000-0000-4000-8000-000000000001',
      'chk-social-place',
      'free',
      'chk-long-presence',
      '2026-01-01 00:00:00+00',
      '2026-01-02 00:00:01+00'
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'presence state exceeded 24-hour structural window';
  end if;

  rejected := false;
  begin
    insert into public.checkins (owner, place_id, note, expires_at)
    values (
      '60000000-0000-4000-8000-000000000001',
      'chk-social-place',
      repeat('x', 141),
      now() + interval '1 hour'
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'check-in note accepted more than 140 characters';
  end if;

  rejected := false;
  begin
    insert into public.checkins (
      owner, place_id, note, created_at, expires_at
    ) values (
      '60000000-0000-4000-8000-000000000001',
      'chk-social-place',
      'chk-infinite-checkin',
      clock_timestamp(),
      'infinity'
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'check-in accepted infinite expiry';
  end if;

  rejected := false;
  begin
    insert into public.checkins (
      owner, place_id, note, created_at, expires_at
    ) values (
      '60000000-0000-4000-8000-000000000001',
      'chk-social-place',
      'chk-long-checkin',
      '2026-01-01 00:00:00+00',
      '2026-01-02 00:00:01+00'
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'check-in exceeded 24-hour structural window';
  end if;

  rejected := false;
  begin
    insert into public.social_write_limits (
      user_id, bucket, window_started_at, count
    ) values (
      '60000000-0000-4000-8000-000000000001',
      'invalid',
      clock_timestamp(),
      0
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'write limiter accepted invalid bucket';
  end if;

  -- Every documented inclusive maximum remains usable; the immediately
  -- preceding checks prove values above each maximum are rejected.
  insert into public.presence_shares (
    owner, viewer, created_at, expires_at
  ) values (
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    '2026-01-01 00:00:00+00',
    '2026-01-08 00:00:00+00'
  );
  delete from public.presence_shares
  where owner = '60000000-0000-4000-8000-000000000001'
    and viewer = '60000000-0000-4000-8000-000000000002';

  insert into public.presence_state (
    user_id, place_id, status, note, updated_at, expires_at
  ) values (
    '60000000-0000-4000-8000-000000000001',
    'chk-social-place',
    'free',
    repeat('x', 80),
    '2026-01-01 00:00:00+00',
    '2026-01-02 00:00:00+00'
  );
  delete from public.presence_state
  where user_id = '60000000-0000-4000-8000-000000000001';

  insert into public.checkins (
    owner, place_id, note, created_at, expires_at
  ) values (
    '60000000-0000-4000-8000-000000000001',
    'chk-social-place',
    repeat('x', 140),
    '2026-01-01 00:00:00+00',
    '2026-01-02 00:00:00+00'
  );
  delete from public.checkins
  where owner = '60000000-0000-4000-8000-000000000001'
    and note = repeat('x', 140);
end
$$;

-- No direct client DML. This is behavioral evidence in addition to catalog
-- grant assertions.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);

do $$
declare
  blocked boolean;
  table_name text;
begin
  foreach table_name in array array[
    'friendships',
    'presence_shares',
    'presence_state',
    'checkins'
  ] loop
    blocked := false;
    begin
      execute format('delete from public.%I where false', table_name);
    exception when insufficient_privilege then
      blocked := true;
    end;
    if not blocked then
      raise exception 'authenticated directly deleted from public.%', table_name;
    end if;
  end loop;
end
$$;

-- A spoofed non-member cannot call any social RPC.
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"attacker@example.com","app_metadata":{"provider":"google"},"user_metadata":{"email_verified":true}}',
  true
);

do $$
declare
  call_sql text;
begin
  foreach call_sql in array array[
    $call$select public.request_friend('60000000-0000-4000-8000-000000000002')$call$,
    $call$select public.respond_friend('60000000-0000-4000-8000-000000000002', true)$call$,
    $call$select public.respond_friend('60000000-0000-4000-8000-000000000002', false)$call$,
    $call$select public.remove_friend('60000000-0000-4000-8000-000000000002')$call$,
    $call$select public.block_user('60000000-0000-4000-8000-000000000002')$call$,
    $call$select public.unblock_user('60000000-0000-4000-8000-000000000002')$call$,
    $call$select public.set_presence_share('60000000-0000-4000-8000-000000000002', clock_timestamp() + interval '1 day')$call$,
    $call$select public.revoke_presence_share('60000000-0000-4000-8000-000000000002')$call$,
    $call$select public.set_presence('chk-social-place', 'free', 'chk-non-member', interval '1 hour')$call$,
    $call$select public.clear_presence()$call$,
    $call$select public.set_ghost(true)$call$,
    $call$select public.set_ghost(false)$call$,
    $call$select public.create_checkin('chk-social-place', 'chk-non-member', interval '1 hour')$call$
  ] loop
    begin
      execute call_sql;
      raise exception 'non-member social RPC call succeeded: %', call_sql;
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'BROWNSYNC_SOCIAL_UNAUTHORIZED' then
        raise;
      end if;
    end;
  end loop;
end
$$;

-- Brown/Google-looking claims without a usable subject are still
-- unauthenticated. The stable authorization error must occur before mutation.
select set_config(
  'request.jwt.claims',
  '{"email":"chk-missing-sub@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.request_friend('60000000-0000-4000-8000-000000000002');
    raise exception 'missing-sub social RPC call succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_SOCIAL_UNAUTHORIZED' then
      raise;
    end if;
  end;
end
$$;

-- A requests B. Self/duplicate/reverse requests are stable failures.
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.request_friend('60000000-0000-4000-8000-000000000002');

do $$
begin
  begin
    perform public.request_friend('60000000-0000-4000-8000-000000000001');
    raise exception 'self friend request succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_FRIEND_SELF' then
      raise;
    end if;
  end;

  begin
    perform public.request_friend('60000000-0000-4000-8000-000000000002');
    raise exception 'duplicate friend request succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_FRIEND_REQUEST_EXISTS' then
      raise;
    end if;
  end;

  begin
    perform public.request_friend('60000000-0000-4000-8000-999999999999');
    raise exception 'missing target friend request succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_FRIEND_TARGET_NOT_FOUND' then
      raise;
    end if;
  end;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000002","email":"chk-social-b@brown.edu","app_metadata":{"providers":["google"]}}',
  true
);
do $$
begin
  begin
    perform public.request_friend('60000000-0000-4000-8000-000000000001');
    raise exception 'reverse friend request succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_FRIEND_REVERSE_PENDING' then
      raise;
    end if;
  end;
end
$$;

reset role;
insert into public.presence_shares (owner, viewer, created_at, expires_at)
values
  (
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    clock_timestamp(),
    clock_timestamp() + interval '1 day'
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000001',
    clock_timestamp(),
    clock_timestamp() + interval '1 day'
  );
set local role authenticated;

-- Only B, the pending addressee, may accept. C cannot transition it and B
-- cannot replay the transition.
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000003","email":"chk-social-c@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.respond_friend(
      '60000000-0000-4000-8000-000000000001',
      true
    );
    raise exception 'non-addressee accepted a friend request';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_FRIEND_PENDING_NOT_FOUND' then
      raise;
    end if;
  end;

  begin
    perform public.respond_friend(
      '60000000-0000-4000-8000-000000000001',
      false
    );
    raise exception 'non-addressee rejected a friend request';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_FRIEND_PENDING_NOT_FOUND' then
      raise;
    end if;
  end;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000002","email":"chk-social-b@brown.edu","app_metadata":{"providers":["google"]}}',
  true
);
do $$
begin
  begin
    perform public.respond_friend(
      '60000000-0000-4000-8000-000000000001',
      null
    );
    raise exception 'null friend response rejected the pending row';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_FRIEND_RESPONSE_INVALID' then
      raise;
    end if;
  end;

  if not exists (
    select 1
    from public.friendships
    where requester = '60000000-0000-4000-8000-000000000001'
      and addressee = '60000000-0000-4000-8000-000000000002'
      and status = 'pending'
  ) then
    raise exception 'null friend response mutated the pending row';
  end if;
end
$$;
select public.respond_friend(
  '60000000-0000-4000-8000-000000000001',
  true
);
do $$
begin
  begin
    perform public.respond_friend(
      '60000000-0000-4000-8000-000000000001',
      true
    );
    raise exception 'accepted transition replayed';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_FRIEND_PENDING_NOT_FOUND' then
      raise;
    end if;
  end;

  if (
    select count(*) <> 1
    from public.friendships
    where requester = '60000000-0000-4000-8000-000000000001'
      and addressee = '60000000-0000-4000-8000-000000000002'
      and status = 'accepted'
      and blocked_by is null
      and responded_at is not null
  ) then
    raise exception 'accept did not make exactly one terminal accepted row';
  end if;
  if exists (
    select 1
    from public.presence_shares
    where owner in (
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002'
    )
      and viewer in (
        '60000000-0000-4000-8000-000000000001',
        '60000000-0000-4000-8000-000000000002'
      )
  ) then
    raise exception 'accept inherited stale presence consent';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.request_friend('60000000-0000-4000-8000-000000000002');
    raise exception 'accepted pair accepted a new request';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_FRIEND_PAIR_EXISTS' then
      raise;
    end if;
  end;
end
$$;

-- C -> D rejection deletes the row and both share directions.
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000003","email":"chk-social-c@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.request_friend('60000000-0000-4000-8000-000000000004');
reset role;
insert into public.presence_shares (owner, viewer, expires_at)
values
  (
    '60000000-0000-4000-8000-000000000003',
    '60000000-0000-4000-8000-000000000004',
    now() + interval '1 day'
  ),
  (
    '60000000-0000-4000-8000-000000000004',
    '60000000-0000-4000-8000-000000000003',
    now() + interval '1 day'
  );
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000004","email":"chk-social-d@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.respond_friend(
  '60000000-0000-4000-8000-000000000003',
  false
);
do $$
begin
  begin
    perform public.respond_friend(
      '60000000-0000-4000-8000-000000000003',
      false
    );
    raise exception 'rejected transition replayed';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_FRIEND_PENDING_NOT_FOUND' then
      raise;
    end if;
  end;
end
$$;
reset role;
do $$
begin
  if exists (
    select 1
    from public.friendships
    where requester = '60000000-0000-4000-8000-000000000003'
      and addressee = '60000000-0000-4000-8000-000000000004'
  ) or exists (
    select 1
    from public.presence_shares
    where owner in (
      '60000000-0000-4000-8000-000000000003',
      '60000000-0000-4000-8000-000000000004'
    )
      and viewer in (
        '60000000-0000-4000-8000-000000000003',
        '60000000-0000-4000-8000-000000000004'
      )
  ) then
    raise exception 'friend rejection did not remove pair and both shares';
  end if;
end
$$;

-- Blocking a pending request is also terminal and must purge stale consent in
-- both directions before a later friendship can exist.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000003","email":"chk-social-c@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.request_friend('60000000-0000-4000-8000-000000000004');
reset role;
insert into public.presence_shares (owner, viewer, expires_at)
values
  (
    '60000000-0000-4000-8000-000000000003',
    '60000000-0000-4000-8000-000000000004',
    now() + interval '1 day'
  ),
  (
    '60000000-0000-4000-8000-000000000004',
    '60000000-0000-4000-8000-000000000003',
    now() + interval '1 day'
  );
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000004","email":"chk-social-d@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.block_user('60000000-0000-4000-8000-000000000003');
do $$
begin
  if not exists (
    select 1
    from public.friendships
    where requester = '60000000-0000-4000-8000-000000000004'
      and addressee = '60000000-0000-4000-8000-000000000003'
      and status = 'blocked'
      and blocked_by = '60000000-0000-4000-8000-000000000004'
  ) or exists (
    select 1
    from public.presence_shares
    where owner in (
      '60000000-0000-4000-8000-000000000003',
      '60000000-0000-4000-8000-000000000004'
    )
      and viewer in (
        '60000000-0000-4000-8000-000000000003',
        '60000000-0000-4000-8000-000000000004'
      )
  ) then
    raise exception 'pending block did not replace pair and clear both shares';
  end if;

  begin
    perform public.respond_friend(
      '60000000-0000-4000-8000-000000000003',
      true
    );
    raise exception 'blocked pending request was later accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_FRIEND_PENDING_NOT_FOUND' then
      raise;
    end if;
  end;
end
$$;
select public.unblock_user('60000000-0000-4000-8000-000000000003');

-- Only the requester may cancel pending. Either party may remove accepted.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000003","email":"chk-social-c@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.request_friend('60000000-0000-4000-8000-000000000005');
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000005","email":"chk-social-e@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.remove_friend('60000000-0000-4000-8000-000000000003');
    raise exception 'pending addressee canceled the request';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_FRIEND_REMOVE_NOT_ALLOWED' then
      raise;
    end if;
  end;
end
$$;
reset role;
insert into public.presence_shares (owner, viewer, expires_at)
values
  (
    '60000000-0000-4000-8000-000000000003',
    '60000000-0000-4000-8000-000000000005',
    now() + interval '1 day'
  ),
  (
    '60000000-0000-4000-8000-000000000005',
    '60000000-0000-4000-8000-000000000003',
    now() + interval '1 day'
  );
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000003","email":"chk-social-c@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.remove_friend('60000000-0000-4000-8000-000000000005');
reset role;
do $$
begin
  if exists (
    select 1 from public.friendships
    where requester = '60000000-0000-4000-8000-000000000003'
      and addressee = '60000000-0000-4000-8000-000000000005'
  ) or exists (
    select 1 from public.presence_shares
    where owner in (
      '60000000-0000-4000-8000-000000000003',
      '60000000-0000-4000-8000-000000000005'
    )
      and viewer in (
        '60000000-0000-4000-8000-000000000003',
        '60000000-0000-4000-8000-000000000005'
      )
  ) then
    raise exception 'pending cancellation did not remove pair and shares';
  end if;
end
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000003","email":"chk-social-c@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.request_friend('60000000-0000-4000-8000-000000000005');
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000005","email":"chk-social-e@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.respond_friend(
  '60000000-0000-4000-8000-000000000003',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000003","email":"chk-social-c@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.set_presence_share(
  '60000000-0000-4000-8000-000000000005',
  now() + interval '1 day'
);
reset role;
insert into public.presence_shares (owner, viewer, expires_at)
values (
  '60000000-0000-4000-8000-000000000005',
  '60000000-0000-4000-8000-000000000003',
  now() + interval '1 day'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000005","email":"chk-social-e@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.remove_friend('60000000-0000-4000-8000-000000000003');
reset role;
do $$
begin
  if exists (
    select 1 from public.friendships
    where (
      requester = '60000000-0000-4000-8000-000000000003'
      and addressee = '60000000-0000-4000-8000-000000000005'
    ) or (
      requester = '60000000-0000-4000-8000-000000000005'
      and addressee = '60000000-0000-4000-8000-000000000003'
    )
  ) or exists (
    select 1 from public.presence_shares
    where owner in (
      '60000000-0000-4000-8000-000000000003',
      '60000000-0000-4000-8000-000000000005'
    )
      and viewer in (
        '60000000-0000-4000-8000-000000000003',
        '60000000-0000-4000-8000-000000000005'
      )
  ) then
    raise exception 'accepted removal did not remove pair and shares';
  end if;
end
$$;

-- A share requires an accepted friend and a bounded future expiry.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000003","email":"chk-social-c@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.set_presence_share(
      '60000000-0000-4000-8000-000000000005',
      now() + interval '1 day'
    );
    raise exception 'share without accepted friendship succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_SHARE_FRIEND_REQUIRED' then
      raise;
    end if;
  end;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.set_presence_share(
      '60000000-0000-4000-8000-000000000001',
      now() + interval '1 day'
    );
    raise exception 'self share succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_SHARE_SELF' then
      raise;
    end if;
  end;

  begin
    perform public.set_presence_share(
      '60000000-0000-4000-8000-000000000002',
      now()
    );
    raise exception 'non-future share expiry succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_SHARE_EXPIRY_INVALID' then
      raise;
    end if;
  end;

  begin
    perform public.set_presence_share(
      '60000000-0000-4000-8000-000000000002',
      now() + interval '7 days 1 minute'
    );
    raise exception 'share expiry beyond seven days succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_SHARE_EXPIRY_INVALID' then
      raise;
    end if;
  end;

  begin
    perform public.set_presence_share(
      '60000000-0000-4000-8000-000000000002',
      'infinity'
    );
    raise exception 'infinite share expiry succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_SHARE_EXPIRY_INVALID' then
      raise;
    end if;
  end;
end
$$;

select public.set_presence_share(
  '60000000-0000-4000-8000-000000000002',
  clock_timestamp() + interval '7 days'
);
reset role;
update public.presence_shares
set created_at = now() - interval '6 days',
    expires_at = now() + interval '1 day'
where owner = '60000000-0000-4000-8000-000000000001'
  and viewer = '60000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.set_presence_share(
  '60000000-0000-4000-8000-000000000002',
  now() + interval '2 days'
);
do $$
begin
  if (
    select count(*) <> 1
    from public.presence_shares
    where owner = '60000000-0000-4000-8000-000000000001'
      and viewer = '60000000-0000-4000-8000-000000000002'
      and expires_at > clock_timestamp() + interval '1 day'
      and created_at > now() - interval '1 minute'
      and expires_at <= created_at + interval '7 days'
  ) then
    raise exception 'share regrant did not reset consent time or retain one bounded row';
  end if;
end
$$;

-- Blocking replaces the pair, records the blocker, removes both shares, and
-- only the current blocker may unblock.
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000003","email":"chk-social-c@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.request_friend('60000000-0000-4000-8000-000000000004');
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000004","email":"chk-social-d@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.respond_friend(
  '60000000-0000-4000-8000-000000000003',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000003","email":"chk-social-c@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.set_presence_share(
  '60000000-0000-4000-8000-000000000004',
  now() + interval '1 day'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000004","email":"chk-social-d@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.block_user('60000000-0000-4000-8000-000000000003');
do $$
begin
  if (
    select count(*) <> 1
    from public.friendships
    where requester = '60000000-0000-4000-8000-000000000004'
      and addressee = '60000000-0000-4000-8000-000000000003'
      and status = 'blocked'
      and blocked_by = '60000000-0000-4000-8000-000000000004'
      and responded_at is not null
  ) or exists (
    select 1
    from public.presence_shares
    where owner in (
      '60000000-0000-4000-8000-000000000003',
      '60000000-0000-4000-8000-000000000004'
    )
      and viewer in (
        '60000000-0000-4000-8000-000000000003',
        '60000000-0000-4000-8000-000000000004'
      )
  ) then
    raise exception 'block did not replace pair and clear shares';
  end if;
end
$$;
do $$
declare
  original_created_at timestamptz;
  original_responded_at timestamptz;
begin
  select created_at, responded_at
  into original_created_at, original_responded_at
  from public.friendships
  where requester = '60000000-0000-4000-8000-000000000004'
    and addressee = '60000000-0000-4000-8000-000000000003';

  perform public.block_user('60000000-0000-4000-8000-000000000003');

  if not exists (
    select 1
    from public.friendships
    where requester = '60000000-0000-4000-8000-000000000004'
      and addressee = '60000000-0000-4000-8000-000000000003'
      and blocked_by = '60000000-0000-4000-8000-000000000004'
      and created_at = original_created_at
      and responded_at = original_responded_at
  ) then
    raise exception 'same-blocker replay rewrote blocked ownership/timestamps';
  end if;

  begin
    perform public.remove_friend('60000000-0000-4000-8000-000000000003');
    raise exception 'blocked row used generic remove path';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_FRIEND_REMOVE_NOT_ALLOWED' then
      raise;
    end if;
  end;
end
$$;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000003","email":"chk-social-c@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.block_user('60000000-0000-4000-8000-000000000004');
    raise exception 'blocked party replaced blocked_by';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_FRIEND_PAIR_BLOCKED' then
      raise;
    end if;
  end;

  begin
    perform public.unblock_user('60000000-0000-4000-8000-000000000004');
    raise exception 'non-blocker unblocked the pair';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_UNBLOCK_NOT_ALLOWED' then
      raise;
    end if;
  end;
end
$$;
reset role;
insert into public.presence_shares (owner, viewer, created_at, expires_at)
values
  (
    '60000000-0000-4000-8000-000000000003',
    '60000000-0000-4000-8000-000000000004',
    clock_timestamp(),
    clock_timestamp() + interval '1 day'
  ),
  (
    '60000000-0000-4000-8000-000000000004',
    '60000000-0000-4000-8000-000000000003',
    clock_timestamp(),
    clock_timestamp() + interval '1 day'
  );
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000004","email":"chk-social-d@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.unblock_user('60000000-0000-4000-8000-000000000003');
do $$
begin
  if exists (
    select 1
    from public.friendships
    where requester in (
      '60000000-0000-4000-8000-000000000003',
      '60000000-0000-4000-8000-000000000004'
    )
      and addressee in (
        '60000000-0000-4000-8000-000000000003',
        '60000000-0000-4000-8000-000000000004'
      )
  ) or exists (
    select 1
    from public.presence_shares
    where owner in (
      '60000000-0000-4000-8000-000000000003',
      '60000000-0000-4000-8000-000000000004'
    )
      and viewer in (
        '60000000-0000-4000-8000-000000000003',
        '60000000-0000-4000-8000-000000000004'
      )
  ) then
    raise exception 'unblock did not remove blocked row and stale shares';
  end if;
end
$$;

-- Presence validation, one-row upsert, ghost sentinel, and clear behavior.
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.set_ghost(true);
do $$
begin
  if (
    select count(*) <> 1
    from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000001'
      and ghost
      and place_id is null
      and status is null
      and note is null
      and expires_at <= clock_timestamp()
  ) then
    raise exception 'set_ghost did not create expired coordinate-free state';
  end if;
end
$$;

reset role;
select set_config(
  'brownsync.check.presence_validation_shared',
  coalesce((
    select count::text
    from public.social_write_limits
    where user_id = '60000000-0000-4000-8000-000000000001'
      and bucket = 'shared'
  ), '-1'),
  true
);
select set_config(
  'brownsync.check.presence_validation_cooldown',
  coalesce((
    select count::text
    from public.social_write_limits
    where user_id = '60000000-0000-4000-8000-000000000001'
      and bucket = 'presence'
  ), '-1'),
  true
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.set_presence(
      'chk-missing-place',
      'free',
      'chk-unknown-place',
      interval '1 hour'
    );
    raise exception 'unknown presence place succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_PRESENCE_PLACE_NOT_FOUND' then
      raise;
    end if;
  end;

  begin
    perform public.set_presence(
      'chk-social-place',
      'invalid',
      'chk-invalid-status',
      interval '1 hour'
    );
    raise exception 'invalid presence status succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_PRESENCE_STATUS_INVALID' then
      raise;
    end if;
  end;

  begin
    perform public.set_presence(
      'chk-social-place',
      'free',
      repeat('x', 81),
      interval '1 hour'
    );
    raise exception 'overlong presence note succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_PRESENCE_NOTE_INVALID' then
      raise;
    end if;
  end;

  begin
    perform public.set_presence(
      'chk-social-place',
      'free',
      'chk-zero-ttl',
      interval '0'
    );
    raise exception 'zero presence TTL succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_PRESENCE_TTL_INVALID' then
      raise;
    end if;
  end;

  begin
    perform public.set_presence(
      'chk-social-place',
      'free',
      'chk-long-ttl',
      interval '24 hours 1 second'
    );
    raise exception 'presence TTL beyond 24 hours succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_PRESENCE_TTL_INVALID' then
      raise;
    end if;
  end;

  begin
    perform public.set_presence(
      'chk-social-place',
      'free',
      'chk-calendar-ttl',
      interval '1 year -359 days'
    );
    raise exception 'calendar presence TTL expanded beyond 24 hours';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_PRESENCE_TTL_INVALID' then
      raise;
    end if;
  end;
end
$$;

reset role;
do $$
begin
  if coalesce((
    select count
    from public.social_write_limits
    where user_id = '60000000-0000-4000-8000-000000000001'
      and bucket = 'shared'
  ), -1) <> current_setting(
    'brownsync.check.presence_validation_shared'
  )::integer or coalesce((
    select count
    from public.social_write_limits
    where user_id = '60000000-0000-4000-8000-000000000001'
      and bucket = 'presence'
  ), -1) <> current_setting(
    'brownsync.check.presence_validation_cooldown'
  )::integer then
    raise exception 'invalid presence input consumed a limiter';
  end if;
end
$$;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.set_presence(
      'chk-social-place',
      'studying',
      'chk-while-ghosted',
      interval '2 hours'
    );
    raise exception 'set_presence implicitly disabled ghost';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_PRESENCE_GHOSTED' then
      raise;
    end if;
  end;
end
$$;

select public.set_ghost(false);
do $$
begin
  if (
    select count(*) <> 1
    from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000001'
      and place_id is null
      and status is null
      and note is null
      and not ghost
      and expires_at <= clock_timestamp()
  ) then
    raise exception 'set_ghost(false) did not retain an expired coordinate-free row';
  end if;
end
$$;

select public.set_presence(
  'chk-social-place',
  'studying',
  'chk-first-presence',
  interval '24 hours'
);
reset role;
select set_config(
  'brownsync.check.a_shared_count',
  coalesce((
    select count::text
    from public.social_write_limits
    where user_id = '60000000-0000-4000-8000-000000000001'
      and bucket = 'shared'
  ), '-1'),
  true
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.set_presence(
      'chk-social-place',
      'free',
      'chk-too-soon',
      interval '3 hours'
    );
    raise exception 'presence cooldown allowed a second publish inside 60 seconds';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_PRESENCE_RATE_LIMITED' then
      raise;
    end if;
  end;

end
$$;

reset role;
do $$
begin
  if coalesce((
    select count
    from public.social_write_limits
    where user_id = '60000000-0000-4000-8000-000000000001'
      and bucket = 'shared'
  ), -1) <> current_setting(
      'brownsync.check.a_shared_count'
    )::integer then
    raise exception 'failed presence cooldown consumed shared quota';
  end if;
end
$$;
update public.social_write_limits
set last_success_at = clock_timestamp() - interval '2 minutes'
where user_id = '60000000-0000-4000-8000-000000000001'
  and bucket = 'presence';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.set_presence(
  'chk-social-place',
  null,
  'chk-updated-presence',
  interval '3 hours'
);
do $$
begin
  if (
    select count(*) <> 1
    from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000001'
      and place_id = 'chk-social-place'
      and status is null
      and note = 'chk-updated-presence'
      and not ghost
      and expires_at > clock_timestamp()
      and expires_at <= updated_at + interval '24 hours'
  ) then
    raise exception 'presence upsert duplicated state, unghosted, or exceeded TTL bound';
  end if;
end
$$;

select public.clear_presence();
do $$
begin
  if (
    select count(*) <> 1
    from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000001'
      and place_id is null
      and status is null
      and note is null
      and not ghost
      and expires_at <= clock_timestamp()
  ) then
    raise exception 'clear_presence did not retain an expired coordinate-free row';
  end if;
end
$$;

-- The owner can read expired/ghosted state; the friend cannot until every
-- accepted-friend/share/state/ghost condition is true.
do $$
begin
  if (
    select count(*) <> 1
    from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'owner could not read own expired presence sentinel';
  end if;
end
$$;

reset role;
update public.social_write_limits
set last_success_at = clock_timestamp() - interval '61 seconds'
where user_id = '60000000-0000-4000-8000-000000000001'
  and bucket = 'presence';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.set_presence(
  'chk-social-place',
  'studying',
  'chk-visible-presence',
  interval '2 hours'
);
do $$
begin
  if (
    select count(*) <> 1
    from public.friendships
    where requester = '60000000-0000-4000-8000-000000000001'
      and addressee = '60000000-0000-4000-8000-000000000002'
      and status = 'accepted'
  ) or (
    select count(*) <> 1
    from public.presence_shares
    where owner = '60000000-0000-4000-8000-000000000001'
      and viewer = '60000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'friend/share owner could not read its own social rows';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000002","email":"chk-social-b@brown.edu","app_metadata":{"providers":["google"]}}',
  true
);
do $$
begin
  if (
    select count(*) <> 1
    from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000001'
      and place_id = 'chk-social-place'
  ) then
    raise exception 'accepted explicitly shared friend could not see presence';
  end if;
  if (
    select count(*) <> 1
    from public.friendships
    where requester = '60000000-0000-4000-8000-000000000001'
      and addressee = '60000000-0000-4000-8000-000000000002'
  ) or (
    select count(*) <> 1
    from public.presence_shares
    where owner = '60000000-0000-4000-8000-000000000001'
      and viewer = '60000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'friend/share viewer could not read addressed social rows';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000003","email":"chk-social-c@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  if exists (
    select 1
    from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'unrelated member saw presence';
  end if;
  if exists (
    select 1
    from public.friendships
    where requester in (
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002'
    )
      and addressee in (
        '60000000-0000-4000-8000-000000000001',
        '60000000-0000-4000-8000-000000000002'
      )
  ) or exists (
    select 1
    from public.presence_shares
    where owner = '60000000-0000-4000-8000-000000000001'
      and viewer = '60000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'unrelated member saw friendship or share rows';
  end if;
end
$$;

reset role;
insert into public.checkins (
  owner, place_id, note, created_at, expires_at
) values (
  '60000000-0000-4000-8000-000000000001',
  'chk-social-place',
  'chk-non-member-rls',
  clock_timestamp(),
  clock_timestamp() + interval '1 hour'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"attacker@example.com","app_metadata":{"provider":"google"},"user_metadata":{"email_verified":true}}',
  true
);
do $$
begin
  if (select count(*) from public.friendships) <> 0
     or (select count(*) from public.presence_shares) <> 0
     or (select count(*) from public.presence_state) <> 0
     or (select count(*) from public.checkins) <> 0 then
    raise exception 'spoofed non-member read one or more social tables';
  end if;
end
$$;
reset role;
delete from public.checkins where note = 'chk-non-member-rls';
set local role authenticated;

-- Ghost, revocation, share expiry, state expiry, removal, and block each make
-- the friend's row immediately disappear.
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.set_ghost(true);
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000002","email":"chk-social-b@brown.edu","app_metadata":{"providers":["google"]}}',
  true
);
do $$
begin
  if exists (
    select 1 from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'ghosted presence remained visible to friend';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.set_ghost(false);
reset role;
update public.social_write_limits
set last_success_at = clock_timestamp() - interval '61 seconds'
where user_id = '60000000-0000-4000-8000-000000000001'
  and bucket = 'presence';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.set_presence(
  'chk-social-place',
  'free',
  'chk-after-ghost',
  interval '2 hours'
);
reset role;
insert into public.presence_shares (owner, viewer, expires_at)
values (
  '60000000-0000-4000-8000-000000000003',
  '60000000-0000-4000-8000-000000000002',
  now() + interval '1 day'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.revoke_presence_share('60000000-0000-4000-8000-000000000002');
reset role;
do $$
begin
  if exists (
    select 1
    from public.presence_shares
    where owner = '60000000-0000-4000-8000-000000000001'
      and viewer = '60000000-0000-4000-8000-000000000002'
  ) or not exists (
    select 1
    from public.presence_shares
    where owner = '60000000-0000-4000-8000-000000000003'
      and viewer = '60000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'share revocation escaped the authenticated owner scope';
  end if;
end
$$;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000002","email":"chk-social-b@brown.edu","app_metadata":{"providers":["google"]}}',
  true
);
do $$
begin
  if exists (
    select 1 from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'revoked share left presence visible';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.set_presence_share(
  '60000000-0000-4000-8000-000000000002',
  now() + interval '1 day'
);
reset role;
update public.presence_shares
set created_at = now() - interval '2 hours',
    expires_at = now() - interval '1 hour'
where owner = '60000000-0000-4000-8000-000000000001'
  and viewer = '60000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000002","email":"chk-social-b@brown.edu","app_metadata":{"providers":["google"]}}',
  true
);
do $$
begin
  if exists (
    select 1 from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'expired share left presence visible';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.set_presence_share(
  '60000000-0000-4000-8000-000000000002',
  now() + interval '1 day'
);
reset role;
update public.presence_state
set updated_at = now() - interval '2 hours',
    expires_at = now() - interval '1 hour'
where user_id = '60000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000002","email":"chk-social-b@brown.edu","app_metadata":{"providers":["google"]}}',
  true
);
do $$
begin
  if exists (
    select 1 from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'expired state remained visible';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
reset role;
update public.social_write_limits
set last_success_at = clock_timestamp() - interval '61 seconds'
where user_id = '60000000-0000-4000-8000-000000000001'
  and bucket = 'presence';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.set_presence(
  'chk-social-place',
  'free',
  'chk-removal-visibility',
  interval '2 hours'
);
select public.remove_friend('60000000-0000-4000-8000-000000000002');
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000002","email":"chk-social-b@brown.edu","app_metadata":{"providers":["google"]}}',
  true
);
do $$
begin
  if exists (
    select 1 from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'removed friendship left presence visible';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.request_friend('60000000-0000-4000-8000-000000000002');
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000002","email":"chk-social-b@brown.edu","app_metadata":{"providers":["google"]}}',
  true
);
select public.respond_friend(
  '60000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.set_presence_share(
  '60000000-0000-4000-8000-000000000002',
  now() + interval '1 day'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000002","email":"chk-social-b@brown.edu","app_metadata":{"providers":["google"]}}',
  true
);
select public.block_user('60000000-0000-4000-8000-000000000001');
do $$
begin
  if exists (
    select 1 from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'blocked pair left presence visible';
  end if;
  if exists (
    select 1 from public.presence_shares
    where owner = '60000000-0000-4000-8000-000000000001'
      and viewer = '60000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'block left directional presence share';
  end if;
end
$$;

-- Check-ins are bounded, place-only, owner-only, and invisible after expiry.
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
declare
  checkin_id uuid;
begin
  checkin_id := public.create_checkin(
    'chk-social-place',
    'chk-valid-checkin',
    interval '24 hours'
  );
  if checkin_id is null or not exists (
    select 1
    from public.checkins
    where id = checkin_id
      and owner = '60000000-0000-4000-8000-000000000001'
      and expires_at > clock_timestamp()
  ) then
    raise exception 'valid check-in was not returned/readable by owner';
  end if;

  begin
    perform public.create_checkin(
      'chk-missing-place',
      'chk-unknown-place',
      interval '1 hour'
    );
    raise exception 'check-in accepted unknown place';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_CHECKIN_PLACE_NOT_FOUND' then
      raise;
    end if;
  end;

  begin
    perform public.create_checkin(
      'chk-social-place',
      repeat('x', 141),
      interval '1 hour'
    );
    raise exception 'check-in accepted overlong note';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_CHECKIN_NOTE_INVALID' then
      raise;
    end if;
  end;

  begin
    perform public.create_checkin(
      'chk-social-place',
      'chk-zero-ttl',
      interval '0'
    );
    raise exception 'check-in accepted zero TTL';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_CHECKIN_TTL_INVALID' then
      raise;
    end if;
  end;

  begin
    perform public.create_checkin(
      'chk-social-place',
      'chk-long-ttl',
      interval '24 hours 1 second'
    );
    raise exception 'check-in accepted TTL beyond 24 hours';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_CHECKIN_TTL_INVALID' then
      raise;
    end if;
  end;
end
$$;

reset role;
select set_config(
  'brownsync.check.checkin_calendar_shared',
  coalesce((
    select count::text
    from public.social_write_limits
    where user_id = '60000000-0000-4000-8000-000000000001'
      and bucket = 'shared'
  ), '-1'),
  true
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.create_checkin(
      'chk-social-place',
      'chk-calendar-ttl',
      interval '1 year -359 days'
    );
    raise exception 'calendar check-in TTL expanded beyond 24 hours';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_CHECKIN_TTL_INVALID' then
      raise;
    end if;
  end;
end
$$;
reset role;
do $$
begin
  if coalesce((
    select count
    from public.social_write_limits
    where user_id = '60000000-0000-4000-8000-000000000001'
      and bucket = 'shared'
  ), -1) <> current_setting(
    'brownsync.check.checkin_calendar_shared'
  )::integer or exists (
    select 1
    from public.checkins
    where note = 'chk-calendar-ttl'
  ) then
    raise exception 'invalid calendar check-in TTL consumed quota or wrote a row';
  end if;
end
$$;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000002","email":"chk-social-b@brown.edu","app_metadata":{"providers":["google"]}}',
  true
);
do $$
begin
  if exists (
    select 1
    from public.checkins
    where note = 'chk-valid-checkin'
  ) then
    raise exception 'non-owner saw check-in';
  end if;
end
$$;
reset role;
update public.checkins
set created_at = now() - interval '2 hours',
    expires_at = now() - interval '1 hour'
where note = 'chk-valid-checkin';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","email":"chk-social-a@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  if exists (
    select 1
    from public.checkins
    where note = 'chk-valid-checkin'
  ) then
    raise exception 'owner saw expired check-in';
  end if;
end
$$;

-- The database limiter is an independent enforcement domain from the Worker
-- native limiter: shared writes are 20/fixed-60s and presence publishes have a
-- non-burstable last-success cooldown of 60 seconds.
reset role;
insert into public.social_write_limits (
  user_id, bucket, window_started_at, count
) values (
  '60000000-0000-4000-8000-000000000005',
  'shared',
  clock_timestamp() - interval '2 minutes',
  20
)
on conflict (user_id, bucket) do update
set window_started_at = excluded.window_started_at,
    count = excluded.count,
    last_success_at = null;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000005","email":"chk-social-e@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.create_checkin(
  'chk-social-place',
  'chk-shared-boundary',
  interval '1 hour'
);
reset role;
do $$
begin
  if coalesce((
    select count
    from public.social_write_limits
    where user_id = '60000000-0000-4000-8000-000000000005'
      and bucket = 'shared'
  ), -1) <> 1 or not exists (
    select 1 from public.checkins where note = 'chk-shared-boundary'
  ) then
    raise exception 'shared limiter did not reopen after its 60-second window';
  end if;
end
$$;
delete from public.checkins where note = 'chk-shared-boundary';

update public.social_write_limits
set window_started_at = clock_timestamp() - interval '30 seconds',
    count = 20
where user_id = '60000000-0000-4000-8000-000000000005'
  and bucket = 'shared';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000005","email":"chk-social-e@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.create_checkin(
      'chk-social-place',
      'chk-shared-too-soon',
      interval '1 hour'
    );
    raise exception 'exhausted shared bucket allowed a write';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_SOCIAL_RATE_LIMITED' then
      raise;
    end if;
  end;
end
$$;
reset role;
do $$
begin
  if exists (
    select 1 from public.checkins where note = 'chk-shared-too-soon'
  ) then
    raise exception 'rate-limited check-in left a row';
  end if;
end
$$;

-- A later caller rollback reverses both the write and its consumed counter.
update public.social_write_limits
set window_started_at = clock_timestamp(),
    count = 0
where user_id = '60000000-0000-4000-8000-000000000005'
  and bucket = 'shared';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000005","email":"chk-social-e@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.create_checkin(
      'chk-social-place',
      'chk-forced-rollback',
      interval '1 hour'
    );
    raise exception 'chk-forced-rollback';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'chk-forced-rollback' then
      raise;
    end if;
  end;
end
$$;

reset role;
do $$
begin
  if coalesce((
    select count
    from public.social_write_limits
    where user_id = '60000000-0000-4000-8000-000000000005'
      and bucket = 'shared'
  ), -1) <> 0 or exists (
    select 1 from public.checkins where note = 'chk-forced-rollback'
  ) then
    raise exception 'caller rollback retained a social write or consumed counter';
  end if;
end
$$;

-- Presence permits a publish beyond 60 seconds, rejects one well inside the
-- cooldown, and rolls back the shared counter consumed earlier in the call.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000005","email":"chk-social-e@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.set_ghost(false);
reset role;
insert into public.social_write_limits (
  user_id, bucket, window_started_at, count, last_success_at
) values (
  '60000000-0000-4000-8000-000000000005',
  'presence',
  clock_timestamp() - interval '2 minutes',
  1,
  clock_timestamp() - interval '2 minutes'
)
on conflict (user_id, bucket) do update
set window_started_at = excluded.window_started_at,
    count = excluded.count,
    last_success_at = excluded.last_success_at;
update public.social_write_limits
set window_started_at = clock_timestamp(),
    count = 1
where user_id = '60000000-0000-4000-8000-000000000005'
  and bucket = 'shared';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000005","email":"chk-social-e@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
select public.set_presence(
  'chk-social-place',
  'free',
  'chk-presence-boundary',
  interval '1 hour'
);
reset role;
update public.social_write_limits
set last_success_at = clock_timestamp() - interval '30 seconds'
where user_id = '60000000-0000-4000-8000-000000000005'
  and bucket = 'presence';
select set_config(
  'brownsync.check.e_shared_count',
  coalesce((
    select count::text
    from public.social_write_limits
    where user_id = '60000000-0000-4000-8000-000000000005'
      and bucket = 'shared'
  ), '-1'),
  true
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000005","email":"chk-social-e@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.set_presence(
      'chk-social-place',
      'free',
      'chk-presence-too-soon',
      interval '1 hour'
    );
    raise exception 'presence cooldown allowed a publish well before 60 seconds';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_PRESENCE_RATE_LIMITED' then
      raise;
    end if;
  end;

end
$$;

reset role;
do $$
begin
  if coalesce((
    select count
    from public.social_write_limits
    where user_id = '60000000-0000-4000-8000-000000000005'
      and bucket = 'shared'
  ), -1) <> current_setting(
      'brownsync.check.e_shared_count'
    )::integer or not exists (
    select 1
    from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000005'
      and note = 'chk-presence-boundary'
  ) then
    raise exception 'presence cooldown failure consumed shared quota or changed state';
  end if;
end
$$;

-- Exhausting shared quota must never disable privacy/safety-off operations.
reset role;
insert into public.friendships (
  requester, addressee, status, responded_at
) values
  (
    '60000000-0000-4000-8000-000000000005',
    '60000000-0000-4000-8000-000000000003',
    'accepted',
    clock_timestamp()
  ),
  (
    '60000000-0000-4000-8000-000000000004',
    '60000000-0000-4000-8000-000000000005',
    'pending',
    null
  );
insert into public.presence_shares (
  owner, viewer, created_at, expires_at
) values (
  '60000000-0000-4000-8000-000000000005',
  '60000000-0000-4000-8000-000000000003',
  clock_timestamp(),
  clock_timestamp() + interval '1 day'
);
update public.social_write_limits
set window_started_at = clock_timestamp(),
    count = 20
where user_id = '60000000-0000-4000-8000-000000000005'
  and bucket = 'shared';
update public.social_write_limits
set last_success_at = clock_timestamp() - interval '2 minutes'
where user_id = '60000000-0000-4000-8000-000000000005'
  and bucket = 'presence';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000005","email":"chk-social-e@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.request_friend('60000000-0000-4000-8000-000000000002');
    raise exception 'exhausted bucket allowed friend request';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_SOCIAL_RATE_LIMITED' then
      raise;
    end if;
  end;

  begin
    perform public.respond_friend(
      '60000000-0000-4000-8000-000000000004',
      true
    );
    raise exception 'exhausted bucket allowed friend acceptance';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_SOCIAL_RATE_LIMITED' then
      raise;
    end if;
  end;

  begin
    perform public.set_presence(
      'chk-social-place',
      'free',
      'chk-exhausted-presence',
      interval '1 hour'
    );
    raise exception 'exhausted bucket allowed presence publish';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_SOCIAL_RATE_LIMITED' then
      raise;
    end if;
  end;
end
$$;

select public.revoke_presence_share('60000000-0000-4000-8000-000000000003');
do $$
begin
  begin
    perform public.set_presence_share(
      '60000000-0000-4000-8000-000000000003',
      clock_timestamp() + interval '1 day'
    );
    raise exception 'exhausted bucket allowed share grant';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_SOCIAL_RATE_LIMITED' then
      raise;
    end if;
  end;
end
$$;
select public.remove_friend('60000000-0000-4000-8000-000000000003');
select public.block_user('60000000-0000-4000-8000-000000000003');
do $$
begin
  begin
    perform public.unblock_user('60000000-0000-4000-8000-000000000003');
    raise exception 'exhausted bucket allowed unblock';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_SOCIAL_RATE_LIMITED' then
      raise;
    end if;
  end;
end
$$;
select public.respond_friend(
  '60000000-0000-4000-8000-000000000004',
  false
);
select public.clear_presence();
select public.set_ghost(true);
do $$
begin
  begin
    perform public.set_ghost(false);
    raise exception 'exhausted bucket allowed ghost=false';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_SOCIAL_RATE_LIMITED' then
      raise;
    end if;
  end;
end
$$;
reset role;
do $$
begin
  if exists (
    select 1
    from public.presence_shares
    where owner = '60000000-0000-4000-8000-000000000005'
      and viewer = '60000000-0000-4000-8000-000000000003'
  ) or exists (
    select 1
    from public.friendships
    where requester = '60000000-0000-4000-8000-000000000004'
      and addressee = '60000000-0000-4000-8000-000000000005'
  ) or not exists (
    select 1
    from public.friendships
    where status = 'blocked'
      and blocked_by = '60000000-0000-4000-8000-000000000005'
      and requester = '60000000-0000-4000-8000-000000000005'
      and addressee = '60000000-0000-4000-8000-000000000003'
  ) or not exists (
    select 1
    from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000005'
      and ghost
      and place_id is null
      and status is null
      and note is null
      and expires_at <= clock_timestamp()
  ) then
    raise exception 'exhausted quota blocked a privacy action or allowed re-enabling';
  end if;
end
$$;

-- Owner-only cleanup deletes expired shares/check-ins and erases only the
-- sensitive state fields while retaining ghost and timestamps.
reset role;
insert into public.presence_shares (
  owner, viewer, created_at, expires_at
)
values (
  '60000000-0000-4000-8000-000000000003',
  '60000000-0000-4000-8000-000000000005',
  now() - interval '2 days',
  now() - interval '1 day'
);
insert into public.checkins (
  owner, place_id, note, created_at, expires_at
) values (
  '60000000-0000-4000-8000-000000000005',
  'chk-social-place',
  'chk-expired-cleanup',
  '2026-01-01 00:00:00+00',
  '2026-01-02 00:00:00+00'
);
insert into public.checkins (
  owner, place_id, note, created_at, expires_at
) values (
  '60000000-0000-4000-8000-000000000004',
  'chk-social-place',
  'chk-live-cleanup-control',
  clock_timestamp(),
  clock_timestamp() + interval '1 hour'
);
insert into public.presence_state (
  user_id,
  place_id,
  status,
  note,
  ghost,
  updated_at,
  expires_at
) values (
  '60000000-0000-4000-8000-000000000003',
  'chk-social-place',
  'eating',
  'chk-expired-sensitive',
  true,
  '2026-01-01 00:00:00+00',
  '2026-01-02 00:00:00+00'
);
do $$
declare
  live_checkin record;
  live_presence record;
  live_share record;
begin
  select *
  into strict live_share
  from public.presence_shares
  where owner = '60000000-0000-4000-8000-000000000003'
    and viewer = '60000000-0000-4000-8000-000000000002';

  select *
  into strict live_checkin
  from public.checkins
  where note = 'chk-live-cleanup-control';

  select *
  into strict live_presence
  from public.presence_state
  where user_id = '60000000-0000-4000-8000-000000000001';

  perform public.cleanup_expired_social();

  if exists (
    select 1
    from public.presence_shares
    where owner = '60000000-0000-4000-8000-000000000003'
      and viewer = '60000000-0000-4000-8000-000000000005'
  ) then
    raise exception 'cleanup retained expired share';
  end if;
  if exists (
    select 1
    from public.checkins
    where note = 'chk-expired-cleanup'
  ) then
    raise exception 'cleanup retained expired check-in';
  end if;
  if (
    select count(*) <> 1
    from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000003'
      and place_id is null
      and status is null
      and note is null
      and ghost
      and updated_at = '2026-01-01 00:00:00+00'
      and expires_at = '2026-01-02 00:00:00+00'
  ) then
    raise exception 'cleanup did not erase sensitive state while retaining preference/timestamps';
  end if;

  if not exists (
    select 1
    from public.presence_shares current_share
    where current_share.owner = live_share.owner
      and current_share.viewer = live_share.viewer
      and current_share.created_at is not distinct from live_share.created_at
      and current_share.expires_at is not distinct from live_share.expires_at
  ) or not exists (
    select 1
    from public.checkins current_checkin
    where current_checkin.id = live_checkin.id
      and current_checkin.owner = live_checkin.owner
      and current_checkin.place_id = live_checkin.place_id
      and current_checkin.note is not distinct from live_checkin.note
      and current_checkin.created_at is not distinct from live_checkin.created_at
      and current_checkin.expires_at is not distinct from live_checkin.expires_at
  ) or not exists (
    select 1
    from public.presence_state current_presence
    where current_presence.user_id = live_presence.user_id
      and current_presence.place_id is not distinct from live_presence.place_id
      and current_presence.status is not distinct from live_presence.status
      and current_presence.note is not distinct from live_presence.note
      and current_presence.ghost is not distinct from live_presence.ghost
      and current_presence.updated_at is not distinct from live_presence.updated_at
      and current_presence.expires_at is not distinct from live_presence.expires_at
  ) then
    raise exception 'cleanup changed an unexpired share, check-in, or presence row';
  end if;
end
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000003","email":"chk-social-c@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
begin
  begin
    perform public.set_presence(
      'chk-social-place',
      'free',
      'chk-stale-after-cleanup',
      interval '1 hour'
    );
    raise exception 'cleanup reset ghost opt-out and allowed stale publish';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'BROWNSYNC_PRESENCE_GHOSTED' then
      raise;
    end if;
  end;
end
$$;
reset role;

-- Deleting auth.users must cascade through its profile and every social
-- family; there is intentionally no client SQL delete_account() RPC.
insert into public.friendships (
  requester, addressee, status, responded_at
) values (
  '60000000-0000-4000-8000-000000000006',
  '60000000-0000-4000-8000-000000000005',
  'accepted',
  now()
);
insert into public.presence_shares (owner, viewer, expires_at)
values (
  '60000000-0000-4000-8000-000000000006',
  '60000000-0000-4000-8000-000000000005',
  now() + interval '1 day'
);
insert into public.presence_state (
  user_id, place_id, status, note, ghost, expires_at
) values (
  '60000000-0000-4000-8000-000000000006',
  'chk-social-place',
  'free',
  'chk-delete-cascade',
  false,
  now() + interval '1 hour'
);
insert into public.checkins (owner, place_id, note, expires_at)
values (
  '60000000-0000-4000-8000-000000000006',
  'chk-social-place',
  'chk-delete-cascade',
  now() + interval '1 hour'
);
insert into public.social_write_limits (
  user_id, bucket, window_started_at, count
) values (
  '60000000-0000-4000-8000-000000000006',
  'shared',
  clock_timestamp(),
  1
);
delete from auth.users
where id = '60000000-0000-4000-8000-000000000006';
do $$
begin
  if exists (
    select 1 from public.profiles
    where id = '60000000-0000-4000-8000-000000000006'
  ) or exists (
    select 1 from public.friendships
    where requester = '60000000-0000-4000-8000-000000000006'
       or addressee = '60000000-0000-4000-8000-000000000006'
       or blocked_by = '60000000-0000-4000-8000-000000000006'
  ) or exists (
    select 1 from public.presence_shares
    where owner = '60000000-0000-4000-8000-000000000006'
       or viewer = '60000000-0000-4000-8000-000000000006'
  ) or exists (
    select 1 from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000006'
  ) or exists (
    select 1 from public.checkins
    where owner = '60000000-0000-4000-8000-000000000006'
  ) or exists (
    select 1 from public.social_write_limits
    where user_id = '60000000-0000-4000-8000-000000000006'
  ) then
    raise exception 'auth-user deletion did not cascade through every social family';
  end if;
end
$$;

-- A previously issued Brown/Google JWT can outlive account deletion. Every
-- mutating RPC must recheck the caller profile and fail before recreating any
-- rate or social row.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000006","email":"chk-social-delete@brown.edu","app_metadata":{"provider":"google"}}',
  true
);
do $$
declare
  call_sql text;
begin
  foreach call_sql in array array[
    $call$select public.request_friend('60000000-0000-4000-8000-000000000005')$call$,
    $call$select public.respond_friend('60000000-0000-4000-8000-000000000005', true)$call$,
    $call$select public.respond_friend('60000000-0000-4000-8000-000000000005', false)$call$,
    $call$select public.remove_friend('60000000-0000-4000-8000-000000000005')$call$,
    $call$select public.block_user('60000000-0000-4000-8000-000000000005')$call$,
    $call$select public.unblock_user('60000000-0000-4000-8000-000000000005')$call$,
    $call$select public.set_presence_share('60000000-0000-4000-8000-000000000005', clock_timestamp() + interval '1 day')$call$,
    $call$select public.revoke_presence_share('60000000-0000-4000-8000-000000000005')$call$,
    $call$select public.set_presence('chk-social-place', 'free', 'chk-deleted-jwt', interval '1 hour')$call$,
    $call$select public.clear_presence()$call$,
    $call$select public.set_ghost(true)$call$,
    $call$select public.set_ghost(false)$call$,
    $call$select public.create_checkin('chk-social-place', 'chk-deleted-jwt', interval '1 hour')$call$
  ] loop
    begin
      execute call_sql;
      raise exception 'deleted-profile social RPC call succeeded: %', call_sql;
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'BROWNSYNC_SOCIAL_UNAUTHORIZED' then
        raise;
      end if;
    end;
  end loop;
end
$$;
reset role;
do $$
begin
  if exists (
    select 1 from public.social_write_limits
    where user_id = '60000000-0000-4000-8000-000000000006'
  ) or exists (
    select 1 from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000006'
  ) or exists (
    select 1 from public.checkins
    where owner = '60000000-0000-4000-8000-000000000006'
  ) then
    raise exception 'deleted-profile JWT recreated social state';
  end if;
end
$$;

-- The database owner/Hyperdrive path remains usable because RLS is enabled but
-- never forced.
update public.presence_state
set note = 'chk-owner-path'
where user_id = '60000000-0000-4000-8000-000000000001';
do $$
begin
  if (
    select count(*) <> 1
    from public.presence_state
    where user_id = '60000000-0000-4000-8000-000000000001'
      and note = 'chk-owner-path'
  ) then
    raise exception 'database owner path could not update/read social state';
  end if;
end
$$;

rollback;
