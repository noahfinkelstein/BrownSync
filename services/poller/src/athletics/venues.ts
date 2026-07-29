import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AthleticsVenuesSchema } from "@brownsync/contract";
import { SEEDS_DIR } from "../paths";
import { type VenueToPlace, venueKey } from "./normalize";

const VENUES_FILE = path.join(SEEDS_DIR, "athletics_venues.json");

/**
 * The ingestion lane emits db/seeds/athletics_venues.json ({ schema_version: 1,
 * generated_at, mappings: [{ source_name, place_id }] } — sidecar schema v1,
 * coordinated with the ingestion lane) mapping SIDEARM home-venue strings
 * ("Stevenson-Pincince Field") to gazetteer place ids. READ-ONLY: this package
 * never writes into db/seeds. Missing file → empty map (place_id stays null,
 * location_raw is kept — contract §2 place resolution never guesses); a
 * present-but-malformed file throws so schema drift fails the run loudly
 * instead of silently dropping resolution.
 */
export function loadAthleticsVenues(file: string = VENUES_FILE): VenueToPlace {
  if (!existsSync(file)) return new Map();
  const sidecar = AthleticsVenuesSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const byVenue = new Map<string, string>();
  for (const { source_name, place_id } of sidecar.mappings) {
    byVenue.set(venueKey(source_name), place_id);
  }
  return byVenue;
}
