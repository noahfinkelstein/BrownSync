\set ON_ERROR_STOP on

-- 0016_user_events_checks.sql
-- Rollback-safe semantic checks for authenticated student-created events.

begin;

do $$
begin
  if pg_catalog.to_regclass('public.user_events') is null
     or pg_catalog.to_regclass('public.user_event_controls') is null
     or pg_catalog.to_regclass('public.user_event_create_limits') is null
     or pg_catalog.to_regprocedure(
       'public.brownsync_create_user_event(uuid,uuid,text,text,text,timestamptz,timestamptz,text,text,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.brownsync_edit_user_event(uuid,uuid,bigint,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.brownsync_delete_user_event(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.brownsync_list_user_events(uuid,timestamptz,uuid,integer)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.brownsync_get_user_event(uuid,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.brownsync_moderate_user_event(uuid,uuid,boolean)'
     ) is null then
    raise exception
      'BROWNSYNC_USER_EVENTS_MIGRATION_MISSING: tables or owner routines';
  end if;
end
$$;

-- The singleton switch blocks only new enabling work. Exact replay resolves
-- before mutable location data, quota, and switch state. Delete/cancel and
-- hide remain available while posting is disabled and the creator is capped.
create function pg_temp.run_user_event_switch_checks()
returns void
language plpgsql
as $$
declare
  v_blocked boolean;
  v_delete_id uuid;
  v_edit_event public.user_events%rowtype;
  v_hide_id uuid;
  v_location_event public.user_events%rowtype;
  v_rate_event public.user_events%rowtype;
  v_result record;
begin
  select e.*
  into v_edit_event
  from public.user_events as e
  where e.client_request_id =
    '82400000-0000-4000-8000-000000000001';

  select e.*
  into v_location_event
  from public.user_events as e
  where e.client_request_id =
    '82100000-0000-4000-8000-000000000010';

  select e.*
  into v_rate_event
  from public.user_events as e
  where e.created_by = '82000000-0000-4000-8000-000000000009'
    and e.deleted_at is null
  order by e.created_at, e.id
  limit 1;

  delete from public.place_aliases
  where place_id = 'chk-user-event-place-a'
    and alias_norm = public.normalize_alias('UE Hall');

  select *
  into v_result
  from public.brownsync_create_user_event(
    '82000000-0000-4000-8000-000000000003',
    v_location_event.client_request_id,
    v_location_event.organization_id,
    'Resolved room event',
    'Uses exact-room resolution',
    v_location_event.start_ts,
    v_location_event.end_ts,
    'academic',
    'https://example.com/resolved',
    null,
    '  UE Hall 101  '
  );
  if v_result.event_id is distinct from v_location_event.id
     or v_result.replayed is distinct from true then
    raise exception 'exact replay re-resolved mutable location data';
  end if;

  update public.places
  set aliases = array['UE Hall']
  where id = 'chk-user-event-place-a';

  update public.user_event_controls
  set posting_enabled = false,
      updated_by = '82000000-0000-4000-8000-000000000006',
      updated_at = pg_catalog.clock_timestamp()
  where id = true;

  select *
  into v_result
  from public.brownsync_create_user_event(
    '82000000-0000-4000-8000-000000000004',
    v_edit_event.client_request_id,
    v_edit_event.organization_id,
    'Editable organization event',
    'Before edit',
    v_edit_event.start_ts,
    v_edit_event.end_ts,
    'club',
    null,
    'chk-user-event-place-a',
    null
  );
  if v_result.event_id is distinct from v_edit_event.id
     or v_result.replayed is distinct from true then
    raise exception 'exact create replay was blocked by disabled posting';
  end if;

  select *
  into v_result
  from public.brownsync_create_user_event(
    '82000000-0000-4000-8000-000000000009',
    v_rate_event.client_request_id,
    null,
    v_rate_event.title,
    v_rate_event.description,
    v_rate_event.start_ts,
    v_rate_event.end_ts,
    v_rate_event.category,
    v_rate_event.url,
    v_rate_event.place_id,
    null
  );
  if v_result.event_id is distinct from v_rate_event.id
     or v_result.replayed is distinct from true
     or (
       select l.count
       from public.user_event_create_limits as l
       where l.user_id = '82000000-0000-4000-8000-000000000009'
     ) is distinct from 10 then
    raise exception 'same-key replay at count=10 consumed quota or failed';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000004',
      v_edit_event.client_request_id,
      v_edit_event.organization_id,
      'Changed while disabled',
      'Before edit',
      v_edit_event.start_ts,
      v_edit_event.end_ts,
      'club',
      null,
      'chk-user-event-place-a',
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm =
      'BROWNSYNC_USER_EVENT_REQUEST_CONFLICT';
  end;
  if not v_blocked then
    raise exception 'changed request-id reuse did not beat switch handling';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000003',
      '82500000-0000-4000-8000-000000000001',
      'chk-user-event-org',
      'Disabled new event',
      null,
      pg_catalog.clock_timestamp() + interval '5 days',
      null,
      'club',
      null,
      'chk-user-event-place-a',
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm =
      'BROWNSYNC_USER_EVENT_POSTING_DISABLED';
  end;
  if not v_blocked then
    raise exception 'posting switch allowed a new create';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_edit_user_event(
      '82000000-0000-4000-8000-000000000004',
      v_edit_event.id,
      v_edit_event.revision,
      '{"title":"Disabled real edit"}'::jsonb
    );
  exception when raise_exception then
    v_blocked := sqlerrm =
      'BROWNSYNC_USER_EVENT_POSTING_DISABLED';
  end;
  if not v_blocked then
    raise exception 'posting switch allowed a real edit';
  end if;

  select e.id
  into v_delete_id
  from public.user_events as e
  where e.created_by = '82000000-0000-4000-8000-000000000009'
  order by e.created_at, e.id
  limit 1;

  select *
  into v_result
  from public.brownsync_delete_user_event(
    '82000000-0000-4000-8000-000000000009',
    v_delete_id
  );
  if v_result.revision is distinct from 1
     or v_result.changed is distinct from true then
    raise exception 'disabled/exhausted delete did not succeed: %', v_result;
  end if;

  select *
  into v_result
  from public.brownsync_delete_user_event(
    '82000000-0000-4000-8000-000000000009',
    v_delete_id
  );
  if v_result.revision is distinct from 1
     or v_result.changed is distinct from false then
    raise exception 'delete retry was not idempotent: %', v_result;
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_edit_user_event(
      '82000000-0000-4000-8000-000000000009',
      v_delete_id,
      1,
      '{"title":"Edit canceled event"}'::jsonb
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_NOT_FOUND';
  end;
  if not v_blocked then
    raise exception 'soft-deleted event remained editable';
  end if;

  select e.id
  into v_hide_id
  from public.user_events as e
  where e.created_by = '82000000-0000-4000-8000-000000000009'
    and e.deleted_at is null
  order by e.created_at, e.id
  limit 1;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_moderate_user_event(
      '82000000-0000-4000-8000-000000000003',
      v_hide_id,
      true
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_FORBIDDEN';
  end;
  if not v_blocked then
    raise exception 'ordinary organization owner moderated an event';
  end if;

  select *
  into v_result
  from public.brownsync_moderate_user_event(
    '82000000-0000-4000-8000-000000000006',
    v_hide_id,
    true
  );
  if v_result.changed is distinct from true
     or not exists (
       select 1
       from public.user_events as e
       where e.id = v_hide_id
         and e.moderation_state = 'hidden'
     ) then
    raise exception 'reviewer hide failed under disabled posting';
  end if;

  select *
  into v_result
  from public.brownsync_moderate_user_event(
    '82000000-0000-4000-8000-000000000006',
    v_hide_id,
    true
  );
  if v_result.changed is distinct from false then
    raise exception 'same moderation retry was not idempotent';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_moderate_user_event(
      '82000000-0000-4000-8000-000000000006',
      v_hide_id,
      false
    );
  exception when raise_exception then
    v_blocked := sqlerrm =
      'BROWNSYNC_USER_EVENT_POSTING_DISABLED';
  end;
  if not v_blocked then
    raise exception 'reviewer unhide bypassed disabled posting';
  end if;

  update public.user_event_controls
  set posting_enabled = true,
      updated_by = '82000000-0000-4000-8000-000000000006',
      updated_at = pg_catalog.clock_timestamp()
  where id = true;

  select *
  into v_result
  from public.brownsync_moderate_user_event(
    '82000000-0000-4000-8000-000000000006',
    v_hide_id,
    false
  );
  if v_result.changed is distinct from true
     or not exists (
       select 1
       from public.user_events as e
       where e.id = v_hide_id
         and e.moderation_state = 'active'
     ) then
    raise exception 'reviewer could not unhide after posting was enabled';
  end if;
end
$$;

-- Exact structural contract, including the deliberate absence of coordinates.
do $$
declare
  v_expected text[];
  v_actual text[];
begin
  v_expected := array[
    'id:uuid',
    'organization_id:text',
    'created_by:uuid',
    'client_request_id:uuid',
    'payload_fingerprint:text',
    'title:text',
    'description:text',
    'start_ts:timestamp with time zone',
    'end_ts:timestamp with time zone',
    'place_id:text',
    'location_raw:text',
    'category:text',
    'url:text',
    'status:text',
    'moderation_state:text',
    'revision:bigint',
    'updated_by:uuid',
    'deleted_by:uuid',
    'deleted_at:timestamp with time zone',
    'moderated_by:uuid',
    'moderated_at:timestamp with time zone',
    'created_at:timestamp with time zone',
    'updated_at:timestamp with time zone'
  ];

  select pg_catalog.array_agg(
    a.attname || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod)
    order by a.attnum
  )
  into v_actual
  from pg_catalog.pg_attribute as a
  where a.attrelid = 'public.user_events'::pg_catalog.regclass
    and a.attnum > 0
    and not a.attisdropped;

  if v_actual is distinct from v_expected then
    raise exception 'user_events columns drifted: %', v_actual;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute as a
    where a.attrelid = 'public.user_events'::pg_catalog.regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attname in ('lat', 'lng', 'coordinates', 'location_text')
  ) then
    raise exception 'user_events contains forbidden coordinate/free-location state';
  end if;

  if not (
    select a.attnotnull
    from pg_catalog.pg_attribute as a
    where a.attrelid = 'public.user_events'::pg_catalog.regclass
      and a.attname = 'place_id'
  ) then
    raise exception 'user_events.place_id is not required';
  end if;
