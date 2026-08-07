import type { EventOut } from "@brownsync/contract";
import { DEFAULT_DURATION_MS, SOON_MS } from "../map/eventsLayer";

/**
 * The header's live readout, as data.
 *
 * Kept pure and separate from <NowBar/> because every interesting case here
 * is a boundary — an event that ends exactly at the cursor, a scrubbed cursor
 * with nothing ahead of it, an all-day event that is "live" for 24 h — and
 * those are miserable to assert through a rendered component.
 */

// No `next` slot (UI audit): the bar's next-event teaser duplicated the
// HappeningNow panel and was deleted, so the summary carries counts only.
export type NowSummary = {
  /** Events in progress at the cursor. */
  readonly live: number;
  /** Events starting within the §6.4 "soon" window (30 min). */
  readonly soon: number;
  /** Course meetings in session at the cursor. */
  readonly classes: number;
};

export const EMPTY_SUMMARY: NowSummary = {
  live: 0,
  soon: 0,
  classes: 0,
};

/**
 * Deliberately NOT `eventsLayer.isEventLive`, despite the name. That
 * predicate is `start <= cursor + 2 h lookahead`, i.e. "should this be drawn
 * on the map", and it is true for everything up to two hours out. Reusing it
 * here would report a 6 p.m. lecture as happening at 4 p.m.
 */
function isInProgress(event: EventOut, cursorMs: number): boolean {
  if (event.isCanceled) return false;
  const start = Date.parse(event.start);
  if (!Number.isFinite(start)) return false;
  const end = event.end ? Date.parse(event.end) : start + DEFAULT_DURATION_MS;
  return start <= cursorMs && end >= cursorMs;
}

/** Starting within (0, 30 min]. `eventsLayer.isStartingSoon` omits the
 *  canceled check — a canceled event must never pulse in the header. */
function isSoon(event: EventOut, cursorMs: number): boolean {
  if (event.isCanceled) return false;
  const until = Date.parse(event.start) - cursorMs;
  return until > 0 && until <= SOON_MS;
}

/**
 * @param events events already narrowed to the cursor window and the active
 *   `?cats=` filter — this function does no filtering of its own, so the bar
 *   always agrees with what the map is showing.
 * @param classes total meetings in session (from `totalMeetingCount`).
 */
export function summarizeNow(
  events: readonly EventOut[],
  classes: number,
  cursor: Date,
): NowSummary {
  const cursorMs = cursor.getTime();
  let live = 0;
  let soon = 0;

  for (const event of events) {
    if (isInProgress(event, cursorMs)) live += 1;
    if (isSoon(event, cursorMs)) soon += 1;
  }

  return { live, soon, classes };
}
