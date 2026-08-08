import { z } from "zod";
import { CategorySchema, OrgKindSchema, PlaceKindSchema } from "./taxonomy";

/**
 * Read-API response shapes — DATA_CONTRACT.md §3. These are FIXED; the
 * frontend and the future Swift client consume only these.
 */

export const EventOutSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    /** ISO-8601 UTC. */
    start: z.string(),
    end: z.string().nullable(),
    allDay: z.boolean(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    placeId: z.string().nullable(),
    placeName: z.string().nullable(),
    locationRaw: z.string().nullable(),
    orgId: z.string().nullable(),
    orgName: z.string().nullable(),
    category: CategorySchema,
    tags: z.array(z.string()),
    url: z.string().nullable(),
    cost: z.string().nullable(),
    source: z.string(),
    confidence: z.number(),
    isCanceled: z.boolean(),
    /** Sources merged into this canonical row (contract §3, dedup). */
    mergedSources: z.array(z.string()).optional(),
  })
  .meta({ id: "Event" });
export type EventOut = z.infer<typeof EventOutSchema>;

export const PlaceOutSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    aliases: z.array(z.string()),
    kind: PlaceKindSchema,
    lat: z.number(),
    lng: z.number(),
    address: z.string().nullable(),
  })
  .meta({ id: "Place" });
export type PlaceOut = z.infer<typeof PlaceOutSchema>;

export const OrgOutSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: OrgKindSchema,
    category: CategorySchema.nullable(),
    description: z.string().nullable(),
    url: z.string().nullable(),
    instagram: z.string().nullable(),
    defaultPlaceId: z.string().nullable(),
  })
  .meta({ id: "Org" });
export type OrgOut = z.infer<typeof OrgOutSchema>;

export const MeetingOutSchema = z
  .object({
    id: z.string(),
    courseCode: z.string(),
    title: z.string(),
    instructor: z.string().nullable(),
    /** Canonical day tokens M,T,W,Th,F,S,Su concatenated, e.g. "MWF", "TTh". */
    days: z.string(),
    /** "HH:MM" 24h, America/New_York wall time. */
    startTime: z.string(),
    endTime: z.string(),
    locationRaw: z.string().nullable(),
    placeId: z.string().nullable(),
    placeName: z.string().nullable(),
    room: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
  })
  .meta({ id: "Meeting" });
export type MeetingOut = z.infer<typeof MeetingOutSchema>;

export const EventDetailOutSchema = EventOutSchema.extend({
  org: OrgOutSchema.nullable(),
  place: PlaceOutSchema.nullable(),
}).meta({ id: "EventDetail" });
export type EventDetailOut = z.infer<typeof EventDetailOutSchema>;

export const OrgDetailOutSchema = OrgOutSchema.extend({
  upcoming: z.array(EventOutSchema),
  past: z.array(EventOutSchema),
}).meta({ id: "OrgDetail" });
export type OrgDetailOut = z.infer<typeof OrgDetailOutSchema>;

export const PlaceActivityOutSchema = z
  .object({
    place: PlaceOutSchema,
    events: z.array(EventOutSchema),
    meetings: z.array(MeetingOutSchema),
  })
  .meta({ id: "PlaceActivity" });
export type PlaceActivityOut = z.infer<typeof PlaceActivityOutSchema>;

export const NowOutSchema = z
  .object({
    events: z.array(EventOutSchema),
    meetings: z.array(MeetingOutSchema),
    countsByCategory: z.record(CategorySchema, z.number()),
  })
  .meta({ id: "Now" });
export type NowOut = z.infer<typeof NowOutSchema>;

export const SourceHealthSchema = z
  .object({
    source: z.string(),
    status: z.enum(["ok", "error", "partial", "never"]),
    lastRunAt: z.string().nullable(),
    lastOkAt: z.string().nullable(),
    itemsUpserted: z.number().nullable(),
    error: z.string().nullable(),
    /**
     * Per-source staleness horizon from `source_registry` (migration 0006):
     * seconds of silence after which this source should be shown as stale.
     *
     * OPTIONAL and nullable ON PURPOSE. A single global staleness constant
     * turns every slow-by-design source (ArcGIS weekly, dining daily)
     * permanently yellow, so the horizon has to be per-source — but a client
     * that ignores this field must keep working exactly as it does today, and
     * `null` (source not in the registry) explicitly means "use your own
     * default".
     */
    staleAfterSeconds: z.number().int().nullable().optional(),
    /**
     * False when the source is switched off — either a legal gate (BDH, ToS)
     * or a recorded refusal (robots.txt disallow, SSO wall). A disabled
     * source is a REPORTED state, never a silent omission; clients should
     * render it as paused rather than as a failure.
     */
    enabled: z.boolean().optional(),
    /** Display label from the registry; null means "keep your own mapping". */
    label: z.string().nullable().optional(),
  })
  .meta({ id: "SourceHealth" });
export const HealthOutSchema = z
  .object({
    sources: z.array(SourceHealthSchema),
  })
  .meta({ id: "Health" });
export type HealthOut = z.infer<typeof HealthOutSchema>;

/** Query params. bbox = "w,s,e,n" (lng/lat). */
export const BboxSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
  .transform((s) => {
    const [w, sVal, e, n] = s.split(",").map(Number) as [number, number, number, number];
    return { w, s: sVal, e, n };
  });

export const EventsQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  bbox: BboxSchema.optional(),
  category: CategorySchema.optional(),
  q: z.string().min(1).max(200).optional(),
});
export type EventsQuery = z.infer<typeof EventsQuerySchema>;

export const AtQuerySchema = z.object({
  at: z.iso.datetime({ offset: true }).optional(),
});
export type AtQuery = z.infer<typeof AtQuerySchema>;

/**
 * Contract v1.9 — articles (news headlines) as their own read shape, backed
 * by the `articles` table (migration 0021) rather than by `events`.
 *
 * `license` is exposed ON PURPOSE so no client can render more than the
 * source permits: `headline_only` rows carry title+URL+date and nothing else
 * — the database CHECK physically rejects body text for them. `publication`
 * is the registry display label ("Brown News") so attribution + click-through
 * is structural, not a client-side lookup table.
 */
export const ArticleLicenseSchema = z
  .enum(["headline_only", "excerpt", "full"])
  .meta({ id: "ArticleLicense" });
export type ArticleLicense = z.infer<typeof ArticleLicenseSchema>;

export const ArticleOutSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    /** Canonical off-site link — the click-through attribution target. */
    url: z.string(),
    /** ISO-8601 UTC. */
    publishedAt: z.string(),
    author: z.string().nullable(),
    /** Registry slug, e.g. "brown_news". */
    source: z.string(),
    /** Registry display label for attribution, e.g. "Brown News". */
    publication: z.string(),
    license: ArticleLicenseSchema,
  })
  .meta({ id: "Article" });
export type ArticleOut = z.infer<typeof ArticleOutSchema>;

export const ArticlesQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type ArticlesQuery = z.infer<typeof ArticlesQuerySchema>;
