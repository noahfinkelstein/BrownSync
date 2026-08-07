import { describe, expect, it } from "vitest";
import {
  BACKOFF_CAP_SECONDS,
  backoffDelaySeconds,
  DISPATCH_LIMIT,
  type DispatchRow,
  due,
} from "../src/schedule/dispatch";

/**
 * Exhaustive offline coverage of the dispatcher's pure planning math — no
 * Worker, no DB (the SQL twin of the predicate is proven separately in
 * db/checks/0008_dispatcher_checks.sql against the disposable container).
 */

const NOW = new Date("2026-08-07T12:00:00Z");

function minutesBefore(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

function row(overrides: Partial<DispatchRow> & { source: string }): DispatchRow {
  return {
    lane: "worker",
    enabled: true,
    cadence_seconds: 600,
    last_started_at: null,
    backoff_until: null,
    ...overrides,
  };
}

describe("due — eligibility", () => {
  it("returns nothing for an empty registry", () => {
    expect(due([], NOW)).toEqual([]);
  });

  it("plans a never-run enabled worker source", () => {
    expect(due([row({ source: "livewhale" })], NOW)).toEqual(["livewhale"]);
  });

  it("excludes disabled rows even when otherwise due", () => {
    // The kill switch: `update source_registry set enabled=false` and the
    // dispatcher stops touching the source next tick — no deploy.
    expect(due([row({ source: "bdh", enabled: false })], NOW)).toEqual([]);
  });

  it.each(["actions", "ingest", "realtime", "blocked"])(
    "excludes lane %s — other runtimes own it",
    (lane) => {
      expect(due([row({ source: "athletics_ics", lane })], NOW)).toEqual([]);
    },
  );

  it("plans lane 'sql' — derived jobs (dedup) ride the same dispatcher (problem #6)", () => {
    expect(due([row({ source: "dedup", lane: "sql", cadence_seconds: 900 })], NOW)).toEqual([
      "dedup",
    ]);
  });

  it("excludes a source still inside its backoff window", () => {
    const backing = row({ source: "livewhale", backoff_until: minutesBefore(-5) });
    expect(due([backing], NOW)).toEqual([]);
  });

  it("includes a source whose backoff expires exactly now (<=, not <)", () => {
    expect(due([row({ source: "livewhale", backoff_until: NOW })], NOW)).toEqual(["livewhale"]);
  });

  it("includes a source whose backoff lies in the past", () => {
    expect(due([row({ source: "livewhale", backoff_until: minutesBefore(1) })], NOW)).toEqual([
      "livewhale",
    ]);
  });

  it("excludes a source whose cadence has not elapsed", () => {
    // cadence 600 s, started 5 min ago → next start is at the 10-min mark.
    expect(due([row({ source: "livewhale", last_started_at: minutesBefore(5) })], NOW)).toEqual([]);
  });

  it("includes a source exactly at its cadence boundary (<=, not <)", () => {
    expect(due([row({ source: "livewhale", last_started_at: minutesBefore(10) })], NOW)).toEqual([
      "livewhale",
    ]);
  });

  it("includes a source past its cadence", () => {
    expect(due([row({ source: "livewhale", last_started_at: minutesBefore(11) })], NOW)).toEqual([
      "livewhale",
    ]);
  });

  it("backoff suppresses even an overdue source — backoff wins over cadence", () => {
    const suppressed = row({
      source: "livewhale",
      last_started_at: minutesBefore(120),
      backoff_until: minutesBefore(-30),
    });
    expect(due([suppressed], NOW)).toEqual([]);
  });
});

describe("due — ordering and limit", () => {
  it("puts never-run sources first — a new source cannot starve", () => {
    const rows = [
      row({ source: "libcal", cadence_seconds: 3600, last_started_at: minutesBefore(90) }),
      row({ source: "bpr", last_started_at: null }),
    ];
    expect(due(rows, NOW)).toEqual(["bpr", "libcal"]);
  });

  it("orders run sources oldest-start first", () => {
    const rows = [
      row({ source: "a", last_started_at: minutesBefore(20) }),
      row({ source: "b", last_started_at: minutesBefore(60) }),
      row({ source: "c", last_started_at: minutesBefore(40) }),
    ];
    expect(due(rows, NOW)).toEqual(["b", "c", "a"]);
  });

  it("breaks ties on source name, so the plan is deterministic", () => {
    const started = minutesBefore(30);
    const rows = [
      row({ source: "zeta", last_started_at: started }),
      row({ source: "alpha", last_started_at: started }),
      row({ source: "beta", last_started_at: null }),
      row({ source: "aardvark", last_started_at: null }),
    ];
    expect(due(rows, NOW)).toEqual(["aardvark", "beta", "alpha"]);
  });

  it(`caps a tick at ${DISPATCH_LIMIT} sources, keeping the most-starved`, () => {
    const rows = [
      row({ source: "recent", last_started_at: minutesBefore(15) }),
      row({ source: "older", last_started_at: minutesBefore(45) }),
      row({ source: "oldest", last_started_at: minutesBefore(90) }),
      row({ source: "fresh", last_started_at: null }),
    ];
    expect(due(rows, NOW)).toEqual(["fresh", "oldest", "older"]);
  });

  it("an ineligible source does not consume a limit slot", () => {
    const rows = [
      row({ source: "suppressed", backoff_until: minutesBefore(-60) }),
      row({ source: "a", last_started_at: minutesBefore(20) }),
      row({ source: "b", last_started_at: minutesBefore(30) }),
      row({ source: "c", last_started_at: minutesBefore(40) }),
    ];
    expect(due(rows, NOW)).toEqual(["c", "b", "a"]);
  });

  it("does not mutate its input", () => {
    const rows = [
      row({ source: "b", last_started_at: minutesBefore(60) }),
      row({ source: "a", last_started_at: minutesBefore(20) }),
    ];
    const snapshot = rows.map((r) => r.source);
    due(rows, NOW);
    expect(rows.map((r) => r.source)).toEqual(snapshot);
  });
});

describe("backoffDelaySeconds", () => {
  it("doubles the cap with each consecutive failure (random pinned to 1)", () => {
    const one = () => 1;
    expect(backoffDelaySeconds(600, 1, one)).toBe(1200);
    expect(backoffDelaySeconds(600, 2, one)).toBe(2400);
    expect(backoffDelaySeconds(600, 3, one)).toBe(4800);
  });

  it("never exceeds the 6-hour ceiling", () => {
    const one = () => 1;
    expect(backoffDelaySeconds(600, 10, one)).toBe(BACKOFF_CAP_SECONDS);
    expect(backoffDelaySeconds(86_400, 1, one)).toBe(BACKOFF_CAP_SECONDS);
    // 2^1000 overflows to Infinity — the ceiling must still hold.
    expect(backoffDelaySeconds(600, 1000, one)).toBe(BACKOFF_CAP_SECONDS);
  });

  it("applies FULL jitter — uniform over [0, cap]", () => {
    expect(backoffDelaySeconds(600, 1, () => 0)).toBe(0);
    expect(backoffDelaySeconds(600, 1, () => 0.5)).toBe(600);
    for (let i = 0; i < 100; i++) {
      const delay = backoffDelaySeconds(900, 4, Math.random);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(900 * 2 ** 4);
    }
  });

  it("degenerate inputs produce no delay rather than NaN", () => {
    expect(backoffDelaySeconds(0, 3)).toBe(0);
    expect(backoffDelaySeconds(600, 0)).toBe(0);
    expect(backoffDelaySeconds(-1, 1)).toBe(0);
  });
});
