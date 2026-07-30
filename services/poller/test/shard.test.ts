import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  dateFromDayNumber,
  dayNumber,
  fetchShards,
  halveWindow,
  livewhaleWindowUrl,
  MIN_SHARD_DAYS,
  mergeShardRows,
  newYorkDate,
  planWindows,
  SHARD_LOOKAHEAD_DAYS,
  SHARD_LOOKBACK_DAYS,
  SHARD_WINDOW_DAYS,
  type Shard,
  shardsAreTruncated,
  windowDays,
} from "../src/livewhale";
import { normalizeLivewhaleFeed } from "../src/livewhale/normalize";
import { FIXTURES_DIR } from "../src/paths";
import { type DateWindow, SERVER_ROW_CAP, sweepWindowFromShards } from "../src/sweep";

const fixture = (name: string) => readFileSync(path.join(FIXTURES_DIR, name), "utf8");
const normalize = (rawText: string) => normalizeLivewhaleFeed(rawText, new Map());

/**
 * Hash pins for the recorded shard fixtures. A recorded response that changes
 * silently would turn every assertion below into a tautology, so the bytes
 * themselves are the fixture.
 */
const FIXTURE_SHA256: Record<string, string> = {
  "livewhale-events.json": "ece44446d4cffb6ff2e6ed18bdfae398eb0d192d33ee29cf64638cc0b3431517",
  "livewhale-shard-a.json": "4ea04a872ec5ab9abdfa7ea8a8c6bc299e9ff435317b19898b9defd74d61afe9",
  "livewhale-shard-b.json": "f319de864aacd84734dddbe1caea14e60f882931847fbdb28a66a17a4c5643c3",
  "livewhale-shard-empty.json": "37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570",
};

describe("shard fixtures are hash-pinned", () => {
  for (const [name, sha] of Object.entries(FIXTURE_SHA256)) {
    it(`${name} matches its recorded digest`, () => {
      const bytes = readFileSync(path.join(FIXTURES_DIR, name));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha);
    });
  }

  it("the replay plan lists the same digests", () => {
    const plan = JSON.parse(fixture("livewhale-shards.json")) as {
      responses: string[];
      default: string;
      sha256: Record<string, string>;
    };
    expect(plan.sha256).toEqual(FIXTURE_SHA256);
    for (const file of [...plan.responses, plan.default]) {
      expect(Object.keys(FIXTURE_SHA256)).toContain(file);
    }
  });
});

describe("planWindows", () => {
  const now = new Date("2026-07-29T16:00:00Z");

  it("covers [now - lookback, now + lookahead] with contiguous windows", () => {
    const windows = planWindows(now);
    expect(windows[0]?.start).toBe(
      dateFromDayNumber(dayNumber(newYorkDate(now)) - SHARD_LOOKBACK_DAYS),
    );
    expect(windows.at(-1)?.end).toBe(
      dateFromDayNumber(dayNumber(newYorkDate(now)) + SHARD_LOOKAHEAD_DAYS),
    );
    // Contiguous and non-overlapping: the union is exactly the requested span,
    // which is what the cancellation sweep will claim to have covered.
    for (let i = 1; i < windows.length; i++) {
      const prev = windows[i - 1] as DateWindow;
      const cur = windows[i] as DateWindow;
      expect(dayNumber(cur.start)).toBe(dayNumber(prev.end) + 1);
    }
  });

  it("uses full-width windows except for a clipped tail", () => {
    const windows = planWindows(now);
    for (const w of windows.slice(0, -1)) expect(windowDays(w)).toBe(SHARD_WINDOW_DAYS);
    expect(windowDays(windows.at(-1) as DateWindow)).toBeLessThanOrEqual(SHARD_WINDOW_DAYS);
  });

  it("keeps the request budget small — ~14 windows for six months", () => {
    expect(planWindows(now).length).toBeLessThanOrEqual(15);
  });

  it("anchors on the publisher's local day, not UTC", () => {
    // 2026-07-30T02:00Z is still 2026-07-29 in America/New_York.
    expect(newYorkDate(new Date("2026-07-30T02:00:00Z"))).toBe("2026-07-29");
    expect(newYorkDate(new Date("2026-07-30T05:00:00Z"))).toBe("2026-07-30");
  });
});

