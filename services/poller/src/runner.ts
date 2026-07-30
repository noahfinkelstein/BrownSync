import { readFileSync } from "node:fs";
import path from "node:path";
import type { SeedEvent } from "@brownsync/contract";
import { athleticsModule } from "./athletics";
import { bdhModule } from "./bdh";
import { cancelUnseen, connect, recordSourceRun, type Sql, upsertEvents } from "./db";
import { createHttpClient, type HttpClient } from "./http";
import { livewhaleModule } from "./livewhale";
import { mergeShardRows, shardsAreTruncated, type WindowFetch } from "./livewhale/shard";
import type { Source } from "./sources";
import { isLikelyTruncated, type SweepWindow, sweepWindow, sweepWindowFromShards } from "./sweep";
import type { SourceModule } from "./types";

export const MODULES: Readonly<Record<Source, SourceModule>> = {
  livewhale: livewhaleModule,
  athletics: athleticsModule,
  bdh: bdhModule,
};

export type RunOptions = {
  /** Print normalized rows + summary; no DB connection at all. */
  dryRun: boolean;
  /** Replay a recorded response instead of fetching. */
  fixturePath: string | null;
};

export type RunResult = {
  source: string;
  /** "partial" = the fetch looked truncated (row cap) — see sweep.ts. */
  status: "ok" | "partial" | "error";
  items: number;
  canceled: number;
  error: string | null;
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function printSummary(
  mod: SourceModule,
  rows: readonly SeedEvent[],
  window: SweepWindow | null,
  canceled: number | null,
): void {
  const byCategory = new Map<string, number>();
  let withCoords = 0;
  for (const row of rows) {
    const cat = row.category ?? "(none)";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
    if (row.lat != null && row.lng != null) withCoords++;
  }
  const cats = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}=${n}`)
    .join(" ");
  console.error(`[${mod.cliName}] ${rows.length} rows (${withCoords} with coords) ${cats}`);
  if (window) console.error(`[${mod.cliName}] window ${window.start} → ${window.end}`);
  if (canceled !== null) console.error(`[${mod.cliName}] canceled ${canceled} unseen in window`);
}

/**
 * A recorded replay plan for a SHARDED source (`fixtures/livewhale-shards.json`).
 *
 * Responses are keyed by REQUEST ORDER rather than by date, on purpose: the
 * window planner is anchored on `now`, so a date-keyed fixture would silently
 * stop matching tomorrow. Order-keyed replay pins the BEHAVIOUR — first window
 * at the cap, its two halves under the cap and sharing an id, everything after
 * that empty — and stays deterministic forever.
 */
type ShardFixturePlan = {
  responses: string[];
  /** Body served for every window past `responses` — normally an empty feed. */
  default: string;
};

function shardFixtureFetch(planPath: string): WindowFetch {
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as ShardFixturePlan;
  const dir = path.dirname(planPath);
  let index = 0;
  return async () => {
    const file = plan.responses[index] ?? plan.default;
    index++;
    return readFileSync(path.join(dir, file), "utf8");
  };
}

/** Best-effort failure logging — a broken feed must still leave a source_runs row. */
async function tryRecordFailure(source: string, startedAt: string, error: string): Promise<void> {
  let sql: Sql | null = null;
  try {
    sql = connect();
    await recordSourceRun(sql, {
      source,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "error",
      items_upserted: 0,
      error,
    });
  } catch (recordErr) {
    console.error(`[source_runs] could not record failure: ${message(recordErr)}`);
  } finally {
    await sql?.end();
  }
}

export async function runSource(
  mod: SourceModule,
  opts: RunOptions,
  client: HttpClient = createHttpClient(),
): Promise<RunResult> {
  const startedAt = new Date().toISOString();

  let rows: SeedEvent[];
  let window: SweepWindow | null;
  let truncated: boolean;
  try {
    if (mod.fetchPlan && mod.windowEndpoint) {
      // Sharded: many bounded windows. Truncation now means something real —
      // a window narrowed all the way to one day that STILL hit the row cap —
      // instead of being permanently true because one unbounded fetch always
      // comes back at the cap.
      const windowEndpoint = mod.windowEndpoint;
      const fetchWindow: WindowFetch = opts.fixturePath
        ? shardFixtureFetch(opts.fixturePath)
        : async (w) => (await client.get(windowEndpoint(w))).body;
      const shards = await mod.fetchPlan(fetchWindow);
      rows = mergeShardRows(shards);
      // The sweep covers what was ASKED FOR, not what came back: a window with
      // no events is now evidence that its events are gone, which is exactly
      // what the cancellation sweep needs and never had.
      window = sweepWindowFromShards(shards.map((s) => s.window));
      truncated = mod.sweep && shardsAreTruncated(shards);
      console.error(
        `[${mod.cliName}] ${shards.length} window(s) fetched, ` +
          `${shards.reduce((n, s) => n + s.rows.length, 0)} rows before dedupe`,
      );
    } else {
      const rawText = opts.fixturePath
        ? readFileSync(opts.fixturePath, "utf8")
        : (await client.get(mod.endpoint)).body;
      rows = mod.normalize(rawText);
      window = sweepWindow(rows);
      // A fetch at the requested max / server row cap is incomplete: the tail
      // of the window was cut off, so an absent event at the window's end
      // boundary proves nothing. Clamp the sweep to [start, end) and record
      // the run as partial. Only meaningful for full-window feeds (mod.sweep).
      truncated = mod.sweep && isLikelyTruncated(rows.length, mod.requestedMax ?? null);
    }
  } catch (err) {
    const error = message(err);
    console.error(`[${mod.cliName}] error: ${error}`);
    if (!opts.dryRun) await tryRecordFailure(mod.source, startedAt, error);
    return { source: mod.source, status: "error", items: 0, canceled: 0, error };
  }

  const status = truncated ? "partial" : "ok";
  if (truncated) {
    console.error(
      `[${mod.cliName}] fetch looks truncated (${rows.length} rows >= cap) — ` +
        "sweep clamped before the window end, run recorded as partial",
    );
  }

  if (opts.dryRun) {
    for (const row of rows) {
      const { raw: _raw, ...printable } = row;
      console.log(JSON.stringify(printable));
    }
    printSummary(mod, rows, window, null);
    return { source: mod.source, status, items: rows.length, canceled: 0, error: null };
  }

  let sql: Sql | null = null;
  try {
    sql = connect();
    const upserted = await upsertEvents(sql, rows);
    let canceled = 0;
    if (mod.sweep && window) {
      canceled = await cancelUnseen(
        sql,
        mod.source,
        truncated ? { ...window, endExclusive: true } : window,
        rows.map((r) => r.source_id),
      );
    }
    await recordSourceRun(sql, {
      source: mod.source,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      items_upserted: upserted,
      error: null,
    });
    printSummary(mod, rows, window, canceled);
    return { source: mod.source, status, items: upserted, canceled, error: null };
  } catch (err) {
    const error = message(err);
    console.error(`[${mod.cliName}] error: ${error}`);
    if (sql) {
      try {
        await recordSourceRun(sql, {
          source: mod.source,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          status: "error",
          items_upserted: 0,
          error,
        });
      } catch (recordErr) {
        console.error(`[source_runs] could not record failure: ${message(recordErr)}`);
      }
    } else {
      await tryRecordFailure(mod.source, startedAt, error);
    }
    return { source: mod.source, status: "error", items: 0, canceled: 0, error };
  } finally {
    await sql?.end();
  }
}
