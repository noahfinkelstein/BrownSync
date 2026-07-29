/**
 * Time formatting — §6.4: timestamps are mono, 24 h, terse ("19:04 · in 26 min").
 * Pure functions; callers inject `now` so tests stay deterministic. All math is
 * in the viewer's local timezone (campus wall time in practice).
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
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

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "19:04" */
export function formatClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "Today" | "Tomorrow" | "Wed Jul 29" */
export function formatDayLabel(d: Date, now: Date): string {
  if (isSameDay(d, now)) return "Today";
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameDay(d, tomorrow)) return "Tomorrow";
  return `${WEEKDAYS[d.getDay()] ?? ""} ${MONTHS[d.getMonth()] ?? ""} ${d.getDate()}`;
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
