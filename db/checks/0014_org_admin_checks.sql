-- 0014_org_admin_checks.sql — rollback-safe organization ownership checks.
begin;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'org_reviewers',
    'org_admins',
    'org_claims',
    'org_overrides',
    'org_edits',
    'org_write_limits'
  ] loop
    if pg_catalog.to_regclass('public.' || v_table) is null then
      raise exception 'BROWNSYNC_ORG_ADMIN_MIGRATION_MISSING: %', v_table;
    end if;
  end loop;

  if pg_catalog.to_regclass('public.v_organizations_api') is null then
    raise exception 'BROWNSYNC_ORG_ADMIN_MIGRATION_MISSING: v_organizations_api';
  end if;
end
$$;

-- Shared behavior fixtures are installed before transition checks. A second
-- fixture declaration below is deliberately ON CONFLICT-safe so the catalog
-- assertions remain readable beside their exact FK expectations.
insert into auth.users (
  id,
  email,
  raw_user_meta_data,
  raw_app_meta_data
) values
  ('61000000-0000-4000-8000-000000000001', 'owner.check@brown.edu', '{"full_name":"Owner Check"}', '{"provider":"google"}'),
  ('61000000-0000-4000-8000-000000000002', 'Contact.Check@brown.edu', '{"full_name":"Contact Check"}', '{"providers":["google"]}'),
  ('61000000-0000-4000-8000-000000000003', 'manual.check@brown.edu', '{"full_name":"Manual Check"}', '{"provider":"google"}'),
  ('61000000-0000-4000-8000-000000000004', 'editor.check@brown.edu', '{"full_name":"Editor Check"}', '{"provider":"google"}'),
  ('61000000-0000-4000-8000-000000000005', 'outsider.check@brown.edu', '{"full_name":"Outsider Check"}', '{"provider":"google"}'),
  ('61000000-0000-4000-8000-000000000006', 'reviewer.check@brown.edu', '{"full_name":"Reviewer Check"}', '{"providers":["google"]}'),
  ('61000000-0000-4000-8000-000000000007', 'delete.check@brown.edu', '{"full_name":"Delete Check"}', '{"provider":"google"}'),
  ('61000000-0000-4000-8000-000000000008', 'untrusted.check@brown.edu', '{"full_name":"Untrusted Check"}', '{"provider":"google"}');

update auth.users
set raw_app_meta_data = '{"provider":"email"}'
where id = '61000000-0000-4000-8000-000000000008';

insert into public.organizations (
  id, name, kind, description, url, instagram, source, contact_emails,
  website_url, logo_url
) values
  ('chk-org-contact', 'Check Contact Club', 'club', 'Seed contact description', 'https://brown.example/contact', 'https://instagram.com/checkcontact', 'studentactivities', array['CONTACT.CHECK@BROWN.EDU', 'checkcontact@gmail.com'], 'https://checkcontact.example', 'https://cdn.example/checkcontact.png'),
  ('chk-org-manual', 'Check Manual Club', 'club', 'Seed manual description', 'https://brown.example/manual', null, 'studentactivities', array['different@brown.edu'], null, null),
  ('chk-org-other', 'Check Other Club', 'club', 'Other seed', null, null, 'studentactivities', array['other@brown.edu'], null, null),
  ('chk-org-ownerless', 'Check Ownerless Club', 'club', 'Ownerless seed', null, null, 'studentactivities', '{}', null, null),
  ('chk-org-department', 'Check Department', 'department', null, null, null, 'brown', array['manual.check@brown.edu'], null, null);

insert into public.org_admins (
  organization_id, user_id, role, grant_source, granted_by
) values
  ('chk-org-manual', '61000000-0000-4000-8000-000000000001', 'owner', 'creator', null),
  ('chk-org-other', '61000000-0000-4000-8000-000000000004', 'owner', 'creator', null);

insert into public.org_reviewers (user_id)
values ('61000000-0000-4000-8000-000000000006');

do $$
declare
  v_first record;
  v_retry record;
begin
  select * into v_first
  from public.brownsync_claim_organization(
    '61000000-0000-4000-8000-000000000002',
    'chk-org-contact',
    null
  );
  select * into v_retry
  from public.brownsync_claim_organization(
    '61000000-0000-4000-8000-000000000002',
    'chk-org-contact',
    'ignored'
  );
  if v_first.disposition is distinct from 'auto_approved'
     or v_retry.disposition is distinct from 'already_admin'
     or v_first.claim_id is distinct from v_retry.claim_id then
    raise exception 'initial exact-contact idempotency failed';
  end if;

  select * into v_first
  from public.brownsync_claim_organization(
    '61000000-0000-4000-8000-000000000003',
    'chk-org-manual',
    '  Current student leader documentation.  '
  );
  select * into v_retry
  from public.brownsync_claim_organization(
    '61000000-0000-4000-8000-000000000003',
    'chk-org-manual',
    'different retry'
  );
  if v_first.disposition is distinct from 'pending'
     or v_retry.disposition is distinct from 'already_pending'
     or v_first.claim_id is distinct from v_retry.claim_id then
    raise exception 'initial pending-claim idempotency failed';
  end if;
end
$$;

-- Provider/email drift, missing actors, wrong organizations, and substring
-- contacts never auto-approve.
do $$
declare
  v_blocked boolean;
  v_result record;