describe("halveWindow", () => {
  it("splits a 14-day window into 7 + 7", () => {
    const halves = halveWindow({ start: "2026-08-01", end: "2026-08-14" });
    expect(halves).toEqual([
      { start: "2026-08-01", end: "2026-08-07" },
      { start: "2026-08-08", end: "2026-08-14" },
    ]);
  });

  it("splits an odd window with the extra day in the first half", () => {
    expect(halveWindow({ start: "2026-08-01", end: "2026-08-07" })).toEqual([
      { start: "2026-08-01", end: "2026-08-04" },
      { start: "2026-08-05", end: "2026-08-07" },
    ]);
  });

  it("refuses to split below the one-day floor", () => {
    expect(halveWindow({ start: "2026-08-01", end: "2026-08-01" })).toBeNull();
    expect(windowDays({ start: "2026-08-01", end: "2026-08-01" })).toBe(MIN_SHARD_DAYS);
  });

  it("never loses or duplicates a day", () => {
    const window = { start: "2026-08-01", end: "2026-08-14" };
    const [a, b] = halveWindow(window) as [DateWindow, DateWindow];
    expect(windowDays(a) + windowDays(b)).toBe(windowDays(window));
    expect(dayNumber(b.start)).toBe(dayNumber(a.end) + 1);
  });
});

describe("fetchShards", () => {
  const now = new Date("2026-07-29T16:00:00Z");

  it("accepts an under-cap window without refetching it", async () => {
    const asked: DateWindow[] = [];
    const shards = await fetchShards(
      async (w) => {
        asked.push(w);
        return fixture("livewhale-shard-a.json");
      },
      normalize,
      { now },
    );
    expect(asked).toEqual(planWindows(now));
    expect(shards).toHaveLength(asked.length);
    expect(shardsAreTruncated(shards)).toBe(false);
  });

  it("halves and refetches a window that comes back at the server cap", async () => {
    const asked: DateWindow[] = [];
    const shards = await fetchShards(
      async (w) => {
        asked.push(w);
        // Only the very first window is at the cap.
        return asked.length === 1
          ? fixture("livewhale-events.json")
          : fixture("livewhale-shard-empty.json");
      },
      normalize,
      { now },
    );
    const plan = planWindows(now);
    const [first] = plan as [DateWindow, ...DateWindow[]];
    const halves = halveWindow(first) as [DateWindow, DateWindow];
    expect(asked.slice(0, 3)).toEqual([first, halves[0], halves[1]]);
    // The capped window is REPLACED by its halves, never counted alongside them.
    expect(shards.some((s) => s.window.start === first.start && s.window.end === first.end)).toBe(
      false,
    );
    expect(shardsAreTruncated(shards)).toBe(false);
  });

  it("reports partial only when a ONE-DAY window still hits the cap", async () => {
    // Everything comes back at the cap, so the planner must recurse all the
    // way down and then STOP, marking the single days truncated rather than
    // halving forever. `cap` is lowered to the recorded 150-row shard so this
    // stays a cheap three-fetch test — SERVER_ROW_CAP itself is exercised by
    // the halve-and-refetch case above, against the real at-cap response.
    const shards = await fetchShards(async () => fixture("livewhale-shard-a.json"), normalize, {
      now,
      cap: 150,
      windowDays: 2,
      lookbackDays: 0,
      lookaheadDays: 1,
    });
    expect(shards).toHaveLength(2);
    for (const s of shards) {
      expect(windowDays(s.window)).toBe(MIN_SHARD_DAYS);
      expect(s.truncated).toBe(true);
    }
    expect(shardsAreTruncated(shards)).toBe(true);
  });

  it("keeps an empty window as a real, non-truncated answer", async () => {
    const shards = await fetchShards(async () => fixture("livewhale-shard-empty.json"), normalize, {
      now,
      windowDays: 14,
      lookbackDays: 0,
      lookaheadDays: 13,
    });
    expect(shards).toHaveLength(1);
    expect(shards[0]?.rows).toEqual([]);
    expect(shards[0]?.truncated).toBe(false);
  });

  it("fetches windows strictly in sequence so per-host spacing applies", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await fetchShards(
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 0));
        inFlight--;
        return fixture("livewhale-shard-empty.json");
      },
      normalize,
      { now },
    );
    expect(maxInFlight).toBe(1);
  });
});

