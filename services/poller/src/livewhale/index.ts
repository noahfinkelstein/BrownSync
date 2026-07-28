import type { SourceModule } from "../types";
import { normalizeLivewhaleFeed } from "./normalize";
import { loadOrgGroups } from "./orgs";

export * from "./categories";
export * from "./normalize";
export * from "./orgs";
export * from "./schema";

/**
 * Rows requested per fetch. NOTE the server does not honor small values — the
 * recorded response to this exact URL is 1000 rows (a server-side cap), so any
 * fetch returning >= this count is treated as truncated (see sweep.ts).
 */
export const LIVEWHALE_MAX = 500;

/** Verified endpoint, contract §5. Poll <= every 10 min. */
export const LIVEWHALE_URL = `https://events.brown.edu/live/json/events?max=${LIVEWHALE_MAX}`;

export const livewhaleModule: SourceModule = {
  source: "livewhale",
  cliName: "livewhale",
  endpoint: LIVEWHALE_URL,
  defaultFixture: "livewhale-events.json",
  sweep: true,
  requestedMax: LIVEWHALE_MAX,
  normalize: (rawText) => normalizeLivewhaleFeed(rawText, loadOrgGroups()),
};
