import type { SeedEvent, SeedSourceRun } from "@brownsync/contract";
import postgres from "postgres";
import { type SweepWindow, selectCancellations, sweepWindow } from "./sweep";

/**
 * Upsert layer per contract §2:
 * - upsert on (source, source_id); refresh last_seen_at on every sighting
 * - never delete — cancellation sweep only flips is_canceled
 * - one source_runs row per run ALWAYS, including failures (runner.ts)
 *
 * Both lanes execute THIS implementation — the Node CLI (services/poller
 * re-exports it) and the Worker cron dispatcher (apps/api/src/scheduled.ts)
 * — so the upsert semantics cannot drift between them. Its SQL is executed
 * for real by CI's `migrate` job against the migrated postgis service
 * container, two ways: `pnpm poll all --fixture` (non-dry-run, twice) with
 * psql assertions in .github/workflows/ci.yml, and the DATABASE_URL-gated
 * tests in services/poller/test/db.integration.test.ts.
 */

export type Sql = ReturnType<typeof postgres>;

/** DATABASE_URL via globalThis — this package has no node types (see http.ts). */
function envDatabaseUrl(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.DATABASE_URL;
}

export function connect(url: string | undefined = envDatabaseUrl()): Sql {
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

/**
 * Upsert one batch of contract rows, resolving `location_raw` to a place
 * along the way (migration 0007).
 *
 * TWO THINGS ARE LOAD-BEARING HERE, both fixing the same live bug —
 * /api/events returning 500 rows with zero placeId:
 *
 *  1. `resolve_place()` is applied to the DISTINCT `location_raw` values of
 *     the batch, in a CTE — not per row. A sweep of 1000 events carries on
 *     the order of 200 distinct location strings, and the fuzzy stage is the
 *     expensive one, so resolving distinct values is a 5x reduction for free.
 *     The poller stays gazetteer-free: resolution is the database's job, and
 *     there is exactly one implementation of it.
 *
 *  2. The conflict clause never overwrites a resolved place with null.
 *     Precedence is: an explicit place_id from the feed or a sidecar, else
 *     this run's SQL resolution, else THE VALUE ALREADY IN THE ROW. The seed
 *     bundle's 229 resolved places used to be wiped on the first live refresh
 *     because the clause was a bare `place_id = excluded.place_id` and the
 *     LiveWhale normalizer emits null.
 *
 *     The spec for this reads `coalesce(excluded.place_id, resolved.place_id,
 *     events.place_id)`, but `resolved` is not in scope inside ON CONFLICT —
 *     only `excluded` and the target table are. Folding the resolution into
 *     the proposed row (below) and writing `coalesce(excluded.place_id,
 *     events.place_id)` is exactly equivalent, and is the only way it can be
 *     expressed.
 *
 * The batch travels as a single jsonb parameter unpacked by
 * `jsonb_to_recordset` rather than as a multi-row VALUES list, because the
 * CTE needs named, typed input columns to join the resolutions onto.
 */
export async function upsertEvents(sql: Sql, rows: readonly SeedEvent[]): Promise<number> {
  let upserted = 0;
  for (const chunk of chunks(rows, UPSERT_CHUNK)) {
    const payload = chunk.map((r) => ({
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
      raw: r.raw ?? null,
    }));
    const result = await sql`
      with input as (
        select * from jsonb_to_recordset(${sql.json(payload as never)}::jsonb) as x(
          source       text,
          source_id    text,
          title        text,
          description  text,
          start_ts     timestamptz,
          end_ts       timestamptz,
          is_all_day   boolean,
          rrule        text,
          location_raw text,
          place_id     text,
          lat          float8,
          lng          float8,
          org_id       text,
          category     text,
          tags         text[],
          url          text,
          cost         text,
          confidence   real,
          is_canceled  boolean,
          raw          jsonb
        )
      ),
      resolved as (
        select d.location_raw, rp.place_id
        from (
          select distinct i.location_raw
          from input i
          where i.location_raw is not null and i.place_id is null
        ) d
        cross join lateral resolve_place(d.location_raw) rp
      )
      insert into events (
        source, source_id, title, description, start_ts, end_ts, is_all_day,
        rrule, location_raw, place_id, lat, lng, org_id, category, tags,
        url, cost, confidence, is_canceled, raw
      )
      select
        i.source, i.source_id, i.title, i.description, i.start_ts, i.end_ts,
        i.is_all_day, i.rrule, i.location_raw,
        coalesce(i.place_id, r.place_id),
        i.lat, i.lng, i.org_id, i.category, coalesce(i.tags, '{}'::text[]),
        i.url, i.cost, i.confidence, i.is_canceled, i.raw
      from input i
      left join resolved r on r.location_raw = i.location_raw
      on conflict (source, source_id) do update set
        title        = excluded.title,
        description  = excluded.description,
        start_ts     = excluded.start_ts,
        end_ts       = excluded.end_ts,
        is_all_day   = excluded.is_all_day,
        rrule        = excluded.rrule,
        location_raw = excluded.location_raw,
        place_id     = coalesce(excluded.place_id, events.place_id),
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

/**
 * One `articles` row as a producer emits it (migration 0021). There is NO
 * description or body_text field here ON PURPOSE: the only current producer
 * (brown_news) is headline_only, and the upsert below never names those
 * columns, so a normalizer that starts carrying prose cannot get it into the
 * database through this path — and the table's CHECK constraints reject it
 * even if someone writes their own SQL.
 */
export type ArticleUpsertRow = {
  source: string;
  source_id: string;
  title: string;
  url: string;
  /** ISO-8601 UTC. */
  published_at: string;
  author: string | null;
  license: "headline_only" | "excerpt" | "full";
  /** Metadata allowlist only — the articles_raw_allowlist_ck CHECK enforces it. */
  raw: Record<string, unknown> | null;
};

/**
 * Upsert articles on (source, source_id), refreshing last_seen_at on every
 * sighting (contract §2). `is_removed` is deliberately NOT in the conflict
 * clause: soft removal is an operator decision and a story reappearing in a
 * listing must not silently resurrect it.
 */
export async function upsertArticles(sql: Sql, rows: readonly ArticleUpsertRow[]): Promise<number> {
  let upserted = 0;
  for (const chunk of chunks(rows, UPSERT_CHUNK)) {
    const payload = chunk.map((r) => ({
      source: r.source,
      source_id: r.source_id,
      title: r.title,
      url: r.url,
      published_at: r.published_at,
      author: r.author,
      license: r.license,
      raw: r.raw,
    }));
    const result = await sql`
      insert into articles (source, source_id, title, url, published_at, author, license, raw)
      select x.source, x.source_id, x.title, x.url, x.published_at, x.author, x.license, x.raw
      from jsonb_to_recordset(${sql.json(payload as never)}::jsonb) as x(
        source       text,
        source_id    text,
        title        text,
        url          text,
        published_at timestamptz,
        author       text,
        license      text,
        raw          jsonb
      )
      on conflict (source, source_id) do update set
        title        = excluded.title,
        url          = excluded.url,
        published_at = excluded.published_at,
        author       = excluded.author,
        license      = excluded.license,
        raw          = excluded.raw,
        last_seen_at = now()
    `;
    upserted += result.count;
  }
  return upserted;
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
