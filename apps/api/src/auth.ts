import type { MeOut } from "@brownsync/contract";
import type { MiddlewareHandler } from "hono";
import { Jwt } from "hono/utils/jwt";
import type { HonoJsonWebKey } from "hono/utils/jwt/types";
import { errorEnvelope } from "./errors";

export const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
export const UNKNOWN_KID_REFRESH_COOLDOWN_MS = 30 * 1000;
export const RECENT_AUTHENTICATION_WINDOW_SECONDS = 10 * 60;

const BROWN_EMAIL = /^[^@\s]+@brown\.edu$/i;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;

export type AuthUser = MeOut;
export type AuthenticationContext = {
  oauthAuthenticatedAt: number | null;
};
export type AuthEnv = {
  Variables: {
    user: AuthUser;
    authentication: AuthenticationContext;
  };
};
export type Authenticator = MiddlewareHandler<AuthEnv>;

export type AuthFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type AccountDeletionResult = "deleted" | "unavailable";
export type AccountDeleter = (user: AuthUser) => Promise<AccountDeletionResult>;

export type AccountDeleterOptions = {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  fetch?: AuthFetch;
};

export type RateLimiterBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

type CacheEntry = {
  keys: HonoJsonWebKey[];
  expiresAt: number;
};

type VerificationJwk = HonoJsonWebKey & {
  alg: string;
  crv: string;
  d?: string;
  key_ops?: string[];
  kty: string;
  use?: string;
  x: string;
  y: string;
};

export type JwkCache = {
  entries: Map<string, CacheEntry>;
  inFlight: Map<string, Promise<CacheEntry>>;
  unknownKidRefreshFailed: Map<string, boolean>;
  unknownKidRefreshAt: Map<string, number>;
};

type AuthConfig = {
  cacheKey: string;
  issuer: string;
  jwksUrl: string;
};

type AuthenticatorOptions = {
  supabaseUrl?: string;
  fetch?: AuthFetch;
  now?: () => number;
  cache?: JwkCache;
};

type AuthResult =
  | { authentication: AuthenticationContext; kind: "ok"; user: AuthUser }
  | { kind: "unauthorized" }
  | { kind: "membership_required" }
  | { kind: "unavailable" };

const moduleJwkCache = createJwksCache();

export function createJwksCache(): JwkCache {
  return {
    entries: new Map(),
    inFlight: new Map(),
    unknownKidRefreshFailed: new Map(),
    unknownKidRefreshAt: new Map(),
  };
}

function normalizeSupabaseOrigin(value: string | undefined): string | null {
  if (value === undefined || value.length === 0 || value.trim() !== value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== "/"
  ) {
    return null;
  }

  return parsed.origin;
}

function normalizeAuthConfig(value: string | undefined): AuthConfig | null {
  const cacheKey = normalizeSupabaseOrigin(value);
  if (cacheKey === null) return null;

  const issuer = `${cacheKey}/auth/v1`;
  return {
    cacheKey,
    issuer,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
  };
}

function parseBearer(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization === null) return null;
  const match = BEARER.exec(authorization);
  if (match === null || match[0].length !== authorization.length) return null;
  return match[1] ?? null;
}

function readTokenHeader(token: string): { alg: string; kid: string } | null {
  try {
    const { header } = Jwt.decode(token);
    if (
      header === null ||
      typeof header !== "object" ||
      header.alg !== "ES256" ||
      typeof header.kid !== "string" ||
      header.kid.length === 0
    ) {
      return null;
    }
    return { alg: header.alg, kid: header.kid };
  } catch {
    return null;
  }
}

function isCandidateVerificationKey(value: unknown): value is VerificationJwk {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const key = value as VerificationJwk;
  return (
    key.kty === "EC" &&
    key.crv === "P-256" &&
    key.alg === "ES256" &&
    typeof key.kid === "string" &&
    key.kid.length > 0 &&
    typeof key.x === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(key.x) &&
    typeof key.y === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(key.y) &&
    key.d === undefined &&
    (key.use === undefined || key.use === "sig") &&
    (key.key_ops === undefined || (Array.isArray(key.key_ops) && key.key_ops.includes("verify")))
  );
}

async function validatedKeys(value: unknown): Promise<HonoJsonWebKey[] | null> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const rawKeys = (value as { keys?: unknown }).keys;
  if (!Array.isArray(rawKeys)) return null;

  const candidates = (
    await Promise.all(
      rawKeys.map(async (key) => {
        if (!isCandidateVerificationKey(key)) return null;
        try {
          const imported = await globalThis.crypto.subtle.importKey(
            "jwk",
            key,
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["verify"],
          );
          return imported.type === "public" && imported.usages.includes("verify") ? key : null;
        } catch {
          return null;
        }
      }),
    )
  ).filter((key): key is VerificationJwk => key !== null);
  const kidCounts = new Map<string, number>();
  for (const key of candidates) {
    const kid = key.kid as string;
    kidCounts.set(kid, (kidCounts.get(kid) ?? 0) + 1);
  }

  const unique = candidates.filter((key) => kidCounts.get(key.kid as string) === 1);
  return unique.length > 0 ? unique : null;
}

