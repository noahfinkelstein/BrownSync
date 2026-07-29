-- 0003_term_reconciliation.sql — Fall 2026 CAB term code: 202710 -> 202610.
--
-- 0002 seeded term_calendar with a conventional Banner-style GUESS for Fall
-- 2026 ('202710' = fall of academic year 2026-27, flagged as a guess in its
-- own comments). The authoritative CAB export and the published
-- db/seeds/course_meetings.ndjson both use srcdb '202610' — CAB codes terms
-- as <calendar year><term> (202610 = Fall 2026). Reconcile the app side to
-- 202610.
--
-- Data rows are re-keyed, never deleted; the only row removed is 0002's own
-- seeded calendar guess, and only once nothing references it. Idempotent and
-- safe on any database state (fresh, seeded-under-202610, or a stale DB that
-- loaded meetings under 202710); db/checks/0003_term_checks.sql re-runs this
-- file against fixture rows to prove both properties. NOTE for that reason
-- this file must stay free of transaction control statements.

-- 1. Carry a previously recorded 202710 teaching window over to the correct
--    code (an operator may have adjusted 0002's dates — keep theirs) ...
insert into term_calendar (srcdb, start_date, end_date)
select '202610', start_date, end_date
from term_calendar
where srcdb = '202710'
on conflict (srcdb) do nothing;

-- ... and make sure the canonical Fall 2026 row exists even where the guess
-- row is already gone. Window matches the CAB export (first day of classes
-- 2026-09-09, end of exams 2026-12-22 — same window 0002 recorded).
insert into term_calendar (srcdb, start_date, end_date)
values ('202610', date '2026-09-09', date '2026-12-22')
on conflict (srcdb) do nothing;

-- 2. Re-key course_meetings loaded under the wrong code. Contract §1: id is
--    '{srcdb}-{crn}-{meet_idx}', so the srcdb prefix is rewritten too —
--    unless the correctly-keyed twin already exists (a later 202610 seed load
--    landed alongside stale 202710 rows), in which case the stale row keeps
--    its id but still gets the corrected srcdb so term_calendar joins hold.
update course_meetings cm
set srcdb = '202610',
    id = '202610' || substr(cm.id, length('202710') + 1)
where cm.srcdb = '202710'
  and cm.id like '202710-%'
  and not exists (
    select 1 from course_meetings t
    where t.id = '202610' || substr(cm.id, length('202710') + 1)
  );

update course_meetings
set srcdb = '202610'
where srcdb = '202710';

-- 3. Drop the wrong-guess calendar row once nothing references it (config
--    seeded by 0002, not ingested data — the never-delete rule governs event
--    data, and a stale wrong term row would silently mis-window any future
--    meeting loaded under 202710 by mistake).
delete from term_calendar tc
where tc.srcdb = '202710'
  and not exists (select 1 from course_meetings cm where cm.srcdb = '202710');
