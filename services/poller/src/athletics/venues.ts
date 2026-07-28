import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SEEDS_DIR } from "../paths";
import { type VenueToPlace, venueKey } from "./normalize";

const VENUES_FILE = path.join(SEEDS_DIR, "athletics_venues.json");

/** { "<venue string as it appears in the ICS>": "<place_id>" } — Codex-emitted sidecar. */
const AthleticsVenuesSchema = z.record(z.string(), z.string());

/**
 * Codex emits db/seeds/athletics_venues.json mapping home-venue strings
 * ("Stevenson-Pincince Field") to gazetteer place ids. READ-ONLY: this package
 * never writes into db/seeds. Missing file → empty map (place_id stays null,
 * location_raw is kept — contract §2 place resolution never guesses).
 */
export function loadAthleticsVenues(file: string = VENUES_FILE): VenueToPlace {
  if (!existsSync(file)) return new Map();
  const parsed = AthleticsVenuesSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const byVenue = new Map<string, string>();
  for (const [venue, placeId] of Object.entries(parsed)) {
    byVenue.set(venueKey(venue), placeId);
  }
  return byVenue;
}
