import { describe, expect, it } from "vitest";
import {
  eventTimeLabel,
  fmtDay,
  fmtRange,
  fmtTime,
  isSameCampusDay,
  minutesUntil,
  relLabel,
} from "../src/data/format";

// 2026-10-01 is a Thursday; EDT (UTC-4) applies.
const CURSOR = new Date("2026-10-01T22:38:00Z"); // 18:38 ET

describe("campus-time formatting (§6.4 mono timestamps)", () => {
  it("formats 24h campus time regardless of host TZ", () => {
    expect(fmtTime(new Date("2026-10-01T23:04:00Z"))).toBe("19:04");
    expect(fmtTime(new Date("2026-10-02T03:59:00Z"))).toBe("23:59");
  });

  it("formats day and range", () => {
    expect(fmtDay(new Date("2026-10-01T23:04:00Z"))).toBe("Thu Oct 1");
    expect(fmtRange(new Date("2026-10-01T23:04:00Z"), new Date("2026-10-02T01:00:00Z"))).toBe(
      "19:04–21:00",
    );
    expect(fmtRange(new Date("2026-10-01T23:04:00Z"), null)).toBe("19:04");
  });

  it("same-campus-day respects the ET day boundary", () => {
    // 03:59Z Oct 2 is still 23:59 ET Oct 1.
    expect(isSameCampusDay(CURSOR, new Date("2026-10-02T03:59:00Z"))).toBe(true);
    expect(isSameCampusDay(CURSOR, new Date("2026-10-02T04:01:00Z"))).toBe(false);
  });

  it("relative labels", () => {
    expect(relLabel(new Date("2026-10-01T23:04:00Z"), CURSOR)).toBe("in 26 min");
    expect(relLabel(new Date("2026-10-01T22:12:00Z"), CURSOR)).toBe("26 min ago");
    expect(relLabel(new Date("2026-10-02T01:38:00Z"), CURSOR)).toBe("in 3 h");
    expect(relLabel(new Date("2026-10-03T22:38:00Z"), CURSOR)).toBe("in 2 d");
    expect(relLabel(new Date("2026-10-01T22:38:20Z"), CURSOR)).toBe("now");
  });

  it("the §6.4 example: '19:04 · in 26 min'", () => {
    expect(eventTimeLabel("2026-10-01T23:04:00Z", null, CURSOR)).toBe("19:04 · in 26 min");
  });

  it("in-progress and ended labels", () => {
    expect(eventTimeLabel("2026-10-01T22:00:00Z", "2026-10-01T23:30:00Z", CURSOR)).toBe(
      "18:00 · started 38 min ago",
    );
    expect(eventTimeLabel("2026-10-01T18:00:00Z", "2026-10-01T19:00:00Z", CURSOR)).toBe(
      "14:00 · ended 4 h ago",
    );
  });

  it("prefixes the weekday when the event is not today (campus time)", () => {
    expect(eventTimeLabel("2026-10-03T23:04:00Z", null, CURSOR)).toBe("Sat 19:04 · in 2 d");
  });

  it("minutesUntil is signed", () => {
    expect(minutesUntil("2026-10-01T23:04:00Z", CURSOR)).toBe(26);
    expect(minutesUntil("2026-10-01T22:12:00Z", CURSOR)).toBe(-26);
  });
});
