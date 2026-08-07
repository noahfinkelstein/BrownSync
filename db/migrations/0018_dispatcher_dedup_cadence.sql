-- 0018_dispatcher_dedup_cadence.sql — dedup moves to the Worker dispatcher.
--
-- NUMBERING (allocation-table deviation, recorded): Lane B was allocated
-- 0005-0009 and 0008/0009 were still free on paper, but prod Supabase had
-- already applied migrations through 0017 by the time this landed — a
-- migration numbered 0008 would slot BELOW the remote high-water mark and
-- `supabase db push` refuses out-of-order files without --include-all.
-- Lane B's 0008/0009 slots are therefore PERMANENTLY DEAD; new migrations
-- continue from 0018.
--
-- ADDITIVE ONLY in effect: no table, column or function changes — one UPDATE
-- of operator policy in source_registry, which exists precisely so that this
-- kind of tuning is an auditable SQL statement instead of a deploy (0006).
--
-- WHY (spec problem #6): dedup used to ride the athletics workflow cron as
-- `pnpm poll dedup`, so its cadence was an ACCIDENT of athletics' schedule —
-- moving athletics to a 2-hour etiquette cadence would have silently halved
-- dedup's. 0006 gave dedup its own poll.yml cron ("52 * * * *") as a stopgap
-- and recorded the target: "lane=sql at 900s once the Worker dispatcher
-- lands". The dispatcher has landed (apps/api/src/scheduled.ts, one
-- `* * * * *` trigger); this migration is that recorded target, executed.
--
-- lane 'sql' = a derived job with no fetch. It still runs IN THE WORKER —
-- pg_cron cannot run the well-tested TypeScript union-find in
-- packages/sources/src/dedup/cluster.ts, and porting it to plpgsql is
-- explicitly rejected — so the dispatcher owns lanes ('worker', 'sql').
--
-- TRANSITIONAL OVERLAP, ON PURPOSE: poll.yml's dedup cron entry is NOT
-- removed here (this PR does not touch poll.yml — it keeps working
-- byte-for-byte until the dispatcher is proven in prod). Dedup is idempotent,
-- so running on both lanes is harmless; the Actions entry is retired in the
-- later PR that edits poll.yml.

update source_registry
set lane                = 'sql',
    cadence_seconds     = 900,
    stale_after_seconds = 3600,
    notes               = 'Derived job, no fetch. Dispatched by the Worker cron dispatcher '
                          '(apps/api/src/scheduled.ts) every 900s alongside lane=worker '
                          'sources; the engine is packages/sources/src/dedup (never plpgsql). '
                          'poll.yml''s "52 * * * *" dedup entry is transitional redundancy — '
                          'idempotent — and is retired in the PR that edits poll.yml.'
where source = 'dedup';
