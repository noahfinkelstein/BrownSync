import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAthletics } from "../src/athletics/normalize";
import { loadAthleticsVenues } from "../src/athletics/venues";
import { normalizeLivewhaleFeed } from "../src/livewhale/normalize";
import { fetchShards } from "../src/livewhale/shard";
import { FIXTURES_DIR } from "../src/paths";
import { MODULES, runSource } from "../src/runner";
import type { SourceModule } from "../src/types";

function fixturePath(mod: SourceModule): string {
  return path.join(FIXTURES_DIR, mod.defaultFixture);
}

/** Fixture replays never fetch; dry-run never touches a database. */
describe("runSource (dry-run over recorded fixtures)", () => {
  beforeEach(() => {
    // Dry-run prints one NDJSON line per row plus a summary — keep tests quiet.
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("marks the sharded LiveWhale replay ok — bounded windows prove completeness", async () => {
    // This is the regression guard for the whole sharding fix. Before it,
    // LiveWhale could NEVER report ok: one unbounded fetch always came back at
    // the server's 1000-row cap, so `partial` was structural, `last_ok_at`
    // stayed null and the primary source's health dot was unreachable.
    //
    // The replay plan (fixtures/livewhale-shards.json) starts with the real
    // recorded at-cap response, which must be halved and refetched; both
    // halves come back under the cap, so nothing bottoms out at the one-day
    // floor and the run is genuinely complete.
    const mod = MODULES.livewhale;
    const result = await runSource(mod, { dryRun: true, fixturePath: fixturePath(mod) });
    expect(result.status).toBe("ok");
    // 150 + 150 rows sharing 10 source_ids across the two halves.
    expect(result.items).toBe(290);
    expect(result.error).toBeNull();
  });

  it("still marks a sharded run partial when a one-day window stays at the cap", async () => {
    // Same module, a replay plan where every window answers at the cap: the
    // planner narrows to single days and then has to admit truncation.
    const mod: SourceModule = {
      ...MODULES.livewhale,
      fetchPlan: (fetchWindow) =>
        fetchShards(fetchWindow, (rawText) => normalizeLivewhaleFeed(rawText, new Map()), {
          // The recorded 150-row shard stands in for "at cap" so this stays a
          // three-fetch test; what is under examination is the recursion
          // floor, not the cap's numeric value.
          cap: 150,
          windowDays: 2,
          lookbackDays: 0,
          lookaheadDays: 1,
        }),
    };
    const result = await runSource(mod, {
      dryRun: true,
      fixturePath: path.join(FIXTURES_DIR, "livewhale-shards-capped.json"),
    });
    expect(result.status).toBe("partial");
  });

  it("marks uncapped fixtures ok", async () => {
    for (const mod of [MODULES.athletics, MODULES.bdh]) {
      const result = await runSource(mod, { dryRun: true, fixturePath: fixturePath(mod) });
      expect(result.status).toBe("ok");
      expect(result.items).toBeGreaterThan(0);
    }
  });

  it("marks athletics ok with the v1 venue sidecar present (ingestion-lane envelope)", async () => {
    // Same module, but the venue map loaded from the fixture mirror of the real
    // ingestion-emitted db/seeds/athletics_venues.json — pins the run against
    // BOTH sidecar worlds: absent (test above) and present-with-v1-content.
    const venues = loadAthleticsVenues(path.join(FIXTURES_DIR, "athletics_venues.json"));
    expect(venues.size).toBe(11);
    const mod: SourceModule = {
      ...MODULES.athletics,
      normalize: (rawText) => normalizeAthletics(rawText, venues),
    };
    const result = await runSource(mod, { dryRun: true, fixturePath: fixturePath(mod) });
    expect(result.status).toBe("ok");
    expect(result.items).toBe(170);
    expect(result.error).toBeNull();
  });
});
