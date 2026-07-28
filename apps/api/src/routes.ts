import {
  AtQuerySchema,
  EventDetailOutSchema,
  EventOutSchema,
  EventsQuerySchema,
  HealthOutSchema,
  MeetingOutSchema,
  NowOutSchema,
  OrgDetailOutSchema,
  OrgOutSchema,
  PlaceActivityOutSchema,
  PlaceOutSchema,
} from "@brownsync/contract";
import { createRoute, z } from "@hono/zod-openapi";

/**
 * OpenAPI route definitions — DATA_CONTRACT.md §3 routes, verbatim paths.
 * Handlers live in src/app.ts; this file is shape-only so the emitted
 * packages/contract/openapi.json (future Swift codegen input) stays in one
 * reviewable place.
 */

export const ErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const EventsResponseSchema = z.object({ events: z.array(EventOutSchema) });
export const PlacesResponseSchema = z.object({ places: z.array(PlaceOutSchema) });
export const OrgsResponseSchema = z.object({ orgs: z.array(OrgOutSchema) });
export const MeetingsResponseSchema = z.object({ meetings: z.array(MeetingOutSchema) });

const json = <S>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const badRequest = json(ErrorEnvelopeSchema, "Malformed query/path parameters");
const notFound = json(ErrorEnvelopeSchema, "No such resource");
const unavailable = json(ErrorEnvelopeSchema, "Database unreachable");

export const eventsRoute = createRoute({
  method: "get",
  path: "/api/events",
  summary: "Canonical events, filterable by time window, bbox, category, and text",
  description:
    "Time filtering is overlap semantics. Defaults: from=now, to=from+7 days. " +
    "bbox is 'w,s,e,n' (lng/lat). q ranks substring hits above trigram-fuzzy hits.",
  request: { query: EventsQuerySchema },
  responses: {
    200: json(EventsResponseSchema, "Matching canonical events (max 500)"),
    400: badRequest,
    503: unavailable,
  },
});

export const eventByIdRoute = createRoute({
  method: "get",
  path: "/api/events/{id}",
  summary: "One event with org and place expanded",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: json(EventDetailOutSchema, "The event"),
    400: badRequest,
    404: notFound,
    503: unavailable,
  },
});

export const placesRoute = createRoute({
  method: "get",
  path: "/api/places",
  summary: "The campus gazetteer",
  responses: {
    200: json(PlacesResponseSchema, "All places, name-sorted"),
    503: unavailable,
  },
});

export const placeActivityRoute = createRoute({
  method: "get",
  path: "/api/places/{id}/activity",
  summary: "A place plus everything happening there around instant `at`",
  description:
    "Events overlapping [at, at+24h] and course meetings in session at `at`. Default at=now.",
  request: { params: z.object({ id: z.string().min(1) }), query: AtQuerySchema },
  responses: {
    200: json(PlaceActivityOutSchema, "Place, events, meetings"),
    400: badRequest,
    404: notFound,
    503: unavailable,
  },
});

export const orgsRoute = createRoute({
  method: "get",
  path: "/api/orgs",
  summary: "All organizations",
  responses: {
    200: json(OrgsResponseSchema, "All organizations, name-sorted"),
    503: unavailable,
  },
});

export const orgByIdRoute = createRoute({
  method: "get",
  path: "/api/orgs/{id}",
  summary: "One organization with upcoming and past events",
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: json(OrgDetailOutSchema, "Org detail"),
    400: badRequest,
    404: notFound,
    503: unavailable,
  },
});

export const meetingsRoute = createRoute({
  method: "get",
  path: "/api/meetings",
  summary: "Course meetings in session at instant `at`",
  description:
    "Server expands weekly day patterns + America/New_York times against the term calendar. " +
    "Default at=now.",
  request: { query: AtQuerySchema },
  responses: {
    200: json(MeetingsResponseSchema, "Meetings in session"),
    400: badRequest,
    503: unavailable,
  },
});

export const nowRoute = createRoute({
  method: "get",
  path: "/api/now",
  summary: "Default live view: events in progress or starting within 2h, meetings, counts",
  responses: {
    200: json(NowOutSchema, "Events, meetings, countsByCategory (all 10 keys)"),
    503: unavailable,
  },
});

export const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  summary: "Per-source ingestion health from source_runs",
  responses: {
    200: json(HealthOutSchema, "Latest run + latest ok per source; 'never' if no runs"),
    503: unavailable,
  },
});
