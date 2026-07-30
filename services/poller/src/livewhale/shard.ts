/**
 * Adaptive date-window sharding for the LiveWhale feed.
 *
 * THE BUG THIS FIXES
 *
 * `isLikelyTruncated(rows.length, 500)` was true forever: the server ignores
 * small `?max=` values and caps the feed at exactly 1000 rows, so a single
 * unbounded fetch ALWAYS came back at the cap. LiveWhale therefore recorded
 * `status: 'partial'` on every run, `last_ok_at` stayed null, and the green
 * dot was unreachable for the project's primary source. Worse, the sweep was
 * permanently clamped, and everything past row 1000 — most of the next six
 * months — was simply never fetched.
 *
 * THE FIX
 *
 * Ask for bounded date windows instead of "everything". A window that comes
 * back under the cap is PROVABLY complete. A window at the cap is halved and
 * refetched; only a window that has shrunk to a single day and still hits the
 * cap is genuinely truncated, and only then is the run `partial`.
 *
 * VERIFIED PARAMETER FACTS (do not re-derive):
 *  - LiveWhale's params are PATH SEGMENTS, not query strings. `?max=3` is
 *    silently ignored; `/max/3` works.
 *  - `/start_date/YYYY-MM-DD/end_date/YYYY-MM-DD` works (200, ~492 KB for a
 *    one-week window).
 *  - `/starting_date/` has no effect and `/limit/` is ignored.
 *
 * REQUEST BUDGET: ~14 windows for six months, plus a halving or two, at the
 * http client's >= 1 s per-host spacing — roughly 20 s per sweep, comfortably
 * inside the 10-minute cadence and far politer than the 218-request group
 * enumeration it replaces.
 */
import type { SeedEvent } from "@brownsync/contract";
import { type DateWindow, SERVER_ROW_CAP } from "../sweep";

/** Width of the initial windows. */
export const SHARD_WINDOW_DAYS = 14;
/** How far back to sweep — enough to catch recently-canceled events. */
export const SHARD_LOOKBACK_DAYS = 7;
/** How far forward. Six months is the useful planning horizon for a campus. */
export const SHARD_LOOKAHEAD_DAYS = 180;
/**
 * Recursion floor. A single day that still returns 1000 events is not a
 * sharding failure — it is a genuinely truncated answer, and the only case
 * that may still report `partial`.
 */
export const MIN_SHARD_DAYS = 1;

/** One fetched window and what it returned. */
export type Shard = {
  window: DateWindow;
  rows: SeedEvent[];
  /** Bottomed out at MIN_SHARD_DAYS and STILL hit the cap. */
  truncated: boolean;
};

/** Fetch the raw body for one window. Injected so fixtures replay offline. */
export type WindowFetch = (window: DateWindow) => Promise<string>;

export type ShardOptions = {
  now?: Date;
  cap?: number;
  windowDays?: number;
  lookbackDays?: number;
  lookaheadDays?: number;
};

const MS_PER_DAY = 86_400_000;

/** Calendar date in America/New_York — the publisher's own day boundaries. */
export function newYorkDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * Days since the epoch for a YYYY-MM-DD string. Pure calendar arithmetic on a
 * UTC basis: no timezone is involved in counting days between two dates, and
 * doing it this way keeps DST out of the window planner entirely.
 */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

export function dateFromDayNumber(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Inclusive length of a window, in days. */
export function windowDays(window: DateWindow): number {
  return dayNumber(window.end) - dayNumber(window.start) + 1;
}

/**
 * Split a window into two. Returns null at the recursion floor — a window
 * that cannot be narrowed further is the one honest `partial`.
 */
export function halveWindow(window: DateWindow): [DateWindow, DateWindow] | null {
  const days = windowDays(window);
  if (days <= MIN_SHARD_DAYS) return null;
  const start = dayNumber(window.start);
  const firstHalf = Math.ceil(days / 2);
  return [
    { start: window.start, end: dateFromDayNumber(start + firstHalf - 1) },
    { start: dateFromDayNumber(start + firstHalf), end: window.end },
  ];
}

/**
 * The initial plan: contiguous, non-overlapping windows covering
 * [now - lookback, now + lookahead] in the publisher's local days. Contiguous
 * and non-overlapping matters — the union of these windows is what the
 * cancellation sweep will claim to have covered.
 */
export function planWindows(now: Date, opts: ShardOptions = {}): DateWindow[] {
  const width = opts.windowDays ?? SHARD_WINDOW_DAYS;
  const first = dayNumber(newYorkDate(now)) - (opts.lookbackDays ?? SHARD_LOOKBACK_DAYS);
  const last = dayNumber(newYorkDate(now)) + (opts.lookaheadDays ?? SHARD_LOOKAHEAD_DAYS);
  const windows: DateWindow[] = [];
  for (let day = first; day <= last; day += width) {
    windows.push({
      start: dateFromDayNumber(day),
      end: dateFromDayNumber(Math.min(day + width - 1, last)),
    });
  }
  return windows;
}

/**
 * Walk the plan, halving and refetching any window that comes back at the
 * server cap. Windows are fetched STRICTLY IN SEQUENCE so the http client's
 * per-host spacing applies: parallelising here would turn a polite sweep into
 * a burst.
 */
export async function fetchShards(
  fetchWindow: WindowFetch,
  normalize: (rawText: string) => SeedEvent[],
  opts: ShardOptions = {},
): Promise<Shard[]> {
  const cap = opts.cap ?? SERVER_ROW_CAP;
  const out: Shard[] = [];

  const visit = async (window: DateWindow): Promise<void> => {
    const rows = normalize(await fetchWindow(window));
    if (rows.length < cap) {
      out.push({ window, rows, truncated: false });
      return;
    }
    const halves = halveWindow(window);
    if (halves === null) {
      // A single day at the cap. Keep the rows — they are real — but say so.
      out.push({ window, rows, truncated: true });
      return;
    }
    for (const half of halves) await visit(half);
  };

  for (const window of planWindows(opts.now ?? new Date(), opts)) await visit(window);
  return out;
}

/**
 * Flatten shards into the contract rows to upsert, dropping duplicates.
 *
 * Deduping is REQUIRED, not defensive: an event cross-posted to several
 * LiveWhale groups is returned once per group, and a halved window shares its
 * boundary day with its sibling.
 *
 * The key is `source_id`, which the normalizer builds as `${id}:${date_ts}` —
 * the per-OCCURRENCE identity. It is deliberately NOT the bare LiveWhale `id`:
 * LiveWhale pre-expands a repeating series into one row per occurrence, all
 * sharing one `id`, so deduping on `id` alone would silently delete every
 * occurrence of every recurring event after the first.
 */
export function mergeShardRows(shards: readonly Shard[]): SeedEvent[] {
  const seen = new Set<string>();
  const rows: SeedEvent[] = [];
  for (const shard of shards) {
    for (const row of shard.rows) {
      if (seen.has(row.source_id)) continue;
      seen.add(row.source_id);
      rows.push(row);
    }
  }
  return rows;
}

/** True when any shard bottomed out at the recursion floor and still capped. */
export function shardsAreTruncated(shards: readonly Shard[]): boolean {
  return shards.some((s) => s.truncated);
}
