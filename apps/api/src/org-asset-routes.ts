import {
  OrgGalleryReorderRequestSchema,
  OrgGalleryReorderResultSchema,
  OrgMediaCollectionSchema,
  OrgMediaMutationRequestSchema,
  OrgMediaMutationResultSchema,
  OrgMediaUploadReservationRequestSchema,
  OrgMediaUploadReservationSchema,
  OrgMediaUploadResultSchema,
  OrgSocialPostCollectionSchema,
  OrgSocialPostCreateRequestSchema,
  OrgSocialPostCreateResultSchema,
  OrgSocialPostDeleteRequestSchema,
  OrgSocialPostDeleteResultSchema,
  OrgSocialPostRefreshResultSchema,
} from "@brownsync/contract";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import type { AuthEnv, Authenticator, RateLimiterBinding } from "./auth";
import { createUserWriteRateLimitMiddleware } from "./auth";
import { errorEnvelope } from "./errors";
import type {
  OrgAssetQueries,
  OrgAssetQueryFailure,
  OrgAssetQueryResult,
  SocialPostFinalization,
} from "./org-asset-queries";
import {
  buildOrgMediaObjectPath,
  canonicalizeInstagramPermalink,
  type IdFactory,
  type ImageProcessor,
  type InstagramOEmbedClient,
  type MediaCleanupScheduler,
  type MediaObjectStore,
  ORG_MEDIA_CACHE_CONTROL,
  OrgAssetServiceError,
  parseUploadContentLength,
} from "./org-asset-services";
import { ErrorEnvelopeSchema } from "./routes";

const json = <S>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const badRequest = json(ErrorEnvelopeSchema, "Malformed path or request body");
const unauthorized = json(ErrorEnvelopeSchema, "Missing or invalid bearer token");
const forbidden = json(ErrorEnvelopeSchema, "Brown membership or organization authority required");
const notFound = json(ErrorEnvelopeSchema, "Organization, media, upload, or social post not found");
const conflict = json(ErrorEnvelopeSchema, "Organization asset state or revision conflict");
const rateLimited = json(ErrorEnvelopeSchema, "Organization asset rate limit exceeded");
const unavailable = json(ErrorEnvelopeSchema, "Organization asset service temporarily unavailable");

const organizationParam = z.object({ id: z.string().min(1) });
const mediaParam = z.object({ id: z.string().min(1), mediaId: z.uuid() });
const uploadParam = z.object({ uploadId: z.uuid() });
const socialParam = z.object({ id: z.string().min(1), postId: z.uuid() });
const postParam = z.object({ postId: z.string().min(1).meta({ format: "uuid" }) });
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const orgMediaRoute = createRoute({
  method: "get",
  path: "/api/orgs/{id}/media",
  operationId: "getOrganizationMedia",
  summary: "Public organization media collection",
  request: { params: organizationParam },
  responses: {
    200: json(OrgMediaCollectionSchema, "Ready public media"),
    400: badRequest,
    404: notFound,
    429: rateLimited,
    503: unavailable,
  },
});

