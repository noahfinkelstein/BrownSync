import {
  MyUserEventsQuerySchema,
  MyUserEventsSchema,
  type UserEventCreateRequest,
  UserEventCreateRequestSchema,
  UserEventCreateResultSchema,
  type UserEventEditPatch,
  type UserEventEditRequest,
  UserEventEditRequestSchema,
  UserEventManagementSchema,
  UserEventMutationResultSchema,
} from "@brownsync/contract";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import type { AuthEnv, Authenticator, RateLimiterBinding } from "./auth";
import { createUserReadRateLimitMiddleware, createUserWriteRateLimitMiddleware } from "./auth";
import { errorEnvelope } from "./errors";
import type { NormalizedUserEventCreateRequest, Queries, UserEventQueryFailure } from "./queries";
import { ErrorEnvelopeSchema } from "./routes";

const json = <S>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const badRequest = json(ErrorEnvelopeSchema, "Malformed path, query, or request body");
const unauthorized = json(ErrorEnvelopeSchema, "Missing or invalid bearer token");
const forbidden = json(ErrorEnvelopeSchema, "Brown membership or event authority required");
const notFound = json(ErrorEnvelopeSchema, "Event or organization not found");
const conflict = json(ErrorEnvelopeSchema, "Request identity or event revision conflict");
const unprocessable = json(ErrorEnvelopeSchema, "Canonical event location could not be resolved");
const rateLimited = json(ErrorEnvelopeSchema, "Authenticated rate limit exceeded");
const unavailable = json(ErrorEnvelopeSchema, "Student-event service temporarily unavailable");

function normalizeUserEventCreate(input: UserEventCreateRequest): NormalizedUserEventCreateRequest {
  return {
    ...input,
    organizationId: input.organizationId ?? null,
    description: input.description ?? null,
    end: input.end ?? null,
    url: input.url ?? null,
  };
}

function normalizeUserEventEditPatch(input: UserEventEditRequest): UserEventEditPatch {
  if (!("version" in input)) return input.patch;

  const patch: UserEventEditPatch = {};
  if (input.patch.title !== undefined) patch.title = input.patch.title;
  if (input.patch.description !== undefined) {
    patch.description =
      input.patch.description.action === "clear" ? null : input.patch.description.value;
  }
  if (input.patch.start !== undefined) patch.start = input.patch.start;
  if (input.patch.end !== undefined) {
    patch.end = input.patch.end.action === "clear" ? null : input.patch.end.value;
  }
  if (input.patch.category !== undefined) patch.category = input.patch.category;
  if (input.patch.url !== undefined) {
    patch.url = input.patch.url.action === "clear" ? null : input.patch.url.value;
  }
  if (input.patch.placeId !== undefined) patch.placeId = input.patch.placeId;
  if (input.patch.locationRaw !== undefined) patch.locationRaw = input.patch.locationRaw;
  return patch;
}

export const createUserEventRoute = createRoute({
  method: "post",
  path: "/api/events",
  operationId: "createUserEvent",
  summary: "Create an authenticated student event",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: UserEventCreateRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: json(UserEventCreateResultSchema, "Created or idempotently replayed event"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: conflict,
    422: unprocessable,
    429: rateLimited,
    503: unavailable,
  },
});

export const editUserEventRoute = createRoute({
  method: "patch",
  path: "/api/events/{id}",
  operationId: "updateUserEvent",
  summary: "Optimistically edit a manageable student event",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      content: { "application/json": { schema: UserEventEditRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: json(UserEventMutationResultSchema, "Effective revision and whether state changed"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: conflict,
    422: unprocessable,
    429: rateLimited,
    503: unavailable,
  },
});

export const deleteUserEventRoute = createRoute({
  method: "delete",
  path: "/api/events/{id}",
  operationId: "deleteUserEvent",
  summary: "Idempotently cancel and soft-delete a manageable student event",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.uuid() }),
  },
  responses: {
    200: json(UserEventMutationResultSchema, "Effective revision and whether state changed"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    429: rateLimited,
    503: unavailable,
  },
});