end
$$;

-- Fixtures use a reserved UUID/id namespace and roll back at EOF.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  ('82000000-0000-4000-8000-000000000001', 'events.old@brown.edu', '{"full_name":"Events Old"}', '{"provider":"google"}'),
  ('82000000-0000-4000-8000-000000000002', 'events.new@brown.edu', '{"full_name":"Events New"}', '{"provider":"google"}'),
  ('82000000-0000-4000-8000-000000000003', 'events.owner@brown.edu', '{"full_name":"Events Owner"}', '{"providers":["google"]}'),
  ('82000000-0000-4000-8000-000000000004', 'events.editor@brown.edu', '{"full_name":"Events Editor"}', '{"provider":"google"}'),
  ('82000000-0000-4000-8000-000000000005', 'events.outsider@brown.edu', '{"full_name":"Events Outsider"}', '{"provider":"google"}'),
  ('82000000-0000-4000-8000-000000000006', 'events.reviewer@brown.edu', '{"full_name":"Events Reviewer"}', '{"provider":"google"}'),
  ('82000000-0000-4000-8000-000000000007', 'events.delete@brown.edu', '{"full_name":"Events Delete"}', '{"provider":"google"}'),
  ('82000000-0000-4000-8000-000000000008', 'events.orgdelete@brown.edu', '{"full_name":"Events Org Delete"}', '{"provider":"google"}'),
  ('82000000-0000-4000-8000-000000000009', 'events.rate@brown.edu', '{"full_name":"Events Rate"}', '{"provider":"google"}'),
  ('82000000-0000-4000-8000-000000000010', 'events.rollback@brown.edu', '{"full_name":"Events Rollback"}', '{"provider":"google"}'),
  ('82000000-0000-4000-8000-000000000011', 'events.page@brown.edu', '{"full_name":"Events Page"}', '{"provider":"google"}'),
  ('82000000-0000-4000-8000-000000000012', 'events.newadmin@brown.edu', '{"full_name":"Events New Admin"}', '{"provider":"google"}');

update public.profiles
set created_at = pg_catalog.clock_timestamp() - interval '2 days'
where id not in (
  '82000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000012'
);

update public.profiles
set created_at = pg_catalog.clock_timestamp() - interval '23 hours 59 minutes'
where id in (
  '82000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000012'
);

insert into public.places (
  id, name, aliases, kind, lat, lng, source
)
values
  (
    'chk-user-event-place-a',
    'User Event Hall',
    array['UE Hall'],
    'academic',
    41.826,
    -71.403,
    'check'
  ),
  (
    'chk-user-event-place-b',
    'User Event Annex B',
    array['Ambiguous User Event Hall'],
    'academic',
    41.827,
    -71.404,
    'check'
  ),
  (
    'chk-user-event-place-c',
    'User Event Annex C',
    array['Ambiguous User Event Hall'],
    'academic',
    41.828,
    -71.405,
    'check'
  );

insert into public.organizations (
  id, name, kind, description, source, contact_emails
)
values
  (
    'chk-user-event-org',
    'Check User Event Org',
    'club',
    'Organization event fixture',
    'check',
    '{}'
  ),
  (
    'chk-user-event-other-org',
    'Check Other User Event Org',
    'club',
    'Cross-organization fixture',
    'check',
    '{}'
  ),
  (
    'chk-user-event-page-org',
    'Check User Event Page Org',
    'club',
    'Pagination fixture',
    'check',
    '{}'
  );

insert into public.org_admins (
  organization_id, user_id, role, grant_source
)
values
  (
    'chk-user-event-org',
    '82000000-0000-4000-8000-000000000003',
    'owner',
    'creator'
  ),
  (
    'chk-user-event-org',
    '82000000-0000-4000-8000-000000000004',
    'editor',
    'owner_grant'
  ),
  (
    'chk-user-event-org',
    '82000000-0000-4000-8000-000000000008',
    'editor',
    'owner_grant'
  ),
  (
    'chk-user-event-org',
    '82000000-0000-4000-8000-000000000012',
    'editor',
    'owner_grant'
  ),
  (
    'chk-user-event-other-org',
    '82000000-0000-4000-8000-000000000005',
    'owner',
    'creator'
  ),
  (
    'chk-user-event-page-org',
    '82000000-0000-4000-8000-000000000011',
    'owner',
    'creator'
  );

insert into public.org_reviewers (user_id)
values ('82000000-0000-4000-8000-000000000006');

-- Table constraints are executable boundaries, not just named catalog
-- objects. Every malformed direct row below must fail before it can survive.
do $$
declare
  v_blocked boolean;
  v_sql text;
begin
  foreach v_sql in array array[
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'  padded  ',clock_timestamp(),'chk-user-event-place-a','academic')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),repeat('x',201),clock_timestamp(),'chk-user-event-place-a','academic')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,description,start_ts,place_id,category)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Valid title',repeat('x',10001),clock_timestamp(),'chk-user-event-place-a','academic')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,description,start_ts,place_id,category)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Valid title',repeat(' ',10001),clock_timestamp(),'chk-user-event-place-a','academic')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,location_raw,category)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Valid title',clock_timestamp(),'chk-user-event-place-a',repeat('x',501),'academic')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,end_ts,place_id,category)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Valid title','2030-01-01 12:00+00','2030-01-01 12:00+00','chk-user-event-place-a','academic')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Valid title','infinity','chk-user-event-place-a','academic')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,end_ts,place_id,category)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Valid title','2030-01-01 12:00+00','infinity','chk-user-event-place-a','academic')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Valid title',clock_timestamp(),'chk-user-event-place-missing','academic')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category,url)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Valid title',clock_timestamp(),'chk-user-event-place-a','academic','http://example.com')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category,url)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Valid title',clock_timestamp(),'chk-user-event-place-a','academic','https://' || repeat('x',2041))$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Valid title',clock_timestamp(),'chk-user-event-place-a','invalid')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category,status)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Valid title',clock_timestamp(),'chk-user-event-place-a','academic','invalid')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category,moderation_state)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Valid title',clock_timestamp(),'chk-user-event-place-a','academic','invalid')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category,revision)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Valid title',clock_timestamp(),'chk-user-event-place-a','academic',-1)$sql$,
    $sql$insert into public.user_events
      (id,organization_id,created_by,client_request_id,payload_fingerprint,title,start_ts,place_id,category,status)
      values ('82900000-0000-4000-8000-000000000001',null,null,'82910000-0000-4000-8000-000000000001',md5('x'),'Visible orphan',clock_timestamp(),'chk-user-event-place-a','academic','published')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category,status)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Canceled without delete',clock_timestamp(),'chk-user-event-place-a','academic','canceled')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category,status,deleted_at)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Published deleted',clock_timestamp(),'chk-user-event-place-a','academic','published',clock_timestamp())$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category,created_at)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Infinite created',clock_timestamp(),'chk-user-event-place-a','academic','infinity')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category,updated_at)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001',md5('x'),'Infinite updated',clock_timestamp(),'chk-user-event-place-a','academic','infinity')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org',null,md5('x'),'Null request',clock_timestamp(),'chk-user-event-place-a','academic')$sql$,
    $sql$insert into public.user_events
      (id,organization_id,client_request_id,payload_fingerprint,title,start_ts,place_id,category)
      values ('82900000-0000-4000-8000-000000000001','chk-user-event-org','82910000-0000-4000-8000-000000000001','bad','Bad fingerprint',clock_timestamp(),'chk-user-event-place-a','academic')$sql$
  ] loop
    v_blocked := false;
    begin
      execute v_sql;
    exception
      when check_violation or not_null_violation or foreign_key_violation then
        v_blocked := true;
    end;
    if not v_blocked then
      raise exception 'invalid user_events row survived: %', v_sql;
    end if;
  end loop;
end
$$;

-- Defaults and singleton/counter bounds are proven by behavior inside forced
-- rollback subtransactions, so no fixture state is retained.
do $$
declare
  v_blocked boolean;
  v_control public.user_event_controls%rowtype;
  v_event public.user_events%rowtype;
  v_limit public.user_event_create_limits%rowtype;