export const reserveOrgMediaUploadRoute = createRoute({
  method: "post",
  path: "/api/orgs/{id}/media/uploads",
  operationId: "reserveOrganizationMediaUpload",
  summary: "Reserve an immutable organization media upload",
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationParam,
    body: {
      content: { "application/json": { schema: OrgMediaUploadReservationRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: json(OrgMediaUploadReservationSchema, "Reserved or idempotently replayed upload"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: conflict,
    429: rateLimited,
    503: unavailable,
  },
});

const BinaryImageSchema = z.string().meta({ format: "binary" });

export const uploadOrgMediaRoute = createRoute({
  method: "put",
  path: "/api/org-media/uploads/{uploadId}",
  operationId: "uploadOrganizationMedia",
  summary: "Stream and finalize one reserved organization image",
  security: [{ bearerAuth: [] }],
  request: {
    params: uploadParam,
    body: {
      required: true,
      content: {
        "image/jpeg": { schema: BinaryImageSchema },
        "image/png": { schema: BinaryImageSchema },
        "image/webp": { schema: BinaryImageSchema },
      },
    },
  },
  responses: {
    201: json(OrgMediaUploadResultSchema, "Processed WebP media result"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: conflict,
    413: json(ErrorEnvelopeSchema, "Image input, geometry, or output exceeds a safety cap"),
    415: json(ErrorEnvelopeSchema, "Unsupported or mismatched image media type"),
    422: json(ErrorEnvelopeSchema, "Malformed, truncated, or transform-invalid image"),
    429: rateLimited,
    503: unavailable,
  },
});

export const deleteOrgMediaRoute = createRoute({
  method: "delete",
  path: "/api/orgs/{id}/media/{mediaId}",
  operationId: "deleteOrganizationMedia",
  summary: "Optimistically remove organization media",
  security: [{ bearerAuth: [] }],
  request: {
    params: mediaParam,
    body: {
      required: true,
      content: { "application/json": { schema: OrgMediaMutationRequestSchema } },
    },
  },
  responses: {
    200: json(OrgMediaMutationResultSchema, "Media deletion result"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: conflict,
    429: rateLimited,
    503: unavailable,
  },
});

export const reorderOrgGalleryRoute = createRoute({
  method: "patch",
  path: "/api/orgs/{id}/media/gallery",
  operationId: "reorderOrganizationGallery",
  summary: "Optimistically replace the complete gallery order",
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationParam,
    body: {
      required: true,
      content: { "application/json": { schema: OrgGalleryReorderRequestSchema } },
    },
  },
  responses: {
    200: json(OrgGalleryReorderResultSchema, "Gallery reorder result"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: conflict,
    429: rateLimited,
    503: unavailable,
  },
});

export const orgSocialPostsRoute = createRoute({
  method: "get",
  path: "/api/orgs/{id}/social-posts",
  operationId: "listOrganizationSocialPosts",
  summary: "Public opt-in Instagram link cards",
  request: { params: organizationParam },
  responses: {
    200: json(OrgSocialPostCollectionSchema, "Public Instagram link or embed cards"),
    400: badRequest,
    404: notFound,
    429: rateLimited,
    503: unavailable,
  },
});

export const addOrgSocialPostRoute = createRoute({
  method: "post",
  path: "/api/orgs/{id}/social-posts",
  operationId: "addOrganizationSocialPost",
  summary: "Add one opt-in Instagram post or Reel permalink",
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationParam,
    body: {
      required: true,
      content: { "application/json": { schema: OrgSocialPostCreateRequestSchema } },
    },
  },
  responses: {
    201: json(OrgSocialPostCreateResultSchema, "Created or replayed social card"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: conflict,
    429: rateLimited,
    503: unavailable,
  },
});

export const refreshOrgSocialPostRoute = createRoute({
  method: "post",
  path: "/api/orgs/{id}/social-posts/{postId}/refresh",
  operationId: "refreshOrganizationSocialPost",
  summary: "Idempotently refresh one organization Instagram card",
  security: [{ bearerAuth: [] }],
  request: { params: socialParam },
  responses: {
    200: json(OrgSocialPostRefreshResultSchema, "Effective social-card refresh state"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: conflict,
    429: rateLimited,
    503: unavailable,
  },
});

export const deleteOrgSocialPostRoute = createRoute({
  method: "delete",
  path: "/api/orgs/{id}/social-posts/{postId}",
  operationId: "deleteOrganizationSocialPost",
  summary: "Optimistically remove an organization social card",
  security: [{ bearerAuth: [] }],
  request: {
    params: socialParam,
    body: {
      required: true,
      content: { "application/json": { schema: OrgSocialPostDeleteRequestSchema } },
    },
  },
  responses: {
    200: json(OrgSocialPostDeleteResultSchema, "Social-card deletion result"),
    400: badRequest,
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: conflict,
    429: rateLimited,
    503: unavailable,
  },
});

export const orgSocialEmbedRoute = createRoute({
  method: "get",
  path: "/api/social-posts/{postId}/embed",
  operationId: "getOrganizationSocialEmbed",
  summary: "Isolated cached Instagram embed fragment",
  request: { params: postParam },
  responses: {
    200: {
      description: "Isolated HTML document",
      content: { "text/html": { schema: z.string() } },
    },
    404: notFound,
    429: rateLimited,
    503: unavailable,
  },
});

function methodOnly(
  method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE",
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

function queryError(c: Context<AuthEnv>, kind: OrgAssetQueryFailure) {
  switch (kind) {
    case "bad_request":
      return c.json(errorEnvelope("bad_request", "Organization asset request rejected."), 400);
    case "forbidden":
      return c.json(errorEnvelope("forbidden", "Organization authority required."), 403);
    case "not_found":
      return c.json(errorEnvelope("not_found", "Organization asset not found."), 404);
    case "conflict":
      return c.json(errorEnvelope("conflict", "Organization asset state changed."), 409);
    case "rate_limited":
      return c.json(errorEnvelope("rate_limited", "Too many requests."), 429, {
        "Retry-After": "60",
      });
    case "unavailable":
      return c.json(
        errorEnvelope("org_asset_service_unavailable", "Organization asset service unavailable."),
        503,
      );
  }
}

function publicQueryError(c: Context<AuthEnv>, kind: OrgAssetQueryFailure) {
  if (kind === "bad_request") {
    return c.json(errorEnvelope("bad_request", "Organization asset request rejected."), 400);
  }
  if (kind === "not_found") {
    return c.json(errorEnvelope("not_found", "Organization asset not found."), 404);
  }
  if (kind === "rate_limited") {
    return c.json(errorEnvelope("rate_limited", "Too many requests."), 429, {
      "Retry-After": "60",
    });
  }
  return c.json(
    errorEnvelope("org_asset_service_unavailable", "Organization asset service unavailable."),
    503,
  );
}

function serviceError(c: Context<AuthEnv>, error: OrgAssetServiceError) {
  const code =
    error.status === 413
      ? "payload_too_large"
      : error.status === 415
        ? "unsupported_media_type"
        : error.status === 422
          ? "invalid_image"
          : error.status === 503
            ? "org_asset_service_unavailable"
            : "bad_request";
  return c.json(errorEnvelope(code, "Organization asset request rejected."), error.status as 400);
}

export type OrgAssetRouteOptions = {
  authenticator: Authenticator;
  mediaWriteLimiter?: RateLimiterBinding;
  socialWriteLimiter?: RateLimiterBinding;
  imageProcessor?: ImageProcessor;
  objectStore?: MediaObjectStore;
  instagramClient?: InstagramOEmbedClient;
  cleanupScheduler?: MediaCleanupScheduler;
  idFactory?: IdFactory;
  embedOrigin?: string | null;
};

function defaultIdFactory(): IdFactory {
  return { uuid: () => crypto.randomUUID() };
}

function wakeCleanup(options: OrgAssetRouteOptions): void {
  try {
    options.cleanupScheduler?.wake();
  } catch {
    // The SQL outbox is durable; wake is explicitly best effort.
  }
}

async function failUpload(
  queries: OrgAssetQueries,
  options: OrgAssetRouteOptions,
  actorId: string,
  uploadId: string,
  failureCode: string,
  objectMayExist: boolean,
): Promise<void> {
  try {
    const result = await queries.failMediaUpload(actorId, uploadId, failureCode, objectMayExist);
    if (result.kind === "ok" && result.value.cleanupEnqueued) wakeCleanup(options);
  } catch {
    // The original error remains authoritative; SQL state still fails closed.
  }
}

export function registerOrgAssetRoutes(
  app: OpenAPIHono<AuthEnv>,
  queries: OrgAssetQueries,
  options: OrgAssetRouteOptions,
): void {
  const mediaLimiter = createUserWriteRateLimitMiddleware(options.mediaWriteLimiter);
  const socialLimiter = createUserWriteRateLimitMiddleware(options.socialWriteLimiter);
  const idFactory = options.idFactory ?? defaultIdFactory();

  for (const [path, method, limiter] of [
    ["/api/orgs/:id/media/uploads", "POST", mediaLimiter],
    ["/api/org-media/uploads/:uploadId", "PUT", mediaLimiter],
    ["/api/orgs/:id/media/:mediaId", "DELETE", mediaLimiter],
    ["/api/orgs/:id/media/gallery", "PATCH", mediaLimiter],
    ["/api/orgs/:id/social-posts", "POST", socialLimiter],
    ["/api/orgs/:id/social-posts/:postId/refresh", "POST", socialLimiter],
    ["/api/orgs/:id/social-posts/:postId", "DELETE", socialLimiter],
  ] as const) {
    app.use(path, methodOnly(method, options.authenticator));
    app.use(path, methodOnly(method, limiter));
  }

  app.openapi(orgMediaRoute, async (c) => {
    const result = await queries.getOrgMedia(c.req.valid("param").id);
    if (result.kind !== "ok") return publicQueryError(c, result.kind);
    return c.json(OrgMediaCollectionSchema.parse(result.value), 200);
  });

  app.openapi(reserveOrgMediaUploadRoute, async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const uploadId = idFactory.uuid();
    let objectPath: string;
    try {
      objectPath = buildOrgMediaObjectPath(id, input.kind, uploadId);
    } catch (error) {
      return serviceError(
        c,
        error instanceof OrgAssetServiceError
          ? error
          : new OrgAssetServiceError(400, "invalid_image"),
      );
    }
    const result = await queries.reserveMediaUpload(c.get("user").id, id, {
      ...input,
      expectedOrganizationRevision: input.expectedOrganizationRevision ?? null,
      expectedGalleryRevision: input.expectedGalleryRevision ?? null,
      uploadId,
      objectPath,
    });
    if (result.kind !== "ok") return queryError(c, result.kind);
    return c.json(OrgMediaUploadReservationSchema.parse(result.value), 201);
  });

  app.openapi(uploadOrgMediaRoute, async (c) => {
    const actorId = c.get("user").id;
    const { uploadId } = c.req.valid("param");
    const begun = await queries.beginMediaUpload(actorId, uploadId);
    if (begun.kind !== "ok") return queryError(c, begun.kind);

    const claim = begun.value;
    const contentType = c.req.header("Content-Type");
    if (
      contentType !== "image/jpeg" &&
      contentType !== "image/png" &&
      contentType !== "image/webp"
    ) {
      await failUpload(queries, options, actorId, uploadId, "unsupported_media_type", false);
      return serviceError(c, new OrgAssetServiceError(415, "unsupported_media_type"));
    }
    let declaredLength: number | null;
    try {
      declaredLength = parseUploadContentLength(c.req.header("Content-Length") ?? null);
    } catch (error) {
      const service =
        error instanceof OrgAssetServiceError
          ? error
          : new OrgAssetServiceError(422, "invalid_image");
      await failUpload(queries, options, actorId, uploadId, service.failureCode, false);
      return serviceError(c, service);
    }
    if (c.req.raw.body === null) {
      await failUpload(queries, options, actorId, uploadId, "invalid_image", false);
      return serviceError(c, new OrgAssetServiceError(422, "invalid_image"));
    }
    if (options.imageProcessor === undefined) {
      await failUpload(queries, options, actorId, uploadId, "transform_failed", false);
      return serviceError(c, new OrgAssetServiceError(503, "transform_failed"));
    }
    if (options.objectStore === undefined) {
      await failUpload(queries, options, actorId, uploadId, "storage_unavailable", false);
      return serviceError(c, new OrgAssetServiceError(503, "storage_unavailable"));
    }

    let processed: Awaited<ReturnType<ImageProcessor["process"]>>;
    try {
      processed = await options.imageProcessor.process({
        stream: c.req.raw.body,
        declaredContentType: contentType,
        declaredLength,
        kind: claim.kind,
      });
    } catch (error) {
      const service =
        error instanceof OrgAssetServiceError
          ? error
          : new OrgAssetServiceError(422, "transform_failed");
      await failUpload(queries, options, actorId, uploadId, service.failureCode, false);
      return serviceError(c, service);
    }

    let stored: { publicUrl: string };
    try {
      stored = await options.objectStore.putImmutable({
        path: claim.objectPath,
        bytes: processed.bytes,
        contentType: "image/webp",
        cacheControl: ORG_MEDIA_CACHE_CONTROL,
      });
    } catch (error) {
      const service =
        error instanceof OrgAssetServiceError
          ? error
          : new OrgAssetServiceError(503, "storage_failed");
      await failUpload(queries, options, actorId, uploadId, service.failureCode, true);
      return serviceError(c, service);
    }

    const mediaId = idFactory.uuid();
    const finalizationInput = {
      mediaId,
      publicUrl: stored.publicUrl,
      width: processed.width,
      height: processed.height,
      byteSize: processed.byteSize,
    };
    let finalized = await queries.finalizeMediaUpload(actorId, uploadId, finalizationInput);
    if (finalized.kind === "unavailable") {
      finalized = await queries.finalizeMediaUpload(actorId, uploadId, finalizationInput);
    }
    if (finalized.kind !== "ok") {
      if (finalized.kind !== "unavailable") {
        try {
          await options.objectStore.delete(claim.objectPath);
        } catch {
          // The failure routine enqueues durable cleanup below.
        }
      }
      await failUpload(queries, options, actorId, uploadId, "finalization_failed", true);
      return queryError(c, finalized.kind);
    }
    const { replayed: _replayed, ...publicResult } = finalized.value;
    return c.json(OrgMediaUploadResultSchema.parse(publicResult), 201);
  });

  app.openapi(deleteOrgMediaRoute, async (c) => {
    const { id, mediaId } = c.req.valid("param");
    const result = await queries.deleteMedia(
      c.get("user").id,
      id,
      mediaId,
      c.req.valid("json").expectedRevision,
    );
    if (result.kind !== "ok") return queryError(c, result.kind);
    if (result.value.changed) wakeCleanup(options);
    return c.json(OrgMediaMutationResultSchema.parse(result.value), 200);
  });

  app.openapi(reorderOrgGalleryRoute, async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const result = await queries.reorderGallery(
      c.get("user").id,
      id,
      input.expectedGalleryRevision,
      input.mediaIds,
    );
    if (result.kind !== "ok") return queryError(c, result.kind);
    return c.json(OrgGalleryReorderResultSchema.parse(result.value), 200);
  });

  app.openapi(orgSocialPostsRoute, async (c) => {
    const result = await queries.listSocialPosts(c.req.valid("param").id);
    if (result.kind !== "ok") return publicQueryError(c, result.kind);
    return c.json(OrgSocialPostCollectionSchema.parse(result.value), 200);
  });

  app.openapi(addOrgSocialPostRoute, async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    let permalink: string;
    try {
      permalink = canonicalizeInstagramPermalink(input.permalink);
    } catch (error) {
      return serviceError(
        c,
        error instanceof OrgAssetServiceError
          ? error
          : new OrgAssetServiceError(400, "permalink_invalid"),
      );
    }
    const added = await queries.addSocialPost(
      c.get("user").id,
      id,
      input.clientRequestId,
      idFactory.uuid(),
      permalink,
    );
    if (added.kind !== "ok") return queryError(c, added.kind);
    if (!added.value.refreshRequired) {
      return c.json(
        OrgSocialPostCreateResultSchema.parse({
          post: added.value.post,
          replayed: added.value.replayed,
        }),
        201,
      );
    }
    if (added.value.leaseToken === null) return queryError(c, "unavailable");
    const finalized = await finalizeSocialClaimWithPermalink(
      queries,
      options,
      c.get("user").id,
      added.value.post.id,
      added.value.leaseToken,
      added.value.post.permalink,
    );
    if (finalized.kind !== "ok") return queryError(c, finalized.kind);
    return c.json(
      OrgSocialPostCreateResultSchema.parse({
        post: finalized.value.post,
        replayed: added.value.replayed,
      }),
      201,
    );
  });

  app.openapi(refreshOrgSocialPostRoute, async (c) => {
    const { id, postId } = c.req.valid("param");
    const begun = await queries.beginSocialPostRefresh(c.get("user").id, id, postId);
    if (begun.kind !== "ok") return queryError(c, begun.kind);
    if (!begun.value.claimed) {
      return c.json(
        OrgSocialPostRefreshResultSchema.parse({ post: begun.value.post, changed: false }),
        200,
      );
    }
    if (begun.value.leaseToken === null) return queryError(c, "unavailable");
    const finalized = await finalizeSocialClaimWithPermalink(
      queries,
      options,
      c.get("user").id,
      postId,
      begun.value.leaseToken,
      begun.value.post.permalink,
    );
    if (finalized.kind !== "ok") return queryError(c, finalized.kind);
    return c.json(
      OrgSocialPostRefreshResultSchema.parse({
        post: finalized.value.post,
        changed: finalized.value.changed,
      }),
      200,
    );
  });

  app.openapi(deleteOrgSocialPostRoute, async (c) => {
    const { id, postId } = c.req.valid("param");
    const result = await queries.deleteSocialPost(
      c.get("user").id,
      id,
      postId,
      c.req.valid("json").expectedRevision,
    );
    if (result.kind !== "ok") return queryError(c, result.kind);
    return c.json(OrgSocialPostDeleteResultSchema.parse(result.value), 200);
  });

  app.openapi(orgSocialEmbedRoute, async (c) => {
    if (options.embedOrigin === undefined || options.embedOrigin === null) {
      return c.json(errorEnvelope("not_found", "Organization asset not found."), 404);
    }
    let requestOrigin: string;
    try {
      requestOrigin = new URL(c.req.url).origin;
    } catch {
      return c.json(errorEnvelope("not_found", "Organization asset not found."), 404);
    }
    if (requestOrigin !== options.embedOrigin) {
      return c.json(errorEnvelope("not_found", "Organization asset not found."), 404);
    }
    const postId = c.req.valid("param").postId;
    if (!UUID_V4.test(postId)) {
      return c.json(errorEnvelope("not_found", "Organization asset not found."), 404);
    }
    const result = await queries.getSocialEmbed(postId);
    if (result.kind !== "ok") {
      if (result.kind === "not_found") {
        return c.json(errorEnvelope("not_found", "Organization asset not found."), 404);
      }
      if (result.kind === "rate_limited") {
        return c.json(errorEnvelope("rate_limited", "Too many requests."), 429, {
          "Retry-After": "60",
        });
      }
      return c.json(
        errorEnvelope("org_asset_service_unavailable", "Organization asset service unavailable."),
        503,
      );
    }
    const document =
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' +
      `${result.value.renderHtml}</body></html>`;
    return c.body(document, 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; " +
        "img-src https://*.cdninstagram.com https://*.fbcdn.net data:; " +
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
  });
}

async function finalizeSocialClaimWithPermalink(
  queries: OrgAssetQueries,
  options: OrgAssetRouteOptions,
  actorId: string,
  postId: string,
  leaseToken: string,
  permalink: string,
): Promise<OrgAssetQueryResult<SocialPostFinalization>> {
  if (options.instagramClient === undefined) {
    return queries.finalizeSocialPost(actorId, postId, leaseToken, {
      outcome: "link_only",
      renderHtml: null,
      attribution: null,
      errorCode: "provider_unconfigured",
    });
  }
  const capacity = await queries.consumeOEmbedCapacity(postId, leaseToken);
  if (capacity.kind !== "ok") return capacity;
  if (!capacity.value.allowed) {
    return queries.finalizeSocialPost(actorId, postId, leaseToken, {
      outcome: "deferred",
      renderHtml: null,
      attribution: null,
      errorCode: "capacity_exhausted",
    });
  }
  const provider = await options.instagramClient.fetch(permalink);
  if (provider.kind === "ready") {
    return queries.finalizeSocialPost(actorId, postId, leaseToken, {
      outcome: "ready",
      renderHtml: provider.renderHtml,
      attribution: provider.attribution,
      errorCode: null,
    });
  }
  return queries.finalizeSocialPost(actorId, postId, leaseToken, {
    outcome: "link_only",
    renderHtml: null,
    attribution: null,
    errorCode: provider.errorCode,
  });
}
