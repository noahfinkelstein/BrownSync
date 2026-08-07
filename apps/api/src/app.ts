import {
  EventDetailOutSchema,
  HealthOutSchema,
  MeOutSchema,
  NowOutSchema,
  OrgDetailOutSchema,
  OrgEnrichedDetailSchema,
  PlaceActivityOutSchema,
} from "@brownsync/contract";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import {
  type AccountDeleter,
  type AuthEnv,
  type Authenticator,
  createRecentAuthenticationMiddleware,
  createUnavailableAccountDeleter,
  createUnavailableAuthenticator,
  createUserWriteRateLimitMiddleware,
  type RateLimiterBinding,
} from "./auth";
import { type BoardIdentity, createBoardIdentity } from "./board-identity";
import type { BoardQueries } from "./board-queries";
import { registerBoardRoutes } from "./board-routes";
import { errorEnvelope, isDbUnavailable } from "./errors";
import {
  aggregateHealth,
  buildCountsByCategory,
  mapEvent,
  mapMeeting,
  mapOrg,
  mapOrgEnrichment,
  mapPlace,
} from "./mappers";
import type { OrgAssetQueries } from "./org-asset-queries";
import { registerOrgAssetRoutes } from "./org-asset-routes";
import type {
  IdFactory,
  ImageProcessor,
  InstagramOEmbedClient,
  MediaCleanupScheduler,
  MediaObjectStore,
} from "./org-asset-services";
import { registerOrganizationRoutes } from "./organization-routes";
import type { Queries } from "./queries";
import {
  ErrorEnvelopeSchema,
  EventsResponseSchema,
  eventByIdRoute,
  eventsRoute,
  healthRoute,
  MeetingsResponseSchema,
  meetingsRoute,
  nowRoute,
  OrgsResponseSchema,
  orgByIdRoute,
  orgProfileRoute,
  orgsRoute,
  PlacesResponseSchema,
  placeActivityRoute,
  placesRoute,
} from "./routes";
import { registerUserEventRoutes } from "./user-event-routes";

/** /api/events default window when `to` is omitted: from + 7 days. */
const EVENTS_DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** /api/now looks ahead 2 h: "in progress or starting soon". */
const NOW_LOOKAHEAD_MS = 2 * 60 * 60 * 1000;
/** /api/places/:id/activity event window: [at, at + 24 h]. */
const ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function createCorsOriginResolver(
  configuredOrigins: string | undefined,
): (origin: string) => string | null {
  const extraOrigins = new Set(
    (configuredOrigins ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );
  return (origin) => (LOCALHOST_ORIGIN.test(origin) || extraOrigins.has(origin) ? origin : null);
}

const meJson = <S>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const meRoute = createRoute({
  method: "get",
  path: "/api/me",
  summary: "Authenticated BrownSync identity",
  security: [{ bearerAuth: [] }],
  responses: {
    200: meJson(MeOutSchema, "Verified Brown Google identity"),
    401: meJson(ErrorEnvelopeSchema, "Missing or invalid bearer token"),
    403: meJson(ErrorEnvelopeSchema, "Brown Google membership required"),
    503: meJson(ErrorEnvelopeSchema, "Authentication temporarily unavailable"),
  },
});

const accountRoute = createRoute({
  method: "delete",
  path: "/api/account",
  summary: "Delete the authenticated BrownSync account",
  security: [{ bearerAuth: [] }],
  responses: {
    204: { description: "Account deleted" },
    401: meJson(ErrorEnvelopeSchema, "Missing or invalid bearer token"),
    403: meJson(
      ErrorEnvelopeSchema,
      "Brown Google membership and recent OAuth authentication required",
    ),
    429: meJson(ErrorEnvelopeSchema, "Authenticated write rate limit exceeded"),
    503: meJson(ErrorEnvelopeSchema, "Account service temporarily unavailable"),
  },
});

function deleteOnly(middleware: MiddlewareHandler<AuthEnv>): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    if (c.req.method !== "DELETE") {
      await next();
      return;
    }
    return middleware(c, next);
  };
}

export type CreateAppOptions = {
  authenticator?: Authenticator;
  userReadLimiter?: RateLimiterBinding;
  userWriteLimiter?: RateLimiterBinding;
  accountDeleter?: AccountDeleter;
  orgAssetQueries?: OrgAssetQueries;
  mediaWriteLimiter?: RateLimiterBinding;
  socialWriteLimiter?: RateLimiterBinding;
  boardQueries?: BoardQueries;
  boardIdentity?: BoardIdentity;
  boardWriteLimiter?: RateLimiterBinding;
  imageProcessor?: ImageProcessor;
  objectStore?: MediaObjectStore;
  instagramClient?: InstagramOEmbedClient;
  cleanupScheduler?: MediaCleanupScheduler;
  idFactory?: IdFactory;
  embedOrigin?: string | null;
};

const unavailableOrgAssetQueries = new Proxy({} as OrgAssetQueries, {
  get() {
    return async () => ({ kind: "unavailable" as const });
  },
});

