import { describe, expect, it } from "vitest";
import {
  aggregateStatus,
  effectiveStatus,
  latestOkAt,
  type SourceHealth,
  STALE_AFTER_MS,
  sourceLabel,
  statusWord,
} from "../src/ops/health-model";

const NOW = Date.parse("2026-07-28T12:00:00Z");

function source(overrides: Partial<SourceHealth>): SourceHealth {
  return {
    source: "livewhale",
    status: "ok",
    lastRunAt: new Date(NOW - 4 * 60_000).toISOString(),
    lastOkAt: new Date(NOW - 4 * 60_000).toISOString(),
    itemsUpserted: 100,
    error: null,
    ...overrides,
  };
}

describe("effectiveStatus", () => {
  it("passes fresh ok through", () => {
    expect(effectiveStatus(source({}), NOW)).toBe("ok");
  });

  it("maps error to error", () => {
    expect(effectiveStatus(source({ status: "error" }), NOW)).toBe("error");
  });

  it("maps partial and never to stale", () => {
    expect(effectiveStatus(source({ status: "partial" }), NOW)).toBe("stale");
    expect(effectiveStatus(source({ status: "never", lastOkAt: null }), NOW)).toBe("stale");
  });

  it("downgrades an old 'ok' to stale — a wedged poller must not stay green", () => {
    const old = new Date(NOW - STALE_AFTER_MS - 60_000).toISOString();
    expect(effectiveStatus(source({ lastOkAt: old }), NOW)).toBe("stale");
    const fresh = new Date(NOW - STALE_AFTER_MS + 60_000).toISOString();
    expect(effectiveStatus(source({ lastOkAt: fresh }), NOW)).toBe("ok");
  });

  it("treats ok-with-no-lastOk as stale", () => {
    expect(effectiveStatus(source({ lastOkAt: null }), NOW)).toBe("stale");
  });
});

describe("aggregateStatus", () => {
  it("returns the worst status across sources", () => {
    expect(aggregateStatus([source({}), source({ status: "partial" })], NOW)).toBe("stale");
    expect(
      aggregateStatus(
        [source({}), source({ status: "partial" }), source({ status: "error" })],
        NOW,
      ),
    ).toBe("error");
    expect(aggregateStatus([source({}), source({})], NOW)).toBe("ok");
    expect(aggregateStatus([], NOW)).toBe("ok");
  });
});

describe("per-source staleness thresholds (register §7)", () => {
  it("uses the wire staleAfterSeconds instead of the global window", () => {
    // Daily-cadence source (dining: 172800s): 2h old is FRESH even though it
    // is far past the 45-min global fallback.
    const twoHoursAgo = new Date(NOW - 2 * 60 * 60_000).toISOString();
    expect(
      effectiveStatus(source({ lastOkAt: twoHoursAgo, staleAfterSeconds: 172_800 }), NOW),
    ).toBe("ok");
    // …and past its own threshold it is stale.
    const threeDaysAgo = new Date(NOW - 3 * 86_400_000).toISOString();
    expect(
      effectiveStatus(source({ lastOkAt: threeDaysAgo, staleAfterSeconds: 172_800 }), NOW),
    ).toBe("stale");
  });

  it("falls back to STALE_AFTER_MS when the wire has no threshold", () => {
    const old = new Date(NOW - STALE_AFTER_MS - 60_000).toISOString();
    expect(effectiveStatus(source({ lastOkAt: old, staleAfterSeconds: null }), NOW)).toBe("stale");
  });
});

describe("paused sources (register §7)", () => {
  it("renders enabled=false as paused, never failure or stale", () => {
    expect(effectiveStatus(source({ enabled: false }), NOW)).toBe("paused");
    // Even a wire error on a disabled row reads paused — it was switched off.
    expect(effectiveStatus(source({ enabled: false, status: "error" }), NOW)).toBe("paused");
    expect(effectiveStatus(source({ enabled: false, status: "never", lastOkAt: null }), NOW)).toBe(
      "paused",
    );
    expect(statusWord(source({ enabled: false }), NOW)).toBe("paused");
  });

  it("never worsens the aggregate", () => {
    expect(aggregateStatus([source({}), source({ enabled: false, status: "error" })], NOW)).toBe(
      "ok",
    );
  });
});

describe("sourceLabel", () => {
  it("prefers the wire registry label when present", () => {
    expect(sourceLabel("livewhale", "Events (LiveWhale)")).toBe("Events (LiveWhale)");
    expect(sourceLabel("livewhale", null)).toBe("LiveWhale");
  });

  it("uses reader-facing names for known slugs", () => {
    expect(sourceLabel("livewhale")).toBe("LiveWhale");
    expect(sourceLabel("athletics_ics")).toBe("Athletics");
    expect(sourceLabel("bdh")).toBe("BDH");
  });

  it("title-cases unknown slugs", () => {
    expect(sourceLabel("dining_menus")).toBe("Dining Menus");
    expect(sourceLabel("shuttle")).toBe("Shuttle");
  });
});

describe("statusWord", () => {
  it("names the wire status, with time-based stale for aged ok", () => {
    expect(statusWord(source({}), NOW)).toBe("ok");
    expect(statusWord(source({ status: "partial" }), NOW)).toBe("partial");
    expect(statusWord(source({ status: "error" }), NOW)).toBe("failing");
    expect(statusWord(source({ status: "never", lastOkAt: null }), NOW)).toBe("never ran");
    const old = new Date(NOW - STALE_AFTER_MS - 60_000).toISOString();
    expect(statusWord(source({ lastOkAt: old }), NOW)).toBe("stale");
  });
});

describe("latestOkAt", () => {
  it("finds the most recent success across sources", () => {
    const older = new Date(NOW - 60 * 60_000).toISOString();
    const newer = new Date(NOW - 5 * 60_000).toISOString();
    expect(latestOkAt([source({ lastOkAt: older }), source({ lastOkAt: newer })])).toBe(newer);
    expect(latestOkAt([source({ lastOkAt: null })])).toBeNull();
    expect(latestOkAt([])).toBeNull();
  });
});
