import { type SeedEvent, SeedEventSchema } from "@brownsync/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, type Sql, upsertEvents } from "../src/db";
import { DEFAULT_DEDUP_CONFIG, type DedupConfig, runDedup, runDedupJob } from "../src/dedup";

/**
 * DATABASE_URL-gated integration tests for the dedup job's actual SQL —
 * skipped in plain `pnpm test` (no local database in dev), executed by CI's
 * `migrate` job against the migrated postgis service container (pg_trgm +
 * postgis + the 0002 view are all exercised for real).
 *
 * NOTE: runDedup scans the WHOLE events table (that is its job), so this test
 * uses dedicated itest-dedup-* sources and distinctive titles; assertions are
 * scoped to those rows only. Fixture titles share no vocabulary across
 * clusters — an unlocated row (no place, no coords) blocks against
 * everything in its time window by design, so title dissimilarity is what
 * keeps the clusters apart, exactly as in production.
 */

const url = process.env.DATABASE_URL;

const SRC_LW = "itest-dedup-lw";
const SRC_ICS = "itest-dedup-ics";
const SRC_BDH = "itest-dedup-bdh";
const SRC_OLD = "itest-dedup-old";

/** Same shape as production config, but ranked over the test's own sources. */
const CFG: DedupConfig = {
  ...DEFAULT_DEDUP_CONFIG,
  sourcePriority: [SRC_LW, SRC_ICS, SRC_BDH],
};

function ev(partial: Partial<SeedEvent> & { source: string; source_id: string }): SeedEvent {
  return SeedEventSchema.parse({
    title: partial.source_id,
    start_ts: "2026-10-10T18:00:00Z",
    ...partial,
  });
}

