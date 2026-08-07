import { getPath } from "hono/utils/url";
import postgres from "postgres";
import { createApp, createCorsOriginResolver } from "./app";
import {
  checkRateLimit,
  createAccountDeleter,
  createAuthenticator,
  type RateLimiterBinding,
  rateLimitUnavailableResponse,
} from "./auth";
import { createBoardAwareAccountDeleter } from "./board-account-deletion";
import { createBoardIdentity } from "./board-identity";
import { type BoardQueries, createBoardQueries } from "./board-queries";
import { errorEnvelope } from "./errors";
import { createOrgAssetQueries, type OrgAssetQueries } from "./org-asset-queries";
import {
  type CloudflareImagesBinding,
  createCloudflareImageProcessor,
  createInstagramOEmbedClient,
  createSupabaseMediaObjectStore,
  type MediaObjectStore,
  normalizeEmbedOrigin,
} from "./org-asset-services";
import { createQueries, type Queries } from "./queries";

/**
 * Cloudflare Workers entry (wrangler.toml `main`). The Node entry
 * (src/server.ts) is untouched and remains the local-dev path; both share
 * createApp/createQueries so the routes cannot drift.
 *
 * Binding/context shapes are declared locally instead of pulling in
 * @cloudflare/workers-types — this package typechecks against @types/node,
 * and the two type packages fight over fetch globals.
 */

/** `[[hyperdrive]]` binding shape (only the field we consume). */
type HyperdriveBinding = { connectionString: string };

export type WorkerEnv = {
  /** Hyperdrive → Supabase Postgres. The production path (DEPLOY.md). */
  HYPERDRIVE?: HyperdriveBinding;
  /** Fallback: `wrangler secret put DATABASE_URL` before Hyperdrive exists. */
  DATABASE_URL?: string;
  /** wrangler.toml [vars]: extra CORS origins, bridged into process.env. */
  CORS_ORIGINS?: string;
  /** Public Supabase project origin used only to derive issuer + JWKS URL. */
  SUPABASE_URL?: string;
  /** Server-only secret used solely for Supabase Auth Admin requests. */
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Cloudflare native public-read IP bucket. */
  PUBLIC_READ_LIMITER?: RateLimiterBinding;
  /** Cloudflare native authenticated-user read bucket. */
  USER_READ_LIMITER?: RateLimiterBinding;
  /** Cloudflare native authenticated-user write bucket. */
  USER_WRITE_LIMITER?: RateLimiterBinding;
  /** Cloudflare Images binding; required only for protected raw media uploads. */
  IMAGES?: CloudflareImagesBinding;
  /** Dedicated authenticated organization-media write bucket. */
  MEDIA_WRITE_LIMITER?: RateLimiterBinding;
  /** Dedicated authenticated organization-social write bucket. */
  SOCIAL_WRITE_LIMITER?: RateLimiterBinding;
  /** Sticky infrastructure launch gate; board_control is the runtime switch. */
  BOARD_ENABLED?: string;
  /** Server-only board identity key. Never sent to SQL, clients, or logs. */
  BOARD_AUTHOR_PEPPER?: string;
  /** Dedicated authenticated native-board write bucket. */
  BOARD_WRITE_LIMITER?: RateLimiterBinding;
  /** Optional server-held Meta token. Never sent to clients or persistence. */
  META_OEMBED_ACCESS_TOKEN?: string;
  /** Must remain v26.0; any other value disables provider calls. */
  META_GRAPH_VERSION?: string;
  /** Provider calls are opt-in and disabled unless exactly "true". */
  INSTAGRAM_OEMBED_ENABLED?: string;
  /** Optional isolated HTTPS origin for cached embed documents. */
  INSTAGRAM_EMBED_ORIGIN?: string;
};

type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

const noDatabaseQueries = new Proxy({} as Queries, {
  get(_target, property) {
    throw new Error(`database query unavailable on no-database route (${String(property)})`);
  },
});

