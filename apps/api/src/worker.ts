import postgres from "postgres";
import { createApp } from "./app";
import { createQueries } from "./queries";

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
};

type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContextLike): Promise<Response> {
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

    // app.ts reads config via process.env (shared with the Node entry):
    // - NODE_ENV needs no bridging — wrangler's bundler inlines it as a
    //   compile-time constant ("production" on deploy, "development" in dev),
    //   which is exactly the response-validation gate we want.
    // - CORS_ORIGINS is bridged explicitly so behavior never depends on the
    //   nodejs_compat populate-process-env flag.
    if (env.CORS_ORIGINS !== undefined) process.env.CORS_ORIGINS = env.CORS_ORIGINS;

    // Workers cannot reuse TCP connections across requests, so the client is
    // per-request and Hyperdrive does the real pooling. `fetch_types` stays
    // on (postgres.js default): text[] columns (tags, aliases) must come back
    // as JS arrays, and type OIDs are fetched through Hyperdrive's cache.
    const sql = postgres(connectionString, { max: 5, connect_timeout: 5 });
    try {
      return await createApp(createQueries(sql)).fetch(request);
    } finally {
      ctx.waitUntil(sql.end({ timeout: 5 }));
    }
  },
};
