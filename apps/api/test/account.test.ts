import type { webcrypto } from "node:crypto";
import { Jwt } from "hono/utils/jwt";
import type { HonoJsonWebKey } from "hono/utils/jwt/types";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildOpenApiDocument, createApp } from "../src/app";
import {
  type AccountDeleter,
  type Authenticator,
  type AuthFetch,
  createAccountDeleter,
  createAuthenticator,
  createJwksCache,
  type RateLimiterBinding,
} from "../src/auth";
import worker from "../src/worker";
import { fakeQueries } from "./fixtures";

const SUPABASE_URL = "https://project-ref.supabase.co";
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "20000000-0000-4000-8000-000000000002";
const SERVICE_ROLE_KEY = "synthetic-service-role-key";

type SyntheticJwk = HonoJsonWebKey & {
  alg?: string;
  crv?: string;
  key_ops?: string[];
  kty?: string;
  use?: string;
  x?: string;
  y?: string;
};

type SyntheticKey = {
  privateJwk: SyntheticJwk;
  publicJwk: SyntheticJwk;
};

let primaryKey: SyntheticKey;
let secondaryKey: SyntheticKey;

async function generateSyntheticKey(kid: string): Promise<SyntheticKey> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as webcrypto.CryptoKeyPair;
  return {
    privateJwk: {
      ...(await crypto.subtle.exportKey("jwk", pair.privateKey)),
      alg: "ES256",
      kid,
    },
    publicJwk: {
      ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
      alg: "ES256",
      kid,
      use: "sig",
      key_ops: ["verify"],
    },
  };
}

