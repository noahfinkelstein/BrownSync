import type { SeedSourceRun } from "@brownsync/contract";
import { describe, expect, it, vi } from "vitest";
import { BACKOFF_CAP_SECONDS } from "../src/schedule/dispatch";
import {
  type DispatcherStore,
  type RegistryRow,
  runDispatchTick,
  type SourceRunner,
} from "../src/scheduled";

/**
 * Orchestration tests over an injected fake store — CI never touches a live
 * server. What the SQL store must guarantee (the claim UPDATE's atomic
 * re-check, the failure counter) is proven in
 * db/checks/0008_dispatcher_checks.sql against the disposable container.
 */

const NOW = new Date("2026-08-07T12:00:00Z");

function registryRow(overrides: Partial<RegistryRow> & { source: string }): RegistryRow {
  return {
    lane: "worker",
    enabled: true,
    cadence_seconds: 600,
    etiquette_min_interval_seconds: 1,
    consecutive_failures: 0,
    last_started_at: null,
    backoff_until: null,
    ...overrides,
  };
}

type FakeStore = DispatcherStore & {
  runs: SeedSourceRun[];
  claims: string[];
  successes: Array<{ source: string; okAt: string | null }>;
  bumps: string[];
  backoffs: Array<{ source: string; untilIso: string }>;
};

function fakeStore(
  rows: RegistryRow[],
  opts: {
    /** Per-source claim answers; default: every claim wins. */
    claimWins?: (source: string) => boolean;
    /** Simulate a source_runs INSERT failing. */
    recordThrows?: boolean;
    /** consecutive_failures value bumpFailures reports. */
    failuresAfterBump?: number;
  } = {},
): FakeStore {
  const store: FakeStore = {
    runs: [],
    claims: [],
    successes: [],
    bumps: [],
    backoffs: [],
    loadRegistry: async () => rows,
    claim: async (source) => {
      store.claims.push(source);
      return opts.claimWins?.(source) ?? true;
    },
    recordRun: async (run) => {
      if (opts.recordThrows) throw new Error("source_runs insert failed");
      store.runs.push(run);
    },
    markSuccess: async (source, okAt) => {
      store.successes.push({ source, okAt });
    },
    bumpFailures: async (source) => {
      store.bumps.push(source);
      return opts.failuresAfterBump ?? 1;
    },
    setBackoff: async (source, untilIso) => {
      store.backoffs.push({ source, untilIso });
    },
  };
  return store;
}

const okRunner: SourceRunner = async () => ({ status: "ok", items: 42, error: null });

