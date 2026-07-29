import { describe, expect, it } from "vitest";
import { getPreset, tonightPreset, weekendPreset } from "../src/time/presets";
import { HOUR_MS } from "../src/time/tz";

describe("tonight", () => {
  it("spans 17:00 → 02:00 campus time with the cursor at 19:00", () => {
    // Tue Jul 28 2026, 10:00 EDT.
    const p = tonightPreset(new Date("2026-07-28T14:00:00Z"));
    expect(p.id).toBe("tonight");
    expect(p.label).toBe("tonight");
    expect(p.from.toISOString()).toBe("2026-07-28T21:00:00.000Z"); // 17:00 EDT
    expect(p.to.toISOString()).toBe("2026-07-29T06:00:00.000Z"); // 02:00 EDT next day
    expect(p.at.toISOString()).toBe("2026-07-28T23:00:00.000Z"); // 19:00 EDT
  });

  it("keeps the cursor at the current instant once the evening is underway", () => {
    // Tue Jul 28 2026, 20:30 EDT (00:30Z Jul 29 — still Jul 28 locally).
    const now = new Date("2026-07-29T00:30:00Z");
    const p = tonightPreset(now);
    expect(p.at.getTime()).toBe(now.getTime());
    expect(p.from.toISOString()).toBe("2026-07-28T21:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-07-29T06:00:00.000Z");
  });

  it("lands on prime time exactly at 19:00", () => {
    const now = new Date("2026-07-28T23:00:00Z");
    expect(tonightPreset(now).at.getTime()).toBe(now.getTime());
  });

  it("handles the spring-forward night: 02:00 does not exist, window ends before the gap", () => {
    // Sat Mar 7 2026, 15:00 EST. DST starts Mar 8 02:00 → to lands 01:00 EST.
    const p = tonightPreset(new Date("2026-03-07T20:00:00Z"));
    expect(p.from.toISOString()).toBe("2026-03-07T22:00:00.000Z"); // 17:00 EST
    expect(p.to.toISOString()).toBe("2026-03-08T06:00:00.000Z"); // 01:00 EST, pre-gap
    expect(p.at.toISOString()).toBe("2026-03-08T00:00:00.000Z"); // 19:00 EST
  });
});

describe("this weekend", () => {
  it("targets the upcoming Friday 17:00 → Monday 00:00 from a weekday", () => {
    // Tue Jul 28 2026.
    const p = weekendPreset(new Date("2026-07-28T14:00:00Z"));
    expect(p.id).toBe("weekend");
    expect(p.from.toISOString()).toBe("2026-07-31T21:00:00.000Z"); // Fri 17:00 EDT
    expect(p.to.toISOString()).toBe("2026-08-03T04:00:00.000Z"); // Mon 00:00 EDT
    expect(p.at.toISOString()).toBe("2026-07-31T23:00:00.000Z"); // Fri 19:00 EDT
  });

  it("targets the weekend underway on Saturday and Sunday", () => {
    // Sat Aug 1 2026, 12:00 EDT — anchor back to Fri Jul 31.
    const sat = new Date("2026-08-01T16:00:00Z");
    const pSat = weekendPreset(sat);
    expect(pSat.from.toISOString()).toBe("2026-07-31T21:00:00.000Z");
    expect(pSat.at.getTime()).toBe(sat.getTime()); // prime time already past

    // Sun Aug 2 2026, 12:00 EDT — anchor back two days.
    const sun = new Date("2026-08-02T16:00:00Z");
    const pSun = weekendPreset(sun);
    expect(pSun.from.toISOString()).toBe("2026-07-31T21:00:00.000Z");
    expect(pSun.to.toISOString()).toBe("2026-08-03T04:00:00.000Z");
    expect(pSun.at.getTime()).toBe(sun.getTime());
  });

  it("spans the fall-back weekend: one extra wall-clock hour, EST end boundary", () => {
    // Wed Oct 28 2026 → weekend Fri Oct 30 17:00 EDT → Mon Nov 2 00:00 EST.
    const p = weekendPreset(new Date("2026-10-28T16:00:00Z"));
    expect(p.from.toISOString()).toBe("2026-10-30T21:00:00.000Z"); // EDT
    expect(p.to.toISOString()).toBe("2026-11-02T05:00:00.000Z"); // EST
    // Fri 17:00 → Mon 00:00 is 55 h on an ordinary weekend; 56 h across fall-back.
    expect(p.to.getTime() - p.from.getTime()).toBe(56 * HOUR_MS);
    expect(p.at.toISOString()).toBe("2026-10-30T23:00:00.000Z"); // Fri 19:00 EDT
  });

  it("anchors across a month start (Sunday Nov 1 → Friday Oct 30)", () => {
    // Sun Nov 1 2026, 12:00 EST: local day 1, Friday = day -1 → Oct 30.
    const now = new Date("2026-11-01T17:00:00Z");
    const p = weekendPreset(now);
    expect(p.from.toISOString()).toBe("2026-10-30T21:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(p.at.getTime()).toBe(now.getTime());
  });
});

describe("getPreset", () => {
  it("dispatches by id", () => {
    const now = new Date("2026-07-28T14:00:00Z");
    expect(getPreset("tonight", now).id).toBe("tonight");
    expect(getPreset("weekend", now).id).toBe("weekend");
  });
});