begin
  v_blocked := false;
  begin
    perform *
    from public.brownsync_claim_organization(
      '61999999-0000-4000-8000-000000000099',
      'chk-org-contact',
      'missing'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_UNAUTHORIZED';
  end;
  if not v_blocked then
    raise exception 'missing actor was not rejected';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_claim_organization(
      '61000000-0000-4000-8000-000000000008',
      'chk-org-contact',
      'untrusted'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_UNAUTHORIZED';
  end;
  if not v_blocked then
    raise exception 'untrusted provider was not rejected';
  end if;

  update auth.users
  set email = 'outsider.check@gmail.com'
  where id = '61000000-0000-4000-8000-000000000005';
  v_blocked := false;
  begin
    perform *
    from public.brownsync_claim_organization(
      '61000000-0000-4000-8000-000000000005',
      'chk-org-contact',
      'gmail'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_UNAUTHORIZED';
  end;
  if not v_blocked then
    raise exception 'Gmail actor was not rejected';
  end if;

  update auth.users
  set email = 'outsider.check@brown.edu.evil'
  where id = '61000000-0000-4000-8000-000000000005';
  v_blocked := false;
  begin
    perform *
    from public.brownsync_claim_organization(
      '61000000-0000-4000-8000-000000000005',
      'chk-org-contact',
      'suffix'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_UNAUTHORIZED';
  end;
  if not v_blocked then
    raise exception 'Brown suffix actor was not rejected';
  end if;
  update auth.users
  set email = 'outsider.check@brown.edu'
  where id = '61000000-0000-4000-8000-000000000005';

  select *
  into v_result
  from public.brownsync_claim_organization(
    '61000000-0000-4000-8000-000000000005',
    'chk-org-other',
    'Correct identity, wrong organization contact.'
  );
  if v_result.disposition is distinct from 'pending'
     or v_result.admin_role is not null then
    raise exception 'wrong-organization contact auto-approved';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_claim_organization(
      '61000000-0000-4000-8000-000000000004',
      'chk-org-department',
      'department'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_NOT_CLAIMABLE';
  end;
  if not v_blocked then
    raise exception 'non-club organization was claimable';
  end if;
end
$$;

-- The pending review queue is scoped to org owners or platform reviewers and
-- exposes no claimant email/contact source.
do $$
declare
  v_blocked boolean;
  v_cursor_created_at timestamptz;
  v_cursor_id uuid;
  v_manual_claim uuid;
  v_second_count bigint;
begin
  select c.id
  into v_manual_claim
  from public.org_claims as c
  where c.organization_id = 'chk-org-manual'
    and c.user_id = '61000000-0000-4000-8000-000000000003';

  if not exists (
    select 1
    from public.brownsync_list_reviewable_org_claims(
      '61000000-0000-4000-8000-000000000001',
      null,
      null,
      100
    ) as q
    where q.claim_id = v_manual_claim
      and q.organization_id = 'chk-org-manual'
      and q.organization_name = 'Check Manual Club'
      and q.claimant_display_name = 'Manual Check'
      and q.claimant_handle is not null
      and q.evidence = 'Current student leader documentation.'
  ) then
    raise exception 'org owner cannot see reviewable pending claim';
  end if;

  if exists (
    select 1
    from public.brownsync_list_reviewable_org_claims(
      '61000000-0000-4000-8000-000000000004',
      null,
      null,
      100
    ) as q
    where q.organization_id = 'chk-org-manual'
  ) then
    raise exception 'cross-organization owner can see manual-org claim';
  end if;

  if not exists (
    select 1
    from public.brownsync_list_reviewable_org_claims(
      '61000000-0000-4000-8000-000000000006',
      null,
      null,
      100
    ) as q
    where q.claim_id = v_manual_claim
  ) then
    raise exception 'platform reviewer cannot see pending queue';
  end if;

  if pg_catalog.pg_get_function_result(
    'public.brownsync_list_reviewable_org_claims(uuid,timestamptz,uuid,integer)'::pg_catalog.regprocedure
  ) ~* 'email|contact' then
    raise exception 'review queue function exposes email/contact fields';
  end if;

  if pg_catalog.to_regprocedure(
    'public.brownsync_list_reviewable_org_claims(uuid)'
  ) is not null then
    raise exception 'unbounded one-argument review queue still exists';
  end if;

  insert into public.organizations (id, name, kind, source)
  select
    'chk-org-queue-' || pg_catalog.lpad(n::text, 3, '0'),
    'Check Queue ' || pg_catalog.lpad(n::text, 3, '0'),
    'club',
    'check'
  from pg_catalog.generate_series(1, 102) as n;

  insert into public.org_claims (
    organization_id,
    user_id,
    status,
    evidence,
    created_at
  )
  select
    'chk-org-queue-' || pg_catalog.lpad(n::text, 3, '0'),
    '61000000-0000-4000-8000-000000000005',
    'pending',
    'Queue cap fixture ' || n::text,
    '2026-01-01 00:00:00+00'::timestamptz
      + pg_catalog.make_interval(secs => n)
  from pg_catalog.generate_series(1, 102) as n;

  if (
    select pg_catalog.count(*) = 100
      and pg_catalog.bool_and(q.has_more)
    from public.brownsync_list_reviewable_org_claims(
      '61000000-0000-4000-8000-000000000006',
      null,
      null,
      100
    ) as q
  ) is distinct from true then
    raise exception 'review queue hard cap/lookahead failed';
  end if;

  if exists (
    with numbered as (
      select
        q.created_at,
        q.claim_id,
        pg_catalog.row_number() over () as row_number
      from public.brownsync_list_reviewable_org_claims(
        '61000000-0000-4000-8000-000000000006',
        null,
        null,
        100
      ) as q
    ),
    compared as (
      select
        created_at,
        claim_id,
        pg_catalog.lag(created_at) over (order by row_number) as prior_at,
        pg_catalog.lag(claim_id) over (order by row_number) as prior_id
      from numbered
    )
    select 1
    from compared
    where prior_at is not null
      and (created_at, claim_id) <= (prior_at, prior_id)
  ) then
    raise exception 'review queue is not ordered by created_at/id';
  end if;

  select q.created_at, q.claim_id
  into v_cursor_created_at, v_cursor_id
  from public.brownsync_list_reviewable_org_claims(
    '61000000-0000-4000-8000-000000000006',
    null,
    null,
    100
  ) as q
  order by q.created_at desc, q.claim_id desc
  limit 1;

  -- A keyset cursor is a position, not a foreign key. It must remain usable
  -- if the boundary claim is reviewed or deleted between page requests.
  delete from public.org_claims
  where id = v_cursor_id;

  select pg_catalog.count(*)
  into v_second_count
  from public.brownsync_list_reviewable_org_claims(
    '61000000-0000-4000-8000-000000000006',
    v_cursor_created_at,
    v_cursor_id,
    100
  ) as q
  where not q.has_more;
  if v_second_count <> 4 then
    raise exception 'review queue cursor page expected 4 rows, got %',
      v_second_count;
  end if;

  foreach v_second_count in array array[0::bigint, 101::bigint] loop
    v_blocked := false;
    begin
      perform *
      from public.brownsync_list_reviewable_org_claims(
        '61000000-0000-4000-8000-000000000006',
        null,
        null,
        v_second_count::integer
      );
    exception when raise_exception then
      v_blocked := sqlerrm = 'BROWNSYNC_ORG_QUEUE_INVALID';
    end;
    if not v_blocked then
      raise exception 'review queue accepted invalid limit %', v_second_count;
    end if;
  end loop;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_list_reviewable_org_claims(
      '61000000-0000-4000-8000-000000000006',
      v_cursor_created_at,
      null,
      10
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_QUEUE_INVALID';
  end;
  if not v_blocked then
    raise exception 'review queue accepted a partial cursor';
  end if;
end
$$;

-- Claim review authority, self/cross-org denial, ordinary editor grant, and
-- platform-reviewer ownerless bootstrap.
do $$
declare
  v_blocked boolean;
  v_claim_id uuid;
  v_result record;
begin
  select c.id
  into v_claim_id
  from public.org_claims as c
  where c.organization_id = 'chk-org-manual'
    and c.user_id = '61000000-0000-4000-8000-000000000003';

  v_blocked := false;
  begin
    perform *
    from public.brownsync_review_org_claim(
      '61000000-0000-4000-8000-000000000003',
      v_claim_id,
      true,
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_SELF_REVIEW';
  end;
  if not v_blocked then
    raise exception 'claimant reviewed their own claim';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_review_org_claim(
      '61000000-0000-4000-8000-000000000004',
      v_claim_id,
      true,
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_FORBIDDEN';
  end;
  if not v_blocked then
    raise exception 'cross-organization owner reviewed claim';
  end if;

  select *
  into v_result
  from public.brownsync_review_org_claim(
    '61000000-0000-4000-8000-000000000001',
    v_claim_id,
    true,
    '  Verified by current owner.  '
  );
  if v_result.claim_status is distinct from 'approved'
     or v_result.granted_role is distinct from 'editor'
     or v_result.changed is distinct from true then
    raise exception 'owner approval did not grant editor: %', v_result;
  end if;

  select *
  into v_result
  from public.brownsync_review_org_claim(
    '61000000-0000-4000-8000-000000000001',
    v_claim_id,
    true,
    'retry'
  );
  if v_result.changed is distinct from false then
    raise exception 'same review retry was not idempotent';
  end if;

  select c.claim_id
  into v_claim_id
  from public.brownsync_claim_organization(
    '61000000-0000-4000-8000-000000000005',
    'chk-org-ownerless',
    'Ownerless organization evidence.'
  ) as c;

  select *
  into v_result
  from public.brownsync_review_org_claim(
    '61000000-0000-4000-8000-000000000006',
    v_claim_id,
    true,
    'Platform bootstrap'
  );
  if v_result.granted_role is distinct from 'owner'
     or v_result.changed is distinct from true then
    raise exception 'reviewer did not bootstrap ownerless org';
  end if;
end
$$;

-- Owner-only administration, no self escalation, idempotency, and last-owner
-- protections.
do $$
declare
  v_blocked boolean;
  v_result record;
begin
  select *
  into v_result
  from public.brownsync_set_org_admin(
    '61000000-0000-4000-8000-000000000001',
    'chk-org-manual',
    '61000000-0000-4000-8000-000000000004',
    'editor'
  );
  if v_result.admin_role is distinct from 'editor'
     or v_result.changed is distinct from true then
    raise exception 'owner did not grant editor';
  end if;

  select *
  into v_result
  from public.brownsync_set_org_admin(
    '61000000-0000-4000-8000-000000000001',
    'chk-org-manual',
    '61000000-0000-4000-8000-000000000004',
    'editor'
  );
  if v_result.changed is distinct from false then
    raise exception 'same admin grant retry was not idempotent';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_set_org_admin(
      '61000000-0000-4000-8000-000000000003',
      'chk-org-manual',
      '61000000-0000-4000-8000-000000000005',
      'editor'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_FORBIDDEN';
  end;
  if not v_blocked then
    raise exception 'editor granted organization authority';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_set_org_admin(
      '61000000-0000-4000-8000-000000000001',
      'chk-org-manual',
      '61000000-0000-4000-8000-000000000001',
      'owner'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_SELF_ADMIN_CHANGE';
  end;
  if not v_blocked then
    raise exception 'owner changed their own role';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_leave_org_admin(
      '61000000-0000-4000-8000-000000000005',
      'chk-org-ownerless'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_LAST_OWNER';
  end;
  if not v_blocked then
    raise exception 'last owner left organization';
  end if;
end
$$;

-- Optimistic overlay writes, strict link structure, no-op stale retries, and
-- a safe merged public projection.
do $$
declare
  v_audit_count bigint;
  v_blocked boolean;
  v_result record;
  v_twenty_one jsonb;
begin
  select *
  into v_result
  from public.brownsync_edit_organization(
    '61000000-0000-4000-8000-000000000001',
    'chk-org-manual',
    0,
    '{
      "description":"Club-authored description",
      "about_md":"**About**",
      "meeting_info":"Fridays",
      "links":[
        {"platform":"discord","url":"https://discord.gg/check","label":"Chat"},
        {"platform":"website","url":"https://manual.example"}
      ],
      "avatar_url":"https://cdn.example/avatar.png"
    }'::jsonb
  );
  if v_result.revision is distinct from 1
     or v_result.changed is distinct from true then
    raise exception 'first overlay edit failed: %', v_result;
  end if;

  select pg_catalog.count(*)
  into v_audit_count
  from public.org_edits
  where organization_id = 'chk-org-manual'
    and revision is not null;

  select *
  into v_result
  from public.brownsync_edit_organization(
    '61000000-0000-4000-8000-000000000001',
    'chk-org-manual',
    0,
    '{
      "description":"Club-authored description",
      "about_md":"**About**",
      "meeting_info":"Fridays",
      "links":[
        {"platform":"discord","url":"https://discord.gg/check","label":"Chat"},
        {"platform":"website","url":"https://manual.example"}
      ],
      "avatar_url":"https://cdn.example/avatar.png"
    }'::jsonb
  );
  if v_result.revision is distinct from 1
     or v_result.changed is distinct from false then
    raise exception 'identical stale edit retry was not a no-op';
  end if;
  if (
    select pg_catalog.count(*)
    from public.org_edits
    where organization_id = 'chk-org-manual'
      and revision is not null
  ) <> v_audit_count then
    raise exception 'no-op edit added audit history';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_edit_organization(
      '61000000-0000-4000-8000-000000000001',
      'chk-org-manual',
      1,
      '{}'::jsonb
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_PATCH_INVALID';
  end;
  if not v_blocked then
    raise exception 'empty organization patch was accepted';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_edit_organization(
      '61000000-0000-4000-8000-000000000001',
      'chk-org-manual',
      0,
      '{"description":"Real stale change"}'::jsonb
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_REVISION_CONFLICT';
  end;
  if not v_blocked then
    raise exception 'real stale edit did not conflict';
  end if;

  foreach v_twenty_one in array array[
    '{"links":{}}'::jsonb,
    '{"links":[{"platform":"discord","url":"http://discord.gg/check"}]}'::jsonb,
    '{"links":[{"platform":"discord","url":"https://discord.gg/check","extra":1}]}'::jsonb,
    '{"links":[{"platform":"website","url":"https://same.example"},{"platform":"other","url":"https://SAME.example/"}]}'::jsonb
  ] loop
    v_blocked := false;
    begin
      perform *
      from public.brownsync_edit_organization(
        '61000000-0000-4000-8000-000000000001',
        'chk-org-manual',
        1,
        v_twenty_one
      );
    exception when raise_exception then
      v_blocked := sqlerrm = 'BROWNSYNC_ORG_LINKS_INVALID';
    end;
    if not v_blocked then
      raise exception 'malformed links accepted: %', v_twenty_one;
    end if;
  end loop;

  select pg_catalog.jsonb_build_object(
    'links',
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'platform', 'other',
        'url', 'https://example.org/' || n::text
      )
    )
  )
  into v_twenty_one
  from pg_catalog.generate_series(1, 21) as n;
  v_blocked := false;
  begin
    perform *
    from public.brownsync_edit_organization(
      '61000000-0000-4000-8000-000000000001',
      'chk-org-manual',
      1,
      v_twenty_one
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_LINKS_INVALID';
  end;
  if not v_blocked then
    raise exception 'more than 20 links accepted';
  end if;

  if (
    select description <> 'Club-authored description'
      or url <> 'https://brown.example/manual'
      or revision <> 1
      or not ('description' = any(overridden_fields))
      or links -> 0 ->> 'platform' <> 'discord'
    from public.v_organizations_api
    where id = 'chk-org-manual'
  ) is distinct from false then
    raise exception 'safe merged organization view is incorrect';
  end if;

  if (
    select description <> 'Seed contact description'
      or url <> 'https://brown.example/contact'
      or instagram <> 'https://instagram.com/checkcontact'
      or logo_url is not null
      or avatar_url is not null
      or revision <> 0
    from public.v_organizations_api
    where id = 'chk-org-contact'
  ) is distinct from false then
    raise exception 'safe seed fields or logo suppression drifted in public view';
  end if;

  insert into public.organizations (
    id,
    name,
    kind,
    source,
    website_url
  ) values (
    'chk-org-http-link',
    'Check HTTP Seed Link',
    'club',
    'studentactivities',
    'http://www.dam.brown.edu/siam/'
  );
  if (
    select website_url <> 'http://www.dam.brown.edu/siam/'
      or links <> '[]'::jsonb
    from public.v_organizations_api
    where id = 'chk-org-http-link'
  ) is distinct from false then
    raise exception 'HTTP source URL was not preserved raw and omitted from typed links';
  end if;

  if public.brownsync_seed_org_links(
    'http://website.example',
    'http://instagram.example',
    'http://facebook.example',
    'http://linkedin.example',
    'http://youtube.example',
    'http://twitter.example',
    'http://tiktok.example'
  ) <> '[]'::jsonb then
    raise exception 'one or more HTTP seed-link branches entered typed links';
  end if;

  if public.brownsync_seed_org_links(
    'https://example.org/' || pg_catalog.repeat('x', 2030),
    null,
    null,
    null,
    null,
    null,
    null
  ) <> '[]'::jsonb then
    raise exception 'oversized HTTPS seed URL entered typed links';
  end if;

  insert into public.organizations (
    id,
    name,
    kind,
    source,
    logo_url
  ) values
    (
      'chk-org-logo-http',
      'Check HTTP Logo',
      'club',
      'studentactivities',
      'http://cdn.example/logo.png'
    ),
    (
      'chk-org-logo-javascript',
      'Check JavaScript Logo',
      'club',
      'studentactivities',
      'javascript:alert(1)'
    ),
    (
      'chk-org-logo-data',
      'Check Data Logo',
      'club',
      'studentactivities',
      'data:image/png;base64,AAAA'
    ),
    (
      'chk-org-logo-space',
      'Check Spaced Logo',
      'club',
      'studentactivities',
      'https://cdn.example/not safe.png'
    ),
    (
      'chk-org-logo-wrong-source',
      'Check Wrong Source Logo',
      'club',
      'bulk-scrape',
      'https://cdn.example/untrusted.png'
    );

  if (
    select pg_catalog.count(*)
    from public.organizations
    where id like 'chk-org-logo-%'
      and logo_url is not null
  ) <> 5 then
    raise exception 'raw logo provenance was not preserved owner-side';
  end if;

  if exists (
    select 1
    from public.v_organizations_api
    where id like 'chk-org-logo-%'
      and (logo_url is not null or avatar_url is not null)
  ) then
    raise exception 'unsafe or unauthorized raw logo entered public media fields';
  end if;
end
$$;
do $$
declare
  v_name text;
  v_role text;
begin
  foreach v_name in array array[
    'org_reviewers',
    'org_admins',
    'org_claims',
    'org_overrides',
    'org_edits',
    'org_write_limits'
  ] loop
    if not (
      select c.relrowsecurity and not c.relforcerowsecurity
      from pg_catalog.pg_class as c
      where c.oid = ('public.' || v_name)::pg_catalog.regclass
    ) then
      raise exception 'RLS/not-FORCE drifted for %', v_name;
    end if;

    foreach v_role in array array['anon', 'authenticated'] loop
      if pg_catalog.has_table_privilege(
        v_role,
        pg_catalog.format('public.%I', v_name),
        'insert,update,delete'
      ) then
        raise exception '% has production DML on %', v_role, v_name;
      end if;
    end loop;
  end loop;
end
$$;

do $$
declare
  v_index text;
begin
  foreach v_index in array array[
    'org_claims_user_org_idx',
    'org_claims_pending_created_idx',
    'org_claims_reviewed_by_idx',
    'org_reviewers_granted_by_idx',
    'org_admins_granted_by_idx',
    'org_overrides_updated_by_idx',
    'org_edits_actor_user_idx',
    'org_edits_target_user_idx',
    'org_edits_claim_idx'
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
      raise exception 'organization access/FK index missing or invalid: %',
        v_index;
    end if;
  end loop;
end
$$;

do $$
declare
  v_proc pg_catalog.regprocedure;
  v_role text;
begin
  foreach v_proc in array array[
    'public.brownsync_require_org_actor(uuid)'::pg_catalog.regprocedure,
    'public.brownsync_lock_org_subject(uuid)'::pg_catalog.regprocedure,
    'public.brownsync_is_org_reviewer(uuid)'::pg_catalog.regprocedure,
    'public.brownsync_is_org_admin(uuid,text,text)'::pg_catalog.regprocedure,
    'public.brownsync_lock_organization(text)'::pg_catalog.regprocedure,
    'public.brownsync_validate_org_links(jsonb)'::pg_catalog.regprocedure,
    'public.brownsync_consume_org_write_limit(uuid,text)'::pg_catalog.regprocedure,
    'public.brownsync_claim_organization(uuid,text,text)'::pg_catalog.regprocedure,
    'public.brownsync_create_organization(uuid,text,text,text,text,jsonb)'::pg_catalog.regprocedure,
    'public.brownsync_list_org_access(uuid)'::pg_catalog.regprocedure,
    'public.brownsync_list_reviewable_org_claims(uuid,timestamptz,uuid,integer)'::pg_catalog.regprocedure,
    'public.brownsync_edit_organization(uuid,text,bigint,jsonb)'::pg_catalog.regprocedure,
    'public.brownsync_review_org_claim(uuid,uuid,boolean,text)'::pg_catalog.regprocedure,
    'public.brownsync_set_org_admin(uuid,text,uuid,text)'::pg_catalog.regprocedure,
    'public.brownsync_remove_org_admin(uuid,text,uuid)'::pg_catalog.regprocedure,
    'public.brownsync_leave_org_admin(uuid,text)'::pg_catalog.regprocedure
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
end
$$;

do $$
declare
  v_column text;
begin
  if exists (
    select 1
    from pg_catalog.pg_attribute as a
    where a.attrelid = 'public.v_organizations_api'::pg_catalog.regclass
      and a.attname = 'contact_emails'
      and a.attnum > 0
      and not a.attisdropped
  ) then
    raise exception 'safe organization view exposes contact_emails';
  end if;

  foreach v_column in array array[
    'id',
    'name',
    'description',
    'url',
    'instagram',
    'links',
    'avatar_url',
    'banner_url',
    'overridden_fields',
    'revision',
    'updated_at'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_attribute as a
      where a.attrelid = 'public.v_organizations_api'::pg_catalog.regclass
        and a.attname = v_column
        and a.attnum > 0
        and not a.attisdropped
    ) then
      raise exception 'safe organization view lacks %', v_column;
    end if;
  end loop;

  if not pg_catalog.has_table_privilege(
    'anon',
    'public.v_organizations_api',
    'select'
  ) or not pg_catalog.has_table_privilege(
    'authenticated',
    'public.v_organizations_api',
    'select'
  ) then
    raise exception 'safe organization view lacks public read grants';
  end if;
end
$$;

-- Exact FK deletion behavior: ownership/claims cascade; historical actor
-- attribution is anonymized so account deletion cannot be blocked.
do $$
declare
  v_actual "char";
begin
  select c.confdeltype
  into v_actual
  from pg_catalog.pg_constraint as c
  where c.conname = 'org_admins_user_id_fkey';
  if v_actual is distinct from 'c' then
    raise exception 'org_admins user FK is not ON DELETE CASCADE';
  end if;

  select c.confdeltype
  into v_actual
  from pg_catalog.pg_constraint as c
  where c.conname = 'org_claims_user_id_fkey';
  if v_actual is distinct from 'c' then
    raise exception 'org_claims user FK is not ON DELETE CASCADE';
  end if;

  select c.confdeltype
  into v_actual
  from pg_catalog.pg_constraint as c
  where c.conname = 'org_overrides_updated_by_fkey';
  if v_actual is distinct from 'n' then
    raise exception 'org_overrides attribution FK is not ON DELETE SET NULL';
  end if;

  select c.confdeltype
  into v_actual
  from pg_catalog.pg_constraint as c
  where c.conname = 'org_edits_actor_user_id_fkey';
  if v_actual is distinct from 'n' then
    raise exception 'org_edits actor FK is not ON DELETE SET NULL';
  end if;
end
$$;

insert into auth.users (
  id,
  email,
  raw_user_meta_data,
  raw_app_meta_data
) values
  (
    '61000000-0000-4000-8000-000000000001',
    'owner.check@brown.edu',
    '{"full_name":"Owner Check"}',
    '{"provider":"google"}'
  ),
  (
    '61000000-0000-4000-8000-000000000002',
    'Contact.Check@brown.edu',
    '{"full_name":"Contact Check"}',
    '{"providers":["google"]}'
  ),
  (
    '61000000-0000-4000-8000-000000000003',
    'manual.check@brown.edu',
    '{"full_name":"Manual Check"}',
    '{"provider":"google"}'
  ),
  (
    '61000000-0000-4000-8000-000000000004',
    'editor.check@brown.edu',
    '{"full_name":"Editor Check"}',
    '{"provider":"google"}'
  ),
  (
    '61000000-0000-4000-8000-000000000005',
    'outsider.check@brown.edu',
    '{"full_name":"Outsider Check"}',
    '{"provider":"google"}'
  ),
  (
    '61000000-0000-4000-8000-000000000006',
    'reviewer.check@brown.edu',
    '{"full_name":"Reviewer Check"}',
    '{"providers":["google"]}'
  ),
  (
    '61000000-0000-4000-8000-000000000007',
    'delete.check@brown.edu',
    '{"full_name":"Delete Check"}',
    '{"provider":"google"}'
  ),
  (
    '61000000-0000-4000-8000-000000000008',
    'untrusted.check@brown.edu',
    '{"full_name":"Untrusted Check"}',
    '{"provider":"google"}'
  )
on conflict (id) do nothing;

-- Simulates provider/email drift after admission. The owner-side routines must
-- re-check current auth.users state rather than trusting profile existence.
update auth.users
set raw_app_meta_data = '{"provider":"email"}'
where id = '61000000-0000-4000-8000-000000000008';

insert into public.organizations (
  id,
  name,
  kind,
  description,
  url,
  instagram,
  source,
  contact_emails,
  website_url,
  logo_url
) values
  (
    'chk-org-contact',
    'Check Contact Club',
    'club',
    'Seed contact description',
    'https://brown.example/contact',
    'https://instagram.com/checkcontact',
    'studentactivities',
    array['CONTACT.CHECK@BROWN.EDU', 'checkcontact@gmail.com'],
    'https://checkcontact.example',
    'https://cdn.example/checkcontact.png'
  ),
  (
    'chk-org-manual',
    'Check Manual Club',
    'club',
    'Seed manual description',
    'https://brown.example/manual',
    null,
    'studentactivities',
    array['different@brown.edu'],
    null,
    null
  ),
  (
    'chk-org-other',
    'Check Other Club',
    'club',
    'Other seed',
    null,
    null,
    'studentactivities',
    array['other@brown.edu'],
    null,
    null
  ),
  (
    'chk-org-ownerless',
    'Check Ownerless Club',
    'club',
    'Ownerless seed',
    null,
    null,
    'studentactivities',
    '{}',
    null,
    null
  ),
  (
    'chk-org-department',
    'Check Department',
    'department',
    null,
    null,
    null,
    'brown',
    array['manual.check@brown.edu'],
    null,
    null
  )
on conflict (id) do nothing;

insert into public.org_admins (
  organization_id,
  user_id,
  role,
  grant_source,
  granted_by
) values
  (
    'chk-org-manual',
    '61000000-0000-4000-8000-000000000001',
    'owner',
    'creator',
    null
  ),
  (
    'chk-org-other',
    '61000000-0000-4000-8000-000000000004',
    'owner',
    'creator',
    null
  )
on conflict (organization_id, user_id) do nothing;

insert into public.org_reviewers (user_id)
values ('61000000-0000-4000-8000-000000000006')
on conflict (user_id) do nothing;

-- Exact case-insensitive contact match auto-approves once.
do $$
declare
  v_first record;
  v_retry record;
begin
  select *
  into v_first
  from public.brownsync_claim_organization(
    '61000000-0000-4000-8000-000000000002',
    'chk-org-contact',
    null
  );
  if v_first.claim_status is distinct from 'approved'
     or v_first.admin_role is distinct from 'owner'
     or v_first.disposition is distinct from 'already_admin' then
    raise exception 'exact contact terminal retry drifted: %', v_first;
  end if;

  select *
  into v_retry
  from public.brownsync_claim_organization(
    '61000000-0000-4000-8000-000000000002',
    'chk-org-contact',
    'ignored retry'
  );
  if v_retry.disposition is distinct from 'already_admin'
     or v_retry.claim_id is distinct from v_first.claim_id then
    raise exception 'contact retry was not idempotent: %', v_retry;
  end if;

  if (
    select pg_catalog.count(*)
    from public.org_claims
    where organization_id = 'chk-org-contact'
      and user_id = '61000000-0000-4000-8000-000000000002'
  ) <> 1 or (
    select pg_catalog.count(*)
    from public.org_edits
    where organization_id = 'chk-org-contact'
      and action = 'claim_auto_approved'
  ) <> 1 then
    raise exception 'contact retry duplicated claim or audit';
  end if;
end
$$;

-- Non-match is pending and exact duplicate retry is a no-op.
do $$
declare
  v_first record;
  v_retry record;
begin
  select *
  into v_first
  from public.brownsync_claim_organization(
    '61000000-0000-4000-8000-000000000003',
    'chk-org-manual',
    '  Current student leader documentation.  '
  );
  select *
  into v_retry
  from public.brownsync_claim_organization(
    '61000000-0000-4000-8000-000000000003',
    'chk-org-manual',
    'different retry text'
  );

  if v_first.disposition is distinct from 'already_admin'
     or v_first.claim_status is distinct from 'approved'
     or v_first.admin_role is distinct from 'editor'
     or v_retry.disposition is distinct from 'already_admin'
     or v_first.claim_id is distinct from v_retry.claim_id then
    raise exception 'manual claim terminal retry failed';
  end if;

  if (
    select evidence
    from public.org_claims
    where id = v_first.claim_id
  ) is distinct from 'Current student leader documentation.' then
    raise exception 'manual evidence was not trimmed';
  end if;
end
$$;

-- The production grant is absent. A transaction-local grant proves the RLS
-- policy itself filters a non-admin UPDATE to zero and produces no audit.
grant select (organization_id) on public.org_overrides to authenticated;
grant update (description) on public.org_overrides to authenticated;
grant execute on function public.brownsync_is_org_admin(uuid, text, text)
  to authenticated;

create temporary table chk_org_rls_audit_before (
  audit_count bigint not null
) on commit drop;
insert into chk_org_rls_audit_before (audit_count)
select pg_catalog.count(*)
from public.org_edits
where organization_id = 'chk-org-manual';

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"61000000-0000-4000-8000-000000000005","email":"outsider.check@brown.edu","app_metadata":{"provider":"google"}}',
  true
);

do $$
declare
  v_rows integer;
begin
  update public.org_overrides
  set description = 'Unauthorized direct write'
  where organization_id = 'chk-org-manual';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'non-admin direct overlay update affected % rows', v_rows;
  end if;
end
$$;

reset role;
do $$
begin
  if (
    select pg_catalog.count(*)
    from public.org_edits
    where organization_id = 'chk-org-manual'
  ) <> (
    select audit_count
    from chk_org_rls_audit_before
  ) then
    raise exception 'filtered direct overlay update created audit';
  end if;
end
$$;

revoke execute on function public.brownsync_is_org_admin(uuid, text, text)
  from authenticated;
revoke update (description) on public.org_overrides from authenticated;
revoke select (organization_id) on public.org_overrides from authenticated;

-- User-created clubs are deterministic and idempotent, start with empty
-- source-owned contact/provenance fields, and cannot be overwritten by a seed
-- collision.
create temporary table chk_created_org (
  id text primary key
) on commit drop;

do $$
declare
  v_blocked boolean := false;
  v_first record;
  v_retry record;
begin
  select *
  into v_first
  from public.brownsync_create_organization(
    '61000000-0000-4000-8000-000000000001',
    '  A New Student Organization  ',
    'Created description',
    'Created about',
    'Mondays',
    '[{"platform":"discord","url":"https://discord.gg/new-org"}]'::jsonb
  );
  if v_first.disposition is distinct from 'created'
     or v_first.revision is distinct from 1
     or v_first.admin_role is distinct from 'owner'
     or v_first.organization_id is null
     or v_first.organization_id !~ '^user-a-new-student-organization-[0-9a-f]{8}$' then
    raise exception 'user organization creation failed: %', v_first;
  end if;
  insert into chk_created_org values (v_first.organization_id);

  select *
  into v_retry
  from public.brownsync_create_organization(
    '61000000-0000-4000-8000-000000000001',
    'A New Student Organization',
    'Created description',
    'Created about',
    'Mondays',
    '[{"platform":"discord","url":"https://discord.gg/new-org"}]'::jsonb
  );
  if v_retry.disposition is distinct from 'already_exists'
     or v_retry.organization_id is distinct from v_first.organization_id
     or v_retry.revision is distinct from 1 then
    raise exception 'user organization retry was not idempotent: %', v_retry;
  end if;

  v_blocked := false;
  begin
    perform *
    from public.brownsync_create_organization(
      '61000000-0000-4000-8000-000000000005',
      'A New Student Organization',
      null,
      null,
      null,
      null
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_NAME_EXISTS';
  end;
  if not v_blocked then
    raise exception 'duplicate normalized organization name was accepted';
  end if;

  if (
    select o.source <> 'user'
      or o.contact_emails <> '{}'
      or o.advisor is not null
      or o.funding_category is not null
    from public.organizations as o
    where o.id = v_first.organization_id
  ) is distinct from false then
    raise exception 'user organization populated source-owned fields';
  end if;

  if (
    select v.description <> 'Created description'
      or v.about_md <> 'Created about'
      or v.meeting_info <> 'Mondays'
      or v.revision <> 1
    from public.v_organizations_api as v
    where v.id = v_first.organization_id
  ) is distinct from false then
    raise exception 'user organization missing from safe merged view';
  end if;

  if not exists (
    select 1
    from public.brownsync_list_org_access(
      '61000000-0000-4000-8000-000000000001'
    ) as access
    where access.organization_id = v_first.organization_id
      and access.organization_name = 'A New Student Organization'
      and access.admin_role = 'owner'
      and access.membership_granted_at is not null
  ) then
    raise exception 'created membership missing from owner access list';
  end if;
end
$$;

do $$
declare
  v_audits bigint;
  v_id text;
  v_revision bigint;
begin
  select id into v_id from chk_created_org;
  select revision into v_revision
  from public.org_overrides
  where organization_id = v_id;
  select pg_catalog.count(*) into v_audits
  from public.org_edits
  where organization_id = v_id;

  insert into public.organizations (
    id,
    name,
    kind,
    description,
    source,
    contact_emails,
    advisor
  ) values (
    v_id,
    'Seed Collision',
    'club',
    'Seed overwrite',
    'studentactivities',
    array['attacker@brown.edu'],
    'Seed Advisor'
  )
  on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      source = excluded.source,
      contact_emails = excluded.contact_emails,
      advisor = excluded.advisor;

  if (
    select name <> 'A New Student Organization'
      or source <> 'user'
      or contact_emails <> '{}'
      or advisor is not null
    from public.organizations
    where id = v_id
  ) is distinct from false or (
    select revision <> v_revision
    from public.org_overrides
    where organization_id = v_id
  ) is distinct from false or (
    select pg_catalog.count(*) <> v_audits
    from public.org_edits
    where organization_id = v_id
  ) then
    raise exception 'seed collision changed user organization state';
  end if;
end
$$;

-- A normal source refresh updates only the seed row. The overlay and audit
-- remain byte-for-byte authoritative at read time.
do $$
declare
  v_audits bigint;
  v_before jsonb;
begin
  select pg_catalog.to_jsonb(x)
  into v_before
  from public.org_overrides as x
  where x.organization_id = 'chk-org-manual';
  select pg_catalog.count(*)
  into v_audits
  from public.org_edits
  where organization_id = 'chk-org-manual';

  insert into public.organizations (
    id,
    name,
    kind,
    description,
    url,
    instagram,
    source,
    contact_emails
  ) values (
    'chk-org-manual',
    'Check Manual Club',
    'club',
    'Refreshed seed description',
    'https://brown.example/manual-refreshed',
    'https://instagram.com/manual-refreshed',
    'studentactivities',
    array['new-president@brown.edu']
  )
  on conflict (id) do update
  set name = excluded.name,
      kind = excluded.kind,
      description = excluded.description,
      url = excluded.url,
      instagram = excluded.instagram,
      source = excluded.source,
      contact_emails = excluded.contact_emails;

  if (
    select pg_catalog.to_jsonb(x) is distinct from v_before
    from public.org_overrides as x
    where x.organization_id = 'chk-org-manual'
  ) is distinct from false or (
    select pg_catalog.count(*) <> v_audits
    from public.org_edits
    where organization_id = 'chk-org-manual'
  ) or (
    select description <> 'Club-authored description'
      or url <> 'https://brown.example/manual-refreshed'
      or instagram <> 'https://instagram.com/manual-refreshed'
    from public.v_organizations_api
    where id = 'chk-org-manual'
  ) is distinct from false then
    raise exception 'seed refresh changed or bypassed overlay/audit';
  end if;
end
$$;

-- Exact rate boundaries, transactional rollback, and safety-reducing writes
-- that remain available when the enabling-mutation bucket is exhausted.
do $$
declare
  v_before integer;
  v_blocked boolean := false;
  v_claim_id uuid;
  v_i integer;
  v_result record;
begin
  delete from public.org_write_limits
  where user_id = '61000000-0000-4000-8000-000000000004'
    and bucket = 'claim_day';
  for v_i in 1..5 loop
    perform public.brownsync_consume_org_write_limit(
      '61000000-0000-4000-8000-000000000004',
      'claim_day'
    );
  end loop;
  begin
    perform public.brownsync_consume_org_write_limit(
      '61000000-0000-4000-8000-000000000004',
      'claim_day'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_RATE_LIMITED';
  end;
  if not v_blocked or (
    select count <> 5
    from public.org_write_limits
    where user_id = '61000000-0000-4000-8000-000000000004'
      and bucket = 'claim_day'
  ) is distinct from false then
    raise exception '5/24h claim boundary failed';
  end if;
  update public.org_write_limits
  set window_started_at = pg_catalog.clock_timestamp() - interval '24 hours'
  where user_id = '61000000-0000-4000-8000-000000000004'
    and bucket = 'claim_day';
  perform public.brownsync_consume_org_write_limit(
    '61000000-0000-4000-8000-000000000004',
    'claim_day'
  );
  if (
    select count <> 1
    from public.org_write_limits
    where user_id = '61000000-0000-4000-8000-000000000004'
      and bucket = 'claim_day'
  ) is distinct from false then
    raise exception '24h claim window did not reset';
  end if;

  delete from public.org_write_limits
  where user_id = '61000000-0000-4000-8000-000000000001'
    and bucket = 'mutation_minute';
  for v_i in 1..30 loop
    perform public.brownsync_consume_org_write_limit(
      '61000000-0000-4000-8000-000000000001',
      'mutation_minute'
    );
  end loop;
  v_blocked := false;
  begin
    perform public.brownsync_consume_org_write_limit(
      '61000000-0000-4000-8000-000000000001',
      'mutation_minute'
    );
  exception when raise_exception then
    v_blocked := sqlerrm = 'BROWNSYNC_ORG_RATE_LIMITED';
  end;
  if not v_blocked then
    raise exception '30/60s mutation boundary failed';
  end if;

  select count
  into v_before
  from public.org_write_limits
  where user_id = '61000000-0000-4000-8000-000000000004'
    and bucket = 'claim_day';
  begin
    perform public.brownsync_consume_org_write_limit(
      '61000000-0000-4000-8000-000000000004',
      'claim_day'
    );
    raise exception 'forced rollback';
  exception when others then
    null;
  end;
  if (
    select count <> v_before
    from public.org_write_limits
    where user_id = '61000000-0000-4000-8000-000000000004'
      and bucket = 'claim_day'
  ) is distinct from false then
    raise exception 'rate counter survived rolled-back subtransaction';
  end if;

  -- Removal is safety-reducing and must work despite the exhausted owner
  -- mutation bucket.
  select *
  into v_result
  from public.brownsync_remove_org_admin(
    '61000000-0000-4000-8000-000000000001',
    'chk-org-manual',
    '61000000-0000-4000-8000-000000000004'
  );
  if v_result.changed is distinct from true then
    raise exception 'admin removal failed under exhausted bucket';
  end if;

  select c.claim_id
  into v_claim_id
  from public.brownsync_claim_organization(
    '61000000-0000-4000-8000-000000000007',
    'chk-org-manual',
    'Deletion fixture claim'
  ) as c;
  select *
  into v_result
  from public.brownsync_review_org_claim(
    '61000000-0000-4000-8000-000000000001',
    v_claim_id,
    false,
    'Rejected safely'
  );
  if v_result.claim_status is distinct from 'rejected' then
    raise exception 'claim rejection failed under exhausted bucket';
  end if;

  if not exists (
    select 1
    from public.brownsync_list_org_access(
      '61000000-0000-4000-8000-000000000007'
    ) as access
    where access.claim_id = v_claim_id
      and access.claim_status = 'rejected'
      and access.claim_review_note = 'Rejected safely'
  ) then
    raise exception 'claimant access list omitted sanitized review note';
  end if;
end
$$;

-- Account deletion removes authority/PII and rate state but preserves shared
-- content and audit with nullable attribution.
do $$
declare
  v_audit_id uuid;
begin
  insert into public.org_admins (
    organization_id,
    user_id,
    role,
    grant_source,
    granted_by
  ) values (
    'chk-org-other',
    '61000000-0000-4000-8000-000000000007',
    'editor',
    'owner_grant',
    '61000000-0000-4000-8000-000000000004'
  );
  insert into public.org_admins (
    organization_id,
    user_id,
    role,
    grant_source,
    granted_by
  ) values (
    'chk-org-other',
    '61000000-0000-4000-8000-000000000005',
    'editor',
    'owner_grant',
    '61000000-0000-4000-8000-000000000007'
  );
  insert into public.org_reviewers (user_id, granted_by)
  values (
    '61000000-0000-4000-8000-000000000007',
    '61000000-0000-4000-8000-000000000006'
  );

  perform *
  from public.brownsync_edit_organization(
    '61000000-0000-4000-8000-000000000007',
    'chk-org-other',
    0,
    '{"description":"Content survives deleted editor"}'::jsonb
  );
  perform public.brownsync_consume_org_write_limit(
    '61000000-0000-4000-8000-000000000007',
    'claim_day'
  );

  select e.id
  into v_audit_id
  from public.org_edits as e
  where e.organization_id = 'chk-org-other'
    and e.actor_user_id = '61000000-0000-4000-8000-000000000007'
    and e.action = 'content_edited';

  delete from auth.users
  where id = '61000000-0000-4000-8000-000000000007';

  if exists (
    select 1 from public.profiles
    where id = '61000000-0000-4000-8000-000000000007'
  ) or exists (
    select 1 from public.org_admins
    where user_id = '61000000-0000-4000-8000-000000000007'
  ) or exists (
    select 1 from public.org_claims
    where user_id = '61000000-0000-4000-8000-000000000007'
  ) or exists (
    select 1 from public.org_reviewers
    where user_id = '61000000-0000-4000-8000-000000000007'
  ) or exists (
    select 1 from public.org_write_limits
    where user_id = '61000000-0000-4000-8000-000000000007'
  ) then
    raise exception 'account deletion left organization authority or PII';
  end if;

  if (
    select updated_by is not null
      or description <> 'Content survives deleted editor'
    from public.org_overrides
    where organization_id = 'chk-org-other'
  ) is distinct from false or (
    select actor_user_id is not null
      or target_user_id is not null
      or after_state ->> 'description' <> 'Content survives deleted editor'
    from public.org_edits
    where id = v_audit_id
  ) is distinct from false or (
    select granted_by is not null
    from public.org_admins
    where organization_id = 'chk-org-other'
      and user_id = '61000000-0000-4000-8000-000000000005'
  ) is distinct from false then
    raise exception 'account deletion failed to preserve/anonymize org history';
  end if;

  begin
    perform *
    from public.brownsync_edit_organization(
      '61000000-0000-4000-8000-000000000007',
      'chk-org-other',
      1,
      '{"description":"Stale token"}'::jsonb
    );
    raise exception 'deleted actor retained organization write access';
  exception when raise_exception then
    if sqlerrm <> 'BROWNSYNC_ORG_UNAUTHORIZED' then
      raise;
    end if;
  end;
end
$$;

rollback;
