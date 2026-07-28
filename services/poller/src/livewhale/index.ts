import type { SourceModule } from "../types";
import { normalizeLivewhaleFeed } from "./normalize";
import { loadOrgGroups } from "./orgs";

export * from "./categories";
export * from "./normalize";
export * from "./orgs";
export * from "./schema";

/** Verified endpoint, contract §5. Poll <= every 10 min. */
export const LIVEWHALE_URL = "https://events.brown.edu/live/json/events?max=500";

export const livewhaleModule: SourceModule = {
  source: "livewhale",
  cliName: "livewhale",
  endpoint: LIVEWHALE_URL,
  defaultFixture: "livewhale-events.json",
  sweep: true,
  normalize: (rawText) => normalizeLivewhaleFeed(rawText, loadOrgGroups()),
};
