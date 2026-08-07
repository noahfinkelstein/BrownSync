import type { DateWindow } from "../sweep";

/**
 * Rows requested per fetch. NOTE the server does not honor small values — the
 * recorded response to this exact URL is 1000 rows (a server-side cap), so any
 * fetch returning >= this count is treated as truncated (see sweep.ts).
 *
 * Retained for the unsharded single-fetch path and for the recorded
 * `livewhale-events.json` fixture, which is that exact response.
 */
export const LIVEWHALE_MAX = 500;

/** Verified endpoint, contract §5. Poll <= every 10 min. */
export const LIVEWHALE_URL = `https://events.brown.edu/live/json/events?max=${LIVEWHALE_MAX}`;

export const LIVEWHALE_BASE_URL = "https://events.brown.edu/live/json/events";

/**
 * One bounded window. The parameters are PATH SEGMENTS — `?start_date=` is
 * silently ignored, `/start_date/` is honoured (verified). No `/max/` segment:
 * the server's own 1000-row cap is what the sharding reacts to, and pinning a
 * second cap on top would only make "at cap" ambiguous.
 */
export function livewhaleWindowUrl(window: DateWindow): string {
  return `${LIVEWHALE_BASE_URL}/start_date/${window.start}/end_date/${window.end}`;
}
