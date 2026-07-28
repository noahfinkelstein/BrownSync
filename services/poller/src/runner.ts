import { readFileSync } from "node:fs";
import type { SeedEvent } from "@brownsync/contract";
import { athleticsModule } from "./athletics";
import { bdhModule } from "./bdh";
import { cancelUnseen, connect, recordSourceRun, type Sql, upsertEvents } from "./db";
import { createHttpClient, type HttpClient } from "./http";
import { livewhaleModule } from "./livewhale";
import type { Source } from "./sources";
import { type SweepWindow, sweepWindow } from "./sweep";
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
  status: "ok" | "error";
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

  if (opts.dryRun) {
    for (const row of rows) {
      const { raw: _raw, ...printable } = row;
      console.log(JSON.stringify(printable));
    }
    printSummary(mod, rows, window, null);
    return { source: mod.source, status: "ok", items: rows.length, canceled: 0, error: null };
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
        window,
        rows.map((r) => r.source_id),
      );
    }
    await recordSourceRun(sql, {
      source: mod.source,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "ok",
      items_upserted: upserted,
      error: null,
    });
    printSummary(mod, rows, window, canceled);
    return { source: mod.source, status: "ok", items: upserted, canceled, error: null };
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