begin
  begin
    insert into public.user_events (
      organization_id,
      client_request_id,
      payload_fingerprint,
      title,
      start_ts,
      place_id,
      category
    ) values (
      'chk-user-event-org',
      '82910000-0000-4000-8000-000000000010',
      pg_catalog.md5('defaults'),
      'Defaulted event',
      pg_catalog.clock_timestamp(),
      'chk-user-event-place-a',
      'academic'
    )
    returning * into v_event;
    if v_event.status <> 'draft'
       or v_event.moderation_state <> 'active'
       or v_event.revision <> 0
       or not pg_catalog.isfinite(v_event.created_at)
       or not pg_catalog.isfinite(v_event.updated_at) then
      raise exception 'user_events defaults drifted: %', v_event;
    end if;
    raise exception 'CHECK_FORCE_DEFAULT_EVENT_ROLLBACK';
  exception when raise_exception then
    if sqlerrm <> 'CHECK_FORCE_DEFAULT_EVENT_ROLLBACK' then
      raise;
    end if;
  end;

  begin
    delete from public.user_event_controls;
    insert into public.user_event_controls default values
    returning * into v_control;
    if v_control.id is distinct from true
       or v_control.posting_enabled is distinct from true
       or not pg_catalog.isfinite(v_control.updated_at) then
      raise exception 'user_event_controls defaults drifted: %', v_control;
    end if;
    raise exception 'CHECK_FORCE_CONTROL_DEFAULT_ROLLBACK';
  exception when raise_exception then
    if sqlerrm <> 'CHECK_FORCE_CONTROL_DEFAULT_ROLLBACK' then
      raise;
    end if;
  end;

  v_blocked := false;
  begin
    insert into public.user_event_controls (id)
    values (false);
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'control singleton accepted id=false';
  end if;

  begin
    insert into public.user_event_create_limits (user_id)
    values ('82000000-0000-4000-8000-000000000012')
    returning * into v_limit;
    if v_limit.count <> 1
       or not pg_catalog.isfinite(v_limit.window_started_at)
       or not pg_catalog.isfinite(v_limit.updated_at) then
      raise exception 'user_event_create_limits defaults drifted: %', v_limit;
    end if;
    raise exception 'CHECK_FORCE_LIMIT_DEFAULT_ROLLBACK';
  exception when raise_exception then
    if sqlerrm <> 'CHECK_FORCE_LIMIT_DEFAULT_ROLLBACK' then
      raise;
    end if;
  end;

end
$$;

do $$
declare
  v_blocked boolean;
  v_count integer;
begin
  foreach v_count in array array[0, 11] loop
    v_blocked := false;
    begin
      insert into public.user_event_create_limits (
        user_id, window_started_at, count
      ) values (
        '82000000-0000-4000-8000-000000000012',
        pg_catalog.clock_timestamp(),
        v_count
      );
    exception when check_violation then
      v_blocked := true;
    end;
    if not v_blocked then
      raise exception 'create counter accepted count=%', v_count;
    end if;
  end loop;

  v_blocked := false;
  begin
    insert into public.user_event_create_limits (
      user_id, window_started_at, count
    ) values (
      '82000000-0000-4000-8000-000000000012',
      'infinity',
      1
    );
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'create counter accepted a non-finite window';
  end if;
end
$$;

-- The fixed 24-hour creation window caps at exactly ten. The AFTER INSERT
-- quota hook also counts drafts, while subtransaction rollback consumes
-- neither an event nor a counter unit.
do $$
declare
  i integer;
  v_blocked boolean;
  v_event_id uuid;
  v_request_id uuid;
  v_start timestamptz := pg_catalog.clock_timestamp() + interval '3 days';
begin
  for i in 1..10 loop
    v_request_id := (
      '82200000-0000-4000-8000-' ||
      pg_catalog.lpad(i::text, 12, '0')
    )::uuid;
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000009',
      v_request_id,
      null,
      'Rate event ' || i::text,
      null,
      v_start + i * interval '1 minute',
      null,
      'social',
      null,
      'chk-user-event-place-a',
      null
    );
  end loop;

  if (
    select l.count
    from public.user_event_create_limits as l
    where l.user_id = '82000000-0000-4000-8000-000000000009'
  ) is distinct from 10 or (
    select pg_catalog.count(*)
    from public.user_events as e
    where e.created_by = '82000000-0000-4000-8000-000000000009'
  ) <> 10 then
    raise exception 'ten successful creates did not produce count=10 and ten rows';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000009',
      '82200000-0000-4000-8000-000000000011',
      null,
      'Rate event eleven',
      null,
      v_start + interval '11 minutes',
      null,
      'social',
      null,
      'chk-user-event-place-a',
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_RATE_LIMITED';
  end;
  if not v_blocked then
    raise exception 'eleventh create did not hit the fixed-window cap';
  end if;

  if (
    select l.count
    from public.user_event_create_limits as l
    where l.user_id = '82000000-0000-4000-8000-000000000009'
  ) is distinct from 10 or exists (
    select 1
    from public.user_events as e
    where e.client_request_id =
      '82200000-0000-4000-8000-000000000011'
  ) then
    raise exception 'rate failure changed the counter or retained an event';
  end if;

  begin
    select c.event_id
    into v_event_id
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000010',
      '82200000-0000-4000-8000-000000000020',
      null,
      'Rolled-back create',
      null,
      v_start,
      null,
      'academic',
      null,
      'chk-user-event-place-a',
      null
    ) as c;
    raise exception 'CHECK_FORCE_USER_EVENT_ROLLBACK';
  exception when raise_exception then
    if sqlerrm <> 'CHECK_FORCE_USER_EVENT_ROLLBACK' then
      raise;
    end if;
  end;

  if exists (
    select 1
    from public.user_events as e
    where e.id = v_event_id
  ) or exists (
    select 1
    from public.user_event_create_limits as l
    where l.user_id = '82000000-0000-4000-8000-000000000010'
  ) then
    raise exception 'rolled-back create retained an event or quota row';
  end if;

  insert into public.user_events (
    id,
    organization_id,
    created_by,
    client_request_id,
    payload_fingerprint,
    title,
    start_ts,
    place_id,
    category,
    status
  ) values (
    '82300000-0000-4000-8000-000000000001',
    null,
    '82000000-0000-4000-8000-000000000010',
    '82200000-0000-4000-8000-000000000021',
    pg_catalog.md5('draft consumes quota'),
    'Draft consumes quota',
    v_start,
    'chk-user-event-place-a',
    'academic',
    'draft'
  );

  if (
    select l.count
    from public.user_event_create_limits as l
    where l.user_id = '82000000-0000-4000-8000-000000000010'
  ) is distinct from 1 then
    raise exception 'draft insertion did not consume one quota unit';
  end if;
end
$$;

-- Optimistic edits merge the complete final state before validation. Current
-- creator or organization-admin authority is sufficient; real stale changes
-- fail while identical stale retries are no-ops.
do $$
declare
  v_blocked boolean;
  v_created record;
  v_patch jsonb;
  v_result record;
  v_start timestamptz := pg_catalog.clock_timestamp() + interval '4 days';
