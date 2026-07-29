import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeAthletics } from "../src/athletics/normalize";
import { loadAthleticsVenues } from "../src/athletics/venues";
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

  it("marks the capped LiveWhale fixture partial — the fetch is incomplete", async () => {
    const mod = MODULES.livewhale;
    const result = await runSource(mod, { dryRun: true, fixturePath: fixturePath(mod) });
    expect(result.status).toBe("partial");
    expect(result.items).toBe(1000);
    expect(result.error).toBeNull();
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
