import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SeedEvent } from "@brownsync/contract";
import { BROWN_NEWS_URL, MIN_LISTING_ITEMS } from "@brownsync/sources/brown_news/index";
import type { ArticleUpsertRow, Sql } from "@brownsync/sources/db";
import type { HttpClient } from "@brownsync/sources/http";
import { describe, expect, it } from "vitest";
import {
  createBrownNewsRunner,
  createLivewhaleRunner,
  createWorkerRunners,
  etiquetteSpacingMs,
  type RegistryRow,
  type RunnerDeps,
} from "../src/schedule/runners";

/**
 * Worker-side runners over the SAME recorded fixtures the poller pins its
 * sharding behaviour to (services/poller/fixtures/livewhale-shards*.json) —
 * no network, no DB. The replay plans are keyed by REQUEST ORDER on purpose;
 * see the note inside livewhale-shards.json.
 */

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../services/poller/fixtures",
);

type ShardFixturePlan = { responses: string[]; default: string };

/** HttpClient replaying a recorded shard plan, one body per request in order. */
function fixtureReplayClient(planFile: string): HttpClient & { requestedUrls: string[] } {
  const plan = JSON.parse(
    readFileSync(path.join(FIXTURES_DIR, planFile), "utf8"),
  ) as ShardFixturePlan;
  const requestedUrls: string[] = [];
  return {
    requestedUrls,
    get: async (url) => {
      const file = plan.responses[requestedUrls.length] ?? plan.default;
      requestedUrls.push(url);
      return {
        status: 200,
        body: readFileSync(path.join(FIXTURES_DIR, file), "utf8"),
        fromCache: false,
      };
    },
  };
}

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

/** The runners must never see a real connection in these tests. */
const noSql = new Proxy({} as Sql, {
  get(_target, property) {
    throw new Error(`unexpected database access in offline runner test (${String(property)})`);
  },
});

type PersistCalls = {
  upserts: SeedEvent[][];
  cancels: Array<{ source: string; window: unknown; seenIds: readonly string[] }>;
};

function fakePersist(): { persist: NonNullable<RunnerDeps["persist"]>; calls: PersistCalls } {
  const calls: PersistCalls = { upserts: [], cancels: [] };
  return {
    calls,
    persist: {
      upsertEvents: async (_sql, rows) => {
        calls.upserts.push([...rows]);
        return rows.length;
      },
      cancelUnseen: async (_sql, source, window, seenIds) => {
        calls.cancels.push({ source, window, seenIds });
        return 0;
      },
    },
  };
}

describe("livewhale worker runner (recorded shard replay)", () => {
  // NOTE: createLivewhaleRunner is exercised directly — it is deliberately
  // NOT in createWorkerRunners while poll.yml's livewhale entry is live (two
  // lanes racing the cancellation sweep flap cancellations; see runners.ts).
  // These tests are the template's proof for the migration release.
  it("shards, dedupes across windows, upserts and sweeps the REQUESTED union — status ok", async () => {
    const client = fixtureReplayClient("livewhale-shards.json");
    const { persist, calls } = fakePersist();
    const runner = createLivewhaleRunner(noSql, { http: client, persist });

    const result = await runner(registryRow({ source: "livewhale" }));

    // Same shape the poller's runner.test.ts pins: the at-cap first window is
    // halved, its halves carry 150 + 150 rows sharing 10 source_ids, every
    // other window is empty — 290 unique rows and a genuinely complete run.
    expect(result).toEqual({ status: "ok", items: 290, error: null });
    // 14 planned windows + 2 refetched halves of the at-cap first window.
    expect(client.requestedUrls).toHaveLength(16);
    for (const url of client.requestedUrls) {
      expect(url).toMatch(
        /^https:\/\/events\.brown\.edu\/live\/json\/events\/start_date\/\d{4}-\d{2}-\d{2}\/end_date\/\d{4}-\d{2}-\d{2}$/,
      );
    }

    const upserted = calls.upserts[0] ?? [];
    expect(upserted).toHaveLength(290);
    expect(new Set(upserted.map((r) => r.source_id)).size).toBe(290);

    // The cancellation sweep covers what was ASKED FOR (union of the shard
    // windows, exclusive end), not the span of what came back.
    expect(calls.cancels).toHaveLength(1);
    const cancel = calls.cancels[0];
    expect(cancel?.source).toBe("livewhale");
    expect(cancel?.seenIds).toHaveLength(290);
    const window = cancel?.window as { start: string; end: string; endExclusive?: boolean };
    expect(window.endExclusive).toBe(true);
    const spanDays = (Date.parse(window.end) - Date.parse(window.start)) / 86_400_000;
    // 7 days back + 180 forward, inclusive of the final local day.
    expect(spanDays).toBeGreaterThanOrEqual(187);
    expect(spanDays).toBeLessThanOrEqual(189);
  });

  it("reports partial when a one-day window still answers at the cap", async () => {
    const client = fixtureReplayClient("livewhale-shards-capped.json");
    const { persist } = fakePersist();
    const runner = createLivewhaleRunner(noSql, {
      http: client,
      persist,
      // Same narrowing as the poller's capped-replay test: the recorded
      // 150-row shard stands in for "at cap", so the recursion floor is what
      // is under examination, not the cap's numeric value.
      shardOptions: { cap: 150, windowDays: 2, lookbackDays: 0, lookaheadDays: 1 },
    });

    const result = await runner(registryRow({ source: "livewhale" }));
    expect(result?.status).toBe("partial");
    expect(result?.error).toBeNull();
  });
});

