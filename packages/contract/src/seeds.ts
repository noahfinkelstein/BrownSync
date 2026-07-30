import { z } from "zod";
import { CategorySchema, OrgKindSchema, PlaceKindSchema } from "./taxonomy";

/**
 * NDJSON seed-row shapes — DATA_CONTRACT.md §6, mirroring the DB columns in
 * §1 (snake_case, exactly as ingestion emits them). db/seed.ts validates
 * every line against these before touching the database.
 */

const isoTs = z.iso.datetime({ offset: true });
/** "HH:MM" or "HH:MM:SS", 24h. */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/);
/** Canonical day tokens (contract §1): M,T,W,Th,F,S,Su concatenated. */
const daysPattern = z.string().regex(/^(Su|Th|M|T|W|F|S)+$/);

export const SeedPlaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  kind: PlaceKindSchema,
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  /** WKT MULTIPOLYGON(...) in EPSG:4326, or null. */
  polygon: z.string().nullish(),
  address: z.string().nullish(),
  osm_id: z.string().nullish(),
  source: z.string().default("osm"),
});
export type SeedPlace = z.infer<typeof SeedPlaceSchema>;

export const SeedOrganizationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: OrgKindSchema,
  category: CategorySchema.nullish(),
  description: z.string().nullish(),
  url: z.string().nullish(),
  instagram: z.string().nullish(),
  contact_emails: z.array(z.string().min(1)).default([]),
  advisor: z.string().nullish(),
  funding_category: z.string().nullish(),
  website_url: z.string().nullish(),
  facebook_url: z.string().nullish(),
  linkedin_url: z.string().nullish(),
  youtube_url: z.string().nullish(),
  twitter_url: z.string().nullish(),
  tiktok_url: z.string().nullish(),
  default_place_id: z.string().nullish(),
  source: z.string().min(1),
});
export type SeedOrganization = z.infer<typeof SeedOrganizationSchema>;

export const SeedEventSchema = z.object({
  source: z.string().min(1),
  source_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullish(),
  start_ts: isoTs,
  end_ts: isoTs.nullish(),
  is_all_day: z.boolean().default(false),
  rrule: z.string().nullish(),
  location_raw: z.string().nullish(),
  place_id: z.string().nullish(),
  lat: z.number().gte(-90).lte(90).nullish(),
  lng: z.number().gte(-180).lte(180).nullish(),
  org_id: z.string().nullish(),
  category: CategorySchema.nullish(),
  tags: z.array(z.string()).default([]),
  url: z.string().nullish(),
  cost: z.string().nullish(),
  confidence: z.number().gt(0).lte(1).default(1),
  is_canceled: z.boolean().default(false),
  raw: z.unknown().nullish(),
});
export type SeedEvent = z.infer<typeof SeedEventSchema>;

export const SeedCourseMeetingSchema = z.object({
  id: z.string().min(1),
  srcdb: z.string().min(1),
  crn: z.string().min(1),
  course_code: z.string().min(1),
  title: z.string().min(1),
  instructor: z.string().nullish(),
  days: daysPattern,
  start_time: timeOfDay,
  end_time: timeOfDay,
  location_raw: z.string().nullish(),
  place_id: z.string().nullish(),
  room: z.string().nullish(),
  enrollment: z.number().int().nullish(),
  raw: z.unknown().nullish(),
});
export type SeedCourseMeeting = z.infer<typeof SeedCourseMeetingSchema>;

export const SeedSourceRunSchema = z.object({
  source: z.string().min(1),
  started_at: isoTs,
  finished_at: isoTs.nullish(),
  status: z.enum(["ok", "error", "partial"]),
  items_upserted: z.number().int().nullish(),
  error: z.string().nullish(),
});
export type SeedSourceRun = z.infer<typeof SeedSourceRunSchema>;

/**
 * Sidecar emitted by ingestion at db/seeds/organization_livewhale_groups.json:
 * links org ids to the LiveWhale publisher group names their events appear
 * under (contract v1 has no organizations.raw column). The file may not exist
 * yet — consumers must tolerate its absence. `schema_version` is a literal so
 * a future v2 fails loudly instead of being half-read.
 *
 * Shape is sidecar schema v1, coordinated with the ingestion lane's execution
 * plan — field-for-field:
 * `{"schema_version": 1, "generated_at": "<UTC ISO>", "mappings":
 *   [{"organization_id": "<slug>", "livewhale_group": "<source name>",
 *     "match_method": "exact|fuzzy", "score": <0..100>}]}`
 */
