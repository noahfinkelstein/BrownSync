import type { SourceModule } from "../types";
import { normalizeAthletics } from "./normalize";
import { loadAthleticsVenues } from "./venues";

export * from "./normalize";
export * from "./venues";

/** Verified endpoint, contract §5. All sports, full season. */
export const ATHLETICS_URL = "https://brownbears.com/calendar.ashx/calendar.ics";

export const athleticsModule: SourceModule = {
  source: "athletics_ics",
  cliName: "athletics",
  endpoint: ATHLETICS_URL,
  defaultFixture: "athletics-calendar.ics",
  sweep: true,
  normalize: (rawText) => normalizeAthletics(rawText, loadAthleticsVenues()),
};
