import { OrgLivewhaleGroupsSchema } from "@brownsync/contract";
import { cancelUnseen, type Sql, upsertEvents } from "@brownsync/sources/db";
import { runDedup } from "@brownsync/sources/dedup/index";
import {
  createHttpCore,
  createMemoryEtagCache,
  type EtagCache,
  type HttpClient,
} from "@brownsync/sources/http";
import {
  fetchShards,
  livewhaleWindowUrl,
  mergeShardRows,
  normalizeLivewhaleFeed,
  type OrgByGroup,
  orgGroupsFromSidecar,
  type ShardOptions,
  shardsAreTruncated,
} from "@brownsync/sources/livewhale/index";
import { sweepWindowFromShards } from "@brownsync/sources/sweep";
import orgGroupsSidecarJson from "../../../../db/seeds/organization_livewhale_groups.json";

/**
 * Worker-side source runners for the cron dispatcher (scheduled.ts). One
 * entry per source the WORKER can execute — registry rows without a runner
 * here are other lanes' work (athletics_ics/arcgis → Actions, passiogo →
 * Durable Object) or future producers (bpr/bjwa/ppl/dining/libcal land one
 * PR each, spec step 10) and are never claimed by this dispatcher.
 *
 * Each runner reuses the SAME normalize/upsert/dedup implementations as the
 * Node CLI via packages/sources, so the two lanes cannot drift. Runners do
 * NOT write source_runs — the orchestrator records exactly one row per run,
 * always, including failures (contract §2).
 */

export type RunnerResult = {
  /** "partial" = the fetch looked truncated (row cap) — see sources/sweep.ts. */
  status: "ok" | "partial" | "error";
  items: number;
  error: string | null;
};

/** One registry row, as scheduled.ts loads it. */
export type RegistryRow = {
  source: string;
  lane: string;
  enabled: boolean;
  cadence_seconds: number;
  etiquette_min_interval_seconds: number;
  consecutive_failures: number;
  last_started_at: Date | null;
  backoff_until: Date | null;
};

export type SourceRunner = (row: RegistryRow) => Promise<RunnerResult>;

/**
 * Per-host request spacing for one source's sweep: the registry's declared
 * etiquette floor, never faster than the global 1 req/s/host etiquette.
 */
export function etiquetteSpacingMs(row: Pick<RegistryRow, "etiquette_min_interval_seconds">) {
  return Math.max(1000, row.etiquette_min_interval_seconds * 1000);
}

/**
 * The org→group sidecar, bundled at build time (wrangler inlines the JSON —
 * there is no filesystem here; the Node CLI reads the same file with fs).
 * Parsed lazily and once per isolate: a malformed sidecar must fail the
 * livewhale RUN loudly (schema drift, same policy as the poller), not break
 * every fetch request in the Worker at module init.
 */
let cachedOrgGroups: OrgByGroup | null = null;
function bundledOrgGroups(): OrgByGroup {
  if (cachedOrgGroups === null) {
    cachedOrgGroups = orgGroupsFromSidecar(OrgLivewhaleGroupsSchema.parse(orgGroupsSidecarJson));
  }
  return cachedOrgGroups;
}

/**
 * ETag cache shared across cron ticks while the isolate stays warm, so
 * unchanged windows revalidate as 304s. A cold start just refetches.
 */
const isolateEtagCache: EtagCache = createMemoryEtagCache();

/** Injection seams so tests replay recorded fixtures with no network and no DB. */
export type RunnerDeps = {
  /** Replaces the polite HTTP client (fixture replay in tests). */
  http?: HttpClient;
  /** Replaces the DB writes (upsert + cancellation sweep) for offline tests. */
  persist?: {
    upsertEvents: (sql: Sql, rows: Parameters<typeof upsertEvents>[1]) => Promise<number>;
    cancelUnseen: (
      sql: Sql,
      source: string,
      window: Parameters<typeof cancelUnseen>[2],
      seenIds: readonly string[],
    ) => Promise<number>;
  };
  /** Replaces the dedup engine for offline tests. */
  dedup?: (sql: Sql) => ReturnType<typeof runDedup>;
  /** Narrows the window plan/cap so tests can replay the recorded capped plan. */
  shardOptions?: ShardOptions;
};

/**
 * LiveWhale, Worker lane — the same adaptive date-window sharding as
 * `pnpm poll livewhale` (sources/livewhale/shard.ts): windows fetched
 * strictly in sequence at the etiquette spacing, a window at the server cap
 * is halved, and the cancellation sweep covers the union of what was ASKED
 * FOR. `partial` only when a single-day window still hit the cap.
 *
 * EXPORTED BUT NOT REGISTERED in createWorkerRunners — deliberately. While
 * poll.yml's livewhale entry is still live, running this too would mean two
 * lanes racing the read-compute-write cancellation sweep with no lock: a
 * mid-sweep upsert from the other lane looks "unseen" to this one and gets
 * falsely canceled (self-healing next sweep, but user-visible flapping), and
 * the combined cadence would breach contract §5's own <=10-min etiquette
 * pledge. This runner is the tested template; it gets its registry entry in
 * the SAME release that retires poll.yml's livewhale entry, never alongside.
 */
export function createLivewhaleRunner(sql: Sql, deps: RunnerDeps = {}): SourceRunner {
  return async (row) => {
    const client =
      deps.http ??
      createHttpCore({ minSpacingMs: etiquetteSpacingMs(row), cache: isolateEtagCache });
    const normalize = (rawText: string) => normalizeLivewhaleFeed(rawText, bundledOrgGroups());
    const shards = await fetchShards(
      async (w) => (await client.get(livewhaleWindowUrl(w))).body,
      normalize,
      deps.shardOptions,
    );
    const rows = mergeShardRows(shards);
    const window = sweepWindowFromShards(shards.map((s) => s.window));
    const truncated = shardsAreTruncated(shards);

    const persist = deps.persist ?? { upsertEvents, cancelUnseen };
    const items = await persist.upsertEvents(sql, rows);
    if (window) {
      await persist.cancelUnseen(
        sql,
        "livewhale",
        truncated ? { ...window, endExclusive: true } : window,
        rows.map((r) => r.source_id),
      );
    }
    return { status: truncated ? "partial" : "ok", items, error: null };
  };
}

/**
 * Cross-source dedup, SQL lane (spec problem #6): the Actions rider used to
 * tie dedup's cadence to athletics', so moving athletics to 2 h would have
 * silently halved it. Here it runs on its own registry cadence (900 s,
 * migration 0018). Same engine as `pnpm poll dedup`; idempotent, so the
 * transitional overlap with poll.yml's cron is harmless.
 */
function createDedupRunner(sql: Sql, deps: RunnerDeps): SourceRunner {
  return async () => {
    const engine = deps.dedup ?? runDedup;
    const { summary } = await engine(sql);
    return { status: "ok", items: summary.marked, error: null };
  };
}

/**
 * Everything the Worker runs THIS release, keyed by registry source name.
 * The dispatcher ships with dedup (sql lane) as its first production source;
 * livewhale joins in the release that retires poll.yml's livewhale entry
 * (see createLivewhaleRunner's note on cancel-sweep flapping).
 */
export function createWorkerRunners(
  sql: Sql,
  deps: RunnerDeps = {},
): Readonly<Record<string, SourceRunner>> {
  return {
    dedup: createDedupRunner(sql, deps),
  };
}
