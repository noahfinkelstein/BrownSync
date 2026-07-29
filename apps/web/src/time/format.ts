/**
 * Mono timestamp readouts per design law §6.4 — `19:04 · in 26 min`.
 * Absolute part is campus wall clock; relative part is real elapsed time
 * (absolute ms difference), so it stays honest across DST jumps.
 */

import {
  CAMPUS_TZ,
  DAY_MS,
  HOUR_MS,
  isSameLocalDay,
  localParts,
  localWeekday,
  MINUTE_MS,
} from "./tz";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 24-h campus wall clock, "19:04". */
export function formatClock(d: Date | number, timeZone: string = CAMPUS_TZ): string {
  const p = localParts(d, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Relative distance, "in 26 min" / "3 h 20 min ago" / "now". */
export function formatRelative(at: Date | number, now: Date | number): string {
  const atMs = typeof at === "number" ? at : at.getTime();
  const nowMs = typeof now === "number" ? now : now.getTime();
  const diff = atMs - nowMs;
  const abs = Math.abs(diff);

  if (abs < MINUTE_MS) return "now";

  let quantity: string;
  if (abs < HOUR_MS) {
    quantity = `${Math.round(abs / MINUTE_MS)} min`;
  } else if (abs < DAY_MS) {
    const totalMinutes = Math.round(abs / MINUTE_MS);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    quantity = m === 0 ? `${h} h` : `${h} h ${m} min`;
  } else {
    const totalHours = Math.round(abs / HOUR_MS);
    const d = Math.floor(totalHours / 24);
    const h = totalHours % 24;
    quantity = h === 0 ? `${d} d` : `${d} d ${h} h`;
  }

  return diff > 0 ? `in ${quantity}` : `${quantity} ago`;
}

/**
 * The scrubber readout: `19:04 · in 26 min`, with a weekday prefix once the
 * cursor leaves today (`Sat 20:00 · in 4 d 2 h`).
 */
export function formatCursor(
  at: Date | number,
  now: Date | number,
  timeZone: string = CAMPUS_TZ,
): string {
  const clock = formatClock(at, timeZone);
  const absolute = isSameLocalDay(at, now, timeZone)
    ? clock
    : `${localWeekday(at, timeZone)} ${clock}`;
  return `${absolute} · ${formatRelative(at, now)}`;
}