begin
  select *
  into v_created
  from public.brownsync_create_user_event(
    '82000000-0000-4000-8000-000000000004',
    '82400000-0000-4000-8000-000000000001',
    'chk-user-event-org',
    'Editable organization event',
    'Before edit',
    v_start,
    v_start + interval '2 hours',
    'club',
    null,
    'chk-user-event-place-a',
    null
  );

  select *
  into v_result
  from public.brownsync_edit_user_event(
    '82000000-0000-4000-8000-000000000003',
    v_created.event_id,
    0,
    '{"title":"Edited by current owner","description":"  After edit  "}'::jsonb
  );
  if v_result.event_id is distinct from v_created.event_id
     or v_result.revision is distinct from 1
     or v_result.changed is distinct from true
     or not exists (
       select 1
       from public.user_events as e
       where e.id = v_created.event_id
         and e.description = '  After edit  '
     ) then
    raise exception 'owner edit returned wrong result: %', v_result;
  end if;

  select *
  into v_result
  from public.brownsync_edit_user_event(
    '82000000-0000-4000-8000-000000000003',
    v_created.event_id,
    0,
    '{"title":"Edited by current owner","description":"  After edit  "}'::jsonb
  );
  if v_result.revision is distinct from 1
     or v_result.changed is distinct from false then
    raise exception 'identical stale edit was not a no-op: %', v_result;
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_edit_user_event(
      '82000000-0000-4000-8000-000000000003',
      v_created.event_id,
      0,
      '{"title":"A genuinely different stale edit"}'::jsonb
    );
  exception when raise_exception then
    v_blocked := sqlerrm =
      'BROWNSYNC_USER_EVENT_REVISION_CONFLICT';
  end;
  if not v_blocked then
    raise exception 'real stale edit did not conflict';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_edit_user_event(
      '82000000-0000-4000-8000-000000000005',
      v_created.event_id,
      1,
      '{"title":"Cross-organization edit"}'::jsonb
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_FORBIDDEN';
  end;
  if not v_blocked then
    raise exception 'unrelated organization admin edited an event';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_edit_user_event(
      '82000000-0000-4000-8000-000000000004',
      v_created.event_id,
      1,
      '{}'::jsonb
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_PATCH_INVALID';
  end;
  if not v_blocked then
    raise exception 'empty edit patch was accepted';
  end if;

  foreach v_patch in array array[
    '{"title":null}'::jsonb,
    '{"title":42}'::jsonb,
    '{"start_ts":null}'::jsonb,
    '{"start_ts":42}'::jsonb,
    '{"start_ts":"not-a-timestamp"}'::jsonb,
    '{"category":null}'::jsonb,
    '{"category":42}'::jsonb,
    '{"place_id":null}'::jsonb,
    '{"place_id":42}'::jsonb,
    '{"location_raw":null}'::jsonb,
    '{"location_raw":42}'::jsonb,
    pg_catalog.jsonb_build_object(
      'location_raw',
      pg_catalog.repeat('x', 501)
    )
  ] loop
    v_blocked := false;
    begin
      perform *
      from public.brownsync_edit_user_event(
        '82000000-0000-4000-8000-000000000004',
        v_created.event_id,
        1,
        v_patch
      );
    exception when raise_exception then
      v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_PATCH_INVALID';
    end;
    if not v_blocked then
      raise exception
        'nullable/non-string/oversized edit field escaped stable validation: %',
        v_patch;
    end if;
  end loop;

  select *
  into v_result
  from public.brownsync_edit_user_event(
    '82000000-0000-4000-8000-000000000004',
    v_created.event_id,
    1,
    '{"location_raw":" UE Hall 202 "}'::jsonb
  );
  if v_result.revision is distinct from 2
     or not exists (
       select 1
       from public.user_events as e
       where e.id = v_created.event_id
         and e.place_id = 'chk-user-event-place-a'
         and e.location_raw = 'UE Hall 202'
     ) then
    raise exception 'locationRaw edit did not resolve and replace location atomically';
  end if;

  select *
  into v_result
  from public.brownsync_edit_user_event(
    '82000000-0000-4000-8000-000000000004',
    v_created.event_id,
    2,
    '{"place_id":"chk-user-event-place-a"}'::jsonb
  );
  if v_result.revision is distinct from 3
     or not exists (
       select 1
       from public.user_events as e
       where e.id = v_created.event_id
         and e.place_id = 'chk-user-event-place-a'
         and e.location_raw is null
     ) then
    raise exception 'placeId edit did not clear raw location evidence';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_edit_user_event(
      '82000000-0000-4000-8000-000000000004',
      v_created.event_id,
      3,
      '{"start_ts":"2099-01-01T12:00:00Z"}'::jsonb
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_PATCH_INVALID';
  end;
  if not v_blocked then
    raise exception 'partial time edit skipped merged end-after-start validation';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_edit_user_event(
      '82000000-0000-4000-8000-000000000004',
      v_created.event_id,
      3,
      '{"place_id":"chk-user-event-place-a","location_raw":"UE Hall"}'::jsonb
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_PATCH_INVALID';
  end;
  if not v_blocked then
    raise exception 'edit accepted both location input forms';
  end if;
end
$$;

do $$
declare
  v_expected text[];
  v_actual text[];
begin
  v_expected := array[
    'id:uuid',
    'title:text',
    'description:text',
    'start_ts:timestamp with time zone',
    'end_ts:timestamp with time zone',
    'is_all_day:boolean',
    'lat:double precision',
    'lng:double precision',
    'place_id:text',
    'place_name:text',
    'location_raw:text',
    'org_id:text',
    'org_name:text',
    'category:text',
    'tags:text[]',
    'url:text',
    'cost:text',
    'source:text',
    'confidence:real',
    'is_canceled:boolean',
    'merged_sources:text[]'
  ];

  select pg_catalog.array_agg(
    a.attname || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod)
    order by a.attnum
  )
  into v_actual
  from pg_catalog.pg_attribute as a
  where a.attrelid = 'public.v_events_api'::pg_catalog.regclass
    and a.attnum > 0
    and not a.attisdropped;

  if v_actual is distinct from v_expected then
    raise exception 'v_events_api 21-column contract drifted: %', v_actual;
  end if;
end
$$;

do $$
declare
  v_actual text[];
  v_expected text[];
  v_proc pg_catalog.regprocedure;
begin
  v_proc :=
    'public.brownsync_list_user_events(uuid,timestamptz,uuid,integer)'
      ::pg_catalog.regprocedure;
  v_expected := array[
    'event_id:uuid',
    'organization_id:text',
    'organization_name:text',
    'title:text',
    'description:text',
    'start_ts:timestamp with time zone',
    'end_ts:timestamp with time zone',
    'place_id:text',
    'place_name:text',
    'location_raw:text',
    'category:text',
    'url:text',
    'status:text',
    'moderation_state:text',
    'revision:bigint',
    'deleted_at:timestamp with time zone',
    'created_at:timestamp with time zone',
    'updated_at:timestamp with time zone',
    'has_more:boolean'
  ];

  select pg_catalog.array_agg(
    p.proargnames[position.i] || ':' ||
    pg_catalog.format_type(p.proallargtypes[position.i], null)
    order by position.i
  )
  into v_actual
  from pg_catalog.pg_proc as p
  cross join lateral pg_catalog.generate_subscripts(
    p.proallargtypes,
    1
  ) as position(i)
  where p.oid = v_proc
    and p.proargmodes[position.i] = 't';

  if v_actual is distinct from v_expected then
    raise exception 'management list OUT contract drifted: %', v_actual;
  end if;

  v_proc :=
    'public.brownsync_get_user_event(uuid,uuid)'
      ::pg_catalog.regprocedure;
  v_expected := v_expected[1:18];

  select pg_catalog.array_agg(
    p.proargnames[position.i] || ':' ||
    pg_catalog.format_type(p.proallargtypes[position.i], null)
    order by position.i
  )
  into v_actual
  from pg_catalog.pg_proc as p
  cross join lateral pg_catalog.generate_subscripts(
    p.proallargtypes,
    1
  ) as position(i)
  where p.oid = v_proc
    and p.proargmodes[position.i] = 't';

  if v_actual is distinct from v_expected then
    raise exception 'management detail OUT contract drifted: %', v_actual;
  end if;
end
$$;

-- RLS, grants, hardened routines, indexes, and FK actions.
do $$
declare
  v_table text;
  v_role text;
  v_private text;
begin
  foreach v_table in array array[
    'user_events',
    'user_event_controls',
    'user_event_create_limits'
  ] loop
    if not (
      select c.relrowsecurity and not c.relforcerowsecurity
      from pg_catalog.pg_class as c
      where c.oid = ('public.' || v_table)::pg_catalog.regclass
    ) then
      raise exception 'RLS/not-FORCE drifted for %', v_table;
    end if;

    foreach v_role in array array['anon', 'authenticated'] loop
      if pg_catalog.has_table_privilege(
        v_role,
        pg_catalog.format('public.%I', v_table),
        'insert,update,delete,truncate,references,trigger'
      ) then
        raise exception '% has direct write authority on %', v_role, v_table;
      end if;
    end loop;
  end loop;

  foreach v_role in array array['anon', 'authenticated'] loop
    if pg_catalog.has_schema_privilege(
      v_role,
      'public',
      'create'
    ) then
      raise exception '% can create resolver-shadowing public objects', v_role;
    end if;

    if pg_catalog.has_table_privilege(
      v_role,
      'public.user_event_controls',
      'select'
    ) or pg_catalog.has_table_privilege(
      v_role,
      'public.user_event_create_limits',
      'select'
    ) then
      raise exception '% can read an internal user-event table', v_role;
    end if;

    foreach v_private in array array[
      'created_by',
      'client_request_id',
      'payload_fingerprint',
      'updated_by',
      'deleted_by',
      'moderated_by',
      'moderated_at'
    ] loop
      if pg_catalog.has_column_privilege(
        v_role,
        'public.user_events',
        v_private,
        'select'
      ) then
        raise exception '% can read private user_events.%', v_role, v_private;
      end if;
    end loop;
  end loop;

  if pg_catalog.has_schema_privilege(
    'public',
    'public',
    'create'
  ) then
    raise exception 'PUBLIC can create resolver-shadowing public objects';
  end if;

  foreach v_private in array array[
    'id',
    'organization_id',
    'title',
    'description',
    'start_ts',
    'end_ts',
    'place_id',
    'location_raw',
    'category',
    'url',
    'status',
    'moderation_state',
    'revision',
    'deleted_at',
    'created_at',
    'updated_at'
  ] loop
    if not pg_catalog.has_column_privilege(
      'anon',
      'public.user_events',
      v_private,
      'select'
    ) or not pg_catalog.has_column_privilege(
      'authenticated',
      'public.user_events',
      v_private,
      'select'
    ) then
      raise exception 'safe read column is not granted: %', v_private;
    end if;
  end loop;
end
$$;

do $$
declare
  v_proc pg_catalog.regprocedure;
  v_role text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc as p
    cross join lateral pg_catalog.unnest(
      coalesce(p.proconfig, '{}'::text[])
    ) as setting(value)
    where p.oid =
      'public.resolve_place(text)'::pg_catalog.regprocedure
      and setting.value = 'search_path=pg_catalog, public'
  ) then
    raise exception 'legacy resolver lacks its trusted pinned search path';
  end if;

  foreach v_proc in array array[
    'public.brownsync_require_user_event_actor(uuid)'::pg_catalog.regprocedure,
    'public.brownsync_lock_user_event_control()'::pg_catalog.regprocedure,
    'public.brownsync_user_event_fingerprint(uuid,text,text,text,timestamptz,timestamptz,text,text,text,text)'::pg_catalog.regprocedure,
    'public.brownsync_consume_user_event_create_limit(uuid,timestamptz)'::pg_catalog.regprocedure,
    'public.brownsync_user_event_after_insert()'::pg_catalog.regprocedure,
    'public.brownsync_user_events_before_profile_delete()'::pg_catalog.regprocedure,
    'public.brownsync_create_user_event(uuid,uuid,text,text,text,timestamptz,timestamptz,text,text,text,text)'::pg_catalog.regprocedure,
    'public.brownsync_edit_user_event(uuid,uuid,bigint,jsonb)'::pg_catalog.regprocedure,
    'public.brownsync_delete_user_event(uuid,uuid)'::pg_catalog.regprocedure,
    'public.brownsync_list_user_events(uuid,timestamptz,uuid,integer)'::pg_catalog.regprocedure,
    'public.brownsync_get_user_event(uuid,uuid)'::pg_catalog.regprocedure,
    'public.brownsync_moderate_user_event(uuid,uuid,boolean)'::pg_catalog.regprocedure
  ] loop
    if not (
      select p.prosecdef
        and exists (
          select 1
          from pg_catalog.unnest(
            coalesce(p.proconfig, '{}'::text[])
          ) as setting(value)
          where setting.value ~ '^search_path=(""|)$'
        )
      from pg_catalog.pg_proc as p
      where p.oid = v_proc
    ) then
      raise exception 'function hardening drifted for %', v_proc;
    end if;

    foreach v_role in array array['public', 'anon', 'authenticated'] loop
      if pg_catalog.has_function_privilege(v_role, v_proc, 'execute') then
        raise exception '% can execute owner-only routine %', v_role, v_proc;
      end if;
    end loop;
  end loop;

  if not (
    select p.prosecdef
      and p.provolatile = 's'
      and p.prorettype = 'boolean'::pg_catalog.regtype
      and exists (
        select 1
        from pg_catalog.unnest(
          coalesce(p.proconfig, '{}'::text[])
        ) as setting(value)
        where setting.value ~ '^search_path=(""|)$'
      )
    from pg_catalog.pg_proc as p
    where p.oid =
      'public.brownsync_user_event_posting_enabled()'
        ::pg_catalog.regprocedure
  ) then
    raise exception 'RLS posting-state helper is not hardened stable boolean';
  end if;

  if pg_catalog.has_function_privilege(
    'public',
    'public.brownsync_user_event_posting_enabled()',
    'execute'
  ) or not pg_catalog.has_function_privilege(
    'anon',
    'public.brownsync_user_event_posting_enabled()',
    'execute'
  ) or not pg_catalog.has_function_privilege(
    'authenticated',
    'public.brownsync_user_event_posting_enabled()',
    'execute'
  ) then
    raise exception 'RLS posting-state helper lacks read execution grant';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as t
    where t.tgrelid = 'public.user_events'::pg_catalog.regclass
      and t.tgname = 'brownsync_user_event_consume_create_limit'
      and not t.tgisinternal
  ) then
    raise exception 'user-event creation quota trigger is missing';
  end if;
end
$$;

do $$
declare
  v_index text;
begin
  foreach v_index in array array[
    'user_events_creator_request_uidx',
    'user_events_management_idx',
    'user_events_public_idx',
    'user_events_organization_idx',
    'user_events_updated_by_idx',
    'user_events_deleted_by_idx',
    'user_events_moderated_by_idx'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_index as i
      where i.indexrelid = (
        'public.' || v_index
      )::pg_catalog.regclass
        and i.indisvalid
        and i.indisready
    ) then
      raise exception 'user-event access/FK index missing or invalid: %', v_index;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_index as i
    where i.indexrelid =
      'public.user_events_creator_request_uidx'::pg_catalog.regclass
      and i.indisunique
      and pg_catalog.pg_get_expr(
        i.indpred,
        i.indrelid
      ) = '(created_by IS NOT NULL)'
  ) then
    raise exception 'creator/request idempotency index is not the required partial unique index';
  end if;
