import type { webcrypto } from "node:crypto";
import { MeOutSchema } from "@brownsync/contract";
import { Hono } from "hono";
import { Jwt } from "hono/utils/jwt";
import type { HonoJsonWebKey } from "hono/utils/jwt/types";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildOpenApiDocument, createApp } from "../src/app";
import {
  type AuthEnv,
  type AuthFetch,
  createAuthenticator,
  createJwksCache,
  createUserWriteRateLimitMiddleware,
  type JwkCache,
  type RateLimiterBinding,
} from "../src/auth";
import worker, { type WorkerEnv } from "../src/worker";
import { fakeQueries } from "./fixtures";

const SUPABASE_URL = "https://project-ref.supabase.co";
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const USER_ID = "10000000-0000-4000-8000-000000000001";

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
let tertiaryKey: SyntheticKey;

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
  [primaryKey, secondaryKey, tertiaryKey] = await Promise.all([
    generateSyntheticKey("primary-key"),
    generateSyntheticKey("secondary-key"),
    generateSyntheticKey("tertiary-key"),
  ]);
});

function jwks(keys: SyntheticJwk[] = [primaryKey.publicJwk]): Response {
  return Response.json({ keys });
}

function fetchJwks(keys: SyntheticJwk[] = [primaryKey.publicJwk]) {
  return vi.fn<AuthFetch>(async () => jwks(keys));
}

function invalidPointKey(kid = "invalid-point"): SyntheticJwk {
  return {
    ...primaryKey.publicJwk,
    kid,
    x: "A".repeat(43),
    y: "A".repeat(43),
  };
}

function authApp(
  fetcher: AuthFetch = fetchJwks(),
  cache: JwkCache = createJwksCache(),
  now: () => number = () => Date.now(),
) {
  return createApp(fakeQueries(), {
    authenticator: createAuthenticator({
      supabaseUrl: SUPABASE_URL,
      fetch: fetcher,
      cache,
      now,
    }),
  });
}

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
      ...overrides,
    },
    key.privateJwk,
    "ES256",
  );
}

async function meRequest(
  app: ReturnType<typeof createApp>,
  credential?: string,
): Promise<Response> {
  return app.request("/api/me", {
    headers: credential === undefined ? undefined : { Authorization: credential },
  });
}

