import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLiveCursorSource,
  getCursorSnapshot,
  getCursorSource,
  setCursorSource,
  subscribeCursor,
  type TimeCursorSource,
} from "../src/data/cursor";

/** A minimal lane-G-shaped source for seam tests. */
function fixedSource(at: Date): TimeCursorSource & { fire: () => void } {
  const listeners = new Set<() => void>();
  return {
    now: () => at,
    isLive: false,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    fire() {
      for (const cb of listeners) cb();
    },
  };
}

describe("time cursor seam (lane G contract)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    // Restore the default live source for other suites.
    setCursorSource(createLiveCursorSource());
    vi.useRealTimers();
  });

  it("defaults to a live source reporting wall-clock now", () => {
    const src = getCursorSource();
    expect(src.isLive).toBe(true);
    const before = Date.now();
    expect(src.now().getTime()).toBeGreaterThanOrEqual(before);
  });

  it("live source ticks subscribers on an interval, and stops when empty", () => {
    const src = createLiveCursorSource(1000);
    let ticks = 0;
    const off = src.subscribe(() => {
      ticks += 1;
    });
    vi.advanceTimersByTime(3100);
    expect(ticks).toBe(3);
    off();
    vi.advanceTimersByTime(3000);
    expect(ticks).toBe(3);
  });

  it("setCursorSource swaps the source and notifies outer subscribers", () => {
    const at = new Date("2026-10-01T22:38:00Z");
    const scrubbed = fixedSource(at);
    let notified = 0;
    const off = subscribeCursor(() => {
      notified += 1;
    });

    setCursorSource(scrubbed);
    expect(notified).toBe(1);
    expect(getCursorSnapshot().isLive).toBe(false);
    expect(getCursorSnapshot().now().toISOString()).toBe(at.toISOString());

    // Ticks of the NEW source propagate to outer subscribers.
    scrubbed.fire();
    expect(notified).toBe(2);
    off();
    scrubbed.fire();
    expect(notified).toBe(2);
  });

  it("snapshot version changes on every notification (useSyncExternalStore contract)", () => {
    const scrubbed = fixedSource(new Date("2026-10-01T22:38:00Z"));
    const off = subscribeCursor(() => {});
    const v1 = getCursorSnapshot().version;
    setCursorSource(scrubbed);
    const v2 = getCursorSnapshot().version;
    scrubbed.fire();
    const v3 = getCursorSnapshot().version;
    expect(v2).toBeGreaterThan(v1);
    expect(v3).toBeGreaterThan(v2);
    off();
  });
});