describe("runDispatchTick", () => {
  it("runs each due source once and records one ok source_runs row each", async () => {
    const store = fakeStore([registryRow({ source: "livewhale" })]);
    const outcomes = await runDispatchTick(store, { livewhale: okRunner }, { now: () => NOW });

    expect(outcomes).toEqual([{ source: "livewhale", status: "ok", items: 42, error: null }]);
    expect(store.runs).toEqual([
      {
        source: "livewhale",
        started_at: NOW.toISOString(),
        finished_at: NOW.toISOString(),
        status: "ok",
        items_upserted: 42,
        error: null,
      },
    ]);
    expect(store.successes).toEqual([{ source: "livewhale", okAt: NOW.toISOString() }]);
    expect(store.bumps).toEqual([]);
    expect(store.backoffs).toEqual([]);
  });

  it("never claims a registered source it has no runner for", async () => {
    // bpr is registered, enabled and overdue — but its producer has not
    // landed. Claiming it would stamp last_started_at for a run that never
    // happened; it must be invisible to this dispatcher instead.
    const store = fakeStore([
      registryRow({ source: "bpr", cadence_seconds: 1800 }),
      registryRow({ source: "livewhale" }),
    ]);
    const outcomes = await runDispatchTick(store, { livewhale: okRunner }, { now: () => NOW });

    expect(outcomes.map((o) => o.source)).toEqual(["livewhale"]);
    expect(store.claims).toEqual(["livewhale"]);
  });

  it("a lost claim is recorded as skipped, runs nothing and touches no registry state", async () => {
    // Worker cron is not exactly-once: the overlapping tick that lost the
    // conditional UPDATE must not double-run or double-record the source.
    const runner = vi.fn(okRunner);
    const store = fakeStore([registryRow({ source: "livewhale" })], { claimWins: () => false });
    const outcomes = await runDispatchTick(store, { livewhale: runner }, { now: () => NOW });

    expect(outcomes).toEqual([{ source: "livewhale", status: "skipped", items: 0, error: null }]);
    expect(runner).not.toHaveBeenCalled();
    expect(store.runs).toEqual([]);
    expect(store.successes).toEqual([]);
    expect(store.backoffs).toEqual([]);
  });

  it("a partial run still records, clears backoff, but does not advance last_ok_at", async () => {
    const partialRunner: SourceRunner = async () => ({ status: "partial", items: 7, error: null });
    const store = fakeStore([registryRow({ source: "livewhale" })]);
    await runDispatchTick(store, { livewhale: partialRunner }, { now: () => NOW });

    expect(store.runs[0]?.status).toBe("partial");
    expect(store.successes).toEqual([{ source: "livewhale", okAt: null }]);
    expect(store.bumps).toEqual([]);
  });

  it("a failed run records an error row and backs off with bounded full jitter", async () => {
    const failingRunner: SourceRunner = async () => ({
      status: "error",
      items: 0,
      error: "GET https://events.brown.edu -> 503",
    });
    const store = fakeStore([registryRow({ source: "livewhale", cadence_seconds: 600 })], {
      failuresAfterBump: 2,
    });
    await runDispatchTick(
      store,
      { livewhale: failingRunner },
      { now: () => NOW, random: () => 0.5 },
    );

    expect(store.runs).toEqual([
      {
        source: "livewhale",
        started_at: NOW.toISOString(),
        finished_at: NOW.toISOString(),
        status: "error",
        items_upserted: 0,
        error: "GET https://events.brown.edu -> 503",
      },
    ]);
    expect(store.bumps).toEqual(["livewhale"]);
    // failures=2 → cap 600·2² = 2400 s; random 0.5 → 1200 s after the finish.
    expect(store.backoffs).toEqual([
      { source: "livewhale", untilIso: new Date(NOW.getTime() + 1200_000).toISOString() },
    ]);
    expect(store.successes).toEqual([]);
  });

  it("a runner that THROWS is contained: error row recorded, backoff applied, next source runs", async () => {
    const store = fakeStore(
      [
        registryRow({ source: "dedup", lane: "sql", cadence_seconds: 900 }),
        registryRow({ source: "livewhale" }),
      ],
      { failuresAfterBump: 1 },
    );
    const outcomes = await runDispatchTick(
      store,
      {
        dedup: async () => {
          throw new Error("relation events does not exist");
        },
        livewhale: okRunner,
      },
      { now: () => NOW, random: () => 1 },
    );

    expect(outcomes).toEqual([
      { source: "dedup", status: "error", items: 0, error: "relation events does not exist" },
      { source: "livewhale", status: "ok", items: 42, error: null },
    ]);
    expect(store.runs.map((r) => [r.source, r.status])).toEqual([
      ["dedup", "error"],
      ["livewhale", "ok"],
    ]);
    const until = Date.parse(store.backoffs[0]?.untilIso ?? "");
    expect(until).toBeGreaterThanOrEqual(NOW.getTime());
    expect(until).toBeLessThanOrEqual(NOW.getTime() + BACKOFF_CAP_SECONDS * 1000);
  });

  it("dispatches lane 'sql' (dedup) alongside lane 'worker' on one tick", async () => {
    const dedupRunner = vi.fn<SourceRunner>(async () => ({ status: "ok", items: 3, error: null }));
    const store = fakeStore([
      registryRow({ source: "dedup", lane: "sql", cadence_seconds: 900 }),
      registryRow({ source: "livewhale" }),
    ]);
    const outcomes = await runDispatchTick(
      store,
      { dedup: dedupRunner, livewhale: okRunner },
      { now: () => NOW },
    );

    expect(outcomes.map((o) => o.source).sort()).toEqual(["dedup", "livewhale"]);
    expect(dedupRunner).toHaveBeenCalledTimes(1);
  });

  it("honors the per-tick limit through due()", async () => {
    const runner = vi.fn(okRunner);
    const store = fakeStore([
      registryRow({ source: "a" }),
      registryRow({ source: "b" }),
      registryRow({ source: "c" }),
      registryRow({ source: "d" }),
    ]);
    const outcomes = await runDispatchTick(
      store,
      { a: runner, b: runner, c: runner, d: runner },
      { now: () => NOW },
    );

    expect(outcomes).toHaveLength(3);
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it("a failing source_runs INSERT does not stop backoff bookkeeping or later sources", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const store = fakeStore(
        [registryRow({ source: "dedup", lane: "sql" }), registryRow({ source: "livewhale" })],
        { recordThrows: true },
      );
      const outcomes = await runDispatchTick(
        store,
        {
          dedup: async () => ({ status: "error", items: 0, error: "boom" }),
          livewhale: okRunner,
        },
        { now: () => NOW, random: () => 0 },
      );

      expect(outcomes.map((o) => o.source)).toEqual(["dedup", "livewhale"]);
      // Recording failed, but the registry still learned about the failure…
      expect(store.bumps).toEqual(["dedup"]);
      expect(store.backoffs).toHaveLength(1);
      // …and the healthy source still ran and was marked successful.
      expect(store.successes).toEqual([{ source: "livewhale", okAt: NOW.toISOString() }]);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("skips sources the registry has disabled or suppressed, without claiming them", async () => {
    const store = fakeStore([
      registryRow({ source: "bdh", enabled: false }),
      registryRow({
        source: "livewhale",
        backoff_until: new Date(NOW.getTime() + 60_000),
      }),
    ]);
    const outcomes = await runDispatchTick(
      store,
      { bdh: okRunner, livewhale: okRunner },
      { now: () => NOW },
    );

    expect(outcomes).toEqual([]);
    expect(store.claims).toEqual([]);
    expect(store.runs).toEqual([]);
  });
});
