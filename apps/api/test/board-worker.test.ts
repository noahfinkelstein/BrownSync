import type { webcrypto } from "node:crypto";
import { Jwt } from "hono/utils/jwt";
import type { HonoJsonWebKey } from "hono/utils/jwt/types";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthFetch } from "../src/auth";
import worker from "../src/worker";

const SUPABASE_URL = "https://board-worker-test.supabase.co";
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const ACTOR_ID = "84000000-0000-4000-8000-000000000001";
const POST_ID = "84000000-0000-4000-8000-000000000002";
const REQUEST_ID = "84000000-0000-4000-8000-000000000003";
const CANONICAL_PEPPER = "A".repeat(43);

type SyntheticJwk = HonoJsonWebKey & {
  alg?: string;
  key_ops?: string[];
  use?: string;
};

type SyntheticKey = {
  privateJwk: SyntheticJwk;
  publicJwk: SyntheticJwk;
};

let key: SyntheticKey;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as webcrypto.CryptoKeyPair;
  key = {
    privateJwk: {
      ...(await crypto.subtle.exportKey("jwk", pair.privateKey)),
      alg: "ES256",
      kid: "board-worker-key",
    },
    publicJwk: {
      ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
      alg: "ES256",
      kid: "board-worker-key",
      use: "sig",
      key_ops: ["verify"],
    },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function bearer(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = await Jwt.sign(
    {
      sub: ACTOR_ID,
      email: "member@brown.edu",
      app_metadata: { provider: "google" },
      iss: ISSUER,
      aud: "authenticated",
      iat: now - 5,
      nbf: now - 5,
      exp: now + 3600,
      amr: [{ method: "oauth", timestamp: now - 5 }],
    },
    key.privateJwk,
    "ES256",
  );
  return `Bearer ${token}`;
}

function stubJwks(extra?: (input: string) => Response | undefined) {
  const fetcher = vi.fn<AuthFetch>(async (input) => {
    const url = input.toString();
    const response = extra?.(url);
    if (response !== undefined) return response;
    if (url === JWKS_URL) return Response.json({ keys: [key.publicJwk] });
    throw new Error(`unexpected synthetic fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

const context = () => ({ waitUntil: vi.fn() });

describe("Worker native-board isolation and launch gates", () => {
  it.each([
    ["feed", "GET", "/api/board/feed", undefined],
    ["thread HEAD", "HEAD", `/api/board/posts/${POST_ID}`, undefined],
    [
      "create",
      "POST",
      "/api/board/posts",
      JSON.stringify({ clientRequestId: REQUEST_ID, body: "Question" }),
    ],
    [
      "moderate",
      "POST",
      `/api/board/moderation/posts/${POST_ID}/decision`,
      JSON.stringify({
        clientRequestId: REQUEST_ID,
        expectedEpoch: 0,
        action: "hide",
        reason: "Safety",
      }),
    ],
    ["encoded status", "GET", "/api/%62oard/status", undefined],
  ])(
    "authenticates %s before board infrastructure and never uses the public limiter",
    async (_label, method, path, body) => {
      const publicLimit = vi.fn(async () => ({ success: false }));
      const boardLimit = vi.fn(async () => ({ success: false }));

      const response = await worker.fetch(
        new Request(`https://api.example${path}`, {
          method,
          headers: {
            "CF-Connecting-IP": "192.0.2.84",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body,
        }),
        {
          BOARD_AUTHOR_PEPPER: CANONICAL_PEPPER,
          BOARD_ENABLED: "true",
          BOARD_WRITE_LIMITER: { limit: boardLimit },
          PUBLIC_READ_LIMITER: { limit: publicLimit },
          SUPABASE_URL,
        },
        context(),
      );

      expect(response.status).toBe(401);
      expect(publicLimit).not.toHaveBeenCalled();
      expect(boardLimit).not.toHaveBeenCalled();
    },
  );

  it("applies the dedicated board limiter after authentication and before identity or SQL", async () => {
    stubJwks();
    const publicLimit = vi.fn(async () => ({ success: false }));
    const userLimit = vi.fn(async () => ({ success: true }));
    const boardLimit = vi.fn(async () => ({ success: false }));

    const response = await worker.fetch(
      new Request("https://api.example/api/board/posts", {
        method: "POST",
        headers: {
          Authorization: await bearer(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clientRequestId: REQUEST_ID, body: "Question" }),
      }),
      {
        BOARD_AUTHOR_PEPPER: CANONICAL_PEPPER,
        BOARD_ENABLED: "true",
        BOARD_WRITE_LIMITER: { limit: boardLimit },
        PUBLIC_READ_LIMITER: { limit: publicLimit },
        SUPABASE_URL,
        USER_WRITE_LIMITER: { limit: userLimit },
      },
      context(),
    );

    expect(response.status).toBe(429);
    expect(boardLimit).toHaveBeenCalledWith({ key: `write:${ACTOR_ID}` });
    expect(publicLimit).not.toHaveBeenCalled();
    expect(userLimit).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/board/feed", "GET"],
    [`/api/board/posts/${POST_ID}`, "PATCH"],
    ["/api/board/moderation/queue", "GET"],
    ["/api/board/admin/config", "PATCH"],
  ])("keeps OPTIONS for %s free of auth, limiters, identity, and SQL", async (path, method) => {
    const publicLimit = vi.fn(async () => ({ success: false }));
    const boardLimit = vi.fn(async () => ({ success: false }));
    const executionContext = context();

    const response = await worker.fetch(
      new Request(`https://api.example${path}`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://brownsync.pages.dev",
          "Access-Control-Request-Method": method,
        },
      }),
      {
        BOARD_AUTHOR_PEPPER: "not canonical",
        BOARD_ENABLED: "true",
        BOARD_WRITE_LIMITER: { limit: boardLimit },
        CORS_ORIGINS: "https://brownsync.pages.dev",
        PUBLIC_READ_LIMITER: { limit: publicLimit },
      },
      executionContext,
    );

    expect(response.status).toBe(204);
    expect(publicLimit).not.toHaveBeenCalled();
    expect(boardLimit).not.toHaveBeenCalled();
    expect(executionContext.waitUntil).not.toHaveBeenCalled();
  });

  it("keeps the disabled-by-default infrastructure gate closed without opening SQL", async () => {
    stubJwks();
    const publicLimit = vi.fn(async () => ({ success: false }));
    const executionContext = context();

    const response = await worker.fetch(
      new Request("https://api.example/api/board/status", {
        headers: {
          Authorization: await bearer(),
          "CF-Connecting-IP": "192.0.2.84",
        },
      }),
      {
        BOARD_AUTHOR_PEPPER: CANONICAL_PEPPER,
        BOARD_ENABLED: "false",
        PUBLIC_READ_LIMITER: { limit: publicLimit },
        SUPABASE_URL,
      },
      executionContext,
    );

    expect(response.status).toBe(503);
    expect(publicLimit).not.toHaveBeenCalled();
    expect(executionContext.waitUntil).not.toHaveBeenCalled();
  });

  it("fails launched account deletion closed before Admin when board identity is malformed", async () => {
    const adminUrl = `${SUPABASE_URL}/auth/v1/admin/users/${ACTOR_ID}`;
    const fetcher = stubJwks((url) =>
      url === adminUrl ? new Response(null, { status: 204 }) : undefined,
    );
    const userLimit = vi.fn(async () => ({ success: true }));

    const response = await worker.fetch(
      new Request("https://api.example/api/account", {
        method: "DELETE",
        headers: { Authorization: await bearer() },
      }),
      {
        BOARD_AUTHOR_PEPPER: "malformed",
        BOARD_ENABLED: "true",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-secret",
        SUPABASE_URL,
        USER_WRITE_LIMITER: { limit: userLimit },
      },
      context(),
    );

    expect(response.status).toBe(503);
    expect(userLimit).toHaveBeenCalledWith({ key: `write:${ACTOR_ID}` });
    expect(fetcher.mock.calls.some(([input]) => input.toString() === adminUrl)).toBe(false);
  });
});