describe("mergeShardRows", () => {
  it("drops rows repeated across overlapping windows", () => {
    const a = normalize(fixture("livewhale-shard-a.json"));
    const b = normalize(fixture("livewhale-shard-b.json"));
    const shards: Shard[] = [
      { window: { start: "2026-08-01", end: "2026-08-07" }, rows: a, truncated: false },
      { window: { start: "2026-08-08", end: "2026-08-14" }, rows: b, truncated: false },
    ];
    const merged = mergeShardRows(shards);
    // The two recorded halves share exactly 10 source_ids.
    expect(a).toHaveLength(150);
    expect(b).toHaveLength(150);
    expect(merged).toHaveLength(290);
    expect(new Set(merged.map((r) => r.source_id)).size).toBe(merged.length);
  });

  it("keeps every occurrence of a repeating event", () => {
    // LiveWhale pre-expands a series into one row per occurrence, all sharing
    // one `id`. Deduping on the bare id — rather than on the ${id}:${date_ts}
    // source_id — would delete every occurrence after the first.
    const rows = normalize(fixture("livewhale-events.json"));
    const byLivewhaleId = new Map<string, number>();
    for (const r of rows) {
      const id = r.source_id.split(":")[0] as string;
      byLivewhaleId.set(id, (byLivewhaleId.get(id) ?? 0) + 1);
    }
    const repeating = [...byLivewhaleId.values()].filter((n) => n > 1);
    expect(repeating.length).toBeGreaterThan(0);

    const merged = mergeShardRows([
      { window: { start: "2026-07-28", end: "2026-08-10" }, rows, truncated: false },
      { window: { start: "2026-08-11", end: "2026-08-24" }, rows, truncated: false },
    ]);
    expect(merged).toHaveLength(rows.length);
    expect(merged.length).toBeGreaterThan(byLivewhaleId.size);
  });
});

describe("sweepWindowFromShards", () => {
  it("spans the union of the REQUESTED windows, not the returned rows", () => {
    const window = sweepWindowFromShards([
      { start: "2026-08-15", end: "2026-08-28" },
      { start: "2026-08-01", end: "2026-08-14" },
    ]);
    // America/New_York is UTC-4 in August: local midnight is 04:00Z, and the
    // exclusive end is local midnight on the day AFTER the last day.
    expect(window).toEqual({
      start: "2026-08-01T04:00:00Z",
      end: "2026-08-29T04:00:00Z",
      endExclusive: true,
    });
  });

  it("covers a fortnight that returned nothing — the bug sweepWindow cannot see", () => {
    const empty: DateWindow = { start: "2026-09-01", end: "2026-09-14" };
    const window = sweepWindowFromShards([empty]);
    expect(window).not.toBeNull();
    // A stored event inside a window the feed answered with zero rows is now
    // sweepable; with sweepWindow() there would have been no window at all.
    expect(window?.start).toBe("2026-09-01T04:00:00Z");
    expect(window?.end).toBe("2026-09-15T04:00:00Z");
  });

  it("uses the standard-time offset across the DST boundary", () => {
    const window = sweepWindowFromShards([{ start: "2026-12-01", end: "2026-12-14" }]);
    expect(window?.start).toBe("2026-12-01T05:00:00Z");
    expect(window?.end).toBe("2026-12-15T05:00:00Z");
  });

  it("is null for an empty plan and ignores unparseable dates", () => {
    expect(sweepWindowFromShards([])).toBeNull();
    expect(sweepWindowFromShards([{ start: "nope", end: "nope" }])).toBeNull();
  });
});

describe("livewhaleWindowUrl", () => {
  it("uses PATH SEGMENTS — query params are silently ignored by the server", () => {
    expect(livewhaleWindowUrl({ start: "2026-08-01", end: "2026-08-14" })).toBe(
      "https://events.brown.edu/live/json/events/start_date/2026-08-01/end_date/2026-08-14",
    );
  });

  it("adds no /max/ segment, so 'at cap' means the server's own cap", () => {
    expect(livewhaleWindowUrl({ start: "2026-08-01", end: "2026-08-14" })).not.toContain("/max/");
    expect(SERVER_ROW_CAP).toBe(1000);
  });
});
