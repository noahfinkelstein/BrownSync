-- 0013_org_enrichment_checks.sql — rollback-safe organization enrichment checks.
begin;

do $$
declare
  v_column text;
begin
  foreach v_column in array array[
    'contact_emails',
    'advisor',
    'funding_category',
    'website_url',
    'facebook_url',
    'linkedin_url',
    'youtube_url',
    'twitter_url',
    'tiktok_url',
    'logo_url'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_attribute as a
      where a.attrelid = 'public.organizations'::pg_catalog.regclass
        and a.attname = v_column
        and a.attnum > 0
        and not a.attisdropped
    ) then
      raise exception 'BROWNSYNC_ORG_ENRICHMENT_MISSING: %', v_column;
    end if;
  end loop;
end
$$;

do $$
declare
  v_role text;
  v_safe_column text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as a
    join pg_catalog.pg_attrdef as d
      on d.adrelid = a.attrelid
     and d.adnum = a.attnum
    where a.attrelid = 'public.organizations'::pg_catalog.regclass
      and a.attname = 'contact_emails'
      and a.attnotnull
      and pg_catalog.format_type(a.atttypid, a.atttypmod) = 'text[]'
      and pg_catalog.pg_get_expr(d.adbin, d.adrelid) = '''{}''::text[]'
  ) then
    raise exception 'contact_emails type/default/nullability drifted';
  end if;

  foreach v_role in array array['anon', 'authenticated'] loop
    if pg_catalog.has_table_privilege(
      v_role,
      'public.organizations',
      'select'
    ) then
      raise exception '% retained table-level organizations SELECT', v_role;
    end if;

    if pg_catalog.has_column_privilege(
      v_role,
      'public.organizations',
      'contact_emails',
      'select'
    ) then
      raise exception '% can read private organization contacts', v_role;
    end if;

    foreach v_safe_column in array array[
      'id',
      'name',
      'kind',
      'category',
      'description',
      'url',
      'instagram',
      'default_place_id',
      'source',
      'advisor',
      'funding_category',
      'website_url',
      'facebook_url',
      'linkedin_url',
      'youtube_url',
      'twitter_url',
      'tiktok_url'
    ] loop
      if not pg_catalog.has_column_privilege(
        v_role,
        'public.organizations',
        v_safe_column,
        'select'
      ) then
        raise exception '% lacks safe organization column %', v_role, v_safe_column;
      end if;
    end loop;

    if pg_catalog.has_column_privilege(
      v_role,
      'public.organizations',
      'logo_url',
      'select'
    ) then
      raise exception '% can read raw organization logo provenance', v_role;
    end if;
  end loop;
end
$$;

insert into public.organizations (
  id,
  name,
  kind,
  source,
  contact_emails,
  advisor,
  website_url
) values (
  'chk-org-enrichment',
  'Check Org Enrichment',
  'club',
  'check',
  array['president@brown.edu'],
  'Published Advisor',
  'https://example.org'
);

set local role anon;

do $$
declare
  v_blocked boolean := false;
begin
  if (
    select name <> 'Check Org Enrichment'
      or advisor <> 'Published Advisor'
      or website_url <> 'https://example.org'
    from public.organizations
    where id = 'chk-org-enrichment'
  ) then
    raise exception 'anon safe organization projection failed';
  end if;

  begin
    perform contact_emails
    from public.organizations
    where id = 'chk-org-enrichment';
  exception
    when insufficient_privilege then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'anon selected private organization contacts';
  end if;

  v_blocked := false;
  begin
    perform logo_url
    from public.organizations
    where id = 'chk-org-enrichment';
  exception
    when insufficient_privilege then
      v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'anon selected raw organization logo provenance';
  end if;
end
$$;

reset role;
set local role authenticated;

do $$
declare
  v_blocked boolean := false;
begin
  if (
    select name <> 'Check Org Enrichment'
      or advisor <> 'Published Advisor'
      or website_url <> 'https://example.org'
    from public.organizations
    where id = 'chk-org-enrichment'
  ) then
    raise exception 'authenticated safe organization projection failed';
  end if;

  begin
    perform contact_emails
    from public.organizations
    where id = 'chk-org-enrichment';
  exception
    when insufficient_privilege then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'authenticated selected private organization contacts';
  end if;

  v_blocked := false;
  begin
    perform logo_url
    from public.organizations
    where id = 'chk-org-enrichment';
  exception
    when insufficient_privilege then
      v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'authenticated selected raw organization logo provenance';
  end if;
end
$$;

reset role;
rollback;
