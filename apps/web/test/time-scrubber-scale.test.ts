import { describe, expect, it } from "vitest";
import {
  createScrubberScale,
  SCRUB_SPAN_DAYS,
  SCRUB_STEP_MINUTES,
  stepLocalDay,
} from "../src/time/scrubberScale";
import { DAY_MS, HOUR_MS } from "../src/time/tz";

const ANCHOR = new Date("2026-07-28T19:04:00Z");
const TOTAL_MINUTES = 2 * SCRUB_SPAN_DAYS * 24 * 60; // 20160

describe("createScrubberScale", () => {
  it("spans ±7 days around the minute-floored anchor in 15-min steps", () => {
    const scale = createScrubberScale(new Date("2026-07-28T19:04:30.500Z"));
    expect(scale.originMs).toBe(ANCHOR.getTime() - SCRUB_SPAN_DAYS * DAY_MS);
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(TOTAL_MINUTES);
    expect(scale.step).toBe(SCRUB_STEP_MINUTES);
  });

  it("maps the anchor to the center and round-trips step values", () => {
    const scale = createScrubberScale(ANCHOR);
    expect(scale.toValue(ANCHOR)).toBe(TOTAL_MINUTES / 2);
    expect(scale.toDate(TOTAL_MINUTES / 2).getTime()).toBe(ANCHOR.getTime());

    for (const v of [0, SCRUB_STEP_MINUTES, 96 * SCRUB_STEP_MINUTES, TOTAL_MINUTES]) {
      expect(scale.toValue(scale.toDate(v))).toBe(v);
    }
  });

  it("clamps out-of-window instants to the rail ends", () => {
    const scale = createScrubberScale(ANCHOR);
    expect(scale.toValue(scale.originMs - HOUR_MS)).toBe(0);
    expect(scale.toValue(scale.originMs + 15 * DAY_MS)).toBe(TOTAL_MINUTES);
  });

  it("places one tick per campus-local midnight, evenly spaced off-DST", () => {
    const scale = createScrubberScale(ANCHOR);
    expect(scale.ticks).toHaveLength(14);
    expect(scale.ticks.every((t) => t >= 0 && t <= TOTAL_MINUTES)).toBe(true);
    // Origin is Jul 21 19:04Z = 15:04 EDT; first midnight is 8 h 56 min later.
    expect(scale.ticks[0]).toBe(8 * 60 + 56);
    for (let i = 1; i < scale.ticks.length; i++) {
      expect((scale.ticks[i] ?? 0) - (scale.ticks[i - 1] ?? 0)).toBe(24 * 60);
    }
  });

  it("shifts one tick gap to 23 h when the window crosses spring-forward", () => {
    // Window Mar 3 → Mar 17 2026 contains the Mar 8 spring-forward.
    const scale = createScrubberScale(new Date("2026-03-10T16:00:00Z"));
    const gaps: number[] = [];
    for (let i = 1; i < scale.ticks.length; i++) {
      gaps.push((scale.ticks[i] ?? 0) - (scale.ticks[i - 1] ?? 0));
    }
    expect(gaps.filter((g) => g === 23 * 60)).toHaveLength(1);
    expect(gaps.every((g) => g === 23 * 60 || g === 24 * 60)).toBe(true);
  });
});

describe("stepLocalDay", () => {
  it("moves one local calendar day — 23 wall-clock hours across spring-forward", () => {
    const scale = createScrubberScale(new Date("2026-03-07T20:00:00Z"));
    const from = new Date("2026-03-08T00:00:00Z"); // Mar 7 19:00 EST
    const next = stepLocalDay(scale, from, 1);
    expect(next.toISOString()).toBe("2026-03-08T23:00:00.000Z"); // Mar 8 19:00 EDT
    expect(next.getTime() - from.getTime()).toBe(23 * HOUR_MS);

    const back = stepLocalDay(scale, next, -1);
    expect(back.getTime()).toBe(from.getTime());
  });

  it("clamps at the rail ends", () => {
    const scale = createScrubberScale(ANCHOR);
    const nearStart = scale.toDate(30);
    expect(stepLocalDay(scale, nearStart, -1).getTime()).toBe(scale.toDate(0).getTime());
    const nearEnd = scale.toDate(scale.max - 30);
    expect(stepLocalDay(scale, nearEnd, 1).getTime()).toBe(scale.toDate(scale.max).getTime());
  });
});