end
$$;

do $$
declare
  expected record;
begin
  for expected in
    select *
    from (values
      ('user_events', 'organization_id', 'organizations', 'id', 'c'),
      ('user_events', 'created_by', 'profiles', 'id', 'n'),
      ('user_events', 'place_id', 'places', 'id', 'a'),
      ('user_events', 'updated_by', 'profiles', 'id', 'n'),
      ('user_events', 'deleted_by', 'profiles', 'id', 'n'),
      ('user_events', 'moderated_by', 'profiles', 'id', 'n'),
      ('user_event_controls', 'updated_by', 'profiles', 'id', 'n'),
      ('user_event_create_limits', 'user_id', 'profiles', 'id', 'c')
    ) as x(
      table_name,
      column_name,
      foreign_table,
      foreign_column,
      delete_action
    )
  loop
    if not exists (
      select 1
      from pg_catalog.pg_constraint as con
      join pg_catalog.pg_attribute as local_col
        on local_col.attrelid = con.conrelid
       and local_col.attnum = con.conkey[1]
      join pg_catalog.pg_attribute as foreign_col
        on foreign_col.attrelid = con.confrelid
       and foreign_col.attnum = con.confkey[1]
      where con.contype = 'f'
        and con.conrelid = (
          'public.' || expected.table_name
        )::pg_catalog.regclass
        and local_col.attname = expected.column_name
        and con.confrelid = (
          'public.' || expected.foreign_table
        )::pg_catalog.regclass
        and foreign_col.attname = expected.foreign_column
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

do $$
begin
  if (
    select pg_catalog.count(*)
    from public.user_event_controls
  ) <> 1 then
    raise exception 'user_event_controls must contain exactly one row';
  end if;
end
$$;

-- Personal age gate, organization authority, create idempotency, and current
-- auth metadata are all enforced by the real owner routine.
do $$
declare
  v_blocked boolean;
  v_first record;
  v_retry record;
  v_start timestamptz := pg_catalog.clock_timestamp() + interval '1 day';
begin
  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000002',
      '82100000-0000-4000-8000-000000000001',
      null,
      'Too-new personal event',
      null,
      v_start,
      v_start + interval '1 hour',
      'social',
      null,
      'chk-user-event-place-a',
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_ACCOUNT_TOO_NEW';
  end;
  if not v_blocked then
    raise exception 'personal event bypassed the 24-hour account-age gate';
  end if;

  select *
  into v_first
  from public.brownsync_create_user_event(
    '82000000-0000-4000-8000-000000000001',
    '82100000-0000-4000-8000-000000000002',
    null,
    '  Canonical personal event  ',
    '  Personal event description  ',
    v_start,
    v_start + interval '2 hours',
    'social',
    '  https://example.com/personal  ',
    'chk-user-event-place-a',
    null
  );
  if v_first.event_id is null
     or v_first.revision is distinct from 0
     or v_first.replayed is distinct from false
     or not exists (
       select 1
       from public.user_events as e
       where e.id = v_first.event_id
         and e.description = '  Personal event description  '
     ) then
    raise exception 'initial personal create returned wrong result: %', v_first;
  end if;

  perform pg_catalog.set_config(
    'TimeZone',
    'America/Los_Angeles',
    true
  );

  select *
  into v_retry
  from public.brownsync_create_user_event(
    '82000000-0000-4000-8000-000000000001',
    '82100000-0000-4000-8000-000000000002',
    null,
    'Canonical personal event',
    '  Personal event description  ',
    v_start,
    v_start + interval '2 hours',
    'social',
    'https://example.com/personal',
    'chk-user-event-place-a',
    null
  );
  if v_retry.event_id is distinct from v_first.event_id
     or v_retry.revision is distinct from 0
     or v_retry.replayed is distinct from true then
    raise exception 'same-key replay was not durable/idempotent: %', v_retry;
  end if;

  perform pg_catalog.set_config('TimeZone', 'UTC', true);

  if (
    select pg_catalog.count(*)
    from public.user_events
    where created_by = '82000000-0000-4000-8000-000000000001'
      and client_request_id = '82100000-0000-4000-8000-000000000002'
  ) <> 1 or (
    select l.count
    from public.user_event_create_limits as l
    where l.user_id = '82000000-0000-4000-8000-000000000001'
  ) is distinct from 1 then
    raise exception 'same-key replay created a second row or quota unit';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000001',
      '82100000-0000-4000-8000-000000000002',
      null,
      'Canonical personal event',
      'Personal event description',
      v_start,
      v_start + interval '2 hours',
      'social',
      'https://example.com/personal',
      'chk-user-event-place-a',
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_REQUEST_CONFLICT';
  end;
  if not v_blocked then
    raise exception 'changed payload reused a client request id';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000005',
      '82100000-0000-4000-8000-000000000003',
      'chk-user-event-org',
      'Unauthorized organization event',
      null,
      v_start,
      null,
      'club',
      null,
      'chk-user-event-place-a',
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_FORBIDDEN';
  end;
  if not v_blocked then
    raise exception 'cross-organization actor created an organization event';
  end if;

  select *
  into v_retry
  from public.brownsync_create_user_event(
    '82000000-0000-4000-8000-000000000012',
    '82100000-0000-4000-8000-000000000004',
    'chk-user-event-org',
    'New admin organization event',
    null,
    v_start,
    null,
    'club',
    null,
    'chk-user-event-place-a',
    null
  );
  if v_retry.replayed is distinct from false then
    raise exception 'new organization admin create did not succeed immediately';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000003',
      '82100000-0000-4000-8000-000000000005',
      'chk-user-event-missing-org',
      'Missing organization event',
      null,
      v_start,
      null,
      'club',
      null,
      'chk-user-event-place-a',
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm =
      'BROWNSYNC_USER_EVENT_ORGANIZATION_NOT_FOUND';
  end;
  if not v_blocked then
    raise exception 'create accepted a missing organization';
  end if;

  update auth.users
  set raw_app_meta_data = '{"provider":"github"}'::jsonb
  where id = '82000000-0000-4000-8000-000000000005';

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000005',
      '82100000-0000-4000-8000-000000000006',
      'chk-user-event-other-org',
      'Stale identity event',
      null,
      v_start,
      null,
      'club',
      null,
      'chk-user-event-place-a',
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_UNAUTHORIZED';
  end;
  if not v_blocked then
    raise exception 'owner routine trusted a stale admitted profile';
  end if;

  update auth.users
  set raw_app_meta_data = '{"provider":"google"}'::jsonb
  where id = '82000000-0000-4000-8000-000000000005';

  update public.profiles
  set created_at = pg_catalog.clock_timestamp() - interval '24 hours'
  where id = '82000000-0000-4000-8000-000000000002';

  select *
  into v_retry
  from public.brownsync_create_user_event(
    '82000000-0000-4000-8000-000000000002',
    '82100000-0000-4000-8000-000000000007',
    null,
    'Boundary personal event',
    null,
    v_start,
    null,
    'academic',
    null,
    'chk-user-event-place-a',
    null
  );
  if v_retry.event_id is null then
    raise exception 'exact 24-hour account boundary was rejected';
  end if;

  select *
  into v_retry
  from public.brownsync_edit_user_event(
    '82000000-0000-4000-8000-000000000001',
    v_first.event_id,
    0,
    '{"description":""}'::jsonb
  );
  if v_retry.revision is distinct from 1
     or v_retry.changed is distinct from true
     or not exists (
       select 1
       from public.user_events as e
       where e.id = v_first.event_id
         and e.description = ''
         and e.description is not null
     ) then
    raise exception 'empty description was not preserved exactly';
  end if;
end
$$;

-- Location resolution, structural input validation, and fail-closed behavior
-- happen before either an event or quota side effect survives.
do $$
declare
  v_before_count integer;
  v_blocked boolean;
  v_result record;
  v_start timestamptz := pg_catalog.clock_timestamp() + interval '2 days';
begin
  select coalesce(l.count, 0)
  into v_before_count
  from (select 1) as one
  left join public.user_event_create_limits as l
    on l.user_id = '82000000-0000-4000-8000-000000000003';

  select *
  into v_result
  from public.brownsync_create_user_event(
    '82000000-0000-4000-8000-000000000003',
    '82100000-0000-4000-8000-000000000010',
    'chk-user-event-org',
    'Resolved room event',
    'Uses exact-room resolution',
    v_start,
    v_start + interval '1 hour',
    'academic',
    'https://example.com/resolved',
    null,
    '  UE Hall 101  '
  );
  if not exists (
    select 1
    from public.user_events as e
    where e.id = v_result.event_id
      and e.place_id = 'chk-user-event-place-a'
      and e.location_raw = 'UE Hall 101'
  ) then
    raise exception 'locationRaw did not resolve to the canonical place';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000003',
      '82100000-0000-4000-8000-000000000011',
      'chk-user-event-org',
      'Ambiguous location event',
      null,
      v_start,
      null,
      'academic',
      null,
      null,
      'Ambiguous User Event Hall'
    );
  exception when raise_exception then
    v_blocked := sqlerrm =
      'BROWNSYNC_USER_EVENT_LOCATION_UNRESOLVED';
  end;
  if not v_blocked then
    raise exception 'ambiguous location did not fail closed';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000003',
      '82100000-0000-4000-8000-000000000012',
      'chk-user-event-org',
      'Unresolved location event',
      null,
      v_start,
      null,
      'academic',
      null,
      null,
      'Definitely Not A Brown Place 999'
    );
  exception when raise_exception then
    v_blocked := sqlerrm =
      'BROWNSYNC_USER_EVENT_LOCATION_UNRESOLVED';
  end;
  if not v_blocked then
    raise exception 'unresolved location did not fail closed';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000003',
      '82100000-0000-4000-8000-000000000013',
      'chk-user-event-org',
      'Missing place event',
      null,
      v_start,
      null,
      'academic',
      null,
      'chk-user-event-place-missing',
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_PLACE_NOT_FOUND';
  end;
  if not v_blocked then
    raise exception 'missing canonical place id was accepted';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000003',
      '82100000-0000-4000-8000-000000000014',
      'chk-user-event-org',
      'Two-location event',
      null,
      v_start,
      null,
      'academic',
      null,
      'chk-user-event-place-a',
      'UE Hall'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_INPUT_INVALID';
  end;
  if not v_blocked then
    raise exception 'create accepted both placeId and locationRaw';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000003',
      '82100000-0000-4000-8000-000000000015',
      'chk-user-event-org',
      '  ',
      null,
      v_start,
      null,
      'academic',
      null,
      'chk-user-event-place-a',
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_INPUT_INVALID';
  end;
  if not v_blocked then
    raise exception 'blank title was accepted';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000003',
      '82100000-0000-4000-8000-000000000016',
      'chk-user-event-org',
      'Bad time event',
      null,
      v_start,
      v_start,
      'academic',
      null,
      'chk-user-event-place-a',
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_INPUT_INVALID';
  end;
  if not v_blocked then
    raise exception 'non-increasing event time range was accepted';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000003',
      '82100000-0000-4000-8000-000000000017',
      'chk-user-event-org',
      'Bad category event',
      null,
      v_start,
      null,
      'not-a-category',
      null,
      'chk-user-event-place-a',
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_INPUT_INVALID';
  end;
  if not v_blocked then
    raise exception 'unknown category was accepted';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000003',
      '82100000-0000-4000-8000-000000000018',
      'chk-user-event-org',
      'Bad URL event',
      null,
      v_start,
      null,
      'academic',
      'http://example.com/not-safe',
      'chk-user-event-place-a',
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_INPUT_INVALID';
  end;
  if not v_blocked then
    raise exception 'non-HTTPS URL was accepted';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000003',
      '82100000-0000-4000-8000-000000000019',
      'chk-user-event-org',
      'Oversized raw location',
      null,
      v_start,
      null,
      'academic',
      null,
      null,
      pg_catalog.repeat('x', 501)
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_INPUT_INVALID';
  end;
  if not v_blocked then
    raise exception 'create accepted a 501-character raw location';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_user_event(
      '82000000-0000-4000-8000-000000000003',
      '82100000-0000-4000-8000-000000000020',
      'chk-user-event-org',
      'Oversized whitespace description',
      pg_catalog.repeat(' ', 10001),
      v_start,
      null,
      'academic',
      null,
      'chk-user-event-place-a',
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_INPUT_INVALID';
  end;
  if not v_blocked then
    raise exception 'create trimmed an oversized whitespace description';
  end if;

  if (
    select l.count
    from public.user_event_create_limits as l
    where l.user_id = '82000000-0000-4000-8000-000000000003'
  ) is distinct from v_before_count + 1 then
    raise exception 'failed create attempts consumed quota';
  end if;
end
$$;

select pg_temp.run_user_event_switch_checks();

-- A fixed window rolls over only after 24 hours; canceling earlier events did
-- not refund quota, while the first post-window create starts a fresh count.
do $$
declare
  v_result record;
begin
  if (
    select l.count
    from public.user_event_create_limits as l
    where l.user_id = '82000000-0000-4000-8000-000000000009'
  ) is distinct from 10 then
    raise exception 'delete or moderation refunded creation quota';
  end if;

  update public.user_event_create_limits
  set window_started_at =
        pg_catalog.clock_timestamp() - interval '24 hours 1 second'
  where user_id = '82000000-0000-4000-8000-000000000009';

  select *
  into v_result
  from public.brownsync_create_user_event(
    '82000000-0000-4000-8000-000000000009',
    '82200000-0000-4000-8000-000000000012',
    null,
    'Post-window event',
    null,
    pg_catalog.clock_timestamp() + interval '6 days',
    null,
    'social',
    null,
    'chk-user-event-place-a',
    null
  );
  if v_result.replayed is distinct from false
     or (
       select l.count
       from public.user_event_create_limits as l
       where l.user_id = '82000000-0000-4000-8000-000000000009'
     ) is distinct from 1 then
    raise exception '24-hour rollover did not reset the create counter';
  end if;
end
$$;

-- The shared 21-column read surface preserves seeded rows and admits only
-- explicitly visible student rows, with canonical place/org projection and
-- no creator field. The explicit view predicate must hold even for its owner.
insert into public.events (
  id,
  source,
  source_id,
  title,
  description,
  start_ts,
  end_ts,
  place_id,
  org_id,
  category
) values (
  '82600000-0000-4000-8000-000000000001',
  'check-seed',
  'user-event-union-seed',
  'Seeded union event',
  'Seeded row remains unchanged',
  pg_catalog.clock_timestamp() + interval '7 days',
  pg_catalog.clock_timestamp() + interval '7 days 1 hour',
  'chk-user-event-place-a',
  'chk-user-event-org',
  'academic'
);

do $$
declare
  v_user_id uuid;
begin
  select e.id
  into v_user_id
  from public.user_events as e
  where e.client_request_id =
    '82100000-0000-4000-8000-000000000010';

  if not exists (
    select 1
    from public.v_events_api as v
    where v.id = '82600000-0000-4000-8000-000000000001'
      and v.source = 'check-seed'
  ) then
    raise exception 'seeded event disappeared from v_events_api';
  end if;

  if not exists (
    select 1
    from public.v_events_api as v
    where v.id = v_user_id
      and v.source = 'brownsync'
      and v.place_id = 'chk-user-event-place-a'
      and v.place_name = 'User Event Hall'
      and v.lat = 41.826
      and v.lng = -71.403
      and v.org_id = 'chk-user-event-org'
      and v.org_name = 'Check User Event Org'
      and v.tags = '{}'::text[]
      and v.cost is null
      and v.confidence = 1::real
      and v.is_canceled = false
      and v.merged_sources = '{}'::text[]
  ) then
    raise exception 'student event projection did not match the 21-column contract';
  end if;

  if not exists (
    select 1
    from public.api_events(
      p_from => pg_catalog.clock_timestamp(),
      p_to => pg_catalog.clock_timestamp() + interval '10 days',
      p_category => 'academic',
      p_q => 'Resolved room'
    ) as a
    where a.id = v_user_id
      and a.source = 'brownsync'
  ) or not exists (
    select 1
    from public.v_events_api as v
    where v.id = v_user_id
      and v.place_id = 'chk-user-event-place-a'
      and v.org_id = 'chk-user-event-org'
  ) then
    raise exception 'student event missed api_events/detail/place/org paths';
  end if;

  if exists (
    select 1
    from public.v_events_api as v
    join public.user_events as e on e.id = v.id
    where e.status <> 'published'
       or e.moderation_state <> 'active'
       or e.deleted_at is not null
  ) then
    raise exception 'non-public student event leaked through v_events_api';
  end if;

  update public.user_event_controls
  set posting_enabled = false,
      updated_at = pg_catalog.clock_timestamp()
  where id = true;

  if exists (
    select 1
    from public.v_events_api as v
    where v.source = 'brownsync'
  ) or not exists (
    select 1
    from public.v_events_api as v
    where v.id = '82600000-0000-4000-8000-000000000001'
  ) then
    raise exception 'owner-executed view bypassed switch predicate or hid seed data';
  end if;

  update public.user_event_controls
  set posting_enabled = true,
      updated_at = pg_catalog.clock_timestamp()
  where id = true;
end
$$;

-- Direct client reads use RLS plus safe column grants. Anonymous readers see
-- only active publication; an admitted creator can additionally see their own
-- draft, without receiving any attribution column grant.
insert into public.user_events (
  id,
  organization_id,
  created_by,
  client_request_id,
  payload_fingerprint,
  title,
  start_ts,
  place_id,
  category,
  status,
  moderation_state,
  deleted_at
)
values
  (
    '82600000-0000-4000-8000-000000000010',
    'chk-user-event-org',
    null,
    '82610000-0000-4000-8000-000000000010',
    pg_catalog.md5('rls public'),
    'RLS public event',
    pg_catalog.clock_timestamp() + interval '8 days',
    'chk-user-event-place-a',
    'club',
    'published',
    'active',
    null
  ),
  (
    '82600000-0000-4000-8000-000000000011',
    null,
    '82000000-0000-4000-8000-000000000001',
    '82610000-0000-4000-8000-000000000011',
    pg_catalog.md5('rls own draft'),
    'RLS own draft',
    pg_catalog.clock_timestamp() + interval '8 days',
    'chk-user-event-place-a',
    'social',
    'draft',
    'active',
    null
  ),
  (
    '82600000-0000-4000-8000-000000000012',
    'chk-user-event-org',
    null,
    '82610000-0000-4000-8000-000000000012',
    pg_catalog.md5('rls hidden'),
    'RLS hidden event',
    pg_catalog.clock_timestamp() + interval '8 days',
    'chk-user-event-place-a',
    'club',
    'published',
    'hidden',
    null
  ),
  (
    '82600000-0000-4000-8000-000000000013',
    'chk-user-event-org',
    null,
    '82610000-0000-4000-8000-000000000013',
    pg_catalog.md5('rls deleted'),
    'RLS deleted event',
    pg_catalog.clock_timestamp() + interval '8 days',
    'chk-user-event-place-a',
    'club',
    'canceled',
    'active',
    pg_catalog.clock_timestamp()
  ),
  (
    '82600000-0000-4000-8000-000000000014',
    null,
    '82000000-0000-4000-8000-000000000006',
    '82610000-0000-4000-8000-000000000014',
    pg_catalog.md5('rls foreign draft'),
    'RLS foreign draft',
    pg_catalog.clock_timestamp() + interval '8 days',
    'chk-user-event-place-a',
    'social',
    'draft',
    'active',
    null
  ),
  (
    '82600000-0000-4000-8000-000000000015',
    null,
    '82000000-0000-4000-8000-000000000001',
    '82610000-0000-4000-8000-000000000015',
    pg_catalog.md5('rls own published'),
    'RLS own published',
    pg_catalog.clock_timestamp() + interval '8 days',
    'chk-user-event-place-a',
    'social',
    'published',
    'active',
    null
  ),
  (
    '82600000-0000-4000-8000-000000000016',
    null,
    '82000000-0000-4000-8000-000000000001',
    '82610000-0000-4000-8000-000000000016',
    pg_catalog.md5('rls own hidden'),
    'RLS own hidden',
    pg_catalog.clock_timestamp() + interval '8 days',
    'chk-user-event-place-a',
    'social',
    'published',
    'hidden',
    null
  ),
  (
    '82600000-0000-4000-8000-000000000017',
    null,
    '82000000-0000-4000-8000-000000000001',
    '82610000-0000-4000-8000-000000000017',
    pg_catalog.md5('rls own canceled'),
    'RLS own canceled',
    pg_catalog.clock_timestamp() + interval '8 days',
    'chk-user-event-place-a',
    'social',
    'canceled',
    'active',
    pg_catalog.clock_timestamp()
  );

-- These checks execute as the table/view owner so RLS cannot conceal a
-- missing explicit predicate in the shared 21-column view.
do $$
begin
  if (
    select pg_catalog.count(*)
    from public.v_events_api
    where id in (
      '82600000-0000-4000-8000-000000000010',
      '82600000-0000-4000-8000-000000000015'
    )
  ) <> 2 or exists (
    select 1
    from public.v_events_api
    where id in (
      '82600000-0000-4000-8000-000000000011',
      '82600000-0000-4000-8000-000000000012',
      '82600000-0000-4000-8000-000000000013',
      '82600000-0000-4000-8000-000000000014',
      '82600000-0000-4000-8000-000000000016',
      '82600000-0000-4000-8000-000000000017'
    )
  ) then
    raise exception 'owner-view status/moderation/delete predicates drifted';
  end if;

  update public.user_event_controls
  set posting_enabled = false,
      updated_at = pg_catalog.clock_timestamp()
  where id = true;

  if exists (
    select 1
    from public.v_events_api
    where id in (
      '82600000-0000-4000-8000-000000000010',
      '82600000-0000-4000-8000-000000000015'
    )
  ) then
    raise exception 'owner-view posting switch predicate drifted';
  end if;

  update public.user_event_controls
  set posting_enabled = true,
      updated_at = pg_catalog.clock_timestamp()
  where id = true;
end
$$;

set local role anon;

do $$
begin
  if (
    select pg_catalog.count(*)
    from public.user_events
    where id in (
      '82600000-0000-4000-8000-000000000010',
      '82600000-0000-4000-8000-000000000011',
      '82600000-0000-4000-8000-000000000012',
      '82600000-0000-4000-8000-000000000013',
      '82600000-0000-4000-8000-000000000014',
      '82600000-0000-4000-8000-000000000015',
      '82600000-0000-4000-8000-000000000016',
      '82600000-0000-4000-8000-000000000017'
    )
  ) <> 2 or not exists (
    select 1
    from public.user_events
    where id = '82600000-0000-4000-8000-000000000010'
  ) or not exists (
    select 1
    from public.user_events
    where id = '82600000-0000-4000-8000-000000000015'
  ) then
    raise exception 'anonymous user-event RLS exposed a non-public row';
  end if;
end
$$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000001","email":"events.old@brown.edu","app_metadata":{"provider":"google"}}',
  true
);

