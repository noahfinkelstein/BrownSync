import {
  MyOrganizationsSchema,
  OrgClaimDecisionRequestSchema,
  OrgClaimDecisionResultSchema,
  OrgClaimRequestSchema,
  OrgClaimResultSchema,
  OrgClaimReviewQueueQuerySchema,
  OrgClaimReviewQueueSchema,
  OrgCreateRequestSchema,
  OrgCreateResultSchema,
  type OrgEditPatch,
  type OrgEditRequest,
  OrgEditRequestSchema,
  OrgEditResultSchema,
} from "@brownsync/contract";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import type { AuthEnv, Authenticator, RateLimiterBinding } from "./auth";
import { createUserReadRateLimitMiddleware, createUserWriteRateLimitMiddleware } from "./auth";
import { errorEnvelope } from "./errors";
import type { OrganizationQueryFailure, Queries } from "./queries";
import { ErrorEnvelopeSchema } from "./routes";

const json = <S>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const badRequest = json(ErrorEnvelopeSchema, "Malformed path or request body");
const unauthorized = json(ErrorEnvelopeSchema, "Missing or invalid bearer token");
const forbidden = json(ErrorEnvelopeSchema, "Brown membership or organization authority required");
const notFound = json(ErrorEnvelopeSchema, "Organization or claim not found");
const conflict = json(ErrorEnvelopeSchema, "Organization state or revision conflict");
const rateLimited = json(ErrorEnvelopeSchema, "Authenticated rate limit exceeded");
const unavailable = json(ErrorEnvelopeSchema, "Organization service temporarily unavailable");

function normalizeOrgEditPatch(input: OrgEditRequest): OrgEditPatch {
  if (!("version" in input)) return input.patch;

  const patch: OrgEditPatch = {};
  if (input.patch.description !== undefined) {
    patch.description =
      input.patch.description.action === "clear" ? null : input.patch.description.value;
  }
  if (input.patch.aboutMd !== undefined) {
    patch.aboutMd = input.patch.aboutMd.action === "clear" ? null : input.patch.aboutMd.value;
  }
  if (input.patch.meetingInfo !== undefined) {
    patch.meetingInfo =
      input.patch.meetingInfo.action === "clear" ? null : input.patch.meetingInfo.value;
  }
  if (input.patch.links !== undefined) {
    patch.links = input.patch.links.action === "clear" ? null : input.patch.links.value;
  }
  return patch;
}

