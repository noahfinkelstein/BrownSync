import { z } from "zod";

/**
 * Shape of one LiveWhale event, derived from the recorded real response
 * (fixtures/livewhale-events.json, GET https://events.brown.edu/live/json/events?max=500,
 * 2026-07-28). Loose objects: unknown fields pass through into `raw` untouched.
 *
 * Quirks observed in the real feed and encoded here:
 * - `location_longitude` arrives as a string, `location_latitude` as a number
 * - `cost` is null | string ("Free") | number (15)
 * - `is_canceled` / `is_all_day` may be boolean, 0/1 or null
 * - `event_types` entries can carry stray leading whitespace (" Open to the Public")
 * - repeat series are pre-expanded: one row per occurrence sharing `id`, with
 *   `id` + `date_ts` unique across the feed (919 ids / 1000 rows in the fixture)
 */
export const LivewhaleEventSchema = z.looseObject({
  id: z.number(),
  title: z.string(),
  url: z.string().nullish(),
  /** "YYYY-MM-DD HH:MM:SS" already in UTC. */
  date_utc: z.string(),
  /** ISO 8601 with offset — fallback if date_utc is malformed. */
  date_iso: z.string().nullish(),
  date_ts: z.number(),
  date2_utc: z.string().nullish(),
  date2_iso: z.string().nullish(),
  is_all_day: z.union([z.boolean(), z.number()]).nullish(),
  repeats: z.string().nullish(),
  is_canceled: z.union([z.boolean(), z.number()]).nullish(),
  description: z.string().nullish(),
  cost: z.union([z.string(), z.number()]).nullish(),
  location: z.string().nullish(),
  location_title: z.string().nullish(),
  location_latitude: z.union([z.number(), z.string()]).nullish(),
  location_longitude: z.union([z.number(), z.string()]).nullish(),
  event_types: z.array(z.string()).nullish(),
  tags: z.array(z.string()).nullish(),
  group: z.string().nullish(),
});

export type LivewhaleEvent = z.infer<typeof LivewhaleEventSchema>;

export const LivewhaleFeedSchema = z.array(LivewhaleEventSchema);