function isProtectedOrganizationRoute(method: string, path: string): boolean {
  if ((method === "GET" || method === "HEAD") && path === "/api/me/organizations") return true;
  if ((method === "GET" || method === "HEAD") && path === "/api/me/org-claims/reviewable") {
    return true;
  }
  if (method === "POST" && path === "/api/orgs") return true;
  if (method === "POST" && /^\/api\/orgs\/[^/]+\/claims$/.test(path)) return true;
  if (method === "POST" && /^\/api\/org-claims\/[^/]+\/decision$/.test(path)) return true;
  return method === "PATCH" && /^\/api\/orgs\/[^/]+$/.test(path);
}

function isProtectedUserEventRoute(method: string, path: string): boolean {
  if ((method === "GET" || method === "HEAD") && path === "/api/me/events") return true;
  if ((method === "GET" || method === "HEAD") && /^\/api\/me\/events\/[^/]+$/.test(path)) {
    return true;
  }
  if (method === "POST" && path === "/api/events") return true;
  return (method === "PATCH" || method === "DELETE") && /^\/api\/events\/[^/]+$/.test(path);
}

function isProtectedOrgAssetRoute(method: string, path: string): boolean {
  if (method === "POST" && /^\/api\/orgs\/[^/]+\/media\/uploads$/.test(path)) return true;
  if (method === "PUT" && /^\/api\/org-media\/uploads\/[^/]+$/.test(path)) return true;
  if (
    method === "DELETE" &&
    /^\/api\/orgs\/[^/]+\/media\/[^/]+$/.test(path) &&
    !path.endsWith("/gallery")
  ) {
    return true;
  }
  if (method === "PATCH" && /^\/api\/orgs\/[^/]+\/media\/gallery$/.test(path)) return true;
  if (method === "POST" && /^\/api\/orgs\/[^/]+\/social-posts$/.test(path)) return true;
  if (method === "POST" && /^\/api\/orgs\/[^/]+\/social-posts\/[^/]+\/refresh$/.test(path)) {
    return true;
  }
  return method === "DELETE" && /^\/api\/orgs\/[^/]+\/social-posts\/[^/]+$/.test(path);
}

function isProtectedBoardRoute(path: string): boolean {
  return path === "/api/board" || path.startsWith("/api/board/");
}

function isSocialEmbedRoute(method: string, path: string): boolean {
  return (
    (method === "GET" || method === "HEAD") && /^\/api\/social-posts\/[^/]+\/embed$/.test(path)
  );
}

function isPublicOrgAssetJsonRoute(method: string, path: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return (
    /^\/api\/orgs\/[^/]+\/media$/.test(path) || /^\/api\/orgs\/[^/]+\/social-posts$/.test(path)
  );
}

function lazyWorkerQueries(
  connectionString: string | undefined,
  ctx: ExecutionContextLike,
  embedOrigin: string | null,
): {
  boardQueries: BoardQueries;
  close(): void;
  orgAssetQueries: OrgAssetQueries;
  queries: Queries;
} {
  let sql: ReturnType<typeof postgres> | undefined;
  let boardQueries: BoardQueries | undefined;
  let queries: Queries | undefined;
  let orgAssetQueries: OrgAssetQueries | undefined;

  function ensure() {
    if (connectionString === undefined) {
      throw Object.assign(new Error("database unavailable"), { code: "ECONNREFUSED" });
    }
    if (
      sql === undefined ||
      boardQueries === undefined ||
      queries === undefined ||
      orgAssetQueries === undefined
    ) {
      sql = postgres(connectionString, { max: 5, connect_timeout: 5 });
      boardQueries = createBoardQueries(sql);
      queries = createQueries(sql);
      orgAssetQueries = createOrgAssetQueries(sql, { embedOrigin });
    }
    return { boardQueries, orgAssetQueries, queries };
  }

  return {
    close() {
      if (sql !== undefined) ctx.waitUntil(sql.end({ timeout: 5 }));
    },
    boardQueries: new Proxy({} as BoardQueries, {
      get(_target, property) {
        return async (...args: unknown[]) => {
          const method = ensure().boardQueries[property as keyof BoardQueries];
          if (typeof method !== "function") {
            throw Object.assign(new Error("database query unavailable"), {
              code: "CONNECTION_ENDED",
            });
          }
          return (method as (...values: unknown[]) => unknown)(...args);
        };
      },
    }),
    queries: new Proxy({} as Queries, {
      get(_target, property) {
        return async (...args: unknown[]) => {
          const method = ensure().queries[property as keyof Queries];
          if (typeof method !== "function") {
            throw Object.assign(new Error("database query unavailable"), {
              code: "CONNECTION_ENDED",
            });
          }
          return (method as (...values: unknown[]) => unknown)(...args);
        };
      },
    }),
    orgAssetQueries: new Proxy({} as OrgAssetQueries, {
      get(_target, property) {
        return async (...args: unknown[]) => {
          const methods = ensure().orgAssetQueries;
          const method = methods[property as keyof OrgAssetQueries];
          if (typeof method !== "function") {
            throw Object.assign(new Error("database query unavailable"), {
              code: "CONNECTION_ENDED",
            });
          }
          return (method as (...values: unknown[]) => unknown)(...args);
        };
      },
    }),
  };
}

