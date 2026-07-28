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
 */

export type SweepWindow = { start: string; end: string };

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
  return t >= Date.parse(window.start) && t <= Date.parse(window.end);
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