export const myUserEventsRoute = createRoute({
  method: "get",
  path: "/api/me/events",
  operationId: "listMyUserEvents",
  summary: "A bounded page of events the authenticated member may manage",
  security: [{ bearerAuth: [] }],
  request: {
    query: MyUserEventsQuerySchema,
  },
  responses: {
    200: json(MyUserEventsSchema, "Creator or current organization-admin management page"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    429: rateLimited,
    503: unavailable,
  },
});

export const myUserEventRoute = createRoute({
  method: "get",
  path: "/api/me/events/{id}",
  operationId: "getMyUserEvent",
  summary: "Management detail for an event the authenticated member may manage",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.uuid() }),
  },
  responses: {
    200: json(UserEventManagementSchema, "Authority-scoped event management detail"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    429: rateLimited,
    503: unavailable,
  },
});

function methodOnly(
  method: "GET" | "HEAD" | "POST" | "PATCH" | "DELETE",
  middleware: MiddlewareHandler<AuthEnv>,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    if (c.req.method !== method) {
      await next();
      return;
    }
    return middleware(c, next);
  };
}

function userEventError(c: Context<AuthEnv>, kind: UserEventQueryFailure) {
  switch (kind) {
    case "bad_request":
      return c.json(errorEnvelope("bad_request", "Event request rejected."), 400);
    case "forbidden":
      return c.json(errorEnvelope("forbidden", "Event authority required."), 403);
    case "not_found":
      return c.json(errorEnvelope("not_found", "Event or organization not found."), 404);
    case "conflict":
      return c.json(errorEnvelope("conflict", "Event state changed."), 409);
    case "unprocessable":
      return c.json(errorEnvelope("unprocessable", "Event location could not be resolved."), 422);
    case "rate_limited":
      return c.json(errorEnvelope("rate_limited", "Too many requests."), 429, {
        "Retry-After": "60",
      });
    case "unavailable":
      return c.json(
        errorEnvelope("user_event_service_unavailable", "Student-event service unavailable."),
        503,
      );
  }
}

function userEventDeleteError(c: Context<AuthEnv>, kind: UserEventQueryFailure) {
  switch (kind) {
    case "bad_request":
      return c.json(errorEnvelope("bad_request", "Event request rejected."), 400);
    case "forbidden":
      return c.json(errorEnvelope("forbidden", "Event authority required."), 403);
    case "not_found":
      return c.json(errorEnvelope("not_found", "Event not found."), 404);
    case "rate_limited":
      return c.json(errorEnvelope("rate_limited", "Too many requests."), 429, {
        "Retry-After": "60",
      });
    case "conflict":
    case "unprocessable":
    case "unavailable":
      return c.json(
        errorEnvelope("user_event_service_unavailable", "Student-event service unavailable."),
        503,
      );
  }
}

function userEventListError(c: Context<AuthEnv>, kind: UserEventQueryFailure) {
  switch (kind) {
    case "bad_request":
      return c.json(errorEnvelope("bad_request", "Event request rejected."), 400);
    case "forbidden":
      return c.json(errorEnvelope("forbidden", "Event authority required."), 403);
    case "rate_limited":
      return c.json(errorEnvelope("rate_limited", "Too many requests."), 429, {
        "Retry-After": "60",
      });
    case "not_found":
    case "conflict":
    case "unprocessable":
    case "unavailable":
      return c.json(
        errorEnvelope("user_event_service_unavailable", "Student-event service unavailable."),
        503,
      );
  }
}

function userEventDetailError(c: Context<AuthEnv>, kind: UserEventQueryFailure) {
  switch (kind) {
    case "bad_request":
      return c.json(errorEnvelope("bad_request", "Event request rejected."), 400);
    case "forbidden":
      return c.json(errorEnvelope("forbidden", "Event authority required."), 403);
    case "not_found":
      return c.json(errorEnvelope("not_found", "Event not found."), 404);
    case "rate_limited":
      return c.json(errorEnvelope("rate_limited", "Too many requests."), 429, {
        "Retry-After": "60",
      });
    case "conflict":
    case "unprocessable":
    case "unavailable":
      return c.json(
        errorEnvelope("user_event_service_unavailable", "Student-event service unavailable."),
        503,
      );
  }
}