async function refreshKeys(
  config: AuthConfig,
  fetcher: AuthFetch,
  cache: JwkCache,
  now: () => number,
): Promise<CacheEntry> {
  const existing = cache.inFlight.get(config.cacheKey);
  if (existing !== undefined) return existing;

  const refresh = (async () => {
    const response = await fetcher(config.jwksUrl, {
      headers: { Accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) throw new Error("unavailable");

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("unavailable");
    }
    const keys = await validatedKeys(payload);
    if (keys === null) throw new Error("unavailable");

    const entry = { keys, expiresAt: now() + JWKS_CACHE_TTL_MS };
    cache.entries.set(config.cacheKey, entry);
    return entry;
  })();

  cache.inFlight.set(config.cacheKey, refresh);
  try {
    return await refresh;
  } finally {
    cache.inFlight.delete(config.cacheKey);
  }
}

async function keysForToken(
  config: AuthConfig,
  kid: string,
  fetcher: AuthFetch,
  cache: JwkCache,
  now: () => number,
): Promise<{ kind: "keys"; keys: HonoJsonWebKey[] } | { kind: "unknown" } | { kind: "error" }> {
  const timestamp = now();
  const cached = cache.entries.get(config.cacheKey);
  const isFresh = cached !== undefined && cached.expiresAt > timestamp;

  if (!isFresh) {
    try {
      const refreshed = await refreshKeys(config, fetcher, cache, now);
      return refreshed.keys.some((key) => key.kid === kid)
        ? { kind: "keys", keys: refreshed.keys }
        : { kind: "unknown" };
    } catch {
      return { kind: "error" };
    }
  }

  if (cached.keys.some((key) => key.kid === kid)) {
    return { kind: "keys", keys: cached.keys };
  }

  const activeRefresh = cache.inFlight.get(config.cacheKey);
  if (activeRefresh !== undefined) {
    try {
      const refreshed = await activeRefresh;
      return refreshed.keys.some((key) => key.kid === kid)
        ? { kind: "keys", keys: refreshed.keys }
        : { kind: "unknown" };
    } catch {
      return { kind: "error" };
    }
  }

  const lastRefresh = cache.unknownKidRefreshAt.get(config.cacheKey);
  if (lastRefresh !== undefined && timestamp - lastRefresh < UNKNOWN_KID_REFRESH_COOLDOWN_MS) {
    return cache.unknownKidRefreshFailed.get(config.cacheKey) === true
      ? { kind: "error" }
      : { kind: "unknown" };
  }

  cache.unknownKidRefreshAt.set(config.cacheKey, timestamp);
  try {
    const refreshed = await refreshKeys(config, fetcher, cache, now);
    cache.unknownKidRefreshFailed.set(config.cacheKey, false);
    return refreshed.keys.some((key) => key.kid === kid)
      ? { kind: "keys", keys: refreshed.keys }
      : { kind: "unknown" };
  } catch {
    cache.unknownKidRefreshFailed.set(config.cacheKey, true);
    return { kind: "error" };
  }
}

function hasTrustedGoogleProvider(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const metadata = value as { provider?: unknown; providers?: unknown };
  return (
    metadata.provider === "google" ||
    (Array.isArray(metadata.providers) && metadata.providers.includes("google"))
  );
}

function oauthAuthenticatedAt(value: unknown): number | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  let latest: number | null = null;
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (
      typeof method !== "string" ||
      method.length === 0 ||
      typeof timestamp !== "number" ||
      !Number.isSafeInteger(timestamp) ||
      timestamp < 0
    ) {
      return null;
    }
    if (method === "oauth" && (latest === null || timestamp > latest)) {
      latest = timestamp;
    }
  }
  return latest;
}

async function authenticateToken(
  token: string,
  config: AuthConfig,
  fetcher: AuthFetch,
  cache: JwkCache,
  now: () => number,
): Promise<AuthResult> {
  const header = readTokenHeader(token);
  if (header === null) return { kind: "unauthorized" };

  const keyResult = await keysForToken(config, header.kid, fetcher, cache, now);
  if (keyResult.kind === "error") return { kind: "unavailable" };
  if (keyResult.kind === "unknown") return { kind: "unauthorized" };

  let payload: Record<string, unknown>;
  try {
    payload = await Jwt.verifyWithJwks(token, {
      keys: keyResult.keys,
      allowedAlgorithms: ["ES256"],
      verification: {
        iss: config.issuer,
        aud: "authenticated",
        exp: true,
        nbf: true,
        iat: true,
      },
    });
  } catch {
    return { kind: "unauthorized" };
  }

  if (typeof payload.sub !== "string" || !CANONICAL_UUID.test(payload.sub)) {
    return { kind: "unauthorized" };
  }
  if (
    typeof payload.email !== "string" ||
    !EMAIL_SHAPE.test(payload.email) ||
    payload.email.length === 0
  ) {
    return { kind: "unauthorized" };
  }
  if (!BROWN_EMAIL.test(payload.email) || !hasTrustedGoogleProvider(payload.app_metadata)) {
    return { kind: "membership_required" };
  }

  return {
    kind: "ok",
    user: { id: payload.sub, email: payload.email.toLowerCase() },
    authentication: {
      oauthAuthenticatedAt: oauthAuthenticatedAt(payload.amr),
    },
  };
}

