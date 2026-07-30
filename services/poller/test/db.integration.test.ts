import { type SeedEvent, SeedEventSchema } from "@brownsync/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelUnseen, connect, recordSourceRun, type Sql, upsertEvents } from "../src/db";

/**
 * DATABASE_URL-gated integration tests for the DB layer's actual SQL —
 * skipped in plain `pnpm test` (no local database in dev), executed by CI's
 * `migrate` job against the migrated postgis service container (see
 * .github/workflows/ci.yml).
 */

const url = process.env.DATABASE_URL;

/** Dedicated source name so these rows never collide with fixture one-shots. */
const SOURCE = "itest-db-layer";

function ev(sourceId: string, startTs: string, title = sourceId): SeedEvent {
  return SeedEventSchema.parse({
    source: SOURCE,
    source_id: sourceId,
    title,
    start_ts: startTs,
  });
}

describe.skipIf(!url)("db layer against a real migrated database", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connect(url);
    // Test rows only — the never-delete rule is ingestion semantics, not test hygiene.
    await sql`delete from events where source = ${SOURCE}`;
    await sql`delete from source_runs where source = ${SOURCE}`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("upsertEvents inserts, then updates in place on (source, source_id)", async () => {
    const inserted = await upsertEvents(sql, [
      ev("upsert-a", "2026-08-01T18:00:00Z", "Original title"),
      ev("upsert-b", "2026-08-02T18:00:00Z"),
    ]);
    expect(inserted).toBe(2);

    const updated = await upsertEvents(sql, [ev("upsert-a", "2026-08-01T19:00:00Z", "New title")]);
    expect(updated).toBe(1);

    const rows = await sql<
      { source_id: string; title: string; start_ts: Date; refreshed: boolean }[]
    >`
      select source_id, title, start_ts, last_seen_at >= first_seen_at as refreshed
      from events where source = ${SOURCE} and source_id like 'upsert-%'
      order by source_id
    `;
    expect(rows.length).toBe(2); // conflict updated — no duplicate row
    expect(rows[0]?.title).toBe("New title");
    expect(rows[0]?.start_ts.toISOString()).toBe("2026-08-01T19:00:00.000Z");
    expect(rows[0]?.refreshed).toBe(true);
  });

  it("cancelUnseen flips only unseen in-window events and honors the truncation clamp", async () => {
    await upsertEvents(sql, [
      ev("sweep-seen", "2026-09-10T18:00:00Z"),
      ev("sweep-gone", "2026-09-11T18:00:00Z"),
      ev("sweep-boundary", "2026-09-30T00:00:00Z"),
      ev("sweep-outside", "2026-10-05T18:00:00Z"),
    ]);

    const canceled = await cancelUnseen(
      sql,
      SOURCE,
      // endExclusive = the truncated-fetch clamp: the boundary event must survive.
      { start: "2026-09-01T00:00:00Z", end: "2026-09-30T00:00:00Z", endExclusive: true },
      ["sweep-seen"],
    );
    expect(canceled).toBe(1);

    const flags = new Map(
      (
        await sql<{ source_id: string; is_canceled: boolean }[]>`
          select source_id, is_canceled from events
          where source = ${SOURCE} and source_id like 'sweep-%'
        `
      ).map((r) => [r.source_id, r.is_canceled]),
    );
    expect(flags.get("sweep-gone")).toBe(true); // unseen, in window
    expect(flags.get("sweep-seen")).toBe(false); // seen this run
    expect(flags.get("sweep-boundary")).toBe(false); // tied at clamped end — spared
    expect(flags.get("sweep-outside")).toBe(false); // never re-fetched
  });

  it("recordSourceRun lands one row per run, including failures", async () => {
    await recordSourceRun(sql, {
      source: SOURCE,
      started_at: "2026-07-28T12:00:00Z",
      finished_at: "2026-07-28T12:00:05Z",
      status: "partial",
      items_upserted: 1000,
      error: null,
    });
    await recordSourceRun(sql, {
      source: SOURCE,
      started_at: "2026-07-28T12:10:00Z",
      finished_at: null,
      status: "error",
      items_upserted: 0,
      error: "feed exploded",
    });

    const runs = await sql<
      { status: string; items_upserted: number | null; error: string | null }[]
    >`
      select status, items_upserted, error from source_runs
      where source = ${SOURCE} order by id
    `;
    expect(runs.length).toBe(2);
    expect(runs[0]).toMatchObject({ status: "partial", items_upserted: 1000, error: null });
    expect(runs[1]).toMatchObject({ status: "error", items_upserted: 0, error: "feed exploded" });
  });
});

/**
 * Place resolution through the upsert (migration 0007). This is the direct
 * regression guard for the bug that left /api/events serving 500 rows with
 * zero placeId: the poller emits `place_id: null`, and the old conflict clause
 * wrote that null straight over whatever the seed bundle had resolved.
 */
