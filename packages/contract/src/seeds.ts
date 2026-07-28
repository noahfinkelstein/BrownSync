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

/** Sidecar emitted by ingestion: org id → LiveWhale group name (contract v1 has no organizations.raw column). */
export const OrgLivewhaleGroupsSchema = z.record(z.string(), z.string());
export type OrgLivewhaleGroups = z.infer<typeof OrgLivewhaleGroupsSchema>;