do $$
declare
  v_blocked boolean := false;
begin
  if (
    select pg_catalog.count(*)
    from public.user_events
    where id in (
      '82600000-0000-4000-8000-000000000010',
      '82600000-0000-4000-8000-000000000011',
      '82600000-0000-4000-8000-000000000012',
      '82600000-0000-4000-8000-000000000013',
      '82600000-0000-4000-8000-000000000014',
      '82600000-0000-4000-8000-000000000015',
      '82600000-0000-4000-8000-000000000016',
      '82600000-0000-4000-8000-000000000017'
    )
  ) <> 3 or not exists (
    select 1
    from public.user_events
    where id = '82600000-0000-4000-8000-000000000011'
  ) or exists (
    select 1
    from public.user_events
    where id in (
      '82600000-0000-4000-8000-000000000014',
      '82600000-0000-4000-8000-000000000016',
      '82600000-0000-4000-8000-000000000017'
    )
  ) then
    raise exception 'authenticated creator could not read own draft safely';
  end if;

  begin
    insert into public.user_events (
      organization_id,
      created_by,
      client_request_id,
      payload_fingerprint,
      title,
      start_ts,
      place_id,
      category
    ) values (
      null,
      '82000000-0000-4000-8000-000000000001',
      '82610000-0000-4000-8000-000000000099',
      pg_catalog.md5('direct client write'),
      'Direct client write',
      pg_catalog.clock_timestamp() + interval '9 days',
      'chk-user-event-place-a',
      'social'
    );
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'authenticated client inserted user_events directly';
  end if;