function withRateLimitCors(
  request: Request,
  response: Response,
  resolveOrigin: (origin: string) => string | null,
): Response {
  response.headers.append("Vary", "Origin");
  const allowedOrigin = resolveOrigin(request.headers.get("Origin") ?? "");
  if (allowedOrigin !== null) {
    response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    if (response.headers.has("Retry-After")) {
      response.headers.set("Access-Control-Expose-Headers", "Retry-After");
    }
  }
  return response;
}

function concealedEmbedNotFound(
  request: Request,
  resolveOrigin: (origin: string) => string | null,
): Response {
  const response =
    request.method === "HEAD"
      ? new Response(null, { status: 404 })
      : Response.json(errorEnvelope("not_found", "Organization asset not found."), {
          status: 404,
        });
  return withRateLimitCors(request, response, resolveOrigin);
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContextLike): Promise<Response> {
    // app.ts reads config via process.env (shared with the Node entry):
    // - NODE_ENV needs no bridging — wrangler's bundler inlines it as a
    //   compile-time constant ("production" on deploy, "development" in dev),
    //   which is exactly the response-validation gate we want.
    // - CORS_ORIGINS is bridged explicitly so behavior never depends on the
    //   nodejs_compat populate-process-env flag.
    if (env.CORS_ORIGINS !== undefined) process.env.CORS_ORIGINS = env.CORS_ORIGINS;
    const resolveCorsOrigin = createCorsOriginResolver(env.CORS_ORIGINS);

    // Hono routes on getPath(request), which safely decodes URI escapes once
    // (and deliberately protects double-encoded `%25`). Classify on that same
    // path so encoded protected aliases cannot drift into the database path.
    const path = getPath(request);
    const embedOrigin = normalizeEmbedOrigin(env.INSTAGRAM_EMBED_ORIGIN);
    const isSocialEmbed = isSocialEmbedRoute(request.method, path);
    if (isSocialEmbed && (embedOrigin === null || new URL(request.url).origin !== embedOrigin)) {
      return concealedEmbedNotFound(request, resolveCorsOrigin);
    }
    const isMe = path === "/api/me";
    const isAccount = path === "/api/account";
    const isProtectedOrganization = isProtectedOrganizationRoute(request.method, path);
    const isProtectedUserEvent = isProtectedUserEventRoute(request.method, path);
    const isProtectedOrgAsset = isProtectedOrgAssetRoute(request.method, path);
    const isProtectedBoard = isProtectedBoardRoute(path);
    const isPublicOrgAssetJson = isPublicOrgAssetJsonRoute(request.method, path);
    const isPublicRead =
      (request.method === "GET" || request.method === "HEAD") &&
      path.startsWith("/api/") &&
      !isMe &&
      !isAccount &&
      !isProtectedOrganization &&
      !isProtectedUserEvent &&
      !isProtectedOrgAsset &&
      !isProtectedBoard;

    if (isPublicRead) {
      const ip = request.headers.get("CF-Connecting-IP");
      if (ip === null || ip.length === 0) {
        return withRateLimitCors(request, rateLimitUnavailableResponse(), resolveCorsOrigin);
      }
      const denied = await checkRateLimit(env.PUBLIC_READ_LIMITER, `read:${ip}`);
      if (denied !== null) {
        return withRateLimitCors(request, denied, resolveCorsOrigin);
      }
    }

    const authenticator = createAuthenticator({ supabaseUrl: env.SUPABASE_URL });
    const adminAccountDeleter = createAccountDeleter({
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
    const boardLaunched = env.BOARD_ENABLED === "true";
    const boardIdentity = createBoardIdentity({
      encodedPepper: boardLaunched ? env.BOARD_AUTHOR_PEPPER : undefined,
    });
    let objectStore: MediaObjectStore | undefined;
    if (env.SUPABASE_URL !== undefined && env.SUPABASE_SERVICE_ROLE_KEY !== undefined) {
      try {
        objectStore = createSupabaseMediaObjectStore({
          supabaseUrl: env.SUPABASE_URL,
          serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
        });
      } catch {
        objectStore = undefined;
      }
    }
    const instagramClient =
      env.INSTAGRAM_OEMBED_ENABLED === "true" &&
      env.META_OEMBED_ACCESS_TOKEN !== undefined &&
      env.META_OEMBED_ACCESS_TOKEN.trim().length > 0 &&
      (env.META_GRAPH_VERSION ?? "v26.0") === "v26.0"
        ? createInstagramOEmbedClient({
            enabled: true,
            accessToken: env.META_OEMBED_ACCESS_TOKEN,
            graphVersion: "v26.0",
          })
        : undefined;
    const appOptions = {
      authenticator,
      userReadLimiter: env.USER_READ_LIMITER,
      userWriteLimiter: env.USER_WRITE_LIMITER,
      accountDeleter: adminAccountDeleter,
      boardIdentity,
      boardWriteLimiter: env.BOARD_WRITE_LIMITER,
      mediaWriteLimiter: env.MEDIA_WRITE_LIMITER,
      socialWriteLimiter: env.SOCIAL_WRITE_LIMITER,
      imageProcessor:
        env.IMAGES === undefined ? undefined : createCloudflareImageProcessor(env.IMAGES),
      objectStore,
      instagramClient,
      embedOrigin,
    };
    if (
      isProtectedOrganization ||
      isProtectedUserEvent ||
      isProtectedOrgAsset ||
      isProtectedBoard ||
      isPublicOrgAssetJson ||
      isSocialEmbed ||
      (isAccount && boardLaunched)
    ) {
      const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
      const lazy = lazyWorkerQueries(connectionString, ctx, embedOrigin);
      const accountDeleter = boardLaunched
        ? createBoardAwareAccountDeleter({
            adminDeleter: adminAccountDeleter,
            cleanup: async (actorId, authorToken) => {
              const result = await lazy.boardQueries.deleteAccount(actorId, authorToken);
              return result.kind === "ok" ? "cleaned" : "unavailable";
            },
            identity: boardIdentity,
            launchState: "launched",
          })
        : adminAccountDeleter;
      try {
        return await createApp(lazy.queries, {
          ...appOptions,
          accountDeleter,
          boardQueries: lazy.boardQueries,
          orgAssetQueries: lazy.orgAssetQueries,
        }).fetch(request);
      } finally {
        lazy.close();
      }
    }
    if (request.method === "OPTIONS" || isMe || isAccount) {
      return createApp(noDatabaseQueries, appOptions).fetch(request);
    }

    const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
    if (connectionString === undefined) {
      return Response.json(
        {
          error: {
            code: "config",
            detail: "No HYPERDRIVE binding or DATABASE_URL secret configured — see DEPLOY.md.",
          },
        },
        { status: 500 },
      );
    }

    // Workers cannot reuse TCP connections across requests, so the client is
    // per-request and Hyperdrive does the real pooling. `fetch_types` stays
    // on (postgres.js default): text[] columns (tags, aliases) must come back
    // as JS arrays, and type OIDs are fetched through Hyperdrive's cache.
    const sql = postgres(connectionString, { max: 5, connect_timeout: 5 });
    try {
      return await createApp(createQueries(sql), {
        ...appOptions,
        orgAssetQueries: createOrgAssetQueries(sql, { embedOrigin }),
      }).fetch(request);
    } finally {
      ctx.waitUntil(sql.end({ timeout: 5 }));
    }
  },
};
