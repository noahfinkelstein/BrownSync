/**
 * Time formatting — §6.4: timestamps are mono, 24 h, terse ("19:04 · in 26 min").
 * Pure functions; callers inject `now` so tests stay deterministic. All math is
 * in campus wall time regardless of the viewer's timezone.
 */

import { formatClock as formatCampusClock } from "../time/format";
import { addLocalDays, isSameLocalDay, localParts, localWeekday } from "../time/tz";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "19:04" */
export function formatClock(d: Date): string {
  return formatCampusClock(d);
}

export function isSameDay(a: Date, b: Date): boolean {
  return isSameLocalDay(a, b);
}

/** "Today" | "Tomorrow" | "Wed Jul 29" */
export function formatDayLabel(d: Date, now: Date): string {
  if (isSameDay(d, now)) return "Today";
  const tomorrow = addLocalDays(now, 1);
  if (isSameDay(d, tomorrow)) return "Tomorrow";
  const parts = localParts(d);
  return `${localWeekday(d)} ${MONTHS[parts.month - 1] ?? ""} ${parts.day}`;
}

/** "in 26 min" | "in 3 h" | "now" | "12 min ago" | "2 h ago" */
export function formatRelative(now: Date, target: Date): string {
  const diffMin = Math.round((target.getTime() - now.getTime()) / 60_000);
  if (Math.abs(diffMin) < 1) return "now";
  if (diffMin > 0) {
    if (diffMin < 60) return `in ${diffMin} min`;
    return `in ${Math.round(diffMin / 60)} h`;
  }
  const ago = -diffMin;
  if (ago < 60) return `${ago} min ago`;
  return `${Math.round(ago / 60)} h ago`;
}

/** "Today 19:00" | "Wed Jul 29 18:30" — palette metadata column. */
export function formatDayTime(iso: string, now: Date): string {
  const d = new Date(iso);
  return `${formatDayLabel(d, now)} ${formatClock(d)}`;
}
