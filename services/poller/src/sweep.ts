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
 */

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
