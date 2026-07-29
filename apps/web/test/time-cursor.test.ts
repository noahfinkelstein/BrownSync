import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTimeCursor,
  DEFAULT_WINDOW_AFTER_MS,
  DEFAULT_WINDOW_BEFORE_MS,
  FALLBACK_EVENT_DURATION_MS,
  floorToMinute,
  LIVE_TICK_MS,
} from "../src/time/cursor";
import { HOUR_MS, MINUTE_MS } from "../src/time/tz";

const T0 = new Date("2026-07-28T14:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("time cursor — live mode", () => {
  it("tracks the wall clock", () => {
    const store = createTimeCursor();
    expect(store.isLive).toBe(true);
    expect(store.now().getTime()).toBe(T0.getTime());

    vi.advanceTimersByTime(5 * MINUTE_MS);
    expect(store.now().getTime()).toBe(T0.getTime() + 5 * MINUTE_MS);
  });

  it("ticks subscribers every LIVE_TICK_MS while observed", () => {
    const store = createTimeCursor();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    vi.advanceTimersByTime(3 * LIVE_TICK_MS);
    expect(notified).toBe(3);
  });

  it("bumps version on every tick (useSyncExternalStore snapshot)", () => {
    const store = createTimeCursor();
    store.subscribe(() => {});
    const before = store.version();
    vi.advanceTimersByTime(LIVE_TICK_MS);
    expect(store.version()).toBe(before + 1);
  });

  it("runs no timer until someone subscribes, and stops after the last unsubscribe", () => {
    const store = createTimeCursor();
    expect(vi.getTimerCount()).toBe(0);

    const unsubA = store.subscribe(() => {});
    const unsubB = store.subscribe(() => {});
    expect(vi.getTimerCount()).toBe(1);

    unsubA();
    expect(vi.getTimerCount()).toBe(1);
    unsubB();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("respects an injected clock and tick cadence", () => {
    let ms = 1_000_000;
    const store = createTimeCursor({ clock: () => ms, tickMs: 1_000 });
    expect(store.now().getTime()).toBe(1_000_000);
    ms += 42;
    expect(store.now().getTime()).toBe(1_000_042);

    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    vi.advanceTimersByTime(3_000);
    expect(notified).toBe(3);
  });
});

describe("time cursor — scrubbing freezes", () => {
  it("setAt freezes now() while the wall clock keeps moving", () => {
    const store = createTimeCursor();
    const frozen = new Date("2026-07-28T21:30:00.000Z");
    store.setAt(frozen);

    expect(store.isLive).toBe(false);
    vi.advanceTimersByTime(2 * HOUR_MS);
    expect(store.now().getTime()).toBe(frozen.getTime());
    expect(store.liveNow().getTime()).toBe(T0.getTime() + 2 * HOUR_MS);
  });

  it("stops the live ticker while scrubbed — no notifications, no timers", () => {
    const store = createTimeCursor();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    store.setAt(new Date("2026-07-28T21:30:00.000Z"));
    expect(notified).toBe(1); // the scrub itself
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(10 * LIVE_TICK_MS);
    expect(notified).toBe(1);
  });

  it("notifies once per scrub and ignores no-op / invalid scrubs", () => {
    const store = createTimeCursor();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    const d = new Date("2026-07-28T21:30:00.000Z");
    store.setAt(d);
    store.setAt(new Date(d.getTime())); // same instant → no-op
    store.setAt(new Date(Number.NaN)); // invalid → ignored
    expect(notified).toBe(1);
    expect(store.now().getTime()).toBe(d.getTime());
  });

  it("setLive returns to the wall clock and resumes ticking", () => {
    const store = createTimeCursor();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    store.setAt(new Date("2026-07-28T21:30:00.000Z"));
    store.setLive();
    expect(store.isLive).toBe(true);
    expect(store.now().getTime()).toBe(T0.getTime());
    expect(notified).toBe(2);

    vi.advanceTimersByTime(LIVE_TICK_MS);
    expect(notified).toBe(3);
  });

  it("setLive while already live is a no-op", () => {
    const store = createTimeCursor();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.setLive();
    expect(notified).toBe(0);
  });
});

describe("time cursor — subscribe/unsubscribe", () => {
  it("stops notifying after unsubscribe; double-unsubscribe is safe", () => {
    const store = createTimeCursor();
    let a = 0;
    let b = 0;
    const unsubA = store.subscribe(() => {
      a += 1;
    });
    store.subscribe(() => {
      b += 1;
    });

    store.setAt(new Date("2026-07-28T15:00:00.000Z"));
    expect(a).toBe(1);
    expect(b).toBe(1);

    unsubA();
    unsubA();
    store.setLive();
    expect(a).toBe(1);
    expect(b).toBe(2);
  });
});

describe("time cursor — derived helpers", () => {
  it("windowAround defaults to 1 h back / 3 h forward of the cursor", () => {
    const store = createTimeCursor();
    const w = store.windowAround();
    expect(w.from.getTime()).toBe(T0.getTime() - DEFAULT_WINDOW_BEFORE_MS);
    expect(w.to.getTime()).toBe(T0.getTime() + DEFAULT_WINDOW_AFTER_MS);
  });

  it("windowAround accepts custom spans and follows the frozen cursor", () => {
    const store = createTimeCursor();
    const frozen = new Date("2026-07-28T21:00:00.000Z");
    store.setAt(frozen);
    const w = store.windowAround(30 * MINUTE_MS, 2 * HOUR_MS);
    expect(w.from.getTime()).toBe(frozen.getTime() - 30 * MINUTE_MS);
    expect(w.to.getTime()).toBe(frozen.getTime() + 2 * HOUR_MS);
  });

  it("isWithin covers [start, end] inclusive, accepting Date/string/number", () => {
    const store = createTimeCursor();
    store.setAt(new Date("2026-07-28T20:00:00.000Z"));

    expect(store.isWithin("2026-07-28T19:00:00Z", "2026-07-28T21:00:00Z")).toBe(true);
    expect(store.isWithin("2026-07-28T20:00:00Z", "2026-07-28T20:00:00Z")).toBe(true);
    expect(store.isWithin("2026-07-28T20:30:00Z", "2026-07-28T21:00:00Z")).toBe(false);
    expect(
      store.isWithin(new Date("2026-07-28T19:00:00Z"), Date.parse("2026-07-28T21:00:00Z")),
    ).toBe(true);
  });

  it("isWithin treats a null/omitted end as start + 1 h (contract §3 events)", () => {
    const store = createTimeCursor();
    store.setAt(new Date("2026-07-28T20:00:00.000Z"));

    expect(FALLBACK_EVENT_DURATION_MS).toBe(HOUR_MS);
    expect(store.isWithin("2026-07-28T19:30:00Z", null)).toBe(true);
    expect(store.isWithin("2026-07-28T19:30:00Z")).toBe(true);
    expect(store.isWithin("2026-07-28T18:30:00Z", null)).toBe(false);
  });

  it("isWithin rejects unparseable bounds instead of throwing", () => {
    const store = createTimeCursor();
    expect(store.isWithin("not a date")).toBe(false);
    expect(store.isWithin("2026-07-28T13:00:00Z", "garbage")).toBe(false);
  });
});

describe("floorToMinute", () => {
  it("quantizes to the start of the minute", () => {
    expect(floorToMinute(new Date("2026-07-28T19:04:59.999Z")).toISOString()).toBe(
      "2026-07-28T19:04:00.000Z",
    );
    expect(floorToMinute(Date.parse("2026-07-28T19:04:00.000Z")).toISOString()).toBe(
      "2026-07-28T19:04:00.000Z",
    );
  });

  it("floors (not truncates) for pre-1970 instants", () => {
    expect(floorToMinute(new Date("1969-12-31T23:59:30.000Z")).toISOString()).toBe(
      "1969-12-31T23:59:00.000Z",
    );
  });
});
