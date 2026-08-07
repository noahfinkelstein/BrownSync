import { DEFAULT_DEDUP_CONFIG, type DedupConfig, runDedup } from "@brownsync/sources/dedup/index";
import { connect, recordSourceRun, type Sql } from "../db";

/**
 * Detection, clustering and application moved to packages/sources
 * (runtime-portable — the Worker dispatcher runs the SAME job on a 15-minute
 * cadence); re-exported here for stable paths. Only the CLI entry below is
 * Node-lane-specific.
 */
export * from "@brownsync/sources/dedup/index";

export type DedupJobResult = {
  source: "dedup";
  status: "ok" | "error";
  marked: number;
  error: string | null;
};

/**
 * CLI entry (`pnpm poll dedup [--dry-run]`). Unlike the feed pollers' dry-run,
 * dedup's --dry-run still needs DATABASE_URL — candidates live in the DB —
 * but writes nothing (no canonical_id updates, no source_runs row) and prints
 * the planned assignments as NDJSON on stdout.
 */
export async function runDedupJob(
  opts: { dryRun: boolean },
  cfg: DedupConfig = DEFAULT_DEDUP_CONFIG,
): Promise<DedupJobResult> {
  const startedAt = new Date().toISOString();
  let sql: Sql | null = null;
  try {
    sql = connect();
    const { summary, assignments } = await runDedup(sql, cfg, opts);
    if (opts.dryRun) {
      for (const a of assignments) console.log(JSON.stringify(a));
    } else {
      await recordSourceRun(sql, {
        source: "dedup",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: "ok",
        items_upserted: summary.marked,
        error: null,
      });
    }
    console.error(
      `[dedup] ${summary.candidatePairs} candidate pairs → ${summary.marked} rows ` +
        `${opts.dryRun ? "would be " : ""}marked duplicate` +
        (summary.flattened > 0 ? ` (${summary.flattened} chained re-pointed)` : ""),
    );
    return { source: "dedup", status: "ok", marked: summary.marked, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[dedup] error: ${error}`);
    if (!opts.dryRun && sql) {
      try {
        await recordSourceRun(sql, {
          source: "dedup",
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          status: "error",
          items_upserted: 0,
          error,
        });
      } catch (recordErr) {
        const msg = recordErr instanceof Error ? recordErr.message : String(recordErr);
        console.error(`[source_runs] could not record failure: ${msg}`);
      }
    }
    return { source: "dedup", status: "error", marked: 0, error };
  } finally {
    await sql?.end();
  }
}
