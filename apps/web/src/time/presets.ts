/**
 * Compact time presets (handoff §2G): "tonight" and "this weekend".
 * Pure functions of the wall clock — the components call these and feed
 * `at` into the cursor store, `from`/`to` into whatever list wants a window.
 * All boundaries are campus wall clock (America/New_York), DST-correct.
 */

import { CAMPUS_TZ, localDayOfWeek, localParts, zonedTimeToUtc } from "./tz";

export type TimePresetId = "tonight" | "weekend";

export type TimePreset = {
  id: TimePresetId;
  /** Rendered on the control — deliberately lowercase and terse. */
  label: string;
  /** Where the cursor jumps. */
  at: Date;
  /** The preset's window, for list views / layer filters. */
  from: Date;
  to: Date;
};

const EVENING_START_HOUR = 17; // window opens 17:00
const PRIME_HOUR = 19; // cursor lands 19:00 unless already past it
const NIGHT_SPILL_HOUR = 2; // "tonight" runs to 02:00 next day
const FRIDAY = 5;

/**
 * Tonight: today 17:00 → 02:00 tomorrow. Cursor lands at 19:00, or at the
 * current instant when the evening is already underway.
 */
export function tonightPreset(now: Date | number, timeZone: string = CAMPUS_TZ): TimePreset {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const p = localParts(nowMs, timeZone);
  const from = zonedTimeToUtc(
    { year: p.year, month: p.month, day: p.day, hour: EVENING_START_HOUR },
    timeZone,
  );
  const to = zonedTimeToUtc(
    { year: p.year, month: p.month, day: p.day + 1, hour: NIGHT_SPILL_HOUR },
    timeZone,
  );
  const prime = zonedTimeToUtc(
    { year: p.year, month: p.month, day: p.day, hour: PRIME_HOUR },
    timeZone,
  );
  const at = nowMs > prime.getTime() ? new Date(nowMs) : prime;
  return { id: "tonight", label: "tonight", at, from, to };
}

/**
 * This weekend: Friday 17:00 → Monday 00:00. Monday–Friday target the
 * upcoming weekend; Saturday–Sunday the one underway. Cursor lands Friday
 * 19:00, or at the current instant once inside the window.
 */
export function weekendPreset(now: Date | number, timeZone: string = CAMPUS_TZ): TimePreset {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const dow = localDayOfWeek(nowMs, timeZone);
  // Days until the anchor Friday: Sat (6) → -1, Sun (0) → -2, else forward.
  const daysToFriday = dow === 6 ? -1 : dow === 0 ? -2 : FRIDAY - dow;
  const p = localParts(nowMs, timeZone);
  const friday = p.day + daysToFriday;
  const from = zonedTimeToUtc(
    { year: p.year, month: p.month, day: friday, hour: EVENING_START_HOUR },
    timeZone,
  );
  const to = zonedTimeToUtc({ year: p.year, month: p.month, day: friday + 3 }, timeZone);
  const prime = zonedTimeToUtc(
    { year: p.year, month: p.month, day: friday, hour: PRIME_HOUR },
    timeZone,
  );
  const at = nowMs > prime.getTime() ? new Date(nowMs) : prime;
  return { id: "weekend", label: "weekend", at, from, to };
}

export function getPreset(
  id: TimePresetId,
  now: Date | number,
  timeZone: string = CAMPUS_TZ,
): TimePreset {
  return id === "tonight" ? tonightPreset(now, timeZone) : weekendPreset(now, timeZone);
}