export type UserEventRouteOptions = {
  authenticator: Authenticator;
  userReadLimiter?: RateLimiterBinding;
  userWriteLimiter?: RateLimiterBinding;
};

export function registerUserEventRoutes(
  app: OpenAPIHono<AuthEnv>,
  queries: Queries,
  options: UserEventRouteOptions,
): void {
  const readLimiter = createUserReadRateLimitMiddleware(options.userReadLimiter);
  const writeLimiter = createUserWriteRateLimitMiddleware(options.userWriteLimiter);

  app.use("/api/events", methodOnly("POST", options.authenticator));
  app.use("/api/events", methodOnly("POST", writeLimiter));
  app.use("/api/events/:id", methodOnly("PATCH", options.authenticator));
  app.use("/api/events/:id", methodOnly("PATCH", writeLimiter));
  app.use("/api/events/:id", methodOnly("DELETE", options.authenticator));
  app.use("/api/events/:id", methodOnly("DELETE", writeLimiter));
  app.use("/api/me/events", methodOnly("GET", options.authenticator));
  app.use("/api/me/events", methodOnly("GET", readLimiter));
  app.use("/api/me/events", methodOnly("HEAD", options.authenticator));
  app.use("/api/me/events", methodOnly("HEAD", readLimiter));
  app.use("/api/me/events/:id", methodOnly("GET", options.authenticator));
  app.use("/api/me/events/:id", methodOnly("GET", readLimiter));
  app.use("/api/me/events/:id", methodOnly("HEAD", options.authenticator));
  app.use("/api/me/events/:id", methodOnly("HEAD", readLimiter));

  app.openapi(createUserEventRoute, async (c) => {
    if (queries.createUserEvent === undefined) return userEventError(c, "unavailable");
    const result = await queries.createUserEvent(
      c.get("user").id,
      normalizeUserEventCreate(c.req.valid("json")),
    );
    if (result.kind !== "ok") return userEventError(c, result.kind);
    return c.json(UserEventCreateResultSchema.parse(result.value), 201);
  });

  app.openapi(editUserEventRoute, async (c) => {
    if (queries.editUserEvent === undefined) return userEventError(c, "unavailable");
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const result = await queries.editUserEvent(
      c.get("user").id,
      id,
      input.expectedRevision,
      normalizeUserEventEditPatch(input),
    );
    if (result.kind !== "ok") return userEventError(c, result.kind);
    return c.json(UserEventMutationResultSchema.parse(result.value), 200);
  });

  app.openapi(deleteUserEventRoute, async (c) => {
    if (queries.deleteUserEvent === undefined) return userEventDeleteError(c, "unavailable");
    const { id } = c.req.valid("param");
    const result = await queries.deleteUserEvent(c.get("user").id, id);
    if (result.kind !== "ok") return userEventDeleteError(c, result.kind);
    return c.json(UserEventMutationResultSchema.parse(result.value), 200);
  });

  app.openapi(myUserEventsRoute, async (c) => {
    if (queries.myUserEvents === undefined) return userEventListError(c, "unavailable");
    const query = c.req.valid("query");
    const result = await queries.myUserEvents(c.get("user").id, {
      beforeUpdatedAt: query.beforeUpdatedAt ?? null,
      beforeEventId: query.beforeEventId ?? null,
      limit: query.limit,
    });
    if (result.kind !== "ok") return userEventListError(c, result.kind);
    return c.json(MyUserEventsSchema.parse(result.value), 200);
  });

  app.openapi(myUserEventRoute, async (c) => {
    if (queries.myUserEvent === undefined) return userEventDetailError(c, "unavailable");
    const { id } = c.req.valid("param");
    const result = await queries.myUserEvent(c.get("user").id, id);
    if (result.kind !== "ok") return userEventDetailError(c, result.kind);
    return c.json(UserEventManagementSchema.parse(result.value), 200);
  });
}
