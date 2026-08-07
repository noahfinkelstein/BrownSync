#!/usr/bin/env bash
# Deterministic multi-session checks for organization claim/admin serialization.
set -euo pipefail

if [[ ${BROWNSYNC_DISPOSABLE_ORG_RACE:-} != 1 ]]; then
  echo "refusing organization race fixtures without BROWNSYNC_DISPOSABLE_ORG_RACE=1" >&2
  exit 2
fi

database_url=${1:-postgresql://postgres:postgres@localhost:5432/postgres}
race_tmp=$(mktemp -d)
cleanup_armed=false
child_pids=()

psql_task() {
  psql -X "$database_url" -v ON_ERROR_STOP=1 -qAt "$@"
}

cleanup() {
  local child_pid
  for child_pid in "${child_pids[@]}"; do
    if kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null || true
    fi
  done
  if [[ $cleanup_armed == true ]]; then
    psql_task >/dev/null 2>&1 <<'SQL' || true
delete from auth.users
where id in (
  '81000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000003',
  '81000000-0000-4000-8000-000000000004',
  '81000000-0000-4000-8000-000000000005',
  '81000000-0000-4000-8000-000000000006',
  '81000000-0000-4000-8000-000000000007',
  '81000000-0000-4000-8000-000000000008',
  '81000000-0000-4000-8000-000000000009'
);
delete from public.organizations
where id in (
  'chk-org-race-auto',
  'chk-org-race-manual',
  'chk-org-race-review',
  'chk-org-race-grant',
  'chk-org-race-edit',
  'chk-org-race-limit-a',
  'chk-org-race-limit-b',
  'chk-org-race-seed',
  'chk-org-race-delete',
  'chk-org-race-reject-delete',
  'chk-org-race-remove-delete'
);
SQL
  fi
  if [[ -n ${race_tmp:-} && -d $race_tmp ]]; then
    rm -r -- "$race_tmp"
  fi
}
trap cleanup EXIT

wait_for_advisory_marker() {
  local lock_key=$1
  local attempt
  local held
  for attempt in {1..120}; do
    held=$(psql_task -c "select not pg_catalog.pg_try_advisory_lock($lock_key)")
    if [[ $held == t ]]; then
      return 0
    fi
    sleep 0.05
  done
  echo "timed out waiting for advisory marker $lock_key" >&2
  return 1
}

wait_for_lock_wait() {
  local application_name=$1
  local attempt
  local waiting
  for attempt in {1..120}; do
    waiting=$(psql_task -c "
      select exists (
        select 1
        from pg_catalog.pg_stat_activity
        where application_name = '$application_name'
          and wait_event_type = 'Lock'
      )
    ")
    if [[ $waiting == t ]]; then
      return 0
    fi
    sleep 0.05
  done
  echo "$application_name never entered a lock wait" >&2
  return 1
}

wait_success() {
  local child_pid=$1
  local output_file=$2
  local status
  set +e
  wait "$child_pid"
  status=$?
  set -e
  if [[ $status -ne 0 ]]; then
    echo "race session failed unexpectedly: $output_file" >&2
    sed -n '1,160p' "$output_file" >&2
    return 1
  fi
}

wait_failure() {
  local child_pid=$1
  local output_file=$2
  local expected_error=$3
  local status
  set +e
  wait "$child_pid"
  status=$?
  set -e
  if [[ $status -eq 0 ]] || ! grep -Fq "$expected_error" "$output_file"; then
    echo "race session did not fail with $expected_error: $output_file" >&2
    sed -n '1,160p' "$output_file" >&2
    return 1
  fi
}

expect_nowait_conflict() {
  local label=$1
  local statement=$2
  local output_file=$3
  local status
  set +e
  psql_task -c "$statement" >"$output_file" 2>&1
  status=$?
  set -e
  if [[ $status -eq 0 ]] \
     || ! grep -Fq 'could not obtain lock on row' "$output_file"; then
    echo "$label did not encounter the expected row-lock conflict" >&2
    sed -n '1,160p' "$output_file" >&2
    return 1
  fi
}

if [[ $(psql_task -c "
  select
    pg_catalog.to_regprocedure(
      'public.brownsync_claim_organization(uuid,text,text)'
    ) is not null
    and pg_catalog.to_regprocedure(
      'public.brownsync_edit_organization(uuid,text,bigint,jsonb)'
    ) is not null
") != t ]]; then
  echo "BROWNSYNC_ORG_ADMIN_MIGRATION_MISSING: owner routines" >&2
  exit 1
fi

collision_count=$(psql_task -c "
  select
    (
      select pg_catalog.count(*)
      from auth.users
      where id::text like '81000000-0000-4000-8000-00000000000_'
    )
    +
    (
      select pg_catalog.count(*)
      from public.organizations
      where id in (
        'chk-org-race-auto',
        'chk-org-race-manual',
        'chk-org-race-review',
        'chk-org-race-grant',
        'chk-org-race-edit',
        'chk-org-race-limit-a',
        'chk-org-race-limit-b',
        'chk-org-race-seed',
        'chk-org-race-delete',
        'chk-org-race-reject-delete',
        'chk-org-race-remove-delete'
      )
    )
")
if [[ $collision_count != 0 ]]; then
  echo "refusing to overwrite pre-existing Task 5B race fixtures" >&2
  exit 2
fi
cleanup_armed=true

psql_task <<'SQL'
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values
  ('81000000-0000-4000-8000-000000000001', 'org.race.auto@brown.edu', '{"full_name":"Org Race Auto"}', '{"provider":"google"}'),
  ('81000000-0000-4000-8000-000000000002', 'org.race.manual@brown.edu', '{"full_name":"Org Race Manual"}', '{"provider":"google"}'),
  ('81000000-0000-4000-8000-000000000003', 'org.race.owner@brown.edu', '{"full_name":"Org Race Owner"}', '{"provider":"google"}'),
  ('81000000-0000-4000-8000-000000000004', 'org.race.reviewer@brown.edu', '{"full_name":"Org Race Reviewer"}', '{"providers":["google"]}'),
  ('81000000-0000-4000-8000-000000000005', 'org.race.claimant@brown.edu', '{"full_name":"Org Race Claimant"}', '{"provider":"google"}'),
  ('81000000-0000-4000-8000-000000000006', 'org.race.grantee@brown.edu', '{"full_name":"Org Race Grantee"}', '{"provider":"google"}'),
  ('81000000-0000-4000-8000-000000000007', 'org.race.spare@brown.edu', '{"full_name":"Org Race Spare"}', '{"provider":"google"}'),
  ('81000000-0000-4000-8000-000000000008', 'org.race.limiter@brown.edu', '{"full_name":"Org Race Limiter"}', '{"provider":"google"}'),
  ('81000000-0000-4000-8000-000000000009', 'org.race.delete@brown.edu', '{"full_name":"Org Race Delete"}', '{"provider":"google"}');

insert into public.organizations (
  id, name, kind, description, source, contact_emails
)
values
  ('chk-org-race-auto', 'Check Race Auto', 'club', 'Auto seed', 'race', array['ORG.RACE.AUTO@BROWN.EDU']),
  ('chk-org-race-manual', 'Check Race Manual', 'club', 'Manual seed', 'race', array['someone.else@brown.edu']),
  ('chk-org-race-review', 'Check Race Review', 'club', 'Review seed', 'race', '{}'),
  ('chk-org-race-grant', 'Check Race Grant', 'club', 'Grant seed', 'race', '{}'),
  ('chk-org-race-edit', 'Check Race Edit', 'club', 'Edit seed', 'race', '{}'),
  ('chk-org-race-limit-a', 'Check Race Limit A', 'club', 'Limit A seed', 'race', '{}'),
  ('chk-org-race-limit-b', 'Check Race Limit B', 'club', 'Limit B seed', 'race', '{}'),
  ('chk-org-race-seed', 'Check Race Seed', 'club', 'Original seed description', 'race', '{}'),
  ('chk-org-race-delete', 'Check Race Delete', 'club', 'Delete seed', 'race', '{}'),
  ('chk-org-race-reject-delete', 'Check Race Reject Delete', 'club', 'Reject delete seed', 'race', '{}'),
  ('chk-org-race-remove-delete', 'Check Race Remove Delete', 'club', 'Remove delete seed', 'race', '{}');

insert into public.org_admins (
  organization_id, user_id, role, grant_source
)
values
  ('chk-org-race-review', '81000000-0000-4000-8000-000000000003', 'owner', 'creator'),
  ('chk-org-race-grant', '81000000-0000-4000-8000-000000000003', 'owner', 'creator'),
  ('chk-org-race-edit', '81000000-0000-4000-8000-000000000003', 'owner', 'creator'),
  ('chk-org-race-seed', '81000000-0000-4000-8000-000000000003', 'owner', 'creator'),
  ('chk-org-race-delete', '81000000-0000-4000-8000-000000000003', 'owner', 'creator'),
  ('chk-org-race-reject-delete', '81000000-0000-4000-8000-000000000003', 'owner', 'creator'),
  ('chk-org-race-remove-delete', '81000000-0000-4000-8000-000000000003', 'owner', 'creator'),
  ('chk-org-race-remove-delete', '81000000-0000-4000-8000-000000000006', 'editor', 'owner_grant');

insert into public.org_reviewers (user_id)
values ('81000000-0000-4000-8000-000000000004');
SQL

# Duplicate exact-contact claims serialize to one approved claim, one owner
# grant, one audit event, and one consumed claim bucket.
psql_task >"$race_tmp/auto-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '12s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task5b-auto-holder';
select disposition
from public.brownsync_claim_organization(
  '81000000-0000-4000-8000-000000000001',
  'chk-org-race-auto',
  null
);
select pg_catalog.pg_advisory_lock(514001);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(514001);
SQL
auto_holder_pid=$!
child_pids+=("$auto_holder_pid")
wait_for_advisory_marker 514001

psql_task >"$race_tmp/auto-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '12s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task5b-auto-waiter';
select disposition
from public.brownsync_claim_organization(
  '81000000-0000-4000-8000-000000000001',
  'chk-org-race-auto',
  'ignored retry evidence'
);
commit;
SQL
auto_waiter_pid=$!
child_pids+=("$auto_waiter_pid")
wait_for_lock_wait brownsync-task5b-auto-waiter
wait_success "$auto_holder_pid" "$race_tmp/auto-holder.log"
wait_success "$auto_waiter_pid" "$race_tmp/auto-waiter.log"

if ! grep -Fxq auto_approved "$race_tmp/auto-holder.log" \
   || ! grep -Fxq already_admin "$race_tmp/auto-waiter.log" \
   || [[ $(psql_task -c "
     select
       (select pg_catalog.count(*) = 1
        from public.org_claims
        where organization_id = 'chk-org-race-auto'
          and status = 'approved'
          and decision_kind = 'contact_auto')
       and
       (select pg_catalog.count(*) = 1
        from public.org_admins
        where organization_id = 'chk-org-race-auto'
          and user_id = '81000000-0000-4000-8000-000000000001'
          and role = 'owner')
       and
       (select pg_catalog.count(*) = 1
        from public.org_edits
        where organization_id = 'chk-org-race-auto'
          and action = 'claim_auto_approved')
       and
       (select count = 1
        from public.org_write_limits
        where user_id = '81000000-0000-4000-8000-000000000001'
          and bucket = 'claim_day')
   ") != t ]]; then
  echo "duplicate auto-claim race did not converge idempotently" >&2
  exit 1
fi

# Duplicate manual claims serialize to one pending row and one audit event.
psql_task >"$race_tmp/manual-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '12s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task5b-manual-holder';
select disposition
from public.brownsync_claim_organization(
  '81000000-0000-4000-8000-000000000002',
  'chk-org-race-manual',
  'Manual race evidence'
);
select pg_catalog.pg_advisory_lock(514002);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(514002);
SQL
manual_holder_pid=$!
child_pids+=("$manual_holder_pid")
wait_for_advisory_marker 514002

psql_task >"$race_tmp/manual-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '12s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task5b-manual-waiter';
select disposition
from public.brownsync_claim_organization(
  '81000000-0000-4000-8000-000000000002',
  'chk-org-race-manual',
  'Different retry evidence'
);
commit;
SQL
manual_waiter_pid=$!
child_pids+=("$manual_waiter_pid")
wait_for_lock_wait brownsync-task5b-manual-waiter
wait_success "$manual_holder_pid" "$race_tmp/manual-holder.log"
wait_success "$manual_waiter_pid" "$race_tmp/manual-waiter.log"

if ! grep -Fxq pending "$race_tmp/manual-holder.log" \
   || ! grep -Fxq already_pending "$race_tmp/manual-waiter.log" \
   || [[ $(psql_task -c "
     select
       (select pg_catalog.count(*) = 1
        from public.org_claims
        where organization_id = 'chk-org-race-manual'
          and status = 'pending'
          and evidence = 'Manual race evidence')
       and
       (select pg_catalog.count(*) = 1
        from public.org_edits
        where organization_id = 'chk-org-race-manual'
          and action = 'claim_submitted')
       and
       (select count = 1
        from public.org_write_limits
        where user_id = '81000000-0000-4000-8000-000000000002'
          and bucket = 'claim_day')
   ") != t ]]; then
  echo "duplicate manual-claim race did not converge idempotently" >&2
  exit 1
fi

# Approve versus reject serializes at the organization and claim. The owner
# commits approval first; the waiting reviewer must receive the stable opposite
# terminal-decision error rather than overwriting it.
review_claim_id=$(psql_task -c "
  select claim_id
  from public.brownsync_claim_organization(
    '81000000-0000-4000-8000-000000000005',
    'chk-org-race-review',
    'Review race evidence'
  )
")

psql_task >"$race_tmp/review-holder.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '12s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task5b-review-holder';
select claim_status || '|' || granted_role || '|' || changed::text
from public.brownsync_review_org_claim(
  '81000000-0000-4000-8000-000000000003',
  '$review_claim_id',
  true,
  'Owner approved'
);
select pg_catalog.pg_advisory_lock(514003);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(514003);
SQL
review_holder_pid=$!
child_pids+=("$review_holder_pid")
wait_for_advisory_marker 514003

psql_task >"$race_tmp/review-waiter.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '12s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task5b-review-waiter';
select *
from public.brownsync_review_org_claim(
  '81000000-0000-4000-8000-000000000004',
  '$review_claim_id',
  false,
  'Reviewer rejected'
);
commit;
SQL
review_waiter_pid=$!
child_pids+=("$review_waiter_pid")
wait_for_lock_wait brownsync-task5b-review-waiter
wait_success "$review_holder_pid" "$race_tmp/review-holder.log"
wait_failure \
  "$review_waiter_pid" \
  "$race_tmp/review-waiter.log" \
  BROWNSYNC_ORG_CLAIM_ALREADY_DECIDED

if ! grep -Fxq 'approved|editor|true' "$race_tmp/review-holder.log" \
   || [[ $(psql_task -c "
     select
       (select pg_catalog.count(*) = 1
        from public.org_claims
        where id = '$review_claim_id'
          and status = 'approved'
          and granted_role = 'editor')
       and
       (select pg_catalog.count(*) = 1
        from public.org_admins
        where organization_id = 'chk-org-race-review'
          and user_id = '81000000-0000-4000-8000-000000000005'
          and role = 'editor')
       and
       (select pg_catalog.count(*) = 1
        from public.org_edits
        where claim_id = '$review_claim_id'
          and action = 'claim_approved')
       and
       (select pg_catalog.count(*) = 0
        from public.org_edits
        where claim_id = '$review_claim_id'
          and action = 'claim_rejected')
   ") != t ]]; then
  echo "approve/reject race did not preserve one terminal decision" >&2
  exit 1
fi

# Owner grant versus target claim: the grant commits first, so the claimant
# wakes as an existing editor and performs no claim write or rate consumption.
psql_task >"$race_tmp/grant-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '12s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task5b-grant-holder';
select admin_role || '|' || changed::text
from public.brownsync_set_org_admin(
  '81000000-0000-4000-8000-000000000003',
  'chk-org-race-grant',
  '81000000-0000-4000-8000-000000000006',
  'editor'
);
select pg_catalog.pg_advisory_lock(514004);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(514004);
SQL
grant_holder_pid=$!
child_pids+=("$grant_holder_pid")
wait_for_advisory_marker 514004

psql_task >"$race_tmp/grant-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '12s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task5b-grant-waiter';
select disposition
from public.brownsync_claim_organization(
  '81000000-0000-4000-8000-000000000006',
  'chk-org-race-grant',
  'Concurrent claim evidence'
);
commit;
SQL
grant_waiter_pid=$!
child_pids+=("$grant_waiter_pid")
wait_for_lock_wait brownsync-task5b-grant-waiter
wait_success "$grant_holder_pid" "$race_tmp/grant-holder.log"
wait_success "$grant_waiter_pid" "$race_tmp/grant-waiter.log"

if ! grep -Fxq 'editor|true' "$race_tmp/grant-holder.log" \
   || ! grep -Fxq already_admin "$race_tmp/grant-waiter.log" \
   || [[ $(psql_task -c "
     select
       (select pg_catalog.count(*) = 1
        from public.org_admins
        where organization_id = 'chk-org-race-grant'
          and user_id = '81000000-0000-4000-8000-000000000006'
          and role = 'editor')
       and
       (select pg_catalog.count(*) = 0
        from public.org_claims
        where organization_id = 'chk-org-race-grant'
          and user_id = '81000000-0000-4000-8000-000000000006')
       and
       (select pg_catalog.count(*) = 0
        from public.org_write_limits
        where user_id = '81000000-0000-4000-8000-000000000006'
          and bucket = 'claim_day')
   ") != t ]]; then
  echo "grant/claim race did not converge on the owner grant" >&2
  exit 1
fi

# Concurrent edits at revision zero have one winner. The distinct loser gets a
# stable conflict; replaying the winner's desired state with stale revision is
# an idempotent no-op with no second audit row.
psql_task >"$race_tmp/edit-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '12s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task5b-edit-holder';
select revision::text || '|' || changed::text
from public.brownsync_edit_organization(
  '81000000-0000-4000-8000-000000000003',
  'chk-org-race-edit',
  0,
  '{"description":"Winning concurrent edit"}'::jsonb
);
select pg_catalog.pg_advisory_lock(514005);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(514005);
SQL
edit_holder_pid=$!
child_pids+=("$edit_holder_pid")
wait_for_advisory_marker 514005

psql_task >"$race_tmp/edit-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '12s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task5b-edit-waiter';
select *
from public.brownsync_edit_organization(
  '81000000-0000-4000-8000-000000000003',
  'chk-org-race-edit',
  0,
  '{"description":"Losing concurrent edit"}'::jsonb
);
commit;
SQL
edit_waiter_pid=$!
child_pids+=("$edit_waiter_pid")
wait_for_lock_wait brownsync-task5b-edit-waiter
wait_success "$edit_holder_pid" "$race_tmp/edit-holder.log"
wait_failure \
  "$edit_waiter_pid" \
  "$race_tmp/edit-waiter.log" \
  BROWNSYNC_ORG_REVISION_CONFLICT

psql_task >"$race_tmp/edit-retry.log" 2>&1 <<'SQL'
select revision::text || '|' || changed::text
from public.brownsync_edit_organization(
  '81000000-0000-4000-8000-000000000003',
  'chk-org-race-edit',
  0,
  '{"description":"Winning concurrent edit"}'::jsonb
);
SQL

if ! grep -Fxq '1|true' "$race_tmp/edit-holder.log" \
   || ! grep -Fxq '1|false' "$race_tmp/edit-retry.log" \
   || [[ $(psql_task -c "
     select
       (select description = 'Winning concurrent edit' and revision = 1
        from public.org_overrides
        where organization_id = 'chk-org-race-edit')
       and
       (select pg_catalog.count(*) = 1
        from public.org_edits
        where organization_id = 'chk-org-race-edit'
          and revision = 1
          and action = 'content_edited')
   ") != t ]]; then
  echo "concurrent edit race or stale idempotent retry drifted" >&2
  exit 1
fi

# First limiter-row creation races on two different organizations for the same
# actor. Both valid claims commit and the single fixed-window bucket reaches 2.
delete_limit_count=$(psql_task -c "
  delete from public.org_write_limits
  where user_id = '81000000-0000-4000-8000-000000000008'
    and bucket = 'claim_day'
  returning count
")
if [[ -n $delete_limit_count ]]; then
  echo "limiter fixture unexpectedly had a pre-existing claim bucket" >&2
  exit 1
fi

psql_task >"$race_tmp/limit-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '12s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task5b-limit-holder';
select disposition
from public.brownsync_claim_organization(
  '81000000-0000-4000-8000-000000000008',
  'chk-org-race-limit-a',
  'Limiter race A'
);
select pg_catalog.pg_advisory_lock(514006);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(514006);
SQL
limit_holder_pid=$!
child_pids+=("$limit_holder_pid")
wait_for_advisory_marker 514006

psql_task >"$race_tmp/limit-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '12s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task5b-limit-waiter';
select disposition
from public.brownsync_claim_organization(
  '81000000-0000-4000-8000-000000000008',
  'chk-org-race-limit-b',
  'Limiter race B'
);
commit;
SQL
limit_waiter_pid=$!
child_pids+=("$limit_waiter_pid")
wait_for_lock_wait brownsync-task5b-limit-waiter
wait_success "$limit_holder_pid" "$race_tmp/limit-holder.log"
wait_success "$limit_waiter_pid" "$race_tmp/limit-waiter.log"

if ! grep -Fxq pending "$race_tmp/limit-holder.log" \
   || ! grep -Fxq pending "$race_tmp/limit-waiter.log" \
   || [[ $(psql_task -c "
     select
       (select count = 2
        from public.org_write_limits
        where user_id = '81000000-0000-4000-8000-000000000008'
          and bucket = 'claim_day')
       and
       (select pg_catalog.count(*) = 2
        from public.org_claims
        where organization_id in (
          'chk-org-race-limit-a',
          'chk-org-race-limit-b'
        )
          and user_id = '81000000-0000-4000-8000-000000000008'
          and status = 'pending')
   ") != t ]]; then
  echo "first limiter-row race did not retain two writes and count=2" >&2
  exit 1
fi

# A seed refresh waits behind an uncommitted overlay edit, then updates only
# the source row. The committed overlay and its single audit revision survive.
psql_task >"$race_tmp/seed-edit-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '12s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task5b-seed-edit-holder';
select revision::text || '|' || changed::text
from public.brownsync_edit_organization(
  '81000000-0000-4000-8000-000000000003',
  'chk-org-race-seed',
  0,
  '{"description":"Durable overlay during seed race"}'::jsonb
);
select pg_catalog.pg_advisory_lock(514007);
select pg_catalog.pg_sleep(3);
commit;
select pg_catalog.pg_advisory_unlock(514007);
SQL
seed_edit_holder_pid=$!
child_pids+=("$seed_edit_holder_pid")
wait_for_advisory_marker 514007

psql_task >"$race_tmp/seed-upsert-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '12s';
set local lock_timeout = '10s';
set local application_name = 'brownsync-task5b-seed-upsert-waiter';
insert into public.organizations (
  id,
  name,
  kind,
  description,
  source,
  contact_emails
) values (
  'chk-org-race-seed',
  'Check Race Seed Refreshed',
  'club',
  'Refreshed source description',
  'studentactivities',
  array['refreshed@brown.edu']
)
on conflict (id) do update
set name = excluded.name,
    kind = excluded.kind,
    description = excluded.description,
    source = excluded.source,
    contact_emails = excluded.contact_emails;
commit;
SQL
seed_upsert_waiter_pid=$!
child_pids+=("$seed_upsert_waiter_pid")
wait_for_lock_wait brownsync-task5b-seed-upsert-waiter
wait_success "$seed_edit_holder_pid" "$race_tmp/seed-edit-holder.log"
wait_success "$seed_upsert_waiter_pid" "$race_tmp/seed-upsert-waiter.log"

if ! grep -Fxq '1|true' "$race_tmp/seed-edit-holder.log" \
   || [[ $(psql_task -c "
     select
       (select description = 'Refreshed source description'
          and name = 'Check Race Seed Refreshed'
          and source = 'studentactivities'
        from public.organizations
        where id = 'chk-org-race-seed')
       and
       (select description = 'Durable overlay during seed race'
          and revision = 1
        from public.v_organizations_api
        where id = 'chk-org-race-seed')
       and
       (select pg_catalog.count(*) = 1
        from public.org_edits
        where organization_id = 'chk-org-race-seed'
          and revision = 1
          and action = 'content_edited')
   ") != t ]]; then
  echo "seed-upsert/edit race did not preserve the overlay and audit" >&2
  exit 1
fi

# Three-session delete-versus-reject barrier. A blocker owns the target profile;
# deletion then owns auth.users and waits on that profile. The fixed reject
# path must wait on auth.users before locking the claim child. A NOWAIT probe
# proves the claim remains free; releasing the profile lets deletion win and
# the reject exits cleanly without a deadlock.
reject_delete_claim_id=$(psql_task -c "
  select claim_id
  from public.brownsync_claim_organization(
    '81000000-0000-4000-8000-000000000007',
    'chk-org-race-reject-delete',
    'Reject then delete evidence'
  )
")

psql_task >"$race_tmp/reject-profile-blocker.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '40s';
set local application_name = 'brownsync-task5b-reject-profile-blocker';
select id
from public.profiles
where id = '81000000-0000-4000-8000-000000000007'
for update;
select pg_catalog.pg_advisory_lock(514009);
select pg_catalog.pg_sleep(30);
commit;
select pg_catalog.pg_advisory_unlock(514009);
SQL
reject_profile_blocker_pid=$!
child_pids+=("$reject_profile_blocker_pid")
wait_for_advisory_marker 514009

psql_task >"$race_tmp/reject-delete-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5b-reject-delete-holder';
delete from auth.users
where id = '81000000-0000-4000-8000-000000000007';
commit;
SQL
reject_delete_holder_pid=$!
child_pids+=("$reject_delete_holder_pid")
wait_for_lock_wait brownsync-task5b-reject-delete-holder
expect_nowait_conflict \
  "reject/delete auth barrier" \
  "select id from auth.users where id = '81000000-0000-4000-8000-000000000007' for key share nowait" \
  "$race_tmp/reject-auth-probe.log"

psql_task >"$race_tmp/reject-delete-waiter.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5b-reject-delete-waiter';
select *
from public.brownsync_review_org_claim(
  '81000000-0000-4000-8000-000000000003',
  '$reject_delete_claim_id',
  false,
  'Concurrent rejection'
);
commit;
SQL
reject_delete_waiter_pid=$!
child_pids+=("$reject_delete_waiter_pid")
wait_for_lock_wait brownsync-task5b-reject-delete-waiter

if [[ $(psql_task -c "
  select id
  from public.org_claims
  where id = '$reject_delete_claim_id'
  for update nowait
") != "$reject_delete_claim_id" ]]; then
  echo "reject path locked the claim before the target auth barrier" >&2
  exit 1
fi

if [[ $(psql_task -c "
  select pg_catalog.pg_terminate_backend(pid)
  from pg_catalog.pg_stat_activity
  where application_name = 'brownsync-task5b-reject-profile-blocker'
") != t ]]; then
  echo "could not release reject/delete profile barrier" >&2
  exit 1
fi
wait_failure \
  "$reject_profile_blocker_pid" \
  "$race_tmp/reject-profile-blocker.log" \
  'terminating connection due to administrator command'
wait_success \
  "$reject_delete_holder_pid" \
  "$race_tmp/reject-delete-holder.log"
wait_failure \
  "$reject_delete_waiter_pid" \
  "$race_tmp/reject-delete-waiter.log" \
  BROWNSYNC_ORG_CLAIM_NOT_FOUND

if [[ $(psql_task -c "
     select
       (select pg_catalog.count(*) = 0
        from auth.users
        where id = '81000000-0000-4000-8000-000000000007')
       and
       (select pg_catalog.count(*) = 0
        from public.org_claims
        where id = '$reject_delete_claim_id')
       and
       (select pg_catalog.count(*) = 1
        from public.org_edits
        where organization_id = 'chk-org-race-reject-delete'
          and action = 'claim_submitted'
          and actor_user_id is null
          and target_user_id is null
          and claim_id is null)
       and
       (select pg_catalog.count(*) = 0
        from public.org_edits
        where organization_id = 'chk-org-race-reject-delete'
          and action = 'claim_rejected')
   ") != t ]]; then
  echo "three-session reject/account-delete race did not drain cleanly" >&2
  exit 1
fi

# Three-session delete-versus-owner-removal barrier. A blocker owns the target
# profile; deletion then owns auth.users and waits on that profile. The fixed
# removal path must wait on auth.users before locking the admin child. A NOWAIT
# probe proves the admin remains free; deletion wins after the profile blocker
# is released, so removal drains idempotently with changed=false.
psql_task >"$race_tmp/remove-profile-blocker.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '40s';
set local application_name = 'brownsync-task5b-remove-profile-blocker';
select id
from public.profiles
where id = '81000000-0000-4000-8000-000000000006'
for update;
select pg_catalog.pg_advisory_lock(514010);
select pg_catalog.pg_sleep(30);
commit;
select pg_catalog.pg_advisory_unlock(514010);
SQL
remove_profile_blocker_pid=$!
child_pids+=("$remove_profile_blocker_pid")
wait_for_advisory_marker 514010

psql_task >"$race_tmp/remove-delete-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5b-remove-delete-holder';
delete from auth.users
where id = '81000000-0000-4000-8000-000000000006';
commit;
SQL
remove_delete_holder_pid=$!
child_pids+=("$remove_delete_holder_pid")
wait_for_lock_wait brownsync-task5b-remove-delete-holder
expect_nowait_conflict \
  "remove/delete auth barrier" \
  "select id from auth.users where id = '81000000-0000-4000-8000-000000000006' for key share nowait" \
  "$race_tmp/remove-auth-probe.log"

psql_task >"$race_tmp/remove-delete-waiter.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5b-remove-delete-waiter';
select changed::text
from public.brownsync_remove_org_admin(
  '81000000-0000-4000-8000-000000000003',
  'chk-org-race-remove-delete',
  '81000000-0000-4000-8000-000000000006'
);
commit;
SQL
remove_delete_waiter_pid=$!
child_pids+=("$remove_delete_waiter_pid")
wait_for_lock_wait brownsync-task5b-remove-delete-waiter

if [[ $(psql_task -c "
  select user_id
  from public.org_admins
  where organization_id = 'chk-org-race-remove-delete'
    and user_id = '81000000-0000-4000-8000-000000000006'
  for update nowait
") != '81000000-0000-4000-8000-000000000006' ]]; then
  echo "removal path locked the admin before the target auth barrier" >&2
  exit 1
fi

if [[ $(psql_task -c "
  select pg_catalog.pg_terminate_backend(pid)
  from pg_catalog.pg_stat_activity
  where application_name = 'brownsync-task5b-remove-profile-blocker'
") != t ]]; then
  echo "could not release remove/delete profile barrier" >&2
  exit 1
fi
wait_failure \
  "$remove_profile_blocker_pid" \
  "$race_tmp/remove-profile-blocker.log" \
  'terminating connection due to administrator command'
wait_success \
  "$remove_delete_holder_pid" \
  "$race_tmp/remove-delete-holder.log"
wait_success \
  "$remove_delete_waiter_pid" \
  "$race_tmp/remove-delete-waiter.log"

if ! grep -Fxq false "$race_tmp/remove-delete-waiter.log" \
   || [[ $(psql_task -c "
     select
       (select pg_catalog.count(*) = 0
        from auth.users
        where id = '81000000-0000-4000-8000-000000000006')
       and
       (select pg_catalog.count(*) = 0
        from public.org_admins
        where user_id = '81000000-0000-4000-8000-000000000006')
       and
       (select pg_catalog.count(*) = 0
        from public.org_edits
        where organization_id = 'chk-org-race-remove-delete'
          and action = 'admin_removed')
   ") != t ]]; then
  echo "three-session owner-removal/account-delete race did not drain cleanly" >&2
  exit 1
fi

# Three-session delete-versus-approval barrier. A blocker owns the claimant
# profile; deletion then owns auth.users and waits on that profile. The fixed
# approval path must wait on auth.users before locking the claim child. A
# NOWAIT probe proves that ordering; deletion wins after release and the
# approval exits unauthorized with cascaded state and anonymized audit data.
delete_claim_id=$(psql_task -c "
  select claim_id
  from public.brownsync_claim_organization(
    '81000000-0000-4000-8000-000000000009',
    'chk-org-race-delete',
    'Deletion race evidence'
  )
")

psql_task >"$race_tmp/approve-profile-blocker.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '40s';
set local application_name = 'brownsync-task5b-approve-profile-blocker';
select id
from public.profiles
where id = '81000000-0000-4000-8000-000000000009'
for update;
select pg_catalog.pg_advisory_lock(514008);
select pg_catalog.pg_sleep(30);
commit;
select pg_catalog.pg_advisory_unlock(514008);
SQL
approve_profile_blocker_pid=$!
child_pids+=("$approve_profile_blocker_pid")
wait_for_advisory_marker 514008

psql_task >"$race_tmp/delete-holder.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5b-delete-holder';
delete from auth.users
where id = '81000000-0000-4000-8000-000000000009';
commit;
SQL
delete_holder_pid=$!
child_pids+=("$delete_holder_pid")
wait_for_lock_wait brownsync-task5b-delete-holder
expect_nowait_conflict \
  "approval/delete auth barrier" \
  "select id from auth.users where id = '81000000-0000-4000-8000-000000000009' for key share nowait" \
  "$race_tmp/approve-auth-probe.log"

psql_task >"$race_tmp/delete-review-waiter.log" 2>&1 <<SQL &
begin;
set local statement_timeout = '20s';
set local lock_timeout = '15s';
set local application_name = 'brownsync-task5b-delete-review-waiter';
select *
from public.brownsync_review_org_claim(
  '81000000-0000-4000-8000-000000000003',
  '$delete_claim_id',
  true,
  'Concurrent approval'
);
commit;
SQL
delete_review_waiter_pid=$!
child_pids+=("$delete_review_waiter_pid")
wait_for_lock_wait brownsync-task5b-delete-review-waiter

if [[ $(psql_task -c "
  select id
  from public.org_claims
  where id = '$delete_claim_id'
  for update nowait
") != "$delete_claim_id" ]]; then
  echo "approval path locked the claim before the target auth barrier" >&2
  exit 1
fi

if [[ $(psql_task -c "
  select pg_catalog.pg_terminate_backend(pid)
  from pg_catalog.pg_stat_activity
  where application_name = 'brownsync-task5b-approve-profile-blocker'
") != t ]]; then
  echo "could not release approval/delete profile barrier" >&2
  exit 1
fi
wait_failure \
  "$approve_profile_blocker_pid" \
  "$race_tmp/approve-profile-blocker.log" \
  'terminating connection due to administrator command'
wait_success "$delete_holder_pid" "$race_tmp/delete-holder.log"
wait_failure \
  "$delete_review_waiter_pid" \
  "$race_tmp/delete-review-waiter.log" \
  BROWNSYNC_ORG_UNAUTHORIZED

if [[ $(psql_task -c "
  select
    (select pg_catalog.count(*) = 0
     from auth.users
     where id = '81000000-0000-4000-8000-000000000009')
    and
    (select pg_catalog.count(*) = 0
     from public.profiles
     where id = '81000000-0000-4000-8000-000000000009')
    and
    (select pg_catalog.count(*) = 0
     from public.org_claims
     where id = '$delete_claim_id')
    and
    (select pg_catalog.count(*) = 0
     from public.org_admins
     where user_id = '81000000-0000-4000-8000-000000000009')
    and
    (select pg_catalog.count(*) = 0
     from public.org_write_limits
     where user_id = '81000000-0000-4000-8000-000000000009')
    and
    (select pg_catalog.count(*) = 1
     from public.org_edits
     where organization_id = 'chk-org-race-delete'
       and action = 'claim_submitted'
       and actor_user_id is null
       and target_user_id is null
       and claim_id is null)
    and
    (select pg_catalog.count(*) = 0
     from public.org_edits
     where organization_id = 'chk-org-race-delete'
       and action = 'claim_approved')
") != t ]]; then
  echo "account-delete/review race did not cascade or anonymize cleanly" >&2
  exit 1
fi

echo "0014_org_admin_race: all deterministic concurrency races passed"