function unauthorizedResponse(): Response {
  return Response.json(errorEnvelope("unauthorized", "Authentication required."), {
    status: 401,
    headers: { "WWW-Authenticate": "Bearer" },
  });
}

function membershipResponse(): Response {
  return Response.json(
    errorEnvelope("brown_membership_required", "A verified Brown Google account is required."),
    { status: 403 },
  );
}

function recentAuthenticationRequiredResponse(): Response {
  return Response.json(
    errorEnvelope("recent_authentication_required", "Recent Google authentication is required."),
    { status: 403 },
  );
}

function unavailableResponse(): Response {
  return Response.json(
    errorEnvelope("auth_unavailable", "Authentication temporarily unavailable."),
    { status: 503 },
  );
}

export function createUnavailableAuthenticator(): Authenticator {
  return async () => unavailableResponse();
}

export function createUnavailableAccountDeleter(): AccountDeleter {
  return async () => "unavailable";
}

export function createAccountDeleter(options: AccountDeleterOptions): AccountDeleter {
  const origin = normalizeSupabaseOrigin(options.supabaseUrl);
  const serviceRoleKey =
    options.serviceRoleKey !== undefined &&
    options.serviceRoleKey.length > 0 &&
    options.serviceRoleKey.trim() === options.serviceRoleKey
      ? options.serviceRoleKey
      : null;
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);

  return async (user) => {
    if (origin === null || serviceRoleKey === null) return "unavailable";

    try {
      const response = await fetcher(`${origin}/auth/v1/admin/users/${user.id}`, {
        method: "DELETE",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
      });
      if (response.status === 204 || response.status === 404) return "deleted";
      if (response.status !== 200) return "unavailable";

      const payload: unknown = await response.json();
      return payload !== null &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        (payload as { id?: unknown }).id === user.id
        ? "deleted"
        : "unavailable";
    } catch {
      return "unavailable";
    }
  };
}

export function createAuthenticator(options: AuthenticatorOptions): Authenticator {
  const config = normalizeAuthConfig(options.supabaseUrl);
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const cache = options.cache ?? moduleJwkCache;
  const now = options.now ?? (() => Date.now());

  return async (c, next) => {
    if (config === null) return unavailableResponse();
    const token = parseBearer(c.req.raw);
    if (token === null) return unauthorizedResponse();

    const result = await authenticateToken(token, config, fetcher, cache, now);
    if (result.kind === "unauthorized") return unauthorizedResponse();
    if (result.kind === "membership_required") return membershipResponse();
    if (result.kind === "unavailable") return unavailableResponse();

    c.set("user", result.user);
    c.set("authentication", result.authentication);
    await next();
  };
}

export function createRecentAuthenticationMiddleware(
  now: () => number = () => Date.now(),
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const authenticatedAt = c.get("authentication")?.oauthAuthenticatedAt;
    const ageSeconds =
      typeof authenticatedAt === "number" ? Math.floor(now() / 1000) - authenticatedAt : null;
    if (
      ageSeconds === null ||
      !Number.isSafeInteger(authenticatedAt) ||
      ageSeconds < 0 ||
      ageSeconds > RECENT_AUTHENTICATION_WINDOW_SECONDS
    ) {
      return recentAuthenticationRequiredResponse();
    }
    await next();
  };
}

export function rateLimitUnavailableResponse(): Response {
  return Response.json(
    errorEnvelope("rate_limit_unavailable", "Rate limiting temporarily unavailable."),
    { status: 503 },
  );
}

function rateLimitedResponse(): Response {
  return Response.json(errorEnvelope("rate_limited", "Too many requests."), {
    status: 429,
    headers: { "Retry-After": "60" },
  });
}

export async function checkRateLimit(
  limiter: RateLimiterBinding | undefined,
  key: string,
): Promise<Response | null> {
  if (limiter === undefined) return rateLimitUnavailableResponse();
  try {
    const result = await limiter.limit({ key });
    if (result.success === true) return null;
    if (result.success === false) return rateLimitedResponse();
    return rateLimitUnavailableResponse();
  } catch {
    return rateLimitUnavailableResponse();
  }
}

export function createUserWriteRateLimitMiddleware(
  limiter: RateLimiterBinding | undefined,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const denied = await checkRateLimit(limiter, `write:${c.get("user").id}`);
    if (denied !== null) return denied;
    await next();
  };
}

export function createUserReadRateLimitMiddleware(
  limiter: RateLimiterBinding | undefined,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const denied = await checkRateLimit(limiter, `read:${c.get("user").id}`);
    if (denied !== null) return denied;
    await next();
  };
}