export const OrgLivewhaleGroupsSchema = z.object({
  schema_version: z.literal(1),
  /** UTC ISO timestamp of when ingestion generated the file. */
  generated_at: isoTs,
  mappings: z.array(
    z.object({
      organization_id: z.string().min(1),
      livewhale_group: z.string().min(1),
      /** How ingestion matched the org name to the LiveWhale group. */
      match_method: z.enum(["exact", "fuzzy"]),
      /** Match confidence 0..100; higher wins when two orgs claim the same group. */
      score: z.number().min(0).max(100),
    }),
  ),
});
export type OrgLivewhaleGroups = z.infer<typeof OrgLivewhaleGroupsSchema>;

/**
 * Sidecar emitted by ingestion at db/seeds/athletics_venues.json: maps SIDEARM
 * home-venue strings as they appear in the athletics ICS LOCATION
 * ("Stevenson-Pincince Field", "OMAC") to gazetteer place ids. The file may
 * not exist yet — consumers must tolerate its absence. `schema_version` is a
 * literal so a future v2 fails loudly instead of being half-read.
 *
 * Shape is sidecar schema v1, coordinated with the ingestion lane's execution
 * plan — field-for-field:
 * `{"schema_version": 1, "generated_at": "<UTC ISO>", "mappings":
 *   [{"source_name": "<SIDEARM venue string>", "place_id": "<canonical slug>"}]}`
 */
/**
 * Manifest emitted by ingestion at db/seeds/manifest.json alongside the seed
 * artifacts: one entry per published file with its byte length and sha256, so
 * consumers can verify the artifact set is complete and untampered before
 * loading. Mirrors the file the ingestion lane already publishes,
 * field-for-field:
 * `{"schema_version": 1, "generated_at": "<UTC ISO>", "generation": "<hex>",
 *   "artifacts": {"<filename>": {"bytes": <int>, "sha256": "<hex64>"}}}`
 * `schema_version` is a literal so a future v2 fails loudly instead of being
 * half-read. Verified offline by `pnpm db:seed-check` (db/seed-check.ts).
 */
export const SeedManifestSchema = z.object({
  schema_version: z.literal(1),
  /** UTC ISO timestamp of when ingestion generated the manifest. */
  generated_at: isoTs,
  /** Opaque generation id tying the artifacts of one publish together. */
  generation: z.string().min(1),
  artifacts: z.record(
    z.string().min(1),
    z.object({
      bytes: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});
export type SeedManifest = z.infer<typeof SeedManifestSchema>;

export const AthleticsVenuesSchema = z.object({
  schema_version: z.literal(1),
  /** UTC ISO timestamp of when ingestion generated the file. */
  generated_at: isoTs,
  mappings: z.array(
    z.object({
      /** Venue string exactly as SIDEARM emits it in the ICS LOCATION. */
      source_name: z.string().min(1),
      /** Canonical gazetteer place slug. */
      place_id: z.string().min(1),
    }),
  ),
});
export type AthleticsVenues = z.infer<typeof AthleticsVenuesSchema>;

/**
 * Sidecar emitted by ingestion at db/seeds/brown_owned_buildings.json: the
 * Brown-owned building footprints the map tints — OSM way ids for the
 * export-backed footprints, plus published gazetteer place slugs carrying the
 * relation-backed Brown buildings (Kassar House, Barbour Hall,
 * Verney-Woolley) that way ids cannot express. The file may not exist yet —
 * consumers must tolerate its absence. `schema_version` is a literal so a
 * future v2 fails loudly instead of being half-read.
 *
 * Shape is sidecar schema v1, pinned field-for-field to the ingestion
 * register (reports/app_side_dependencies.md §5):
 * `{"schema_version": 1, "generated_at": "<UTC ISO>", "attribution":
 *   "<OpenStreetMap/ODbL credit>", "osm_way_ids": [<int>, ...],
 *   "place_ids": ["<slug>", ...]}`
 * The `attribution` key is mandated by the register's ODbL constraint on
 * OSM-derived output — it must credit OpenStreetMap, and any consumer
 * rendering the tint must surface it.
 */
export const BrownOwnedBuildingsSchema = z.object({
  schema_version: z.literal(1),
  /** UTC ISO timestamp of when ingestion generated the file. */
  generated_at: isoTs,
  /** ODbL-mandated credit for the OSM-derived way ids — must name OpenStreetMap. */
  attribution: z.string().includes("OpenStreetMap"),
  /** OSM way ids of Brown-owned building footprints (producer emits sorted unique). */
  osm_way_ids: z.array(z.number().int().positive()),
  /** Canonical gazetteer place slugs for the relation-backed Brown buildings. */
  place_ids: z.array(z.string().min(1)),
});
export type BrownOwnedBuildings = z.infer<typeof BrownOwnedBuildingsSchema>;
