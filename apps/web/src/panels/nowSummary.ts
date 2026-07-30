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

export type NowSummary = {
  /** Events in progress at the cursor. */
  readonly live: number;
  /** Events starting within the §6.4 "soon" window (30 min). */
  readonly soon: number;
  /** Course meetings in session at the cursor. */
  readonly classes: number;
  /** The next event to START strictly after the cursor, if any. */
  readonly next: EventOut | null;
  /** Milliseconds until `next` starts, or null when there is no next. */
  readonly nextInMs: number | null;
};

export const EMPTY_SUMMARY: NowSummary = {
  live: 0,
  soon: 0,
  classes: 0,
  next: null,
  nextInMs: null,
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
  let next: EventOut | null = null;
  let nextMs = Number.POSITIVE_INFINITY;

  for (const event of events) {
    if (isInProgress(event, cursorMs)) live += 1;
    if (isSoon(event, cursorMs)) soon += 1;

    const startMs = Date.parse(event.start);
    // Strictly after: an event starting exactly at the cursor is already
    // counted as live, and showing it as "next" too would double-report it.
    // Canceled events are never "next" — that is the one slot the bar names.
    if (!event.isCanceled && Number.isFinite(startMs) && startMs > cursorMs && startMs < nextMs) {
      nextMs = startMs;
      next = event;
    }
  }

  return {
    live,
    soon,
    classes,
    next,
    nextInMs: next ? nextMs - cursorMs : null,
  };
}

/** `in 26 min` / `in 3 h` / `in 2 d` — the coarse form the bar needs. */
export function formatCountdown(ms: number): string {
  // The sub-minute check reads the raw ms, not the rounded minutes: 30 s
  // rounds to 1, and "in 1 min" for something 30 s away is a small lie that
  // the user can watch tick past.
  if (ms < 60_000) return "in <1 min";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} d`;
}
