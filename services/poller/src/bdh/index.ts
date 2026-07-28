import type { SourceModule } from "../types";
import { normalizeBdh } from "./normalize";

export * from "./normalize";

/** Verified endpoint, contract §5 (302-redirects; the client follows). */
export const BDH_URL = "https://www.browndailyherald.com/feed";

export const bdhModule: SourceModule = {
  source: "bdh",
  cliName: "bdh",
  endpoint: BDH_URL,
  defaultFixture: "bdh-feed.xml",
  // Rolling top-N article feed, not a full window — absence != cancellation.
  sweep: false,
  normalize: normalizeBdh,
};
