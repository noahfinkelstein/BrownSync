/**
 * Cancellation-sweep logic (contract §2), extracted pure so it is unit-testable
 * without a database:
 *
 *   "An event present in a previous run but missing from the current full
 *    fetch of the same window → set is_canceled = true (don't delete)."
 *
 * The window of a full fetch is [min(start_ts), max(start_ts)] of the rows the
 * feed returned this run. Events of the same source that start inside that
 * window but were not seen this run get canceled; events outside the window
 * were never re-fetched, so absence proves nothing and they are left alone.
 *
 * Truncated fetches: when the feed hits a row cap (see isLikelyTruncated) the
 * "full fetch" premise breaks at the window's END — the feed is sorted
 * ascending by start and the tail was cut off mid-stream, so an event tied at
 * max(start_ts) may be absent only because it fell past the cap. The sweep is
 * then clamped to [start, end) via `endExclusive` and the run marked partial.
 *
 * `sweepWindow` DERIVES the window from what came back, which has a silent
 * blind spot: a fortnight in which the feed returns nothing produces no window
 * at all for that stretch, so events previously stored there are never marked
 * canceled. A source that fetches EXPLICIT windows (see
 * livewhale/shard.ts) should use `sweepWindowFromShards` instead — the window
 * is then what was ASKED FOR, and an empty answer is real information.
 */
import { newYorkToUtc, toIsoUtc } from "./util";

export type SweepWindow = {
  start: string;
  end: string;
  /** Clamp for truncated fetches: events starting exactly at `end` are NOT swept. */
  endExclusive?: boolean;
};

/**
 * LiveWhale's server ignores small `?max=` values and caps the feed at 1000
 * rows: the recorded fixture is exactly 1000 rows (sorted ascending by
 * date_ts) despite requesting max=500. At or beyond either limit we cannot
 * tell "everything fetched" from "cut off at the cap".
 */
export const SERVER_ROW_CAP = 1000;

/** A fetch at/over the requested max — or at the observed server cap — is incomplete. */
export function isLikelyTruncated(rowCount: number, requestedMax: number | null = null): boolean {
  return (requestedMax !== null && rowCount >= requestedMax) || rowCount >= SERVER_ROW_CAP;
}

/** Window covered by this run's full fetch; null when the feed came back empty. */
export function sweepWindow(rows: ReadonlyArray<{ start_ts: string }>): SweepWindow | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const row of rows) {
    const t = Date.parse(row.start_ts);
    if (Number.isNaN(t)) continue;
    if (start === null || t < Date.parse(start)) start = row.start_ts;
    if (end === null || t > Date.parse(end)) end = row.start_ts;
  }
  return start !== null && end !== null ? { start, end } : null;
}

/**
 * An inclusive calendar-day range, exactly as the LiveWhale
 * `/start_date/YYYY-MM-DD/end_date/YYYY-MM-DD` path segments express it.
 */
export type DateWindow = {
  /** YYYY-MM-DD, inclusive. */
  start: string;
  /** YYYY-MM-DD, inclusive. */
  end: string;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(s: string): [number, number, number] | null {
  const m = DATE_RE.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Sweep window covering the union of the windows that were REQUESTED, rather
 * than the span of the rows that came back.
 *
 * This is the fix for a real, currently-silent bug: with `sweepWindow`, a
 * fortnight the feed answers with zero events contributes nothing to the
 * window, so anything previously stored in that fortnight is never swept and
 * stays live forever. When the windows are explicit, "no events between these
 * two dates" is an answer, not an absence.
 *
 * The date params are the publisher's LOCAL days (contract §2: source-local
 * parsing assumes America/New_York), so the window runs from local midnight on
 * `start` to local midnight on the day AFTER `end`, exclusive — i.e. through
 * the whole of the final local day, with no double-counting at the boundary.
 */
export function sweepWindowFromShards(windows: readonly DateWindow[]): SweepWindow | null {
  let earliest: [number, number, number] | null = null;
  let latest: [number, number, number] | null = null;
  for (const w of windows) {
    const start = parseDate(w.start);
    const end = parseDate(w.end);
    if (start === null || end === null) continue;
    if (earliest === null || Date.UTC(...start) < Date.UTC(...earliest)) earliest = start;
    if (latest === null || Date.UTC(...end) > Date.UTC(...latest)) latest = end;
  }
  if (earliest === null || latest === null) return null;
  return {
    start: toIsoUtc(newYorkToUtc(earliest[0], earliest[1], earliest[2])),
    end: toIsoUtc(newYorkToUtc(latest[0], latest[1], latest[2] + 1)),
    endExclusive: true,
  };
}

export function isInWindow(startTs: string, window: SweepWindow): boolean {
  const t = Date.parse(startTs);
  if (t < Date.parse(window.start)) return false;
  const end = Date.parse(window.end);
  return window.endExclusive ? t < end : t <= end;
}

/**
 * Which previously-stored events to cancel: inside the fetched window AND not
 * seen this run. `existing` is this source's not-yet-canceled rows.
 */
export function selectCancellations(
  existing: ReadonlyArray<{ source_id: string; start_ts: string }>,
  seenIds: ReadonlySet<string>,
  window: SweepWindow,
): string[] {
  return existing
    .filter((row) => isInWindow(row.start_ts, window) && !seenIds.has(row.source_id))
    .map((row) => row.source_id);
}
