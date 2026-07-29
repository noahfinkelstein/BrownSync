/**
 * Timestamp formatting — §6.4: mono timestamps like "19:04 · in 26 min".
 * Campus times always render in America/New_York regardless of viewer
 * timezone (events happen on College Hill), which also keeps tests
 * deterministic.
 */

export const CAMPUS_TZ = "America/New_York";

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: CAMPUS_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dayFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: CAMPUS_TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
});

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "19:04" (24 h, campus time). */
export function fmtTime(d: Date): string {
  return timeFmt.format(d);
}

/** "Thu Jul 30" (campus time). */
export function fmtDay(d: Date): string {
  return dayFmt.format(d).replaceAll(",", "");
}

/** True when both instants fall on the same campus-time calendar day. */
export function isSameCampusDay(a: Date, b: Date): boolean {
  return dayFmt.format(a) === dayFmt.format(b);
}

/** "in 26 min" / "26 min ago" / "in 3 h" / "2 d ago" / "now". */
export function relLabel(target: Date, cursor: Date): string {
  const deltaMs = target.getTime() - cursor.getTime();
  const past = deltaMs < 0;
  const abs = Math.abs(deltaMs);
  const minutes = Math.round(abs / MIN);
  if (minutes < 1) return "now";
  let span: string;
  if (minutes < 90) span = `${minutes} min`;
  else if (abs < 36 * HOUR) span = `${Math.round(abs / HOUR)} h`;
  else span = `${Math.round(abs / DAY)} d`;
  return past ? `${span} ago` : `in ${span}`;
}

/** "19:04–21:00", or "19:04" when the end is unknown. */
export function fmtRange(start: Date, end: Date | null): string {
  return end ? `${fmtTime(start)}–${fmtTime(end)}` : fmtTime(start);
}

/**
 * The §6.4 one-liner for an event relative to the time cursor:
 *   upcoming      → "19:04 · in 26 min"      (prefixed "Thu " when not today)
 *   in progress   → "19:04 · started 26 min ago"
 *   over          → "19:04 · ended 3 h ago"
 */
export function eventTimeLabel(startIso: string, endIso: string | null, cursor: Date): string {
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  const dayPrefix = isSameCampusDay(start, cursor) ? "" : `${fmtDay(start).slice(0, 3)} `;
  const t = `${dayPrefix}${fmtTime(start)}`;
  if (cursor.getTime() < start.getTime()) {
    return `${t} · ${relLabel(start, cursor)}`;
  }
  const effectiveEnd = end ?? new Date(start.getTime() + 90 * MIN);
  if (cursor.getTime() <= effectiveEnd.getTime()) {
    const started = relLabel(start, cursor);
    return `${t} · ${started === "now" ? "starting now" : `started ${started}`}`;
  }
  return `${t} · ended ${relLabel(effectiveEnd, cursor)}`;
}

/** Whole minutes from cursor to target; negative when target is past. */
export function minutesUntil(targetIso: string, cursor: Date): number {
  return Math.round((new Date(targetIso).getTime() - cursor.getTime()) / MIN);
}
