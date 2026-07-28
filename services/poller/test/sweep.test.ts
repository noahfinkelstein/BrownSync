import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIVEWHALE_MAX } from "../src/livewhale";
import { normalizeLivewhaleFeed } from "../src/livewhale/normalize";
import { FIXTURES_DIR } from "../src/paths";
import {
  isInWindow,
  isLikelyTruncated,
  SERVER_ROW_CAP,
  selectCancellations,
  sweepWindow,
} from "../src/sweep";

describe("sweepWindow", () => {
  it("is the [min, max] start_ts of the fetched rows", () => {
    const window = sweepWindow([
      { start_ts: "2026-08-01T12:00:00Z" },
      { start_ts: "2026-07-28T04:00:00Z" },
      { start_ts: "2026-09-15T00:00:00Z" },
    ]);
    expect(window).toEqual({ start: "2026-07-28T04:00:00Z", end: "2026-09-15T00:00:00Z" });
  });

  it("is null for an empty fetch — an empty feed must never trigger a sweep", () => {
    expect(sweepWindow([])).toBeNull();
  });

  it("ignores unparseable timestamps", () => {
    expect(sweepWindow([{ start_ts: "garbage" }])).toBeNull();
    expect(sweepWindow([{ start_ts: "garbage" }, { start_ts: "2026-08-01T00:00:00Z" }])).toEqual({
      start: "2026-08-01T00:00:00Z",
      end: "2026-08-01T00:00:00Z",
    });
  });
});

describe("isInWindow", () => {
  const window = { start: "2026-08-01T00:00:00Z", end: "2026-08-31T00:00:00Z" };

  it("is inclusive at both bounds", () => {
    expect(isInWindow("2026-08-01T00:00:00Z", window)).toBe(true);
    expect(isInWindow("2026-08-31T00:00:00Z", window)).toBe(true);
    expect(isInWindow("2026-07-31T23:59:59Z", window)).toBe(false);
    expect(isInWindow("2026-08-31T00:00:01Z", window)).toBe(false);
  });

  it("excludes the end boundary when the window is clamped for truncation", () => {
    const clamped = { ...window, endExclusive: true };
    expect(isInWindow("2026-08-31T00:00:00Z", clamped)).toBe(false);
    expect(isInWindow("2026-08-30T23:59:59Z", clamped)).toBe(true);
    expect(isInWindow("2026-08-01T00:00:00Z", clamped)).toBe(true);
  });
});

describe("isLikelyTruncated", () => {
  it("flags fetches at or over the requested max", () => {
    expect(isLikelyTruncated(500, 500)).toBe(true);
    expect(isLikelyTruncated(1000, 500)).toBe(true);
    expect(isLikelyTruncated(499, 500)).toBe(false);
  });

  it("flags fetches at the observed server cap even without a requested max", () => {
    expect(isLikelyTruncated(SERVER_ROW_CAP, null)).toBe(true);
    expect(isLikelyTruncated(SERVER_ROW_CAP - 1, null)).toBe(false);
  });
});

describe("selectCancellations (contract §2)", () => {
  const window = { start: "2026-08-01T00:00:00Z", end: "2026-08-31T00:00:00Z" };
  const existing = [
    { source_id: "seen-in-window", start_ts: "2026-08-10T18:00:00Z" },
    { source_id: "gone-in-window", start_ts: "2026-08-12T18:00:00Z" },
    { source_id: "gone-before-window", start_ts: "2026-07-01T18:00:00Z" },
    { source_id: "gone-after-window", start_ts: "2026-09-20T18:00:00Z" },
  ];

  it("cancels only unseen events inside the fetched window", () => {
    const cancel = selectCancellations(existing, new Set(["seen-in-window"]), window);
    expect(cancel).toEqual(["gone-in-window"]);
  });

  it("never touches events outside the window — absence there proves nothing", () => {
    const cancel = selectCancellations(existing, new Set(), window);
    expect(cancel).toContain("gone-in-window");
    expect(cancel).toContain("seen-in-window");
    expect(cancel).not.toContain("gone-before-window");
    expect(cancel).not.toContain("gone-after-window");
  });

  it("cancels nothing when everything fetched is still present", () => {
    const seen = new Set(existing.map((e) => e.source_id));
    expect(selectCancellations(existing, seen, window)).toEqual([]);
  });
});

describe("truncation guard with the recorded fixture at the cap", () => {
  // The recorded response to ?max=500 is exactly 1000 rows — the server
  // ignored the requested max and capped the feed, cutting the window's tail.
  const fixtureText = readFileSync(path.join(FIXTURES_DIR, "livewhale-events.json"), "utf8");
  const rows = normalizeLivewhaleFeed(fixtureText, new Map());
  const seen = new Set(rows.map((r) => r.source_id));
  const window = sweepWindow(rows);
  if (!window) throw new Error("fixture produced no sweep window");

  it("detects the capped fetch as truncated", () => {
    expect(rows.length).toBe(SERVER_ROW_CAP);
    expect(isLikelyTruncated(rows.length, LIVEWHALE_MAX)).toBe(true);
  });

  it("never cancels an event tied at the window's end boundary", () => {
    // A stored event starting exactly at the last fetched start_ts, absent
    // from this run — plausibly cut off by the cap, NOT canceled.
    const boundary = { source_id: "boundary-event:1", start_ts: window.end };
    const clamped = { ...window, endExclusive: true };
    expect(selectCancellations([boundary], seen, clamped)).toEqual([]);
    // Without the guard the same event WOULD have been falsely canceled.
    expect(selectCancellations([boundary], seen, window)).toEqual(["boundary-event:1"]);
  });

  it("cancels nothing at all when every fetched row is still present", () => {
    const existing = rows.map((r) => ({ source_id: r.source_id, start_ts: r.start_ts }));
    const clamped = { ...window, endExclusive: true };
    expect(selectCancellations(existing, seen, clamped)).toEqual([]);
  });
});