const PLACE_ID = "itest-poller-hall";

describe.skipIf(!url)("upsertEvents resolves and never un-resolves place_id", () => {
  let sql: Sql;

  const placeOf = async (sourceId: string): Promise<string | null> => {
    const rows = await sql<{ place_id: string | null }[]>`
      select place_id from events where source = ${SOURCE} and source_id = ${sourceId}`;
    return rows[0]?.place_id ?? null;
  };

  beforeAll(async () => {
    sql = connect(url);
    await sql`delete from events where source = ${SOURCE} and source_id like 'resolve-%'`;
    await sql`
      insert into places (id, name, aliases, kind, lat, lng)
      values (${PLACE_ID}, 'Itest Poller Hall', '{IPH}', 'academic', 41.8262, -71.4032)
      on conflict (id) do update set name = excluded.name, aliases = excluded.aliases`;
  });

  afterAll(async () => {
    await sql`delete from events where source = ${SOURCE} and source_id like 'resolve-%'`;
    await sql`delete from places where id = ${PLACE_ID}`;
    await sql?.end();
  });

  it("populates place_aliases from places by trigger, with no writer involvement", async () => {
    const rows = await sql<{ alias_norm: string }[]>`
      select alias_norm from place_aliases where place_id = ${PLACE_ID} order by alias_norm`;
    expect(rows.map((r) => r.alias_norm)).toEqual(["iph", "itest poller hall"]);
  });

  it("resolves location_raw the poller could not", async () => {
    await upsertEvents(sql, [
      SeedEventSchema.parse({
        source: SOURCE,
        source_id: "resolve-exact",
        title: "Resolved by name",
        start_ts: "2026-08-01T18:00:00Z",
        location_raw: "Itest Poller Hall",
      }),
      SeedEventSchema.parse({
        source: SOURCE,
        source_id: "resolve-room",
        title: "Resolved by alias prefix with a room",
        start_ts: "2026-08-01T19:00:00Z",
        location_raw: "IPH 101",
      }),
      SeedEventSchema.parse({
        source: SOURCE,
        source_id: "resolve-none",
        title: "Nothing grounds this",
        start_ts: "2026-08-01T20:00:00Z",
        location_raw: "zzzz qqqq xyxyx",
      }),
    ]);
    expect(await placeOf("resolve-exact")).toBe(PLACE_ID);
    expect(await placeOf("resolve-room")).toBe(PLACE_ID);
    // Fails closed: never guess below the threshold.
    expect(await placeOf("resolve-none")).toBeNull();
  });

  it("never overwrites an existing place_id with null — the actual bug", async () => {
    await sql`
      insert into events (source, source_id, title, start_ts, place_id)
      values (${SOURCE}, 'resolve-seeded', 'Seeded with a resolved place',
              '2026-08-02T18:00:00Z', ${PLACE_ID})`;

    // Exactly what the LiveWhale normalizer emits: place_id null, and a
    // location string the gazetteer cannot ground.
    await upsertEvents(sql, [
      SeedEventSchema.parse({
        source: SOURCE,
        source_id: "resolve-seeded",
        title: "Refreshed by the poller",
        start_ts: "2026-08-02T18:00:00Z",
        location_raw: "TBD",
      }),
    ]);
    expect(await placeOf("resolve-seeded")).toBe(PLACE_ID);
  });

  it("lets an explicit feed place_id win over both resolution and history", async () => {
    await upsertEvents(sql, [
      SeedEventSchema.parse({
        source: SOURCE,
        source_id: "resolve-explicit",
        title: "Carries its own place",
        start_ts: "2026-08-03T18:00:00Z",
        location_raw: "zzzz qqqq xyxyx",
        place_id: PLACE_ID,
      }),
    ]);
    expect(await placeOf("resolve-explicit")).toBe(PLACE_ID);
  });

  it("keeps resolving after the gazetteer grows a new alias", async () => {
    await upsertEvents(sql, [
      SeedEventSchema.parse({
        source: SOURCE,
        source_id: "resolve-grown",
        title: "Unresolvable until the alias exists",
        start_ts: "2026-08-04T18:00:00Z",
        location_raw: "Poller Annex",
      }),
    ]);
    expect(await placeOf("resolve-grown")).toBeNull();

    // Growing the alias set on `places` must reach the resolver with no
    // second code path — that is why place_aliases is trigger-maintained.
    await sql`
      update places set aliases = '{IPH,"Poller Annex"}' where id = ${PLACE_ID}`;
    await upsertEvents(sql, [
      SeedEventSchema.parse({
        source: SOURCE,
        source_id: "resolve-grown",
        title: "Unresolvable until the alias exists",
        start_ts: "2026-08-04T18:00:00Z",
        location_raw: "Poller Annex",
      }),
    ]);
    expect(await placeOf("resolve-grown")).toBe(PLACE_ID);
  });
});