end
$$;

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000001","email":"events.old@brown.edu","app_metadata":{"provider":"github"}}',
  true
);

do $$
begin
  if exists (
    select 1
    from public.user_events
    where id = '82600000-0000-4000-8000-000000000011'
  ) then
    raise exception 'stale non-Google JWT read the creator draft';
  end if;
end
$$;

reset role;
select pg_catalog.set_config('request.jwt.claims', '', true);

update public.user_event_controls
set posting_enabled = false,
    updated_at = pg_catalog.clock_timestamp()
where id = true;

set local role anon;

do $$
begin
  if exists (
    select 1
    from public.user_events
    where id = '82600000-0000-4000-8000-000000000010'
  ) then
    raise exception 'anon direct RLS leaked publication while posting disabled';
  end if;
end
$$;

reset role;
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000001","email":"events.old@brown.edu","app_metadata":{"provider":"google"}}',
  true
);

do $$
begin
  if exists (
    select 1
    from public.user_events
    where id = '82600000-0000-4000-8000-000000000010'
  ) or exists (
    select 1
    from public.user_events
    where id = '82600000-0000-4000-8000-000000000015'
  ) or not exists (
    select 1
    from public.user_events
    where id = '82600000-0000-4000-8000-000000000011'
  ) or exists (
    select 1
    from public.user_events
    where id in (
      '82600000-0000-4000-8000-000000000014',
      '82600000-0000-4000-8000-000000000016',
      '82600000-0000-4000-8000-000000000017'
    )
  ) then
    raise exception 'authenticated direct RLS ignored switch or hid own draft';
  end if;
end
$$;

reset role;
select pg_catalog.set_config('request.jwt.claims', '', true);

