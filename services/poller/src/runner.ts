import { readFileSync } from "node:fs";
import type { SeedEvent } from "@brownsync/contract";
import { athleticsModule } from "./athletics";
import { bdhModule } from "./bdh";
import { cancelUnseen, connect, recordSourceRun, type Sql, upsertEvents } from "./db";
import { createHttpClient, type HttpClient } from "./http";
import { livewhaleModule } from "./livewhale";
import type { Source } from "./sources";
import { isLikelyTruncated, type SweepWindow, sweepWindow } from "./sweep";
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
  try {
    const rawText = opts.fixturePath
      ? readFileSync(opts.fixturePath, "utf8")
      : (await client.get(mod.endpoint)).body;
    rows = mod.normalize(rawText);
  } catch (err) {
    const error = message(err);
    console.error(`[${mod.cliName}] error: ${error}`);
    if (!opts.dryRun) await tryRecordFailure(mod.source, startedAt, error);
    return { source: mod.source, status: "error", items: 0, canceled: 0, error };
  }

  const window = sweepWindow(rows);
  // A fetch at the requested max / server row cap is incomplete: the tail of
  // the window was cut off, so an absent event at the window's end boundary
  // proves nothing. Clamp the sweep to [start, end) and record the run as
  // partial instead of ok. Only meaningful for full-window feeds (mod.sweep).
  const truncated = mod.sweep && isLikelyTruncated(rows.length, mod.requestedMax ?? null);
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
