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
  /** Cloudflare native authenticated-user write bucket (mounted in Step 4). */
  USER_WRITE_LIMITER?: RateLimiterBinding;
};

type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

const noDatabaseQueries = new Proxy({} as Queries, {
  get(_target, property) {
    throw new Error(`database query unavailable on no-database route (${String(property)})`);
  },
});

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
    const isMe = path === "/api/me";
    const isAccount = path === "/api/account";
    const isPublicRead =
      (request.method === "GET" || request.method === "HEAD") &&
      path.startsWith("/api/") &&
      !isMe &&
      !isAccount;

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
    const accountDeleter = createAccountDeleter({
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
    const appOptions = {
      authenticator,
      userWriteLimiter: env.USER_WRITE_LIMITER,
      accountDeleter,
    };
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
      return await createApp(createQueries(sql), appOptions).fetch(request);
    } finally {
      ctx.waitUntil(sql.end({ timeout: 5 }));
    }
  },
};