beforeAll(async () => {
  [primaryKey, secondaryKey] = await Promise.all([
    generateSyntheticKey("account-primary"),
    generateSyntheticKey("account-secondary"),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function token(
  overrides: Record<string, unknown> = {},
  key: SyntheticKey = primaryKey,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return Jwt.sign(
    {
      sub: USER_ID,
      email: "Member@Brown.edu",
      app_metadata: { provider: "google" },
      iss: ISSUER,
      aud: "authenticated",
      iat: now - 5,
      nbf: now - 5,
      exp: now + 3600,
      amr: [{ method: "oauth", timestamp: now - 5 }],
      ...overrides,
    },
    key.privateJwk,
    "ES256",
  );
}

function validAuthenticator(fetcher: AuthFetch): Authenticator {
  return createAuthenticator({
    supabaseUrl: SUPABASE_URL,
    fetch: fetcher,
    cache: createJwksCache(),
  });
}

function attachedAuthenticator(events?: string[]): Authenticator {
  return async (c, next) => {
    events?.push("authenticate");
    c.set("user", { id: USER_ID, email: "member@brown.edu" });
    c.set("authentication", {
      oauthAuthenticatedAt: Math.floor(Date.now() / 1000) - 5,
    });
    await next();
  };
}

function allowedLimiter(events?: string[]): RateLimiterBinding {
  return {
    limit: vi.fn(async () => {
      events?.push("limit");
      return { success: true };
    }),
  };
}

async function accountRequest(
  app: ReturnType<typeof createApp>,
  authorization?: string,
  init: Omit<RequestInit, "method"> = {},
): Promise<Response> {
  return await app.request("/api/account", {
    ...init,
    method: "DELETE",
    headers: {
      ...(init.headers ?? {}),
      ...(authorization === undefined ? {} : { Authorization: authorization }),
    },
  });
}

function accountApp(options: {
  authenticator?: Authenticator;
  limiter?: RateLimiterBinding;
  deleter?: AccountDeleter;
}) {
  return createApp(fakeQueries(), {
    authenticator: options.authenticator,
    userWriteLimiter: options.limiter,
    accountDeleter: options.deleter,
  });
}

describe("DELETE /api/account orchestration", () => {
  it("authenticates a Brown Google token, limits its verified UUID, then maps Admin 200 to empty 204", async () => {
    const events: string[] = [];
    const jwksFetch = vi.fn<AuthFetch>(async () => {
      events.push("authenticate");
      return Response.json({ keys: [primaryKey.publicJwk] });
    });
    const limiter = allowedLimiter(events);
    const adminFetch = vi.fn<AuthFetch>(async () => {
      events.push("delete");
      return Response.json({ id: USER_ID }, { status: 200 });
    });
    const app = accountApp({
      authenticator: validAuthenticator(jwksFetch),
      limiter,
      deleter: createAccountDeleter({
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SERVICE_ROLE_KEY,
        fetch: adminFetch,
      }),
    });

    const response = await accountRequest(app, `Bearer ${await token()}`);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(events).toEqual(["authenticate", "limit", "delete"]);
    expect(limiter.limit).toHaveBeenCalledWith({ key: `write:${USER_ID}` });
  });

  it.each([204, 404])("maps Admin %i to an idempotent empty 204", async (adminStatus) => {
    const app = accountApp({
      authenticator: attachedAuthenticator(),
      limiter: allowedLimiter(),
      deleter: createAccountDeleter({
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SERVICE_ROLE_KEY,
        fetch: vi.fn(async () => new Response(null, { status: adminStatus })),
      }),
    });

    const response = await accountRequest(app);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it.each([
    ["missing", undefined],
    ["malformed", "Bearer abc.def"],
    ["invalid signature", "signed"],
  ])("returns 401 for a %s token without limiting or deleting", async (_label, credential) => {
    const jwksFetch = vi.fn<AuthFetch>(async () => Response.json({ keys: [primaryKey.publicJwk] }));
    const limiter = allowedLimiter();
    const deleter = vi.fn<AccountDeleter>(async () => "deleted");
    const invalidSignature =
      credential === "signed"
        ? `Bearer ${await token(
            {},
            {
              ...secondaryKey,
              privateJwk: { ...secondaryKey.privateJwk, kid: primaryKey.privateJwk.kid },
            },
          )}`
        : credential;
    const response = await accountRequest(
      accountApp({
        authenticator: validAuthenticator(jwksFetch),
        limiter,
        deleter,
      }),
      invalidSignature,
    );

    expect(response.status).toBe(401);
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "unauthorized" },
    });
    expect(limiter.limit).not.toHaveBeenCalled();
    expect(deleter).not.toHaveBeenCalled();
  });

  it.each([
    ["non-Brown", { email: "member@example.com" }],
    ["non-Google", { app_metadata: { provider: "email", providers: ["email"] } }],
  ])("returns 403 for a valid %s token without limiting or deleting", async (_label, claims) => {
    const limiter = allowedLimiter();
    const deleter = vi.fn<AccountDeleter>(async () => "deleted");
    const response = await accountRequest(
      accountApp({
        authenticator: validAuthenticator(async () =>
          Response.json({ keys: [primaryKey.publicJwk] }),
        ),
        limiter,
        deleter,
      }),
      `Bearer ${await token(claims)}`,
    );

    expect(response.status).toBe(403);
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "brown_membership_required" },
    });
    expect(limiter.limit).not.toHaveBeenCalled();
    expect(deleter).not.toHaveBeenCalled();
  });

  it.each([
    ["stale OAuth", () => [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) - 601 }]],
    ["future OAuth", () => [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) + 1 }]],
    [
      "token_refresh only",
      () => [{ method: "token_refresh", timestamp: Math.floor(Date.now() / 1000) - 5 }],
    ],
    ["missing", () => undefined],
    ["non-array", () => ({ method: "oauth", timestamp: Math.floor(Date.now() / 1000) - 5 })],
    ["malformed entry", () => [{ method: "oauth", timestamp: "recent" }]],
  ])("requires recent OAuth when AMR is %s", async (_label, makeAmr) => {
    const limiter = allowedLimiter();
    const deleter = vi.fn<AccountDeleter>(async () => "deleted");
    const response = await accountRequest(
      accountApp({
        authenticator: validAuthenticator(async () =>
          Response.json({ keys: [primaryKey.publicJwk] }),
        ),
        limiter,
        deleter,
      }),
      `Bearer ${await token({ amr: makeAmr() })}`,
    );

    expect(response.status).toBe(403);
    expect((await response.json()) as unknown).toEqual({
      error: {
        code: "recent_authentication_required",
        message: "Recent Google authentication is required.",
      },
    });
    expect(limiter.limit).not.toHaveBeenCalled();
    expect(deleter).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After 60 and never deletes when the limiter denies", async () => {
    const limiter = {
      limit: vi.fn(async () => ({ success: false })),
    };
    const deleter = vi.fn<AccountDeleter>(async () => "deleted");
    const response = await accountRequest(
      accountApp({
        authenticator: attachedAuthenticator(),
        limiter,
        deleter,
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "rate_limited" },
    });
    expect(deleter).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    [
      "throwing",
      {
        limit: vi.fn(async () => {
          throw new Error("synthetic limiter failure");
        }),
      },
    ],
    [
      "malformed",
      {
        limit: vi.fn(async () => ({ success: "yes" })),
      } as unknown as RateLimiterBinding,
    ],
  ])("returns 503 without deleting when the limiter is %s", async (_label, limiter) => {
    const deleter = vi.fn<AccountDeleter>(async () => "deleted");
    const response = await accountRequest(
      accountApp({
        authenticator: attachedAuthenticator(),
        limiter,
        deleter,
      }),
    );

    expect(response.status).toBe(503);
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "rate_limit_unavailable" },
    });
    expect(deleter).not.toHaveBeenCalled();
  });

  it("fails closed by default before a limiter or account service can be trusted", async () => {
    const response = await accountRequest(createApp(fakeQueries()));

    expect(response.status).toBe(503);
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "auth_unavailable" },
    });
  });
});

