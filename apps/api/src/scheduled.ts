import type { SeedSourceRun } from "@brownsync/contract";
import { recordSourceRun, type Sql } from "@brownsync/sources/db";
import { backoffDelaySeconds, due } from "./schedule/dispatch";
import type { RegistryRow, RunnerResult, SourceRunner } from "./schedule/runners";

/**
 * The registry-driven cron dispatcher: ONE `* * * * *` trigger (wrangler.toml
 * [triggers]) reads source_registry each minute, plans with the pure `due()`
 * (schedule/dispatch.ts), and runs at most DISPATCH_LIMIT sources. Cadence,
 * backoff, etiquette and the kill switch are all registry DATA — enabling or
 * silencing a source is an UPDATE, not a deploy.
 *
 * All SQL lives behind `DispatcherStore` (same seam pattern as queries.ts) so
 * the orchestration is tested with an injected fake — CI never touches a live
 * server. The SQL implementation's semantics are proven in
 * db/checks/0008_dispatcher_checks.sql against the disposable PostGIS
 * container.
 *
 * Worker cron is NOT exactly-once and ticks can be skipped (spec risk R5):
 * `due()` only PLANS; `claim()` is a conditional UPDATE that re-checks
 * eligibility and stamps last_started_at atomically, so of two overlapping
 * ticks exactly one wins each source and the loser records nothing. Cadence
 * is a floor — a missed minute just means the source sorts first next tick.
 */

export type { RegistryRow, RunnerResult, SourceRunner };

export type DispatcherStore = {
  loadRegistry: () => Promise<RegistryRow[]>;
  /** Atomic claim: re-check eligibility, stamp last_started_at. False = another tick won. */
  claim: (source: string) => Promise<boolean>;
  /** One source_runs row per run, ALWAYS, including failures (contract §2). */
  recordRun: (run: SeedSourceRun) => Promise<void>;
  /** ok/partial: clear failures + backoff; okAt stamps last_ok_at (null keeps it). */
  markSuccess: (source: string, okAt: string | null) => Promise<void>;
  /** Count one more consecutive failure; returns the new count. */
  bumpFailures: (source: string) => Promise<number>;
  setBackoff: (source: string, untilIso: string) => Promise<void>;
};

export function createDispatcherStore(sql: Sql): DispatcherStore {
  return {
    loadRegistry: async () =>
      await sql<RegistryRow[]>`
        select
          source, lane, enabled, cadence_seconds, etiquette_min_interval_seconds,
          consecutive_failures, last_started_at, backoff_until
        from source_registry
      `,
    claim: async (source) => {
      // The SQL twin of due()'s eligibility predicate — claim-time re-check.
      const claimed = await sql`
        update source_registry
        set last_started_at = now()
        where source = ${source}
          and enabled
          and (backoff_until is null or backoff_until <= now())
          and (last_started_at is null
               or last_started_at + make_interval(secs => cadence_seconds) <= now())
        returning source
      `;
      return claimed.count > 0;
    },
    recordRun: (run) => recordSourceRun(sql, run),
    markSuccess: async (source, okAt) => {
      await sql`
        update source_registry
        set consecutive_failures = 0,
            backoff_until = null,
            last_ok_at = coalesce(${okAt}::timestamptz, last_ok_at)
        where source = ${source}
      `;
    },
    bumpFailures: async (source) => {
      const rows = await sql<{ consecutive_failures: number }[]>`
        update source_registry
        set consecutive_failures = consecutive_failures + 1
        where source = ${source}
        returning consecutive_failures
      `;
      return rows[0]?.consecutive_failures ?? 1;
    },
    setBackoff: async (source, untilIso) => {
      await sql`
        update source_registry
        set backoff_until = ${untilIso}::timestamptz
        where source = ${source}
      `;
    },
  };
}

export type TickOutcome = {
  source: string;
  /** "skipped" = planned but the claim lost to a concurrent tick — nothing ran. */
  status: RunnerResult["status"] | "skipped";
  items: number;
  error: string | null;
};

export type TickDeps = {
  now?: () => Date;
  random?: () => number;
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One cron tick. Sources run SEQUENTIALLY — the limit bounds the work and the
 * per-host etiquette spacing must not be defeated by parallel sweeps. A
 * runner failure is contained per source: the run row is still recorded, the
 * registry gets exponential backoff with full jitter, and the remaining due
 * sources still run.
 */
export async function runDispatchTick(
  store: DispatcherStore,
  runners: Readonly<Record<string, SourceRunner>>,
  deps: TickDeps = {},
): Promise<TickOutcome[]> {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;

  const registry = await store.loadRegistry();
  // Only sources this Worker can execute are candidates: a registered source
  // whose producer has not landed yet must never be claimed (that would stamp
  // last_started_at and turn the registry into a log of runs that never
  // happened) — it simply is not this dispatcher's work yet.
  const runnable = registry.filter((row) => runners[row.source] !== undefined);

  const outcomes: TickOutcome[] = [];
  for (const source of due(runnable, now())) {
    const row = runnable.find((r) => r.source === source);
    const runner = runners[source];
    if (row === undefined || runner === undefined) continue; // unreachable: due() plans over runnable
    if (!(await store.claim(source))) {
      outcomes.push({ source, status: "skipped", items: 0, error: null });
      continue;
    }

    const startedAt = now();
    let result: RunnerResult;
    try {
      result = await runner(row);
    } catch (err) {
      result = { status: "error", items: 0, error: message(err) };
    }
    const finishedAt = now();

    // Best-effort, mirroring the poller: a failure to RECORD must not stop
    // the backoff bookkeeping or the remaining sources.
    try {
      await store.recordRun({
        source,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        status: result.status,
        items_upserted: result.items,
        error: result.error,
      });
    } catch (recordErr) {
      console.error(`[source_runs] could not record ${source} run: ${message(recordErr)}`);
    }

    try {
      if (result.status === "error") {
        const failures = await store.bumpFailures(source);
        const delaySeconds = backoffDelaySeconds(row.cadence_seconds, failures, random);
        await store.setBackoff(
          source,
          new Date(finishedAt.getTime() + Math.round(delaySeconds * 1000)).toISOString(),
        );
      } else {
        // last_ok_at only moves on a genuinely complete run; a partial still
        // clears failures/backoff because the source is alive and answering.
        await store.markSuccess(source, result.status === "ok" ? finishedAt.toISOString() : null);
      }
    } catch (registryErr) {
      console.error(`[registry] could not update ${source}: ${message(registryErr)}`);
    }

    outcomes.push({ source, ...result });
  }
  return outcomes;
}
