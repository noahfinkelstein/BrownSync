import type { SeedEvent, SeedSourceRun } from "@brownsync/contract";
import postgres from "postgres";
import { type SweepWindow, selectCancellations, sweepWindow } from "./sweep";

/**
 * Upsert layer per contract §2:
 * - upsert on (source, source_id); refresh last_seen_at on every sighting
 * - never delete — cancellation sweep only flips is_canceled
 * - one source_runs row per run ALWAYS, including failures (runner.ts)
 *
 * There is no local database in dev; this module is exercised in CI against
 * the postgis service container and via `--dry-run` locally.
 */

export type Sql = ReturnType<typeof postgres>;

export function connect(url: string | undefined = process.env.DATABASE_URL): Sql {
  if (!url) {
    throw new Error("DATABASE_URL is not set — export it or use --dry-run (no DB needed)");
  }
  return postgres(url, { max: 4, onnotice: () => {} });
}

const UPSERT_CHUNK = 200;

function chunks<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function upsertEvents(sql: Sql, rows: readonly SeedEvent[]): Promise<number> {
  let upserted = 0;
  for (const chunk of chunks(rows, UPSERT_CHUNK)) {
    const values = chunk.map((r) => ({
      source: r.source,
      source_id: r.source_id,
      title: r.title,
      description: r.description ?? null,
      start_ts: r.start_ts,
      end_ts: r.end_ts ?? null,
      is_all_day: r.is_all_day,
      rrule: r.rrule ?? null,
      location_raw: r.location_raw ?? null,
      place_id: r.place_id ?? null,
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      org_id: r.org_id ?? null,
      category: r.category ?? null,
      tags: r.tags,
      url: r.url ?? null,
      cost: r.cost ?? null,
      confidence: r.confidence,
      is_canceled: r.is_canceled,
      raw: r.raw == null ? null : sql.json(r.raw as never),
    }));
    const result = await sql`
      insert into events ${sql(values)}
      on conflict (source, source_id) do update set
        title        = excluded.title,
        description  = excluded.description,
        start_ts     = excluded.start_ts,
        end_ts       = excluded.end_ts,
        is_all_day   = excluded.is_all_day,
        rrule        = excluded.rrule,
        location_raw = excluded.location_raw,
        place_id     = excluded.place_id,
        lat          = excluded.lat,
        lng          = excluded.lng,
        org_id       = excluded.org_id,
        category     = excluded.category,
        tags         = excluded.tags,
        url          = excluded.url,
        cost         = excluded.cost,
        confidence   = excluded.confidence,
        is_canceled  = excluded.is_canceled,
        raw          = excluded.raw,
        last_seen_at = now()
    `;
    upserted += result.count;
  }
  return upserted;
}

/**
 * Cancellation sweep (contract §2): after a successful FULL window fetch, mark
 * this source's events inside that window that were not seen this run as
 * is_canceled = true. Selection logic lives in sweep.ts (pure, unit-tested);
 * this function only does the I/O around it.
 */
export async function cancelUnseen(
  sql: Sql,
  source: string,
  window: SweepWindow,
  seenIds: readonly string[],
): Promise<number> {
  const existing = await sql<{ source_id: string; start_ts: Date }[]>`
    select source_id, start_ts
    from events
    where source = ${source} and is_canceled = false
  `;
  const toCancel = selectCancellations(
    existing.map((r) => ({ source_id: r.source_id, start_ts: r.start_ts.toISOString() })),
    new Set(seenIds),
    window,
  );
  if (toCancel.length === 0) return 0;
  const result = await sql`
    update events
    set is_canceled = true
    where source = ${source} and source_id = any(${sql.array(toCancel)})
  `;
  return result.count;
}

/** One row per run, always — including failed runs (ops dashboard + staleness). */
export async function recordSourceRun(sql: Sql, run: SeedSourceRun): Promise<void> {
  await sql`
    insert into source_runs ${sql({
      source: run.source,
      started_at: run.started_at,
      finished_at: run.finished_at ?? null,
      status: run.status,
      items_upserted: run.items_upserted ?? null,
      error: run.error ?? null,
    })}
  `;
}

export type { SweepWindow };
export { sweepWindow };
