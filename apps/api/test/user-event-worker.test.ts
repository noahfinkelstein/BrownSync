import type { webcrypto } from "node:crypto";
import { Jwt } from "hono/utils/jwt";
import type { HonoJsonWebKey } from "hono/utils/jwt/types";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthFetch } from "../src/auth";
import worker from "../src/worker";

const SUPABASE_URL = "https://user-event-worker-test.supabase.co";
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const ACTOR_ID = "30000000-0000-4000-8000-000000000001";
const EVENT_ID = "40000000-0000-4000-8000-000000000001";

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
      kid: "user-event-worker-key",
    },
    publicJwk: {
      ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
      alg: "ES256",
      kid: "user-event-worker-key",
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
}

const context = () => ({ waitUntil: vi.fn() });

const createBody = JSON.stringify({
  clientRequestId: "50000000-0000-4000-8000-000000000001",
  organizationId: null,
  title: "Campus software study break",
  description: null,
  start: "2026-09-15T22:00:00Z",
  end: null,
  category: "social",
  url: null,
  placeId: "salomon-center",
});

describe("Worker student-event route classification", () => {
  it.each([
    ["create", "POST", "/api/events", createBody],
    [
      "edit",
      "PATCH",
      `/api/events/${EVENT_ID}`,
      JSON.stringify({ expectedRevision: 2, patch: { title: "Updated" } }),
    ],
    ["delete", "DELETE", `/api/events/${EVENT_ID}`, undefined],
    ["management list", "GET", "/api/me/events", undefined],
    ["management list HEAD", "HEAD", "/api/me/events", undefined],
    ["management detail", "GET", `/api/me/events/${EVENT_ID}`, undefined],
    ["management detail HEAD", "HEAD", `/api/me/events/${EVENT_ID}`, undefined],
  ])(
    "authenticates %s before database configuration and excludes the public-IP limiter",
    async (_label, method, path, body) => {
      const publicLimit = vi.fn(async () => ({ success: false }));
      const readLimit = vi.fn(async () => ({ success: true }));
      const writeLimit = vi.fn(async () => ({ success: true }));

      const response = await worker.fetch(
        new Request(`https://api.example${path}`, {
          method,
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
          body,
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

  it.each([
    ["list", "GET", "/api/me/events"],
    ["list HEAD", "HEAD", "/api/me/events"],
    ["detail", "GET", `/api/me/events/${EVENT_ID}`],
    ["detail HEAD", "HEAD", `/api/me/events/${EVENT_ID}`],
  ])(
    "applies USER_READ_LIMITER before the protected %s database seam",
    async (_label, method, path) => {
      stubJwks();
      const publicLimit = vi.fn(async () => ({ success: false }));
      const readLimit = vi.fn(async () => ({ success: false }));
      const writeLimit = vi.fn(async () => ({ success: true }));

      const response = await worker.fetch(
        new Request(`https://api.example${path}`, {
          method,
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

      expect(response.status).toBe(429);
      expect(readLimit).toHaveBeenCalledWith({ key: `read:${ACTOR_ID}` });
      expect(publicLimit).not.toHaveBeenCalled();
      expect(writeLimit).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["create", "POST", "/api/events", createBody],
    [
      "edit",
      "PATCH",
      `/api/events/${EVENT_ID}`,
      JSON.stringify({ expectedRevision: 2, patch: { title: "Updated" } }),
    ],
    ["delete", "DELETE", `/api/events/${EVENT_ID}`, undefined],
  ])(
    "applies USER_WRITE_LIMITER before the protected %s database seam",
    async (_label, method, path, body) => {
      stubJwks();
      const publicLimit = vi.fn(async () => ({ success: false }));
      const readLimit = vi.fn(async () => ({ success: true }));
      const writeLimit = vi.fn(async () => ({ success: false }));

      const response = await worker.fetch(
        new Request(`https://api.example${path}`, {
          method,
          headers: {
            Authorization: await bearer(),
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body,
        }),
        {
          PUBLIC_READ_LIMITER: { limit: publicLimit },
          SUPABASE_URL,
          USER_READ_LIMITER: { limit: readLimit },
          USER_WRITE_LIMITER: { limit: writeLimit },
        },
        context(),
      );

      expect(response.status).toBe(429);
      expect(writeLimit).toHaveBeenCalledWith({ key: `write:${ACTOR_ID}` });
      expect(publicLimit).not.toHaveBeenCalled();
      expect(readLimit).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["/api/events", "POST"],
    [`/api/events/${EVENT_ID}`, "PATCH"],
    [`/api/events/${EVENT_ID}`, "DELETE"],
    ["/api/me/events", "GET"],
    [`/api/me/events/${EVENT_ID}`, "GET"],
  ])("keeps OPTIONS for %s database- and limiter-free", async (path, requestedMethod) => {
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

  it.each(["/api/events", `/api/events/${EVENT_ID}`])(
    "keeps public GET %s on the public-IP limiter",
    async (path) => {
      const publicLimit = vi.fn(async () => ({ success: false }));
      const readLimit = vi.fn(async () => ({ success: true }));
      const writeLimit = vi.fn(async () => ({ success: true }));

      const response = await worker.fetch(
        new Request(`https://api.example${path}`, {
          headers: { "CF-Connecting-IP": "192.0.2.44" },
        }),
        {
          PUBLIC_READ_LIMITER: { limit: publicLimit },
          USER_READ_LIMITER: { limit: readLimit },
          USER_WRITE_LIMITER: { limit: writeLimit },
        },
        context(),
      );

      expect(response.status).toBe(429);
      expect(publicLimit).toHaveBeenCalledWith({ key: "read:192.0.2.44" });
      expect(readLimit).not.toHaveBeenCalled();
      expect(writeLimit).not.toHaveBeenCalled();
    },
  );
});
