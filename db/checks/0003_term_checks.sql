-- 0003_term_checks.sql — semantic checks for the term-code reconciliation.
--
-- Run by CI's postgis job AFTER migrations with:
--   psql -v ON_ERROR_STOP=1 -f db/checks/0003_term_checks.sql
-- from the repo root (the \i below resolves relative to the cwd).
--
-- ROLLBACK-SAFE: the transaction rebuilds the pre-0003 world (only the 202710
-- guess row in term_calendar, stale meetings keyed under 202710), re-applies
-- the migration file via \i — twice, proving idempotency — asserts the
-- outcome, and rolls everything back. Fixture crns use a chk9xx suffix that
-- real CAB data (numeric crns) can never collide with, so this is safe to
-- point at a live database too.

begin;

-- Pre-0003 world: the guess row (with operator-adjusted dates, to prove the
-- migration carries them over rather than resetting to the default window).
delete from term_calendar where srcdb in ('202610', '202710');
insert into term_calendar (srcdb, start_date, end_date)
values ('202710', date '2026-09-08', date '2026-12-21');

-- Stale meetings loaded under the wrong code, including one whose correctly
-- keyed twin already exists and one with a non-standard id.
insert into course_meetings (id, srcdb, crn, course_code, title, days,
                             start_time, end_time) values
  ('202710-chk901-0', '202710', 'chk901', 'CHK 0101', 'Chk Old Code',   'MWF', '10:00', '10:50'),
  ('202710-chk902-0', '202710', 'chk902', 'CHK 0102', 'Chk Stale Twin', 'MWF', '10:00', '10:50'),
  ('202610-chk902-0', '202610', 'chk902', 'CHK 0102', 'Chk Fresh Twin', 'MWF', '10:00', '10:50'),
  ('chk-odd-id',      '202710', 'chk903', 'CHK 0103', 'Chk Odd Id',     'MWF', '10:00', '10:50');

\i db/migrations/0003_term_reconciliation.sql
-- Second application must be a no-op (idempotency) — the assertions below
-- hold for the combined effect either way.
\i db/migrations/0003_term_reconciliation.sql

do $chk$
declare
  r record;
begin
  -- Standard ids are re-keyed onto the 202610 prefix.
  select * into r from course_meetings where id = '202610-chk901-0';
  if not found or r.srcdb <> '202610' then
    raise exception 'term 0003: 202710-chk901-0 not re-keyed to 202610 (srcdb=%)', r.srcdb;
  end if;
  if exists (select 1 from course_meetings where id = '202710-chk901-0') then
    raise exception 'term 0003: stale 202710-chk901-0 id survived re-keying';
  end if;

  -- A row whose correct twin exists keeps its id but gets the right srcdb;
  -- the twin is untouched. Nothing was deleted.
  select * into r from course_meetings where id = '202710-chk902-0';
  if not found or r.srcdb <> '202610' then
    raise exception 'term 0003: twin-blocked row lost or srcdb not fixed (srcdb=%)', r.srcdb;
  end if;
  select * into r from course_meetings where id = '202610-chk902-0';
  if not found or r.title <> 'Chk Fresh Twin' then
    raise exception 'term 0003: fresh twin was modified';
  end if;

  -- Non-standard ids keep their id, srcdb still corrected.
  select * into r from course_meetings where id = 'chk-odd-id';
  if not found or r.srcdb <> '202610' then
    raise exception 'term 0003: odd-id row srcdb not fixed (srcdb=%)', r.srcdb;
  end if;

  -- No meeting references the wrong code anywhere.
  if exists (select 1 from course_meetings where srcdb = '202710') then
    raise exception 'term 0003: srcdb 202710 still present in course_meetings';
  end if;

  -- Calendar: the 202610 row carries the guess row's (operator-adjusted)
  -- window; the guess row itself is gone once nothing references it.
  select * into r from term_calendar where srcdb = '202610';
  if not found or r.start_date <> date '2026-09-08' or r.end_date <> date '2026-12-21' then
    raise exception 'term 0003: 202610 row did not inherit the 202710 window (start=%, end=%)',
      r.start_date, r.end_date;
  end if;
  if exists (select 1 from term_calendar where srcdb = '202710') then
    raise exception 'term 0003: 202710 guess row survived with nothing referencing it';
  end if;
end
$chk$;

rollback;

\echo '0003_term_checks: all assertions passed (transaction rolled back)'