update public.user_event_controls
set posting_enabled = true,
    updated_at = pg_catalog.clock_timestamp()
where id = true;

-- Management reads are bounded and keyset-paginated. The cursor is positional
-- rather than referential, so deleting its boundary row does not invalidate
-- the next page.
do $$
declare
  i integer;
begin
  for i in 1..102 loop
    insert into public.user_events (
      id,
      organization_id,
      created_by,
      client_request_id,
      payload_fingerprint,
      title,
      start_ts,
      place_id,
      category,
      status,
      created_at,
      updated_at
    ) values (
      (
        '82700000-0000-4000-8000-' ||
        pg_catalog.lpad(i::text, 12, '0')
      )::uuid,
      'chk-user-event-page-org',
      null,
      (
        '82710000-0000-4000-8000-' ||
        pg_catalog.lpad(i::text, 12, '0')
      )::uuid,
      pg_catalog.md5('page ' || i::text),
      'Page event ' || i::text,
      '2030-01-01 12:00:00+00'::timestamptz,
      'chk-user-event-place-a',
      'academic',
      'draft',
      '2029-01-01 00:00:00+00'::timestamptz
        + i * interval '1 second',
      '2029-01-01 00:00:00+00'::timestamptz
        + i * interval '1 second'
    );
  end loop;
end
$$;

do $$
declare
  v_before_event_id uuid;
  v_before_updated_at timestamptz;
  v_blocked boolean;
  v_creator_event_id uuid;
  v_detail record;
begin
  select e.id
  into v_creator_event_id
  from public.user_events as e
  where e.created_by = '82000000-0000-4000-8000-000000000001'
    and e.client_request_id =
      '82100000-0000-4000-8000-000000000002';

  if not exists (
    select 1
    from public.brownsync_list_user_events(
      '82000000-0000-4000-8000-000000000001',
      null,
      null,
      100
    ) as own_event
    where own_event.event_id = v_creator_event_id
  ) then
    raise exception 'creator-only management list authority failed';
  end if;

  select *
  into v_detail
  from public.brownsync_get_user_event(
    '82000000-0000-4000-8000-000000000001',
    v_creator_event_id
  );
  if v_detail.event_id is distinct from v_creator_event_id
     or v_detail.organization_id is not null then
    raise exception 'creator-only management detail authority failed';
  end if;

  if (
    select pg_catalog.count(*)
    from public.brownsync_list_user_events(
      '82000000-0000-4000-8000-000000000011',
      null,
      null
    )
  ) <> 50 then
    raise exception 'management list default was not 50';
  end if;

  if exists (
    select 1
    from public.brownsync_list_user_events(
      '82000000-0000-4000-8000-000000000005',
      null,
      null,
      100
    ) as leaked
    where leaked.organization_id = 'chk-user-event-page-org'
  ) then
    raise exception 'management list exposed unrelated page-organization events';
  end if;

  if exists (
    select 1
    from public.brownsync_list_user_events(
      '82000000-0000-4000-8000-000000000011',
      null,
      null,
      100
    ) as page
    where page.organization_id is distinct from
      'chk-user-event-page-org'
  ) then
    raise exception 'management list mixed unauthorized rows into the page';
  end if;

  if (
    select pg_catalog.count(*)
    from public.brownsync_list_user_events(
      '82000000-0000-4000-8000-000000000011',
      null,
      null,
      100
    )
  ) <> 100 or not (
    select pg_catalog.bool_and(page.has_more)
    from public.brownsync_list_user_events(
      '82000000-0000-4000-8000-000000000011',
      null,
      null,
      100
    ) as page
  ) then
    raise exception 'management list cap/has_more was not 100/true';
  end if;

  select page.updated_at, page.event_id
  into v_before_updated_at, v_before_event_id
  from public.brownsync_list_user_events(
    '82000000-0000-4000-8000-000000000011',
    null,
    null,
    100
  ) as page
  offset 99
  limit 1;

  delete from public.user_events
  where id = v_before_event_id;

  if (
    select pg_catalog.count(*)
    from public.brownsync_list_user_events(
      '82000000-0000-4000-8000-000000000011',
      v_before_updated_at,
      v_before_event_id,
      100
    )
  ) <> 2 or coalesce((
    select pg_catalog.bool_or(page.has_more)
    from public.brownsync_list_user_events(
      '82000000-0000-4000-8000-000000000011',
      v_before_updated_at,
      v_before_event_id,
      100
    ) as page
  ), true) then
    raise exception 'positional next page did not survive boundary deletion';
  end if;

  select *
  into v_detail
  from public.brownsync_get_user_event(
    '82000000-0000-4000-8000-000000000011',
    '82700000-0000-4000-8000-000000000102'
  );
  if v_detail.event_id is distinct from
       '82700000-0000-4000-8000-000000000102'::uuid
     or v_detail.organization_id is distinct from
       'chk-user-event-page-org'
     or v_detail.organization_name is distinct from
       'Check User Event Page Org'
     or v_detail.status is distinct from 'draft'
     or v_detail.revision is distinct from 0 then
    raise exception 'management detail returned the wrong safe row: %', v_detail;
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_get_user_event(
      '82000000-0000-4000-8000-000000000005',
      '82700000-0000-4000-8000-000000000102'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_FORBIDDEN';
  end;
  if not v_blocked then
    raise exception 'unrelated actor read management detail';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_get_user_event(
      '82000000-0000-4000-8000-000000000011',
      '82700000-0000-4000-8000-999999999999'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_NOT_FOUND';
  end;
  if not v_blocked then
    raise exception 'missing management detail did not return NOT_FOUND';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_list_user_events(
      '82000000-0000-4000-8000-000000000011',
      pg_catalog.clock_timestamp(),
      null,
      50
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_QUEUE_INVALID';
  end;
  if not v_blocked then
    raise exception 'management list accepted a partial cursor';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_list_user_events(
      '82000000-0000-4000-8000-000000000011',
      null,
      null,
      101
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_QUEUE_INVALID';
  end;
  if not v_blocked then
    raise exception 'management list accepted limit > 100';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_list_user_events(
      '82000000-0000-4000-8000-000000000011',
      'infinity'::timestamptz,
      '82700000-0000-4000-8000-000000000102',
      50
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_QUEUE_INVALID';
  end;
  if not v_blocked then
    raise exception 'management list accepted a non-finite cursor';
  end if;
end
$$;

-- Profile deletion serializes with writes. Personal events are canceled and
-- soft-deleted before creator attribution is nulled; organization events keep
-- their publication and organization while all deleted-user attribution and
-- quota rows disappear.
do $$
declare
  v_blocked boolean;
  v_org_event record;
  v_personal_event record;
  v_start timestamptz := pg_catalog.clock_timestamp() + interval '9 days';
begin
  select *
  into v_personal_event
  from public.brownsync_create_user_event(
    '82000000-0000-4000-8000-000000000007',
    '82800000-0000-4000-8000-000000000001',
    null,
    'Delete-account personal event',
    null,
    v_start,
    null,
    'social',
    null,
    'chk-user-event-place-a',
    null
  );

  select *
  into v_org_event
  from public.brownsync_create_user_event(
    '82000000-0000-4000-8000-000000000008',
    '82800000-0000-4000-8000-000000000002',
    'chk-user-event-org',
    'Delete-account organization event',
    null,
    v_start,
    null,
    'club',
    null,
    'chk-user-event-place-a',
    null
  );

  insert into public.org_reviewers (user_id)
  values ('82000000-0000-4000-8000-000000000008');

  perform *
  from public.brownsync_moderate_user_event(
    '82000000-0000-4000-8000-000000000008',
    v_org_event.event_id,
    true
  );
  perform *
  from public.brownsync_moderate_user_event(
    '82000000-0000-4000-8000-000000000008',
    v_org_event.event_id,
    false
  );

  delete from auth.users
  where id in (
    '82000000-0000-4000-8000-000000000007',
    '82000000-0000-4000-8000-000000000008'
  );

  if not exists (
    select 1
    from public.user_events as e
    where e.id = v_personal_event.event_id
      and e.organization_id is null
      and e.created_by is null
      and e.status = 'canceled'
      and e.deleted_at is not null
      and e.updated_by is null
      and e.deleted_by is null
  ) or exists (
    select 1
    from public.v_events_api as v
    where v.id = v_personal_event.event_id
  ) then
    raise exception 'personal event survived account deletion visibly';
  end if;

  if not exists (
    select 1
    from public.user_events as e
    where e.id = v_org_event.event_id
      and e.organization_id = 'chk-user-event-org'
      and e.created_by is null
      and e.updated_by is null
      and e.moderated_by is null
      and e.status = 'published'
      and e.deleted_at is null
  ) or not exists (
    select 1
    from public.v_events_api as v
    where v.id = v_org_event.event_id
      and v.source = 'brownsync'
  ) then
    raise exception 'organization event did not survive creator deletion safely';
  end if;

  if exists (
    select 1
    from public.user_event_create_limits as l
    where l.user_id in (
      '82000000-0000-4000-8000-000000000007',
      '82000000-0000-4000-8000-000000000008'
    )
  ) then
    raise exception 'account deletion retained create-limit rows';
  end if;

  if exists (
    select 1
    from public.v_events_api as v
    join public.user_events as e on e.id = v.id
    where e.organization_id is null
      and e.created_by is null
  ) then
    raise exception 'visible personal event survived with no organization or creator';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_list_user_events(
      '82000000-0000-4000-8000-000000000007',
      null,
      null,
      50
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_USER_EVENT_UNAUTHORIZED';
  end;
  if not v_blocked then
    raise exception 'deleted actor did not receive user-event UNAUTHORIZED';
  end if;
end
$$;

rollback;
