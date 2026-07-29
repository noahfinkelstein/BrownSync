/** Relative-time readouts for ops surfaces — terse, always rendered mono (§6.4). */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * "just now" | "4 min ago" | "2 h ago" | "3 d ago" | "never".
 * `nowMs` is explicit so callers (and tests) control the clock.
 */
export function formatAgo(iso: string | null, nowMs: number): string {
  if (!iso) return "never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "never";
  const delta = nowMs - then;
  if (delta < MINUTE_MS) return "just now";
  if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)} min ago`;
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)} h ago`;
  return `${Math.floor(delta / DAY_MS)} d ago`;
}
