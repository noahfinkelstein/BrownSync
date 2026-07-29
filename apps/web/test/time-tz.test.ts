/**
 * DST-boundary coverage for the Intl-based tz math (America/New_York).
 * 2026 transitions: spring forward Mar 8 02:00 EST → 03:00 EDT (07:00Z);
 * fall back Nov 1 02:00 EDT → 01:00 EST (06:00Z).
 */

import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  dayBoundaries,
  HOUR_MS,
  isSameLocalDay,
  localDayOfWeek,
  localParts,
  localWeekday,
  startOfLocalDay,
  tzOffsetMs,
  zonedTimeToUtc,
} from "../src/time/tz";

const NY = "America/New_York";

describe("localParts / tzOffsetMs", () => {
  it("reads campus wall-clock parts of a UTC instant", () => {
    expect(localParts(new Date("2026-07-28T19:04:05Z"))).toEqual({
      year: 2026,
      month: 7,
      day: 28,
      hour: 15,
      minute: 4,
      second: 5,
    });
  });

  it("reports -5 h in winter (EST) and -4 h in summer (EDT)", () => {
    expect(tzOffsetMs(NY, Date.UTC(2026, 0, 15, 12))).toBe(-5 * HOUR_MS);
    expect(tzOffsetMs(NY, Date.UTC(2026, 6, 15, 12))).toBe(-4 * HOUR_MS);
  });
});

describe("zonedTimeToUtc", () => {
  it("maps ordinary wall-clock times in both offsets", () => {
    expect(
      zonedTimeToUtc({ year: 2026, month: 7, day: 28, hour: 19, minute: 30 }).toISOString(),
    ).toBe("2026-07-28T23:30:00.000Z");
    expect(
      zonedTimeToUtc({ year: 2026, month: 1, day: 15, hour: 19, minute: 30 }).toISOString(),
    ).toBe("2026-01-16T00:30:00.000Z");
  });

  it("is exact on both sides of the spring-forward gap", () => {
    expect(
      zonedTimeToUtc({ year: 2026, month: 3, day: 8, hour: 1, minute: 59 }).toISOString(),
    ).toBe("2026-03-08T06:59:00.000Z");
    expect(zonedTimeToUtc({ year: 2026, month: 3, day: 8, hour: 3 }).toISOString()).toBe(
      "2026-03-08T07:00:00.000Z",
    );
  });

  it("maps nonexistent spring-forward times deterministically before the gap", () => {
    // 02:30 never happens on Mar 8 2026; lands one hour earlier (01:30 EST).
    expect(
      zonedTimeToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }).toISOString(),
    ).toBe("2026-03-08T06:30:00.000Z");
  });

  it("picks the first occurrence of ambiguous fall-back times", () => {
    // 01:30 happens twice on Nov 1 2026; first pass is EDT (05:30Z, not 06:30Z).
    expect(
      zonedTimeToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }).toISOString(),
    ).toBe("2026-11-01T05:30:00.000Z");
  });

  it("normalizes overflowed days across month starts like Date.UTC", () => {
    expect(zonedTimeToUtc({ year: 2026, month: 11, day: -1, hour: 12 }).toISOString()).toBe(
      zonedTimeToUtc({ year: 2026, month: 10, day: 30, hour: 12 }).toISOString(),
    );
  });
});

describe("addLocalDays across DST", () => {
  it("spring-forward day is 23 wall-clock hours", () => {
    const from = new Date("2026-03-08T00:00:00Z"); // Mar 7, 19:00 EST
    const to = addLocalDays(from, 1, NY); // Mar 8, 19:00 EDT
    expect(to.toISOString()).toBe("2026-03-08T23:00:00.000Z");
    expect(to.getTime() - from.getTime()).toBe(23 * HOUR_MS);
  });

  it("fall-back day is 25 wall-clock hours", () => {
    const from = new Date("2026-10-31T23:00:00Z"); // Oct 31, 19:00 EDT
    const to = addLocalDays(from, 1, NY); // Nov 1, 19:00 EST
    expect(to.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(to.getTime() - from.getTime()).toBe(25 * HOUR_MS);
  });

  it("negative steps reverse the same wall-clock day math", () => {
    const back = addLocalDays(new Date("2026-03-08T23:00:00Z"), -1, NY);
    expect(back.toISOString()).toBe("2026-03-08T00:00:00.000Z");
  });
});

describe("startOfLocalDay / isSameLocalDay", () => {
  it("returns campus-local midnight, not UTC midnight", () => {
    expect(startOfLocalDay(new Date("2026-07-28T19:00:00Z")).toISOString()).toBe(
      "2026-07-28T04:00:00.000Z",
    );
    // 03:00Z is still 23:00 EDT the previous local day.
    expect(startOfLocalDay(new Date("2026-07-29T03:00:00Z")).toISOString()).toBe(
      "2026-07-28T04:00:00.000Z",
    );
  });

  it("groups instants by local calendar day across the UTC date line", () => {
    expect(
      isSameLocalDay(Date.parse("2026-07-29T03:59:00Z"), Date.parse("2026-07-28T12:00:00Z")),
    ).toBe(true);
    expect(
      isSameLocalDay(Date.parse("2026-07-29T04:00:00Z"), Date.parse("2026-07-28T12:00:00Z")),
    ).toBe(false);
  });
});

describe("dayBoundaries", () => {
  it("yields local midnights with 23/24/25 h spacing across the spring gap", () => {
    const boundaries = dayBoundaries(
      new Date("2026-03-06T12:00:00Z"),
      new Date("2026-03-10T12:00:00Z"),
      NY,
    );
    expect(boundaries.map((b) => b.toISOString())).toEqual([
      "2026-03-07T05:00:00.000Z", // Mar 7 00:00 EST
      "2026-03-08T05:00:00.000Z", // Mar 8 00:00 EST
      "2026-03-09T04:00:00.000Z", // Mar 9 00:00 EDT — 23 h later
      "2026-03-10T04:00:00.000Z",
    ]);
  });

  it("includes a boundary exactly at `from` and none past `to`", () => {
    const midnight = new Date("2026-07-28T04:00:00Z");
    const boundaries = dayBoundaries(midnight, new Date("2026-07-29T03:59:00Z"), NY);
    expect(boundaries.map((b) => b.toISOString())).toEqual(["2026-07-28T04:00:00.000Z"]);
  });
});

describe("weekday helpers", () => {
  it("computes the local day-of-week and label", () => {
    // 2026-07-28 is a Tuesday on College Hill.
    expect(localDayOfWeek(new Date("2026-07-28T12:00:00Z"))).toBe(2);
    expect(localWeekday(new Date("2026-07-28T12:00:00Z"))).toBe("Tue");
    // 02:00Z Wednesday UTC is still Tuesday 22:00 EDT locally.
    expect(localDayOfWeek(new Date("2026-07-29T02:00:00Z"))).toBe(2);
  });
});
