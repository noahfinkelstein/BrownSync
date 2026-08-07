import type { webcrypto } from "node:crypto";
import { Jwt } from "hono/utils/jwt";
import type { HonoJsonWebKey } from "hono/utils/jwt/types";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthFetch } from "../src/auth";
import worker from "../src/worker";

const SUPABASE_URL = "https://organization-worker-test.supabase.co";
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const ACTOR_ID = "30000000-0000-4000-8000-000000000001";

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
      kid: "organization-worker-key",
    },
    publicJwk: {
      ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
      alg: "ES256",
      kid: "organization-worker-key",
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
    },
    key.privateJwk,
    "ES256",
  );
  return `Bearer ${token}`;
}

function stubJwks() {
  const fetcher = vi.fn<AuthFetch>(async (input) => {
    expect(input.toString()).toBe(JWKS_URL);
    return Response.json({ keys: [key.publicJwk] });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

const context = () => ({ waitUntil: vi.fn() });

describe("Worker organization route classification", () => {
  it.each([
    ["list access", "GET", "/api/me/organizations"],
    ["list access HEAD", "HEAD", "/api/me/organizations"],
    ["review queue", "GET", "/api/me/org-claims/reviewable"],
    ["review queue HEAD", "HEAD", "/api/me/org-claims/reviewable"],
    ["create", "POST", "/api/orgs"],
    ["claim", "POST", "/api/orgs/brown-lecture-board/claims"],
    ["claim decision", "POST", "/api/org-claims/20000000-0000-4000-8000-000000000001/decision"],
    ["edit", "PATCH", "/api/orgs/brown-lecture-board"],
  ])(
    "authenticates %s before database configuration and never uses the public-IP limiter",
    async (_label, method, path) => {
      const publicLimit = vi.fn(async () => ({ success: false }));
      const readLimit = vi.fn(async () => ({ success: true }));
      const writeLimit = vi.fn(async () => ({ success: true }));

      const response = await worker.fetch(
        new Request(`https://api.example${path}`, {
          method,
          headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
          body:
            method === "POST"
              ? path === "/api/orgs"
                ? JSON.stringify({ name: "BrownSync Builders" })
                : JSON.stringify({ evidence: "officer" })
              : method === "PATCH"
                ? JSON.stringify({ expectedRevision: 0, patch: { description: null } })
                : undefined,
        }),
        {
          PUBLIC_READ_LIMITER: { limit: publicLimit },
          SUPABASE_URL,
          USER_READ_LIMITER: { limit: readLimit },
          USER_WRITE_LIMITER: { limit: writeLimit },
        },
        context(),
      );

      expect(response.status).toBe(401);
      expect(publicLimit).not.toHaveBeenCalled();
      expect(readLimit).not.toHaveBeenCalled();
      expect(writeLimit).not.toHaveBeenCalled();
    },
  );

  it("opens the database seam only after a valid access-list token", async () => {
    const fetcher = stubJwks();
    const publicLimit = vi.fn(async () => ({ success: false }));
    const readLimit = vi.fn(async () => ({ success: true }));
    const writeLimit = vi.fn(async () => ({ success: true }));

    const response = await worker.fetch(
      new Request("https://api.example/api/me/organizations", {
        headers: { Authorization: await bearer() },
      }),
      {
        PUBLIC_READ_LIMITER: { limit: publicLimit },
        SUPABASE_URL,
        USER_READ_LIMITER: { limit: readLimit },
        USER_WRITE_LIMITER: { limit: writeLimit },
      },
      context(),
    );

    expect(response.status).toBe(503);
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "db_unavailable" },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(publicLimit).not.toHaveBeenCalled();
    expect(readLimit).toHaveBeenCalledWith({ key: `read:${ACTOR_ID}` });
    expect(writeLimit).not.toHaveBeenCalled();
  });

  it.each([
    ["access GET", "/api/me/organizations", "GET"],
    ["access HEAD", "/api/me/organizations", "HEAD"],
    ["review GET", "/api/me/org-claims/reviewable", "GET"],
    ["review HEAD", "/api/me/org-claims/reviewable", "HEAD"],
  ])(
    "applies the authenticated read limiter before the %s database seam",
    async (_label, path, method) => {
      stubJwks();
      const publicLimit = vi.fn(async () => ({ success: false }));
      const readLimit = vi.fn(async () => ({ success: false }));
      const writeLimit = vi.fn(async () => ({ success: true }));

      const response = await worker.fetch(
        new Request(`https://api.example${path}`, {
          method,
          headers: {
            Authorization: await bearer(),
            Origin: "https://brownsync.pages.dev",
          },
        }),
        {
          CORS_ORIGINS: "https://brownsync.pages.dev",
          PUBLIC_READ_LIMITER: { limit: publicLimit },
          SUPABASE_URL,
          USER_READ_LIMITER: { limit: readLimit },
          USER_WRITE_LIMITER: { limit: writeLimit },
        },
        context(),
      );

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("60");
      expect(readLimit).toHaveBeenCalledWith({ key: `read:${ACTOR_ID}` });
      expect(publicLimit).not.toHaveBeenCalled();
      expect(writeLimit).not.toHaveBeenCalled();
    },
  );

  it("applies the user limiter after authentication and before the organization database seam", async () => {
    stubJwks();
    const publicLimit = vi.fn(async () => ({ success: false }));
    const readLimit = vi.fn(async () => ({ success: true }));
    const writeLimit = vi.fn(async () => ({ success: false }));

    const response = await worker.fetch(
      new Request("https://api.example/api/orgs/brown-lecture-board/claims", {
        method: "POST",
        headers: {
          Authorization: await bearer(),
          "Content-Type": "application/json",
          Origin: "https://brownsync.pages.dev",
        },
        body: JSON.stringify({ evidence: "officer" }),
      }),
      {
        CORS_ORIGINS: "https://brownsync.pages.dev",
        PUBLIC_READ_LIMITER: { limit: publicLimit },
        SUPABASE_URL,
        USER_READ_LIMITER: { limit: readLimit },
        USER_WRITE_LIMITER: { limit: writeLimit },
      },
      context(),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://brownsync.pages.dev");
    expect(response.headers.get("access-control-expose-headers")).toBe("Retry-After");
    expect(writeLimit).toHaveBeenCalledWith({ key: `write:${ACTOR_ID}` });
    expect(publicLimit).not.toHaveBeenCalled();
    expect(readLimit).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/me/organizations", "GET"],
    ["/api/me/org-claims/reviewable", "GET"],
    ["/api/orgs", "POST"],
    ["/api/orgs/brown-lecture-board/claims", "POST"],
    ["/api/orgs/brown-lecture-board", "PATCH"],
    ["/api/org-claims/20000000-0000-4000-8000-000000000001/decision", "POST"],
  ])("keeps OPTIONS for %s database-free", async (path, requestedMethod) => {
    const publicLimit = vi.fn(async () => ({ success: false }));
    const readLimit = vi.fn(async () => ({ success: false }));
    const writeLimit = vi.fn(async () => ({ success: false }));
    const executionContext = context();

    const response = await worker.fetch(
      new Request(`https://api.example${path}`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://brownsync.pages.dev",
          "Access-Control-Request-Method": requestedMethod,
        },
      }),
      {
        CORS_ORIGINS: "https://brownsync.pages.dev",
        PUBLIC_READ_LIMITER: { limit: publicLimit },
        USER_READ_LIMITER: { limit: readLimit },
        USER_WRITE_LIMITER: { limit: writeLimit },
      },
      executionContext,
    );

    expect(response.status).toBe(204);
    expect(publicLimit).not.toHaveBeenCalled();
    expect(readLimit).not.toHaveBeenCalled();
    expect(writeLimit).not.toHaveBeenCalled();
    expect(executionContext.waitUntil).not.toHaveBeenCalled();
  });
});