describe("GET /api/me authentication", () => {
  it("returns only normalized id/email for a valid Brown Google token", async () => {
    const fetcher = fetchJwks();
    const res = await meRequest(authApp(fetcher), `Bearer ${await token()}`);

    expect(res.status).toBe(200);
    expect(MeOutSchema.parse(await res.json())).toEqual({
      id: USER_ID,
      email: "member@brown.edu",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0].toString()).toBe(JWKS_URL);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["leading whitespace", ` Bearer abc.def.ghi`],
    ["trailing whitespace", `Bearer abc.def.ghi `],
    ["two spaces", `Bearer  abc.def.ghi`],
    ["tab separator", `Bearer\tabc.def.ghi`],
    ["wrong scheme", `Basic abc.def.ghi`],
    ["one segment", `Bearer abc`],
    ["two segments", `Bearer abc.def`],
    ["empty segment", `Bearer abc..ghi`],
    ["four segments", `Bearer abc.def.ghi.jkl`],
    ["non-base64url", `Bearer abc.def.gh+i`],
    ["multi-value", `Bearer abc.def.ghi, Bearer abc.def.ghi`],
  ])("rejects %s bearer input before JWKS fetch", async (_label, header) => {
    const fetcher = fetchJwks();
    const res = await meRequest(authApp(fetcher), header);

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect((await res.json()) as unknown).toMatchObject({
      error: { code: "unauthorized" },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts a case-insensitive Bearer scheme with exactly one ASCII space", async () => {
    const res = await meRequest(authApp(), `bEaReR ${await token()}`);
    expect(res.status).toBe(200);
  });

  it("does not accept cookie or query-string credentials", async () => {
    const signed = await token();
    const app = authApp();
    const [queryRes, cookieRes] = await Promise.all([
      app.request(`/api/me?access_token=${encodeURIComponent(signed)}`),
      app.request("/api/me", { headers: { Cookie: `access_token=${signed}` } }),
    ]);

    expect(queryRes.status).toBe(401);
    expect(cookieRes.status).toBe(401);
  });

  it("returns 403 without a bearer challenge for a valid non-Brown token", async () => {
    const res = await meRequest(
      authApp(),
      `Bearer ${await token({ email: "member@example.com" })}`,
    );

    expect(res.status).toBe(403);
    expect(res.headers.has("www-authenticate")).toBe(false);
    expect((await res.json()) as unknown).toMatchObject({
      error: { code: "brown_membership_required" },
    });
  });

  it("does not trust spoofed user_metadata verification/provider claims", async () => {
    const res = await meRequest(
      authApp(),
      `Bearer ${await token({
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: { email_verified: true, provider: "google", hd: "brown.edu" },
      })}`,
    );

    expect(res.status).toBe(403);
    expect(res.headers.has("www-authenticate")).toBe(false);
  });

  it("accepts Google in the trusted app_metadata providers array", async () => {
    const res = await meRequest(
      authApp(),
      `Bearer ${await token({ app_metadata: { providers: ["email", "google"] } })}`,
    );
    expect(res.status).toBe(200);
  });

  it("returns 403 for a valid Brown token without trusted Google provenance", async () => {
    const res = await meRequest(
      authApp(),
      `Bearer ${await token({ app_metadata: { provider: "email", providers: ["email"] } })}`,
    );
    expect(res.status).toBe(403);
    expect(res.headers.has("www-authenticate")).toBe(false);
  });

  it.each([
    [
      "bad signature",
      async () =>
        token(
          {},
          {
            ...secondaryKey,
            privateJwk: {
              ...secondaryKey.privateJwk,
              kid: primaryKey.privateJwk.kid,
            },
          },
        ),
    ],
    ["non-canonical subject", async () => token({ sub: "not-a-uuid" })],
    ["missing subject", async () => token({ sub: undefined })],
    ["missing email", async () => token({ email: undefined })],
    ["wrong issuer", async () => token({ iss: "https://attacker.example/auth/v1" })],
    ["wrong audience", async () => token({ aud: "anon" })],
    ["expired", async () => token({ exp: Math.floor(Date.now() / 1000) - 1 })],
    ["not active", async () => token({ nbf: Math.floor(Date.now() / 1000) + 3600 })],
    ["issued in future", async () => token({ iat: Math.floor(Date.now() / 1000) + 3600 })],
  ])("returns a sanitized 401 for %s", async (_label, makeToken) => {
    const res = await meRequest(authApp(), `Bearer ${await makeToken()}`);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: "Authentication required." },
    });
  });

  it("rejects any algorithm except ES256", async () => {
    const signed = await token();
    const [header, payload, signature] = signed.split(".") as [string, string, string];
    const decoded = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(header.replaceAll("-", "+").replaceAll("_", "/")), (character) =>
          character.charCodeAt(0),
        ),
      ),
    ) as Record<string, unknown>;
    const replaced = btoa(JSON.stringify({ ...decoded, alg: "RS256" }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const res = await meRequest(authApp(), `Bearer ${replaced}.${payload}.${signature}`);
    expect(res.status).toBe(401);
  });

  it("keeps existing public routes available with default no-auth configuration", async () => {
    const app = createApp(fakeQueries());
    expect((await app.request("/api/events")).status).toBe(200);
    const me = await app.request("/api/me");
    expect(me.status).toBe(503);
    expect((await me.json()) as unknown).toMatchObject({
      error: { code: "auth_unavailable" },
    });
  });
});

