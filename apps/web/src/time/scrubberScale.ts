/**
 * Pure value-space math for the TimeScrubber. The slider works in whole
 * minutes offset from the start of a fixed 14-day window (±7 days around the
 * anchor — handoff §2G), so Radix gets small integers, every keyboard step is
 * exact, and none of this needs a DOM to test.
 */

import { floorToMinute } from "./cursor";
import { addLocalDays, CAMPUS_TZ, DAY_MS, dayBoundaries, MINUTE_MS } from "./tz";

export const SCRUB_SPAN_DAYS = 7;
/** Plain arrow keys step this many minutes (handoff §2G). */
export const SCRUB_STEP_MINUTES = 15;

export type ScrubberScale = {
  /** UTC ms of slider value 0 (anchor floored to the minute, minus 7 days). */
  readonly originMs: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Day-boundary tick positions in value space (campus-local midnights). */
  readonly ticks: readonly number[];
  /** Instant → slider value, clamped into [min, max]. */
  toValue(d: Date | number): number;
  /** Slider value → UTC instant. */
  toDate(value: number): Date;
};

export function createScrubberScale(
  anchor: Date | number,
  timeZone: string = CAMPUS_TZ,
): ScrubberScale {
  const originMs = floorToMinute(anchor).getTime() - SCRUB_SPAN_DAYS * DAY_MS;
  const max = 2 * SCRUB_SPAN_DAYS * 24 * 60;
  // DST shifts local midnights off the 24 h grid — compute, never assume.
  const ticks = dayBoundaries(originMs, originMs + max * MINUTE_MS, timeZone).map(
    (b) => (b.getTime() - originMs) / MINUTE_MS,
  );

  return {
    originMs,
    min: 0,
    max,
    step: SCRUB_STEP_MINUTES,
    ticks,
    toValue(d: Date | number): number {
      const ms = typeof d === "number" ? d : d.getTime();
      const raw = Math.round((ms - originMs) / MINUTE_MS);
      return Math.min(max, Math.max(0, raw));
    },
    toDate(value: number): Date {
      return new Date(originMs + value * MINUTE_MS);
    },
  };
}

/**
 * Shift+arrow / PageUp / PageDown: one LOCAL calendar day (23/24/25 h across
 * DST — the wall clock stays put), clamped into the scale.
 */
export function stepLocalDay(
  scale: ScrubberScale,
  from: Date | number,
  direction: 1 | -1,
  timeZone: string = CAMPUS_TZ,
): Date {
  return scale.toDate(scale.toValue(addLocalDays(from, direction, timeZone)));
}