export const myOrganizationsRoute = createRoute({
  method: "get",
  path: "/api/me/organizations",
  operationId: "listMyOrganizations",
  summary: "The authenticated member's organization access and claims",
  security: [{ bearerAuth: [] }],
  responses: {
    200: json(MyOrganizationsSchema, "Own memberships and claim summaries"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: conflict,
    429: rateLimited,
    503: unavailable,
  },
});

export const createOrganizationRoute = createRoute({
  method: "post",
  path: "/api/orgs",
  operationId: "createOrganization",
  summary: "Create a member-owned organization",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: OrgCreateRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: json(OrgCreateResultSchema, "Organization created with the caller as owner"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: conflict,
    429: rateLimited,
    503: unavailable,
  },
});

export const claimOrganizationRoute = createRoute({
  method: "post",
  path: "/api/orgs/{id}/claims",
  operationId: "claimOrganization",
  summary: "Claim organization administration",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().min(1) }),
    body: {
      content: { "application/json": { schema: OrgClaimRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: json(OrgClaimResultSchema, "Idempotent claim disposition"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: conflict,
    429: rateLimited,
    503: unavailable,
  },
});

export const reviewableOrganizationClaimsRoute = createRoute({
  method: "get",
  path: "/api/me/org-claims/reviewable",
  operationId: "listReviewableOrganizationClaims",
  summary: "Claims the authenticated owner or reviewer may decide",
  security: [{ bearerAuth: [] }],
  request: {
    query: OrgClaimReviewQueueQuerySchema,
  },
  responses: {
    200: json(OrgClaimReviewQueueSchema, "Safe pending organization claim queue"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: conflict,
    429: rateLimited,
    503: unavailable,
  },
});

export const decideOrganizationClaimRoute = createRoute({
  method: "post",
  path: "/api/org-claims/{claimId}/decision",
  operationId: "decideOrganizationClaim",
  summary: "Approve or reject a pending organization claim",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ claimId: z.uuid() }),
    body: {
      content: { "application/json": { schema: OrgClaimDecisionRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: json(OrgClaimDecisionResultSchema, "Idempotent organization claim decision"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: conflict,
    429: rateLimited,
    503: unavailable,
  },
});

export const editOrganizationRoute = createRoute({
  method: "patch",
  path: "/api/orgs/{id}",
  operationId: "updateOrganization",
  summary: "Edit a seed-surviving organization overlay",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().min(1) }),
    body: {
      content: { "application/json": { schema: OrgEditRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: json(OrgEditResultSchema, "Effective revision and whether state changed"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: conflict,
    429: rateLimited,
    503: unavailable,
  },
});

function methodOnly(
  method: "GET" | "HEAD" | "POST" | "PATCH",
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

function organizationError(c: Context<AuthEnv>, kind: OrganizationQueryFailure) {
  switch (kind) {
    case "bad_request":
      return c.json(errorEnvelope("bad_request", "Organization request rejected."), 400);
    case "forbidden":
      return c.json(errorEnvelope("forbidden", "Organization authority required."), 403);
    case "not_found":
      return c.json(errorEnvelope("not_found", "Organization or claim not found."), 404);
    case "conflict":
      return c.json(errorEnvelope("conflict", "Organization state changed."), 409);
    case "rate_limited":
      return c.json(errorEnvelope("rate_limited", "Too many requests."), 429, {
        "Retry-After": "60",
      });
    case "unavailable":
      return c.json(
        errorEnvelope("organization_service_unavailable", "Organization service unavailable."),
        503,
      );
  }
}

export type OrganizationRouteOptions = {
  authenticator: Authenticator;
  userReadLimiter?: RateLimiterBinding;
  userWriteLimiter?: RateLimiterBinding;
};

export function registerOrganizationRoutes(
  app: OpenAPIHono<AuthEnv>,
  queries: Queries,
  options: OrganizationRouteOptions,
): void {
  const readLimiter = createUserReadRateLimitMiddleware(options.userReadLimiter);
  const writeLimiter = createUserWriteRateLimitMiddleware(options.userWriteLimiter);

  app.use("/api/me/organizations", methodOnly("GET", options.authenticator));
  app.use("/api/me/organizations", methodOnly("GET", readLimiter));
  app.use("/api/me/organizations", methodOnly("HEAD", options.authenticator));
  app.use("/api/me/organizations", methodOnly("HEAD", readLimiter));
  app.use("/api/me/org-claims/reviewable", methodOnly("GET", options.authenticator));
  app.use("/api/me/org-claims/reviewable", methodOnly("GET", readLimiter));
  app.use("/api/me/org-claims/reviewable", methodOnly("HEAD", options.authenticator));
  app.use("/api/me/org-claims/reviewable", methodOnly("HEAD", readLimiter));
  app.use("/api/orgs", methodOnly("POST", options.authenticator));
  app.use("/api/orgs", methodOnly("POST", writeLimiter));
  app.use("/api/orgs/:id/claims", methodOnly("POST", options.authenticator));
  app.use("/api/orgs/:id/claims", methodOnly("POST", writeLimiter));
  app.use("/api/org-claims/:claimId/decision", methodOnly("POST", options.authenticator));
  app.use("/api/org-claims/:claimId/decision", methodOnly("POST", writeLimiter));
  app.use("/api/orgs/:id", methodOnly("PATCH", options.authenticator));
  app.use("/api/orgs/:id", methodOnly("PATCH", writeLimiter));

  app.openapi(myOrganizationsRoute, async (c) => {
    if (queries.myOrganizations === undefined) {
      return organizationError(c, "unavailable");
    }
    const result = await queries.myOrganizations(c.get("user").id);
    if (result.kind !== "ok") return organizationError(c, result.kind);
    return c.json(MyOrganizationsSchema.parse(result.value), 200);
  });

  app.openapi(createOrganizationRoute, async (c) => {
    if (queries.createOrganization === undefined) {
      return organizationError(c, "unavailable");
    }
    const result = await queries.createOrganization(c.get("user").id, c.req.valid("json"));
    if (result.kind !== "ok") return organizationError(c, result.kind);
    return c.json(OrgCreateResultSchema.parse(result.value), 201);
  });

  app.openapi(claimOrganizationRoute, async (c) => {
    if (queries.claimOrganization === undefined) {
      return organizationError(c, "unavailable");
    }
    const { id } = c.req.valid("param");
    const { evidence } = c.req.valid("json");
    const result = await queries.claimOrganization(c.get("user").id, id, evidence);
    if (result.kind !== "ok") return organizationError(c, result.kind);
    return c.json(OrgClaimResultSchema.parse(result.value), 200);
  });

  app.openapi(reviewableOrganizationClaimsRoute, async (c) => {
    if (queries.reviewableOrganizationClaims === undefined) {
      return organizationError(c, "unavailable");
    }
    const query = c.req.valid("query");
    const result = await queries.reviewableOrganizationClaims(c.get("user").id, {
      afterCreatedAt: query.afterCreatedAt ?? null,
      afterClaimId: query.afterClaimId ?? null,
      limit: query.limit,
    });
    if (result.kind !== "ok") return organizationError(c, result.kind);
    return c.json(OrgClaimReviewQueueSchema.parse(result.value), 200);
  });

  app.openapi(decideOrganizationClaimRoute, async (c) => {
    if (queries.decideOrganizationClaim === undefined) {
      return organizationError(c, "unavailable");
    }
    const { claimId } = c.req.valid("param");
    const { approve, note } = c.req.valid("json");
    const result = await queries.decideOrganizationClaim(c.get("user").id, claimId, approve, note);
    if (result.kind !== "ok") return organizationError(c, result.kind);
    return c.json(OrgClaimDecisionResultSchema.parse(result.value), 200);
  });

  app.openapi(editOrganizationRoute, async (c) => {
    if (queries.editOrganization === undefined) {
      return organizationError(c, "unavailable");
    }
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const result = await queries.editOrganization(
      c.get("user").id,
      id,
      input.expectedRevision,
      normalizeOrgEditPatch(input),
    );
    if (result.kind !== "ok") return organizationError(c, result.kind);
    return c.json(OrgEditResultSchema.parse(result.value), 200);
  });
}