describe("createWorkerRunners — release gate", () => {
  it("ships brown_news + dedup; livewhale stays unregistered until poll.yml's entry is retired", () => {
    // Registering livewhale here while the Actions lane still sweeps it means
    // two unlocked read-compute-write cancellation sweeps racing each other —
    // false cancellations and a combined cadence past contract §5's <=10-min
    // pledge. This assertion is the gate: flipping it is the same release
    // that must edit poll.yml.
    //
    // brown_news is different and registers at birth: it has NO cross-lane
    // overlap (no Actions entry, no cancellation sweep to race) and its
    // registry row ships in the same release (migration 0021), so an
    // unregistered runner would just make the registry lie about what runs.
    const runners = createWorkerRunners(noSql);
    expect(Object.keys(runners).sort()).toEqual(["brown_news", "dedup"]);
  });
});

describe("brown_news worker runner (recorded listing replay)", () => {
  /** HttpClient serving one recorded body for every request, counting URLs. */
  function staticBodyClient(body: string): HttpClient & { requestedUrls: string[] } {
    const requestedUrls: string[] = [];
    return {
      requestedUrls,
      get: async (url) => {
        requestedUrls.push(url);
        return { status: 200, body, fromCache: false };
      },
    };
  }

  const recordedListing = readFileSync(path.join(FIXTURES_DIR, "brown-news-listing.html"), "utf8");

  function articlePersist() {
    const upserts: ArticleUpsertRow[][] = [];
    const persistArticles = async (_sql: Sql, rows: readonly ArticleUpsertRow[]) => {
      upserts.push([...rows]);
      return rows.length;
    };
    return { upserts, persistArticles };
  }

  it("parses the recorded listing and upserts headline+URL+date rows only — status ok", async () => {
    const client = staticBodyClient(recordedListing);
    const { upserts, persistArticles } = articlePersist();
    const runner = createBrownNewsRunner(noSql, { http: client, persistArticles });

    const result = await runner(registryRow({ source: "brown_news", cadence_seconds: 1800 }));

    // One polite request to the vetted endpoint, never a per-article fetch.
    expect(client.requestedUrls).toEqual([BROWN_NEWS_URL]);
    expect(result.status).toBe("ok");
    expect(result.error).toBeNull();

    const rows = upserts[0] ?? [];
    expect(result.items).toBe(rows.length);
    // The recorded 2026-08-07 listing carries 43 unique dateful items —
    // comfortably past the fail-closed floor.
    expect(rows.length).toBeGreaterThanOrEqual(MIN_LISTING_ITEMS);
    expect(rows).toHaveLength(43);
    expect(new Set(rows.map((r) => r.source_id)).size).toBe(rows.length);

    for (const row of rows) {
      expect(row.source).toBe("brown_news");
      expect(row.license).toBe("headline_only");
      expect(row.source_id).toMatch(/^\/news\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9\-_.]*$/);
      expect(row.url).toBe(`https://www.brown.edu${row.source_id}`);
      expect(row.published_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(row.author).toBeNull();
      // The headline anchor, not the "Read Article" chip that shares its href.
      expect(row.title.length).toBeGreaterThan("Read Article".length);
      expect(row.title).not.toMatch(/read article/i);
      // Provenance only in raw — the allowlist the DB CHECK also enforces.
      expect(Object.keys(row.raw ?? {})).toEqual(["listing_date"]);
      // HEADLINE-ONLY by construction: the row type has no body field at all.
      expect("description" in row).toBe(false);
      expect("body_text" in row).toBe(false);
    }
  });

  it("fails closed below the item floor: records partial and upserts NOTHING", async () => {
    // The recorded listing truncated to its first dateful anchors — the shape
    // selector drift actually produces (few matches, not an exception).
    const anchors = [...recordedListing.matchAll(/<a\b[^>]*href="\/news\/\d{4}-/g)];
    const cutAt = anchors[4]?.index ?? 0;
    expect(cutAt).toBeGreaterThan(0);
    const drifted = recordedListing.slice(0, cutAt);

    const client = staticBodyClient(drifted);
    const { upserts, persistArticles } = articlePersist();
    const runner = createBrownNewsRunner(noSql, { http: client, persistArticles });

    const result = await runner(registryRow({ source: "brown_news", cadence_seconds: 1800 }));

    expect(result.status).toBe("partial");
    expect(result.items).toBe(0);
    expect(result.error).toMatch(/fail-closed gate/);
    expect(result.error).toMatch(/nothing upserted/);
    // The gate's whole point: previous data stays untouched because no
    // persistence call is ever made.
    expect(upserts).toHaveLength(0);
  });
});

describe("dedup worker runner", () => {
  it("delegates to the shared engine and reports marked rows as items", async () => {
    let engineCalls = 0;
    const runners = createWorkerRunners(noSql, {
      dedup: async () => {
        engineCalls++;
        return { summary: { candidatePairs: 5, marked: 2, flattened: 0 }, assignments: [] };
      },
    });

    const result = await runners.dedup?.(
      registryRow({ source: "dedup", lane: "sql", cadence_seconds: 900 }),
    );
    expect(engineCalls).toBe(1);
    expect(result).toEqual({ status: "ok", items: 2, error: null });
  });
});

describe("etiquetteSpacingMs", () => {
  it("uses the registry's declared floor, never faster than 1 req/s/host", () => {
    expect(etiquetteSpacingMs({ etiquette_min_interval_seconds: 1 })).toBe(1000);
    expect(etiquetteSpacingMs({ etiquette_min_interval_seconds: 30 })).toBe(30_000);
    expect(etiquetteSpacingMs({ etiquette_min_interval_seconds: 0 })).toBe(1000);
  });
});
