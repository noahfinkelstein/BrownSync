import type { EventOut } from "@brownsync/contract";
import { DEFAULT_DURATION_MS, SOON_MS } from "../map/eventsLayer";

/**
 * NOTE ON THE FILENAME. This is the model behind `HappeningNow.tsx` and was
 * `happeningNow.ts`. On a case-insensitive filesystem (macOS, Windows) those
 * two resolve to each other: `import … from "./HappeningNow"` silently loaded
 * the MODEL, and TypeScript reported a file "differing only in casing". It
 * would then behave differently on Linux CI. The existing pair in this
 * directory gets it right by using different words — `NowBar.tsx` /
 * `nowSummary.ts` — and this now follows suit.
 */

/**
 * The map's bottom-left "happening now" bar, as data.
 *
 * Pure and separate from <HappeningNow/> for the same reason `nowSummary.ts`
 * is separate from <NowBar/>: everything worth asserting here is a boundary —
 * an event that ends exactly at the cursor, an event whose `end` the feed left
 * null, two events that start in the same minute — and boundaries are
 * miserable to assert through a rendered component.
 *
 * THE TRAP, restated because it is the whole reason this file exists:
 * `eventsLayer.isEventLive` is misnamed. It is `start <= cursor + 2 h
 * lookahead && end >= cursor`, i.e. "should the map DRAW this dot", and it is
 * true for an event two hours out. A bar built on it would say a 7:30 p.m.
 * lecture is happening at 6 p.m. In-progress here means the cursor is inside
 * [start, end], nothing looser.
 */

/** Most rows the bar will ever list; the counts are never capped. */
export const MAX_ROWS = 5;

export type HappeningRow = {
  readonly event: EventOut;
  /** True when the cursor sits inside [start, end]; false when it starts soon. */
  readonly inProgress: boolean;
  /**
   * Distance from the cursor, always ≥ 0: time SINCE start while in progress,
   * time UNTIL start while soon. One field for both because sorting ascending
   * on it does the right thing for both groups (see `happeningNow`).
   */
  readonly offsetMs: number;
};

export type HappeningNow = {
  /** Events in progress at the cursor. Not capped by `limit`. */
  readonly live: number;
  /** Events starting within the §6.4 "soon" window (30 min). Not capped. */
  readonly soon: number;
  /** The most imminent rows, at most `limit` of them. */
  readonly rows: readonly HappeningRow[];
};

export const EMPTY_HAPPENING: HappeningNow = { live: 0, soon: 0, rows: [] };

/**
 * End instant of an event. A null `end` gets the same fallback the map uses,
 * so the bar and the dots agree on when a dot stops being live. An
 * UNPARSEABLE end takes the fallback too rather than yielding NaN — `NaN >=
 * cursor` is false, which would silently drop an event that is plainly
 * happening just because its feed emitted a malformed end timestamp.
 */
function endMs(event: EventOut, startMs: number): number {
  if (!event.end) return startMs + DEFAULT_DURATION_MS;
  const parsed = Date.parse(event.end);
  return Number.isFinite(parsed) ? parsed : startMs + DEFAULT_DURATION_MS;
}

/**
 * What is actually happening at `at`, plus what is about to.
 *
 * @param events events ALREADY narrowed to the cursor window and the active
 *   `?cats=` filter — this function filters by time only, so the bar can never
 *   disagree with the dots the map is drawing.
 * @param at the time cursor.
 * @param limit how many rows to return; the `live`/`soon` counts ignore it.
 */
export function happeningNow(
  events: readonly EventOut[],
  at: Date,
  limit: number = MAX_ROWS,
): HappeningNow {
  const atMs = at.getTime();
  const rows: HappeningRow[] = [];
  let live = 0;
  let soon = 0;

  for (const event of events) {
    // Canceled events are neither live nor soon anywhere in the app: the
    // header dot, the map pulse and this bar all agree (§6.4).
    if (event.isCanceled) continue;
    const startMs = Date.parse(event.start);
    if (!Number.isFinite(startMs)) continue;

    if (startMs <= atMs) {
      // Inclusive at both ends, matching nowSummary and the detail panel: an
      // event ending exactly now is still in progress for one more instant.
      if (endMs(event, startMs) < atMs) continue;
      live += 1;
      rows.push({ event, inProgress: true, offsetMs: atMs - startMs });
      continue;
    }

    const until = startMs - atMs;
    if (until <= SOON_MS) {
      soon += 1;
      rows.push({ event, inProgress: false, offsetMs: until });
    }
  }

  rows.sort(compareRows);
  return { live, soon, rows: rows.slice(0, Math.max(0, limit)) };
}

/**
 * In-progress rows first, then the imminent ones; inside each group, smallest
 * `offsetMs` first. The single comparator reads correctly for both groups: the
 * in-progress event with the smallest offset is the one that JUST started (the
 * one you can still catch from the beginning), and the soon event with the
 * smallest offset is the one starting first.
 *
 * The id tiebreak is not decoration. Without it, `Array#sort` may reorder
 * same-minute events between renders, so the 60 s live refetch would reshuffle
 * rows under the user's cursor with identical data — motion the design law
 * does not allow (§6.4) and a misclick waiting to happen.
 */
function compareRows(a: HappeningRow, b: HappeningRow): number {
  if (a.inProgress !== b.inProgress) return a.inProgress ? -1 : 1;
  return a.offsetMs - b.offsetMs || a.event.id.localeCompare(b.event.id);
}

/**
 * The WHERE line for a row: the resolved place, else the feed's raw location.
 * Returns null rather than an empty string so the caller can drop the
 * separator instead of rendering a dangling "19:04 · ".
 */
export function placeLabel(event: EventOut): string | null {
  const raw = event.placeName ?? event.locationRaw;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}