const unavailableBoardQueries = new Proxy({} as BoardQueries, {
  get() {
    return async () => ({ kind: "unavailable" as const });
  },
});

/**
 * Contract Out-schema validation of response bodies — on everywhere except
 * production, so a mapper/SQL drift fails loudly in dev/test instead of
 * shipping a malformed payload.
 */
function validated<T>(schema: { parse: (input: unknown) => T }, body: T): T {
  if (process.env.NODE_ENV === "production") return body;
  return schema.parse(body);
}

/**
 * Thin route layer over an injected `Queries` implementation (src/queries.ts
 * in production, fakes in tests). All handlers are pure orchestration:
 * validate → query → map → validate response.
 */
export function createApp(queries: Queries, options: CreateAppOptions = {}) {
  const app = new OpenAPIHono<AuthEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const detail = result.error.issues
          .map((issue) => {
            const path = issue.path.join(".");
            return path === "" ? issue.message : `${path}: ${issue.message}`;
          })
          .join("; ");
        return c.json(errorEnvelope("bad_request", detail), 400);
      }
    },
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });
  // CORS for local dev (web app on any localhost port); extra origins via
  // env CORS_ORIGINS="https://brownsync.example,https://…" for deploys.
  app.use("/api/*", async (c, next) => {
    await next();
    if (c.res.headers.has("Access-Control-Allow-Origin") && c.res.headers.has("Retry-After")) {
      c.res.headers.set("Access-Control-Expose-Headers", "Retry-After");
    } else if (!c.res.headers.has("Access-Control-Allow-Origin")) {
      c.res.headers.delete("Access-Control-Expose-Headers");
    }
  });
  app.use(
    "/api/*",
    cors({
      origin: createCorsOriginResolver(process.env.CORS_ORIGINS),
    }),
  );

  app.onError((err, c) => {
    if (err instanceof HTTPException && err.status === 400) {
      return c.json(errorEnvelope("bad_request", "Malformed request body."), 400);
    }
    if (isDbUnavailable(err)) {
      return c.json(
        errorEnvelope("db_unavailable", "Database unreachable — try again shortly."),
        503,
      );
    }
    console.error("[api] unhandled error:", err);
    return c.json(errorEnvelope("internal", "Unexpected server error."), 500);
  });

  app.notFound((c) => c.json(errorEnvelope("not_found", "No such route."), 404));

  app.use("/api/me", options.authenticator ?? createUnavailableAuthenticator());
  app.openapi(meRoute, (c) => {
    const user = c.get("user");
    return c.json(validated(MeOutSchema, user), 200);
  });

  app.use("/api/account", deleteOnly(options.authenticator ?? createUnavailableAuthenticator()));
  app.use("/api/account", deleteOnly(createRecentAuthenticationMiddleware()));
  app.use("/api/account", deleteOnly(createUserWriteRateLimitMiddleware(options.userWriteLimiter)));
  app.openapi(accountRoute, async (c) => {
    const accountDeleter = options.accountDeleter ?? createUnavailableAccountDeleter();
    let result: Awaited<ReturnType<AccountDeleter>>;
    try {
      result = await accountDeleter(c.get("user"));
    } catch {
      result = "unavailable";
    }
    if (result !== "deleted") {
      return c.json(
        errorEnvelope("account_service_unavailable", "Account service temporarily unavailable."),
        503,
      );
    }
    return c.body(null, 204);
  });

  registerBoardRoutes(app, options.boardQueries ?? unavailableBoardQueries, {
    authenticator: options.authenticator ?? createUnavailableAuthenticator(),
    boardIdentity: options.boardIdentity ?? createBoardIdentity({}),
    boardWriteLimiter: options.boardWriteLimiter,
  });

  registerOrganizationRoutes(app, queries, {
    authenticator: options.authenticator ?? createUnavailableAuthenticator(),
    userReadLimiter: options.userReadLimiter,
    userWriteLimiter: options.userWriteLimiter,
  });
  registerUserEventRoutes(app, queries, {
    authenticator: options.authenticator ?? createUnavailableAuthenticator(),
    userReadLimiter: options.userReadLimiter,
    userWriteLimiter: options.userWriteLimiter,
  });
  registerOrgAssetRoutes(app, options.orgAssetQueries ?? unavailableOrgAssetQueries, {
    authenticator: options.authenticator ?? createUnavailableAuthenticator(),
    mediaWriteLimiter: options.mediaWriteLimiter,
    socialWriteLimiter: options.socialWriteLimiter,
    imageProcessor: options.imageProcessor,
    objectStore: options.objectStore,
    instagramClient: options.instagramClient,
    cleanupScheduler: options.cleanupScheduler,
    idFactory: options.idFactory,
    embedOrigin: options.embedOrigin,
  });

  app.openapi(eventsRoute, async (c) => {
    const query = c.req.valid("query");
    const from = query.from !== undefined ? new Date(query.from) : new Date();
    const to =
      query.to !== undefined
        ? new Date(query.to)
        : new Date(from.getTime() + EVENTS_DEFAULT_WINDOW_MS);
    const rows = await queries.events({
      from,
      to,
      bbox: query.bbox,
      category: query.category,
      q: query.q,
    });
    return c.json(validated(EventsResponseSchema, { events: rows.map(mapEvent) }), 200);
  });

  app.openapi(eventByIdRoute, async (c) => {
    const { id } = c.req.valid("param");
    const row = await queries.eventById(id);
    if (row === null) {
      return c.json(errorEnvelope("not_found", `No event ${id}.`), 404);
    }
    const [place, org] = await Promise.all([
      row.place_id !== null ? queries.placeById(row.place_id) : null,
      row.org_id !== null ? queries.orgById(row.org_id) : null,
    ]);
    const body = {
      ...mapEvent(row),
      org: org === null ? null : mapOrg(org),
      place: place === null ? null : mapPlace(place),
    };
    return c.json(validated(EventDetailOutSchema, body), 200);
  });

  app.openapi(placesRoute, async (c) => {
    const rows = await queries.places();
    return c.json(validated(PlacesResponseSchema, { places: rows.map(mapPlace) }), 200);
  });

  app.openapi(placeActivityRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { at } = c.req.valid("query");
    const placeRow = await queries.placeById(id);
    if (placeRow === null) {
      return c.json(errorEnvelope("not_found", `No place ${id}.`), 404);
    }
    const atDate = at !== undefined ? new Date(at) : new Date();
    const [events, meetings] = await Promise.all([
      queries.eventsByPlace(id, atDate, new Date(atDate.getTime() + ACTIVITY_WINDOW_MS)),
      queries.meetingsAtByPlace(atDate, id),
    ]);
    const body = {
      place: mapPlace(placeRow),
      events: events.map(mapEvent),
      meetings: meetings.map(mapMeeting),
    };
    return c.json(validated(PlaceActivityOutSchema, body), 200);
  });

  app.openapi(orgsRoute, async (c) => {
    const rows = await queries.orgs();
    return c.json(validated(OrgsResponseSchema, { orgs: rows.map(mapOrg) }), 200);
  });

  app.openapi(orgByIdRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { at } = c.req.valid("query");
    const orgRow = await queries.orgById(id);
    if (orgRow === null) {
      return c.json(errorEnvelope("not_found", `No org ${id}.`), 404);
    }
    const pivot = at !== undefined ? new Date(at) : new Date();
    const { upcoming, past } = await queries.eventsByOrg(id, pivot);
    const body = {
      ...mapOrg(orgRow),
      upcoming: upcoming.map(mapEvent),
      past: past.map(mapEvent),
    };
    return c.json(validated(OrgDetailOutSchema, body), 200);
  });

  app.openapi(orgProfileRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { at } = c.req.valid("query");
    const orgRow = await queries.orgById(id);
    if (orgRow === null) {
      return c.json(errorEnvelope("not_found", `No org ${id}.`), 404);
    }
    const pivot = at !== undefined ? new Date(at) : new Date();
    const { upcoming, past } = await queries.eventsByOrg(id, pivot);
    const body = {
      ...mapOrg(orgRow),
      upcoming: upcoming.map(mapEvent),
      past: past.map(mapEvent),
      ...mapOrgEnrichment(orgRow),
    };
    return c.json(validated(OrgEnrichedDetailSchema, body), 200);
  });

  app.openapi(meetingsRoute, async (c) => {
    const { at } = c.req.valid("query");
    const rows = await queries.meetingsAt(at !== undefined ? new Date(at) : new Date());
    return c.json(validated(MeetingsResponseSchema, { meetings: rows.map(mapMeeting) }), 200);
  });

  app.openapi(nowRoute, async (c) => {
    const now = new Date();
    const [eventRows, meetingRows] = await Promise.all([
      queries.events({ from: now, to: new Date(now.getTime() + NOW_LOOKAHEAD_MS) }),
      queries.meetingsAt(now),
    ]);
    const events = eventRows.map(mapEvent);
    const meetings = meetingRows.map(mapMeeting);
    const body = {
      events,
      meetings,
      countsByCategory: buildCountsByCategory(events, meetings.length),
    };
    return c.json(validated(NowOutSchema, body), 200);
  });

  app.openapi(healthRoute, async (c) => {
    const rows = await queries.health();
    return c.json(validated(HealthOutSchema, aggregateHealth(rows)), 200);
  });

  // The document the `openapi` script writes to packages/contract/openapi.json,
  // also served for humans/tools poking at a running instance.
  app.get("/api/openapi.json", (c) => c.json(buildOpenApiDocument(app)));

  return app;
}

export function buildOpenApiDocument(app: ReturnType<typeof createApp>) {
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "BrownSync API",
      version: "0.1.0",
      description:
        "Public read endpoints and protected account operations over the BrownSync canonical schema. " +
        "Consumed by apps/web and the SwiftUI client via codegen.",
    },
    servers: [{ url: "http://localhost:8787", description: "local dev" }],
  });
}