describe("Supabase Auth Admin account deleter", () => {
  it.each([
    ["missing URL", undefined, SERVICE_ROLE_KEY],
    ["blank URL", "", SERVICE_ROLE_KEY],
    ["URL with surrounding whitespace", ` ${SUPABASE_URL}`, SERVICE_ROLE_KEY],
    ["non-HTTPS URL", "http://project-ref.supabase.co", SERVICE_ROLE_KEY],
    ["URL with a path", `${SUPABASE_URL}/auth/v1`, SERVICE_ROLE_KEY],
    ["URL with credentials", "https://user:password@project-ref.supabase.co", SERVICE_ROLE_KEY],
    ["URL with a query", `${SUPABASE_URL}/?key=value`, SERVICE_ROLE_KEY],
    ["missing secret", SUPABASE_URL, undefined],
    ["blank secret", SUPABASE_URL, ""],
    ["whitespace secret", SUPABASE_URL, "   "],
    ["secret with surrounding whitespace", SUPABASE_URL, ` ${SERVICE_ROLE_KEY}`],
  ])("fails closed without fetch for %s", async (_label, supabaseUrl, serviceRoleKey) => {
    const fetcher = vi.fn<AuthFetch>(async () => new Response(null, { status: 200 }));
    const deleter = createAccountDeleter({ supabaseUrl, serviceRoleKey, fetch: fetcher });
    const response = await accountRequest(
      accountApp({
        authenticator: attachedAuthenticator(),
        limiter: allowedLimiter(),
        deleter,
      }),
    );

    expect(response.status).toBe(503);
    expect((await response.json()) as unknown).toEqual({
      error: {
        code: "account_service_unavailable",
        message: "Account service temporarily unavailable.",
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([201, 300, 400, 401, 403, 429, 500, 599])(
    "maps unexpected Admin %i to a sanitized 503",
    async (status) => {
      const deleter = createAccountDeleter({
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SERVICE_ROLE_KEY,
        fetch: vi.fn(async () =>
          Response.json(
            {
              error: `${SERVICE_ROLE_KEY}: synthetic upstream body must not escape`,
            },
            { status },
          ),
        ),
      });
      const response = await accountRequest(
        accountApp({
          authenticator: attachedAuthenticator(),
          limiter: allowedLimiter(),
          deleter,
        }),
      );
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(JSON.parse(body)).toEqual({
        error: {
          code: "account_service_unavailable",
          message: "Account service temporarily unavailable.",
        },
      });
      expect(body).not.toContain(SERVICE_ROLE_KEY);
      expect(body).not.toContain("synthetic upstream body");
    },
  );

  it.each([
    ["missing JSON body", () => new Response(null, { status: 200 })],
    ["HTML body", () => new Response("<html>not a user</html>", { status: 200 })],
    ["malformed JSON body", () => new Response("{", { status: 200 })],
    ["missing user id", () => Response.json({ email: "member@brown.edu" }, { status: 200 })],
    ["mismatched user id", () => Response.json({ id: OTHER_USER_ID }, { status: 200 })],
  ])("maps Admin 200 with %s to sanitized 503", async (_label, makeResponse) => {
    const response = await accountRequest(
      accountApp({
        authenticator: attachedAuthenticator(),
        limiter: allowedLimiter(),
        deleter: createAccountDeleter({
          supabaseUrl: SUPABASE_URL,
          serviceRoleKey: SERVICE_ROLE_KEY,
          fetch: vi.fn(async () => makeResponse()),
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect((await response.json()) as unknown).toEqual({
      error: {
        code: "account_service_unavailable",
        message: "Account service temporarily unavailable.",
      },
    });
  });

  it.each([
    [
      "network exception",
      vi.fn<AuthFetch>(async () => {
        throw new Error(`${SERVICE_ROLE_KEY}: synthetic upstream exception`);
      }),
    ],
    ["malformed response", vi.fn<AuthFetch>(async () => undefined as never)],
  ])("maps a %s to sanitized 503", async (_label, fetcher) => {
    const response = await accountRequest(
      accountApp({
        authenticator: attachedAuthenticator(),
        limiter: allowedLimiter(),
        deleter: createAccountDeleter({
          supabaseUrl: SUPABASE_URL,
          serviceRoleKey: SERVICE_ROLE_KEY,
          fetch: fetcher,
        }),
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).not.toContain(SERVICE_ROLE_KEY);
    expect(body).not.toContain("synthetic upstream");
    expect(JSON.parse(body)).toMatchObject({
      error: { code: "account_service_unavailable" },
    });
  });

  it("pins the configured origin and verified subject with server-only headers and no body/query", async () => {
    const fetcher = vi.fn<AuthFetch>(async () => new Response(null, { status: 204 }));
    const response = await accountRequest(
      accountApp({
        authenticator: attachedAuthenticator(),
        limiter: allowedLimiter(),
        deleter: createAccountDeleter({
          supabaseUrl: SUPABASE_URL,
          serviceRoleKey: SERVICE_ROLE_KEY,
          fetch: fetcher,
        }),
      }),
      undefined,
      {
        body: JSON.stringify({ userId: OTHER_USER_ID }),
        headers: {
          "Content-Type": "application/json",
          "X-User-ID": OTHER_USER_ID,
        },
      },
    );

    expect(response.status).toBe(204);
    expect(fetcher).toHaveBeenCalledOnce();
    const [input, init] = fetcher.mock.calls[0] ?? [];
    if (input === undefined) throw new Error("expected a captured Admin request");
    const adminUrl = new URL(input.toString());
    const headers = new Headers(init?.headers);
    expect(adminUrl.origin).toBe(SUPABASE_URL);
    expect(adminUrl.pathname).toBe(`/auth/v1/admin/users/${USER_ID}`);
    expect(adminUrl.search).toBe("");
    expect(init?.method).toBe("DELETE");
    expect(init?.redirect).toBe("error");
    expect(init?.body).toBeUndefined();
    expect(headers.get("authorization")).toBe(`Bearer ${SERVICE_ROLE_KEY}`);
    expect(headers.get("apikey")).toBe(SERVICE_ROLE_KEY);
    expect(headers.get("accept")).toBe("application/json");
    expect(input.toString()).not.toContain(OTHER_USER_ID);
  });

  it("does not accept a client-supplied UUID in the path", async () => {
    const fetcher = vi.fn<AuthFetch>(async () => new Response(null, { status: 204 }));
    const app = accountApp({
      authenticator: attachedAuthenticator(),
      limiter: allowedLimiter(),
      deleter: createAccountDeleter({
        supabaseUrl: SUPABASE_URL,
        serviceRoleKey: SERVICE_ROLE_KEY,
        fetch: fetcher,
      }),
    });

    const response = await app.request(`/api/account/${OTHER_USER_ID}`, { method: "DELETE" });

    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not log or return a synthetic bearer, secret, body, URL, or exception", async () => {
    const syntheticBearer = "synthetic.bearer.token";
    const upstreamBody = "synthetic-upstream-sensitive-body";
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await accountRequest(
      accountApp({
        authenticator: attachedAuthenticator(),
        limiter: allowedLimiter(),
        deleter: createAccountDeleter({
          supabaseUrl: SUPABASE_URL,
          serviceRoleKey: SERVICE_ROLE_KEY,
          fetch: vi.fn(async () => {
            throw new Error(`${syntheticBearer} ${SERVICE_ROLE_KEY} ${upstreamBody} ${JWKS_URL}`);
          }),
        }),
      }),
      `Bearer ${syntheticBearer}`,
    );
    const body = await response.text();
    const logged = [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls].flat().join(" ");

    expect(response.status).toBe(503);
    for (const sensitive of [syntheticBearer, SERVICE_ROLE_KEY, upstreamBody, JWKS_URL]) {
      expect(body).not.toContain(sensitive);
      expect(logged).not.toContain(sensitive);
    }
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("Worker and cross-origin boundary", () => {
  it.each(["GET", "HEAD", "PATCH"])(
    "lets Hono answer unauthenticated direct-app %s without account dependencies",
    async (method) => {
      const jwksFetch = vi.fn<AuthFetch>(async () =>
        Response.json({ keys: [primaryKey.publicJwk] }),
      );
      const writeLimit = vi.fn(async () => ({ success: true }));
      const deleter = vi.fn<AccountDeleter>(async () => "deleted");
      const app = accountApp({
        authenticator: validAuthenticator(jwksFetch),
        limiter: { limit: writeLimit },
        deleter,
      });

      const response = await app.request("/api/account", { method });

      expect(response.status).toBe(404);
      expect(jwksFetch).not.toHaveBeenCalled();
      expect(writeLimit).not.toHaveBeenCalled();
      expect(deleter).not.toHaveBeenCalled();
    },
  );

  it("deletes through the Worker before database configuration or opening", async () => {
    const signed = await token();
    const fetcher = vi.fn<AuthFetch>(async (input) => {
      const url = input.toString();
      if (url === JWKS_URL) return Response.json({ keys: [primaryKey.publicJwk] });
      if (url === `${SUPABASE_URL}/auth/v1/admin/users/${USER_ID}`) {
        return Response.json({ id: USER_ID }, { status: 200 });
      }
      throw new Error("unexpected synthetic fetch");
    });
    vi.stubGlobal("fetch", fetcher);
    const writeLimit = vi.fn(async () => ({ success: true }));

    const response = await worker.fetch(
      new Request("https://api.example/api/account", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${signed}` },
      }),
      {
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
        USER_WRITE_LIMITER: { limit: writeLimit },
      },
      { waitUntil: vi.fn() },
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(writeLimit).toHaveBeenCalledWith({ key: `write:${USER_ID}` });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("treats a once-encoded account alias as the protected DB-free route", async () => {
    const fetcher = vi.fn<AuthFetch>(async () => {
      throw new Error("Missing bearer must not fetch JWKS or call Admin");
    });
    vi.stubGlobal("fetch", fetcher);
    const publicLimit = vi.fn(async () => ({ success: false }));
    const writeLimit = vi.fn(async () => ({ success: true }));

    const response = await worker.fetch(
      new Request("https://api.example/api/%61ccount", {
        method: "DELETE",
        headers: { Origin: "https://brownsync.pages.dev" },
      }),
      {
        CORS_ORIGINS: "https://brownsync.pages.dev",
        PUBLIC_READ_LIMITER: { limit: publicLimit },
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
        USER_WRITE_LIMITER: { limit: writeLimit },
      },
      { waitUntil: vi.fn() },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://brownsync.pages.dev");
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "unauthorized" },
    });
    expect(publicLimit).not.toHaveBeenCalled();
    expect(writeLimit).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("treats a once-encoded me alias as the protected DB-free route", async () => {
    const fetcher = vi.fn<AuthFetch>(async () => {
      throw new Error("Missing bearer must not fetch JWKS");
    });
    vi.stubGlobal("fetch", fetcher);
    const publicLimit = vi.fn(async () => ({ success: false }));

    const response = await worker.fetch(
      new Request("https://api.example/api/%6de", {
        headers: {
          "CF-Connecting-IP": "198.51.100.12",
          Origin: "https://brownsync.pages.dev",
        },
      }),
      {
        CORS_ORIGINS: "https://brownsync.pages.dev",
        PUBLIC_READ_LIMITER: { limit: publicLimit },
        SUPABASE_URL,
      },
      { waitUntil: vi.fn() },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://brownsync.pages.dev");
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "unauthorized" },
    });
    expect(publicLimit).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed escape", "/api/%"],
    ["account trailing slash", "/api/account/"],
  ])("does not classify %s as the canonical account route", async (_label, path) => {
    const fetcher = vi.fn<AuthFetch>(async () => {
      throw new Error("A noncanonical path must not authenticate or call Admin");
    });
    vi.stubGlobal("fetch", fetcher);
    const writeLimit = vi.fn(async () => ({ success: true }));

    const response = await worker.fetch(
      new Request(`https://api.example${path}`, { method: "DELETE" }),
      {
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
        USER_WRITE_LIMITER: { limit: writeLimit },
      },
      { waitUntil: vi.fn() },
    );

    expect(response.status).toBe(500);
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "config" },
    });
    expect(writeLimit).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD", "PATCH"])(
    "keeps unauthenticated wrong-method %s dependency-free and under Hono CORS",
    async (method) => {
      const fetcher = vi.fn<AuthFetch>(async () => {
        throw new Error("No authentication or Admin fetch may run for a wrong method");
      });
      vi.stubGlobal("fetch", fetcher);
      const publicLimit = vi.fn(async () => ({ success: false }));
      const writeLimit = vi.fn(async () => ({ success: true }));

      const response = await worker.fetch(
        new Request("https://api.example/api/account", {
          method,
          headers: {
            Origin: "https://brownsync.pages.dev",
          },
        }),
        {
          CORS_ORIGINS: "https://brownsync.pages.dev",
          PUBLIC_READ_LIMITER: { limit: publicLimit },
          SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
          USER_WRITE_LIMITER: { limit: writeLimit },
        },
        { waitUntil: vi.fn() },
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        "https://brownsync.pages.dev",
      );
      expect(response.headers.get("vary")).toContain("Origin");
      expect(publicLimit).not.toHaveBeenCalled();
      expect(writeLimit).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["allowed", "https://brownsync.pages.dev", "https://brownsync.pages.dev"],
    ["disallowed", "https://attacker.example", null],
  ])("preserves Hono CORS behavior for an %s origin", async (_label, origin, expected) => {
    vi.stubEnv("CORS_ORIGINS", "https://brownsync.pages.dev");
    const response = await accountRequest(
      accountApp({
        authenticator: attachedAuthenticator(),
        limiter: allowedLimiter(),
        deleter: vi.fn<AccountDeleter>(async () => "deleted"),
      }),
      undefined,
      { headers: { Origin: origin } },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(expected);
    expect(response.headers.get("vary")).toContain("Origin");
  });

  it.each([
    ["allowed", "https://brownsync.pages.dev", "https://brownsync.pages.dev", "Retry-After"],
    ["disallowed", "https://attacker.example", null, null],
  ])(
    "applies %s-origin CORS and Retry-After exposure to account 429",
    async (_label, origin, allowedOrigin, exposedHeaders) => {
      vi.stubEnv("CORS_ORIGINS", "https://brownsync.pages.dev");
      const deleter = vi.fn<AccountDeleter>(async () => "deleted");
      const response = await accountRequest(
        accountApp({
          authenticator: attachedAuthenticator(),
          limiter: { limit: vi.fn(async () => ({ success: false })) },
          deleter,
        }),
        undefined,
        { headers: { Origin: origin } },
      );

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("60");
      expect(response.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
      expect(response.headers.get("access-control-expose-headers")).toBe(exposedHeaders);
      expect(response.headers.get("vary")).toContain("Origin");
      expect(deleter).not.toHaveBeenCalled();
    },
  );
});

describe("OpenAPI account contract", () => {
  it("declares bearer security and 204/401/403/429/503 without a client user id", () => {
    const document = buildOpenApiDocument(createApp(fakeQueries())) as {
      paths?: Record<string, Record<string, unknown>>;
    };
    const operation = document.paths?.["/api/account"]?.delete as {
      parameters?: unknown;
      requestBody?: unknown;
      responses?: Record<string, unknown>;
      security?: unknown;
    };

    expect(operation.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(operation.responses ?? {}).sort()).toEqual([
      "204",
      "401",
      "403",
      "429",
      "503",
    ]);
    expect(operation.requestBody).toBeUndefined();
    expect(operation.parameters).toBeUndefined();
    expect(JSON.stringify(operation)).not.toContain("userId");
    expect(JSON.stringify(operation)).not.toContain("user_id");
  });
});
