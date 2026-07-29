/**
 * Timezone math for the time machine — Intl-based, dependency-free, DST-correct.
 *
 * Everything in BrownSync happens on College Hill, so wall-clock semantics
 * (day boundaries, "tonight", "this weekend") are computed in campus time
 * regardless of where the viewer is. Contract §2: source-local parsing is
 * America/New_York; the cursor itself is always a UTC instant.
 */

export const CAMPUS_TZ = "America/New_York";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export type LocalParts = {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, fmt);
  }
  return fmt;
}

function toMs(d: Date | number): number {
  return typeof d === "number" ? d : d.getTime();
}

/** Wall-clock parts of a UTC instant in `timeZone`. */
export function localParts(utc: Date | number, timeZone: string = CAMPUS_TZ): LocalParts {
  const parts = partsFormatter(timeZone).formatToParts(toMs(utc));
  const out: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    // Intl may report hour 24 at midnight under some ICU versions; normalize.
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** UTC offset of `timeZone` at instant `utc`, in ms (EST → -5h → -18000000). */
export function tzOffsetMs(timeZone: string, utc: Date | number): number {
  const ms = toMs(utc);
  const p = localParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Compare at second precision — formatters do not carry milliseconds.
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

/**
 * The UTC instant whose wall clock in `timeZone` reads `parts`.
 * Overflowing fields normalize like `Date.UTC` (day 32 rolls the month), which
 * makes local-calendar arithmetic trivial. Two fixpoint iterations resolve DST:
 * ambiguous fall-back times pick the first occurrence; nonexistent spring-
 * forward times land deterministically just before the gap.
 */
export function zonedTimeToUtc(
  parts: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
  },
  timeZone: string = CAMPUS_TZ,
): Date {
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  const utc1 = asIfUtc - tzOffsetMs(timeZone, asIfUtc);
  const utc2 = asIfUtc - tzOffsetMs(timeZone, utc1);
  return new Date(utc2);
}

/** Local midnight of the day containing `utc` (a UTC instant). */
export function startOfLocalDay(utc: Date | number, timeZone: string = CAMPUS_TZ): Date {
  const p = localParts(utc, timeZone);
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day }, timeZone);
}

/** `utc` shifted by `days` on the local calendar (23/24/25 h across DST). */
export function addLocalDays(utc: Date | number, days: number, timeZone: string = CAMPUS_TZ): Date {
  const p = localParts(utc, timeZone);
  return zonedTimeToUtc(
    {
      year: p.year,
      month: p.month,
      day: p.day + days,
      hour: p.hour,
      minute: p.minute,
      second: p.second,
    },
    timeZone,
  );
}

/**
 * Local midnights within [from, to], inclusive — the scrubber's day-boundary
 * tick marks. DST days shift boundaries by an hour; never assume 24 h spacing.
 */
export function dayBoundaries(
  from: Date | number,
  to: Date | number,
  timeZone: string = CAMPUS_TZ,
): Date[] {
  const fromMs = toMs(from);
  const toMs_ = toMs(to);
  const out: Date[] = [];
  let cursor = startOfLocalDay(fromMs, timeZone);
  if (cursor.getTime() < fromMs) cursor = addLocalDays(cursor, 1, timeZone);
  // ±7 days is 15 boundaries; the guard only trips on caller misuse.
  for (let i = 0; cursor.getTime() <= toMs_ && i < 64; i++) {
    out.push(cursor);
    cursor = addLocalDays(cursor, 1, timeZone);
  }
  return out;
}

/** Local day-of-week of `utc` in `timeZone`: 0 = Sunday … 6 = Saturday. */
export function localDayOfWeek(utc: Date | number, timeZone: string = CAMPUS_TZ): number {
  const p = localParts(utc, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Short local weekday label ("Tue") for readouts. */
export function localWeekday(utc: Date | number, timeZone: string = CAMPUS_TZ): string {
  let fmt = weekdayFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
    weekdayFormatters.set(timeZone, fmt);
  }
  return fmt.format(toMs(utc));
}

/** True when the two instants fall on the same local calendar day. */
export function isSameLocalDay(
  a: Date | number,
  b: Date | number,
  timeZone: string = CAMPUS_TZ,
): boolean {
  const pa = localParts(a, timeZone);
  const pb = localParts(b, timeZone);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}
