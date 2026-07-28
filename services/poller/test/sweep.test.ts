import { describe, expect, it } from "vitest";
import { isInWindow, selectCancellations, sweepWindow } from "../src/sweep";

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
