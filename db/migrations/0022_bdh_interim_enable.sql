-- 0022: align the bdh registry row with the owner-approved interim posture.
--
-- G1 decision (owner: Noah Finkelstein, 2026-08-07, recorded in
-- reports/ops/2026-08-07-launch-session-1.md): BDH ships headline-only while
-- the written-permission email is out. The registry row was seeded
-- enabled=false in 0006 as the pre-P1 stance, but poll.yml has polled the RSS
-- headline-only since the P1 purge — cron and registry disagreed (recon
-- discrepancy #10). This flips the row to match the approved reality; the
-- kill switch (`update source_registry set enabled=false where source='bdh'`)
-- remains one statement away if the Herald declines.
--
-- The licence constraint is unchanged and structural: license stays
-- 'headline_only' and the 0004 CHECK architecture physically rejects body
-- text for bdh rows.

update source_registry
set enabled = true,
    tos_note = coalesce(tos_note, '')
      || ' | 2026-08-07 owner decision: headline-only interim while written '
      || 'permission is pending (email drafted); see G1 in BROWNSYNC_V2_PLAN.md.'
where source = 'bdh'
  and enabled = false;