describe.skipIf(!url)("dedup job against a real migrated database", () => {
  let sql: Sql;

  const idOf = async (source: string, sourceId: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      select id from events where source = ${source} and source_id = ${sourceId}
    `;
    const id = rows[0]?.id;
    if (!id) throw new Error(`missing test event ${source}/${sourceId}`);
    return id;
  };

  const canonicalOf = async (source: string, sourceId: string): Promise<string | null> => {
    const rows = await sql<{ canonical_id: string | null }[]>`
      select canonical_id from events where source = ${source} and source_id = ${sourceId}
    `;
    return rows[0]?.canonical_id ?? null;
  };

  beforeAll(async () => {
    sql = connect(url);
    // Test rows only — the never-delete rule is ingestion semantics, not test hygiene.
    await sql`delete from events where source like 'itest-dedup-%'`;
    await sql`delete from source_runs where source = 'dedup'`;

    await upsertEvents(sql, [
      // ONE real-world game, three feeds. LiveWhale has coords; the ICS row
      // has nearby coords (~40 m) and a title variant; BDH has neither coords
      // nor place (buzz layer) — it blocks via the unlocated arm.
      ev({
        source: SRC_LW,
        source_id: "game",
        title: "Chk Dedup Men's Soccer vs. Yale",
        start_ts: "2026-10-10T18:00:00Z",
        lat: 41.8268,
        lng: -71.3987,
      }),
      ev({
        source: SRC_ICS,
        source_id: "game",
        title: "Chk Dedup Men's Soccer vs Yale University",
        start_ts: "2026-10-10T18:30:00Z",
        lat: 41.8265,
        lng: -71.3984,
      }),
      ev({
        source: SRC_BDH,
        source_id: "game",
        title: "Chk Dedup Men's Soccer vs. Yale",
        start_ts: "2026-10-10T18:15:00Z",
      }),
      // Decoy: same time + same coords as the game, dissimilar title.
      ev({
        source: SRC_ICS,
        source_id: "different-title",
        title: "Chk Dedup Volleyball Invitational Round Two",
        start_ts: "2026-10-10T18:00:00Z",
        lat: 41.8268,
        lng: -71.3987,
      }),
      // Decoy: same title + coords as the game, 5.5 h outside the time block.
      ev({
        source: SRC_ICS,
        source_id: "different-time",
        title: "Chk Dedup Men's Soccer vs. Yale",
        start_ts: "2026-10-10T23:30:00Z",
        lat: 41.8268,
        lng: -71.3987,
      }),
      // Coordinate blocking: same title + time, but ~5 km apart, and both
      // LOCATED (coords present) — so the unlocated arm cannot bridge them.
      ev({
        source: SRC_LW,
        source_id: "concert-near",
        title: "Chk Dedup Orchestra Autumn Concert",
        start_ts: "2026-10-10T19:00:00Z",
        lat: 41.8262,
        lng: -71.4032,
      }),
      ev({
        source: SRC_ICS,
        source_id: "concert-far",
        title: "Chk Dedup Orchestra Autumn Concert",
        start_ts: "2026-10-10T19:00:00Z",
        lat: 41.87,
        lng: -71.38,
      }),
      // Same-source twins: identical title/time/coords, but cross-source-only
      // dedup must never pair rows of one source (upsert key owns that).
      ev({
        source: SRC_LW,
        source_id: "improv-a",
        title: "Chk Dedup Improv Night at the Underground",
        start_ts: "2026-10-10T20:00:00Z",
        lat: 41.827,
        lng: -71.4029,
      }),
      ev({
        source: SRC_LW,
        source_id: "improv-b",
        title: "Chk Dedup Improv Night at the Underground",
        start_ts: "2026-10-10T20:00:00Z",
        lat: 41.827,
        lng: -71.4029,
      }),
      // Pre-existing duplicate from an "earlier run", re-parented below.
      ev({
        source: SRC_OLD,
        source_id: "stale-dup",
        title: "Chk Dedup Stale Duplicate Row",
        start_ts: "2026-10-10T18:00:00Z",
      }),
    ]);

    // OLD -> ICS game. When this run marks the ICS row itself a duplicate of
    // the LiveWhale row, OLD must be re-pointed (chain flattening).
    await sql`
      update events set canonical_id = ${await idOf(SRC_ICS, "game")}
      where source = ${SRC_OLD} and source_id = 'stale-dup'
    `;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("marks cross-source duplicates, never deletes, and picks canonical by priority", async () => {
    const before = (await sql`select count(*)::int as n from events`)[0]?.n as number;

    const { summary } = await runDedup(sql, CFG);

    const after = (await sql`select count(*)::int as n from events`)[0]?.n as number;
    expect(after).toBe(before); // never delete

    const lwId = await idOf(SRC_LW, "game");
    // ICS + BDH rows collapse onto the LiveWhale row (first in priority).
    expect(await canonicalOf(SRC_ICS, "game")).toBe(lwId);
    expect(await canonicalOf(SRC_BDH, "game")).toBe(lwId);
    expect(await canonicalOf(SRC_LW, "game")).toBeNull(); // canonical stays canonical
    expect(summary.marked).toBeGreaterThanOrEqual(2);
  });

  it("leaves decoys alone: wrong title, wrong time, wrong place, same source", async () => {
    expect(await canonicalOf(SRC_ICS, "different-title")).toBeNull();
    expect(await canonicalOf(SRC_ICS, "different-time")).toBeNull();
    expect(await canonicalOf(SRC_LW, "concert-near")).toBeNull();
    expect(await canonicalOf(SRC_ICS, "concert-far")).toBeNull();
    expect(await canonicalOf(SRC_LW, "improv-a")).toBeNull();
    expect(await canonicalOf(SRC_LW, "improv-b")).toBeNull();
  });

  it("re-points pre-existing duplicates when their canonical becomes a duplicate", async () => {
    const lwId = await idOf(SRC_LW, "game");
    expect(await canonicalOf(SRC_OLD, "stale-dup")).toBe(lwId);
    // Global invariant: no canonical_id may point at a non-canonical row.
    const chains = await sql<{ n: number }[]>`
      select count(*)::int as n
      from events d join events c on d.canonical_id = c.id
      where c.canonical_id is not null
    `;
    expect(chains[0]?.n).toBe(0);
  });

  it("exposes only canonical rows via v_events_api, with mergedSources", async () => {
    const lwId = await idOf(SRC_LW, "game");
    const view = await sql<{ id: string; merged_sources: string[] }[]>`
      select id, merged_sources from v_events_api where id = ${lwId}
    `;
    expect(view[0]?.merged_sources).toEqual([SRC_BDH, SRC_ICS, SRC_OLD].sort());
    const dupExposed = await sql<{ n: number }[]>`
      select count(*)::int as n from v_events_api
      where id = ${await idOf(SRC_ICS, "game")} or id = ${await idOf(SRC_BDH, "game")}
    `;
    expect(dupExposed[0]?.n).toBe(0);
  });

  it("is idempotent: a second run marks nothing new", async () => {
    const { summary } = await runDedup(sql, CFG);
    expect(summary.marked).toBe(0);
    expect(summary.flattened).toBe(0);
  });

  it("records a source_runs row per non-dry run (contract §2)", async () => {
    const result = await runDedupJob({ dryRun: false }, CFG);
    expect(result.status).toBe("ok");
    const runs = await sql<{ status: string; items_upserted: number | null }[]>`
      select status, items_upserted from source_runs where source = 'dedup' order by id
    `;
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.at(-1)).toMatchObject({ status: "ok", items_upserted: 0 });
  });

  it("dry-run plans assignments without writing", async () => {
    // Reset one duplicate back to canonical so a plan exists, then dry-run.
    await sql`
      update events set canonical_id = null
      where source = ${SRC_BDH} and source_id = 'game'
    `;
    const { summary, assignments } = await runDedup(sql, CFG, { dryRun: true });
    expect(summary.marked).toBeGreaterThanOrEqual(1);
    expect(assignments.some((a) => a.canonicalId !== a.duplicateId)).toBe(true);
    expect(await canonicalOf(SRC_BDH, "game")).toBeNull(); // nothing written
    // Re-apply for real so the table ends consistent.
    await runDedup(sql, CFG);
    expect(await canonicalOf(SRC_BDH, "game")).toBe(await idOf(SRC_LW, "game"));
  });
});
