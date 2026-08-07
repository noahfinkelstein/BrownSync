/**
 * Pure scheduling math for the Worker cron dispatcher (spec: one `* * * * *`
 * trigger with a registry-driven dispatcher, not N cron expressions). No
 * Worker, no DB, no clock — everything is a parameter, so apps/api/test/
 * schedule-dispatch.test.ts can exercise it exhaustively offline.
 *
 * The SQL twin of `due` lives in scheduled.ts's claim() UPDATE, which
 * re-checks the same predicate row-by-row at claim time: Worker cron is not
 * exactly-once (spec risk R5), so `due` PLANS and the conditional UPDATE
 * decides — two overlapping ticks can both plan a source but only one can
 * claim it.
 */

/** The source_registry columns the dispatch decision reads (snake_case, as SQL returns them). */
export type DispatchRow = {
  source: string;
  /** 'worker'|'actions'|'ingest'|'realtime'|'sql'|'blocked' (registry CHECK). */
  lane: string;
  enabled: boolean;
  cadence_seconds: number;
  last_started_at: Date | null;
  backoff_until: Date | null;
};

/**
 * Lanes this dispatcher owns. 'worker' per the spec's dispatcher query, plus
 * 'sql' — the derived jobs (dedup, feed_rank) have no fetch but their engine
 * is well-tested TypeScript (never ported to plpgsql, spec problem #6), so
 * the same Worker tick runs them. 'actions'/'ingest'/'realtime'/'blocked'
 * stay with their own runtimes.
 */
export const DISPATCH_LANES: ReadonlySet<string> = new Set(["worker", "sql"]);

/**
 * Per-tick work bound: keeps one invocation inside the Worker CPU budget.
 * Cadence is a floor, not a guarantee — a source that misses a tick is simply
 * first in line next minute (`last_started_at` ordering self-heals).
 */
export const DISPATCH_LIMIT = 3;

/** Backoff ceiling: least(cadence · 2^failures, 6 h). */
export const BACKOFF_CAP_SECONDS = 6 * 60 * 60;

function isEligible(row: DispatchRow, now: Date): boolean {
  if (!row.enabled || !DISPATCH_LANES.has(row.lane)) return false;
  if (row.backoff_until !== null && row.backoff_until.getTime() > now.getTime()) return false;
  if (row.last_started_at === null) return true;
  return row.last_started_at.getTime() + row.cadence_seconds * 1000 <= now.getTime();
}

/**
 * Which sources this tick should run, in order:
 *
 *   eligible = enabled AND lane ∈ DISPATCH_LANES
 *              AND (backoff_until IS NULL OR backoff_until <= now)
 *              AND (last_started_at IS NULL
 *                   OR last_started_at + cadence_seconds <= now)
 *   ORDER BY last_started_at NULLS FIRST   -- never-run sources cannot starve
 *   LIMIT 3
 *
 * Ties (equal last_started_at, or several never-run rows) break on source
 * name so the plan is a total order — determinism no matter the input order.
 */
export function due(rows: readonly DispatchRow[], now: Date): string[] {
  return rows
    .filter((row) => isEligible(row, now))
    .sort((a, b) => {
      if (a.last_started_at === null && b.last_started_at !== null) return -1;
      if (a.last_started_at !== null && b.last_started_at === null) return 1;
      if (a.last_started_at !== null && b.last_started_at !== null) {
        const byStarted = a.last_started_at.getTime() - b.last_started_at.getTime();
        if (byStarted !== 0) return byStarted;
      }
      return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
    })
    .slice(0, DISPATCH_LIMIT)
    .map((row) => row.source);
}

/**
 * Backoff delay after the Nth consecutive failure (N >= 1, i.e. the value
 * AFTER the failure was counted), in seconds:
 *
 *   delay = random() · least(cadence · 2^failures, 6 h)
 *
 * FULL jitter (uniform over [0, cap]) rather than cap ± ε: every failing
 * source on the same schedule would otherwise retry in lockstep against a
 * host that just told us it is struggling. A near-zero draw is fine — the
 * cap doubles with every further failure, so persistent failure still walks
 * out to the 6-hour ceiling.
 */
export function backoffDelaySeconds(
  cadenceSeconds: number,
  consecutiveFailures: number,
  random: () => number = Math.random,
): number {
  if (cadenceSeconds <= 0 || consecutiveFailures <= 0) return 0;
  const cap = Math.min(cadenceSeconds * 2 ** consecutiveFailures, BACKOFF_CAP_SECONDS);
  return random() * cap;
}