describe("auth configuration and JWKS failures", () => {
  it.each([
    ["missing", undefined],
    ["HTTP", "http://project-ref.supabase.co"],
    ["credentials", "https://user:pass@project-ref.supabase.co"],
    ["query", "https://project-ref.supabase.co?redirect=evil"],
    ["fragment", "https://project-ref.supabase.co#fragment"],
    ["path", "https://project-ref.supabase.co/tenant"],
    ["double slash path", "https://project-ref.supabase.co//"],
  ])("fails closed with 503 for %s SUPABASE_URL", async (_label, supabaseUrl) => {
    const fetcher = fetchJwks();
    const app = createApp(fakeQueries(), {
      authenticator: createAuthenticator({
        supabaseUrl,
        fetch: fetcher,
        cache: createJwksCache(),
      }),
    });
    const res = await meRequest(app, `Bearer ${await token()}`);
    expect(res.status).toBe(503);
    expect(res.headers.has("www-authenticate")).toBe(false);
    expect((await res.json()) as unknown).toMatchObject({
      error: { code: "auth_unavailable" },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("normalizes exactly one trailing slash in configured SUPABASE_URL", async () => {
    const fetcher = fetchJwks();
    const app = createApp(fakeQueries(), {
      authenticator: createAuthenticator({
        supabaseUrl: `${SUPABASE_URL}/`,
        fetch: fetcher,
        cache: createJwksCache(),
      }),
    });
    expect((await meRequest(app, `Bearer ${await token()}`)).status).toBe(200);
    expect(fetcher.mock.calls[0]?.[0].toString()).toBe(JWKS_URL);
  });

  it.each([
    [
      "network failure",
      vi.fn<AuthFetch>(async () => {
        throw new Error("synthetic network failure");
      }),
    ],
    ["non-2xx status", vi.fn<AuthFetch>(async () => new Response("nope", { status: 503 }))],
    ["malformed JSON", vi.fn<AuthFetch>(async () => new Response("{"))],
    ["missing keys", vi.fn<AuthFetch>(async () => Response.json({ nope: [] }))],
    ["non-array keys", vi.fn<AuthFetch>(async () => Response.json({ keys: {} }))],
    ["empty keys", vi.fn<AuthFetch>(async () => jwks([]))],
    [
      "wrong curve",
      vi.fn<AuthFetch>(async () => jwks([{ ...primaryKey.publicJwk, crv: "P-384" }])),
    ],
    [
      "sign-only key",
      vi.fn<AuthFetch>(async () => jwks([{ ...primaryKey.publicJwk, key_ops: ["sign"] }])),
    ],
    [
      "non-array key_ops",
      vi.fn<AuthFetch>(async () =>
        jwks([
          {
            ...primaryKey.publicJwk,
            key_ops: "verify" as unknown as string[],
          },
        ]),
      ),
    ],
    [
      "duplicate kid",
      vi.fn<AuthFetch>(async () => jwks([primaryKey.publicJwk, { ...primaryKey.publicJwk }])),
    ],
    ["invalid P-256 point", vi.fn<AuthFetch>(async () => jwks([invalidPointKey()]))],
  ])("returns 503 without verifier details for %s", async (_label, fetcher) => {
    const res = await meRequest(authApp(fetcher), `Bearer ${await token()}`);
    expect(res.status).toBe(503);
    expect(res.headers.has("www-authenticate")).toBe(false);
    expect(await res.json()).toEqual({
      error: { code: "auth_unavailable", message: "Authentication temporarily unavailable." },
    });
  });

  it("keeps a valid verification key when an invalid point shares its kid", async () => {
    const fetcher = fetchJwks([
      invalidPointKey(primaryKey.publicJwk.kid as string),
      primaryKey.publicJwk,
    ]);
    const res = await meRequest(authApp(fetcher), `Bearer ${await token()}`);

    expect(res.status).toBe(200);
  });

  it("pins JWKS fetches to config rather than an unverified token issuer", async () => {
    const fetcher = fetchJwks();
    const maliciousIssuer = "https://attacker.example/auth/v1";
    const res = await meRequest(
      authApp(fetcher),
      `Bearer ${await token({ iss: maliciousIssuer })}`,
    );
    expect(res.status).toBe(401);
    expect(fetcher.mock.calls[0]?.[0].toString()).toBe(JWKS_URL);
    expect(fetcher.mock.calls[0]?.[0].toString()).not.toContain("attacker.example");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
  });
});

describe("JWKS cache", () => {
  it("uses a fresh cache for ten minutes, then refreshes at expiry", async () => {
    let cacheNow = 1_000_000;
    const fetcher = fetchJwks();
    const app = authApp(fetcher, createJwksCache(), () => cacheNow);
    const bearer = `Bearer ${await token()}`;

    expect((await meRequest(app, bearer)).status).toBe(200);
    cacheNow += 10 * 60 * 1000 - 1;
    expect((await meRequest(app, bearer)).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    cacheNow += 1;
    expect((await meRequest(app, bearer)).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("single-flights concurrent cold-cache refreshes", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetcher = vi.fn<AuthFetch>(async () => pending);
    const app = authApp(fetcher);
    const bearer = `Bearer ${await token()}`;

    const first = meRequest(app, bearer);
    const second = meRequest(app, bearer);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    resolveFetch?.(jwks());
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("forces one refresh for an unknown kid in a fresh cache", async () => {
    const responses = [
      jwks([primaryKey.publicJwk]),
      jwks([primaryKey.publicJwk, secondaryKey.publicJwk]),
    ];
    const fetcher = vi.fn<AuthFetch>(async () => responses.shift() ?? jwks());
    const app = authApp(fetcher);

    expect((await meRequest(app, `Bearer ${await token()}`)).status).toBe(200);
    expect((await meRequest(app, `Bearer ${await token({}, secondaryKey)}`)).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("limits unknown-kid forced refreshes to once per 30 seconds", async () => {
    let cacheNow = 5_000_000;
    const fetcher = fetchJwks([primaryKey.publicJwk]);
    const app = authApp(fetcher, createJwksCache(), () => cacheNow);

    expect((await meRequest(app, `Bearer ${await token()}`)).status).toBe(200);
    expect((await meRequest(app, `Bearer ${await token({}, secondaryKey)}`)).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(2);
    cacheNow += 29_999;
    expect((await meRequest(app, `Bearer ${await token({}, tertiaryKey)}`)).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(2);
    cacheNow += 1;
    expect((await meRequest(app, `Bearer ${await token({}, tertiaryKey)}`)).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("preserves a good cache entry when an unknown-kid refresh fails", async () => {
    let calls = 0;
    const fetcher = vi.fn<AuthFetch>(async () => {
      calls += 1;
      if (calls === 1) return jwks([primaryKey.publicJwk]);
      throw new Error("synthetic refresh failure");
    });
    const app = authApp(fetcher);
    const primaryBearer = `Bearer ${await token()}`;

    expect((await meRequest(app, primaryBearer)).status).toBe(200);
    expect((await meRequest(app, `Bearer ${await token({}, secondaryKey)}`)).status).toBe(503);
    expect((await meRequest(app, primaryBearer)).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns 503 throughout cooldown after an unknown-kid refresh failure", async () => {
    let cacheNow = 7_000_000;
    let calls = 0;
    const fetcher = vi.fn<AuthFetch>(async () => {
      calls += 1;
      if (calls === 1) return jwks([primaryKey.publicJwk]);
      throw new Error("synthetic forced refresh failure");
    });
    const app = authApp(fetcher, createJwksCache(), () => cacheNow);

    expect((await meRequest(app, `Bearer ${await token()}`)).status).toBe(200);
    expect((await meRequest(app, `Bearer ${await token({}, secondaryKey)}`)).status).toBe(503);
    cacheNow += 10_000;
    expect((await meRequest(app, `Bearer ${await token({}, tertiaryKey)}`)).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("never authenticates from an expired cache when refresh fails", async () => {
    let cacheNow = 8_000_000;
    let calls = 0;
    const fetcher = vi.fn<AuthFetch>(async () => {
      calls += 1;
      if (calls === 1) return jwks([primaryKey.publicJwk]);
      throw new Error("synthetic expiry refresh failure");
    });
    const app = authApp(fetcher, createJwksCache(), () => cacheNow);
    const bearer = `Bearer ${await token()}`;

    expect((await meRequest(app, bearer)).status).toBe(200);
    cacheNow += 10 * 60 * 1000;
    expect((await meRequest(app, bearer)).status).toBe(503);
  });
});

describe("OpenAPI authentication contract", () => {
  it("registers named Me, bearerAuth, route security, and all auth responses", () => {
    const doc = buildOpenApiDocument(createApp(fakeQueries())) as {
      components?: {
        schemas?: Record<string, unknown>;
        securitySchemes?: Record<string, unknown>;
      };
      paths?: Record<string, Record<string, unknown>>;
    };
    expect(doc.components?.schemas).toHaveProperty("Me");
    expect(doc.components?.securitySchemes?.bearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
    });
    const operation = doc.paths?.["/api/me"]?.get as {
      security?: unknown;
      responses?: Record<string, unknown>;
    };
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(operation.responses ?? {}).sort()).toEqual(["200", "401", "403", "503"]);
  });
});

describe("user-write native rate limiting", () => {
  function writeApp(limiter?: RateLimiterBinding) {
    const app = new Hono<AuthEnv>();
    app.use("*", async (c, next) => {
      c.set("user", { id: USER_ID, email: "member@brown.edu" });
      await next();
    });
    app.use("/write", createUserWriteRateLimitMiddleware(limiter));
    app.post("/write", (c) => c.json({ ok: true }));
    return app;
  }

  it("keys only from the verified attached user id", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const res = await writeApp({ limit }).request("/write", { method: "POST" });
    expect(res.status).toBe(200);
    expect(limit).toHaveBeenCalledWith({ key: `write:${USER_ID}` });
  });

  it("returns 429 with Retry-After 60 when denied", async () => {
    const res = await writeApp({
      limit: vi.fn(async () => ({ success: false })),
    }).request("/write", { method: "POST" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect((await res.json()) as unknown).toMatchObject({
      error: { code: "rate_limited" },
    });
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
  ])("returns 503 when the limiter is %s", async (_label, limiter) => {
    const res = await writeApp(limiter).request("/write", { method: "POST" });
    expect(res.status).toBe(503);
    expect(res.headers.has("retry-after")).toBe(false);
    expect((await res.json()) as unknown).toMatchObject({
      error: { code: "rate_limit_unavailable" },
    });
  });
});

describe("Worker public-read native rate gate", () => {
  const ctx = { waitUntil: vi.fn() };

  it("uses CF-Connecting-IP, ignores XFF and Authorization, and rejects before DB setup", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const res = await worker.fetch(
      new Request("https://api.example/api/events", {
        headers: {
          Authorization: `Bearer ${await token()}`,
          "CF-Connecting-IP": "198.51.100.7",
          "X-Forwarded-For": "203.0.113.99",
        },
      }),
      { PUBLIC_READ_LIMITER: { limit } },
      ctx,
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(limit).toHaveBeenCalledWith({ key: "read:198.51.100.7" });
  });

  it("applies the public bucket to HEAD under /api", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const res = await worker.fetch(
      new Request("https://api.example/api/events", {
        method: "HEAD",
        headers: { "CF-Connecting-IP": "198.51.100.8" },
      }),
      { PUBLIC_READ_LIMITER: { limit } },
      ctx,
    );
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: "read:198.51.100.8" });
  });

  it.each([
    ["missing binding", {}],
    [
      "binding exception",
      {
        PUBLIC_READ_LIMITER: {
          limit: vi.fn(async () => {
            throw new Error("synthetic public limiter failure");
          }),
        },
      },
    ],
  ] satisfies [string, Partial<WorkerEnv>][])(
    "returns 503 before DB setup for %s",
    async (_label, env) => {
      const res = await worker.fetch(
        new Request("https://api.example/api/events", {
          headers: { "CF-Connecting-IP": "198.51.100.9" },
        }),
        env,
        ctx,
      );
      expect(res.status).toBe(503);
      expect((await res.json()) as unknown).toMatchObject({
        error: { code: "rate_limit_unavailable" },
      });
    },
  );

  it("fails closed when CF-Connecting-IP is missing and never trusts XFF", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const res = await worker.fetch(
      new Request("https://api.example/api/events", {
        headers: { "X-Forwarded-For": "203.0.113.10" },
      }),
      { PUBLIC_READ_LIMITER: { limit } },
      ctx,
    );
    expect(res.status).toBe(503);
    expect(limit).not.toHaveBeenCalled();
  });

  it.each([
    ["429", 429, "https://brownsync.pages.dev", "https://brownsync.pages.dev"],
    ["429 disallowed", 429, "https://attacker.example", null],
    ["503", 503, "https://brownsync.pages.dev", "https://brownsync.pages.dev"],
    ["503 disallowed", 503, "https://attacker.example", null],
  ] as const)(
    "applies the shared CORS policy to early %s rate responses",
    async (_label, status, origin, allowedOrigin) => {
      const limiter =
        status === 429 ? { limit: vi.fn(async () => ({ success: false })) } : undefined;
      const res = await worker.fetch(
        new Request("https://api.example/api/events", {
          headers: {
            "CF-Connecting-IP": "198.51.100.11",
            Origin: origin,
          },
        }),
        {
          CORS_ORIGINS: "https://brownsync.pages.dev",
          PUBLIC_READ_LIMITER: limiter,
        },
        ctx,
      );

      expect(res.status).toBe(status);
      expect(res.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
      expect(res.headers.get("vary")).toContain("Origin");
      expect(res.headers.get("access-control-expose-headers")).toBe(
        status === 429 && allowedOrigin !== null ? "Retry-After" : null,
      );
      expect((await res.json()) as unknown).toMatchObject({
        error: {
          code: status === 429 ? "rate_limited" : "rate_limit_unavailable",
        },
      });
    },
  );

  it("exempts OPTIONS and /api/me from the public-read bucket", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const options = await worker.fetch(
      new Request("https://api.example/api/events", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
        },
      }),
      { PUBLIC_READ_LIMITER: { limit } },
      ctx,
    );
    const me = await worker.fetch(
      new Request("https://api.example/api/me"),
      {
        PUBLIC_READ_LIMITER: { limit },
        SUPABASE_URL,
      },
      ctx,
    );

    expect(options.status).toBe(204);
    expect(me.status).toBe(401);
    expect(limit).not.toHaveBeenCalled();
  });
});
