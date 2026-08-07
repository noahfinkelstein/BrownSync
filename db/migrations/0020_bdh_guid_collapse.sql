-- 0020: collapse attributed BDH guids to their text — corrective for 0004.
--
-- 0004's rebuild coerced every allowlisted field with `->>`, and its comment
-- claimed that collapses a guid carrying XML attributes
-- ({"#text": ..., "@_isPermaLink": ...}) to its text. It does not: `->>` on a
-- nested OBJECT returns the object serialized as JSON text, so such guids
-- survived 0004 as strings like '{"#text": "...", "@_isPermaLink": "true"}'.
-- db/checks/0004_bdh_licence_checks.sql caught exactly this (the long-standing
-- repository-wide red assertion); the collapse guarantee now lives here, with
-- db/checks/0020_bdh_guid_checks.sql as its regression guard.
--
-- Two shapes to repair, both idempotent and source-scoped:
--   a. guid still a nested object (rows that never passed through 0004's
--      rebuild — e.g. restored backups): extract #text directly.
--   b. guid a string that IS a serialized attributed object (0004's output):
--      parse and extract #text.

-- Exception-safe parse: a real-world guid that merely starts with '{' but is
-- not valid JSON must be left alone, and a bare `::jsonb` cast would abort the
-- whole migration on it. pg_temp-scoped so nothing persists past the session.
create or replace function pg_temp.brownsync_try_jsonb(t text) returns jsonb
language plpgsql immutable as $$
begin
  return t::jsonb;
exception when others then
  return null;
end $$;

-- a. Nested-object guids.
update events e
set raw = jsonb_set(e.raw, '{guid}', to_jsonb(e.raw -> 'guid' ->> '#text'))
where e.source = 'bdh'
  and jsonb_typeof(e.raw -> 'guid') = 'object'
  and e.raw -> 'guid' ->> '#text' is not null;

-- b. Stringified-object guids (0004's mis-collapse).
update events e
set raw = jsonb_set(
  e.raw, '{guid}',
  to_jsonb(pg_temp.brownsync_try_jsonb(e.raw ->> 'guid') ->> '#text')
)
where e.source = 'bdh'
  and jsonb_typeof(e.raw -> 'guid') = 'string'
  and e.raw ->> 'guid' like '{%'
  and jsonb_typeof(pg_temp.brownsync_try_jsonb(e.raw ->> 'guid')) = 'object'
  and pg_temp.brownsync_try_jsonb(e.raw ->> 'guid') ->> '#text' is not null;
