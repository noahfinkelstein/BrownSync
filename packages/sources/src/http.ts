/**
 * Polite fetch wrapper CORE (handoff §8 scraper etiquette, contract §5):
 * - identifies via the POLLER_USER_AGENT env User-Agent on every request
 * - >= 1 s spacing between requests to the same host (the dispatcher raises
 *   this to the registry's etiquette_min_interval_seconds where declared)
 * - ETag / If-None-Match revalidation against an INJECTED cache
 * - exponential-backoff retries on network errors, 429 and 5xx
 *
 * Every collaborator (fetch, clock, sleep, cache) is injectable so tests
 * never touch the network or real time. The cache is an interface rather
 * than a directory because this module runs in two runtimes: the Node CLI
 * (services/poller/src/http.ts wraps this with an fs-backed cache under
 * .cache/) and the Worker dispatcher (apps/api, in-memory per isolate).
 * No node:* imports here, by construction.
 */

export const DEFAULT_USER_AGENT = "BrownSync/1.0 (+noah_finkelstein@brown.edu)";

/**
 * Resolved per request so `.env` loading order never bites. Read via
 * globalThis because this module has no node types: `process.env` exists on
 * Node and on Workers under nodejs_compat, and its absence just means the
 * declared default UA.
 */
export function resolveUserAgent(): string {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.POLLER_USER_AGENT ?? DEFAULT_USER_AGENT;
}

export type CacheEntry = {
  url: string;
  etag: string;
  body: string;
  fetchedAt: string;
};

/** ETag/body store for If-None-Match revalidation. May be sync or async. */
export type EtagCache = {
  read: (url: string) => CacheEntry | null | Promise<CacheEntry | null>;
  write: (url: string, entry: CacheEntry) => void | Promise<void>;
};

export type HttpResponse = {
  status: number;
  body: string;
  /** true when the server answered 304 and the body came from the ETag cache. */
  fromCache: boolean;
};

export type HttpClient = {
  get: (url: string) => Promise<HttpResponse>;
};

export type HttpCoreOptions = {
  fetchImpl?: typeof fetch;
  /** ETag/body cache; `null`/undefined disables caching. */
  cache?: EtagCache | null;
  /** Minimum ms between two requests to the same host. */
  minSpacingMs?: number;
  /** Retries after the first attempt. */
  maxRetries?: number;
  /** First retry delay; doubles per retry. */
  baseDelayMs?: number;
  userAgent?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createHttpCore(opts: HttpCoreOptions = {}): HttpClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cache = opts.cache ?? null;
  const minSpacingMs = opts.minSpacingMs ?? 1000;
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const lastRequestAt = new Map<string, number>();

  /** Wait until >= minSpacingMs since the previous request to this host. */
  async function spaceOut(host: string): Promise<void> {
    const last = lastRequestAt.get(host);
    if (last !== undefined) {
      const wait = last + minSpacingMs - now();
      if (wait > 0) await sleep(wait);
    }
    lastRequestAt.set(host, now());
  }

  async function get(url: string): Promise<HttpResponse> {
    const host = new URL(url).host;
    const cached = cache ? await cache.read(url) : null;
    const headers: Record<string, string> = {
      "user-agent": opts.userAgent ?? resolveUserAgent(),
    };
    if (cached) headers["if-none-match"] = cached.etag;

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await sleep(baseDelayMs * 2 ** (attempt - 1));
      await spaceOut(host);
      let res: Response;
      try {
        res = await fetchImpl(url, { headers, redirect: "follow" });
      } catch (err) {
        lastError = err;
        continue;
      }
      if (res.status === 304 && cached) {
        return { status: 304, body: cached.body, fromCache: true };
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`GET ${url} -> ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
      const body = await res.text();
      const etag = res.headers.get("etag");
      if (etag && cache) {
        await cache.write(url, { url, etag, body, fetchedAt: new Date(now()).toISOString() });
      }
      return { status: res.status, body, fromCache: false };
    }
    throw new Error(`GET ${url} failed after ${maxRetries + 1} attempts: ${String(lastError)}`);
  }

  return { get };
}

/**
 * Map-backed cache for runtimes without a filesystem (the Worker dispatcher).
 * Scope is the module instance — on Workers that means the isolate, so a warm
 * isolate revalidates with If-None-Match across cron ticks and a cold start
 * simply refetches. Bounded so a long-lived isolate cannot grow unbounded.
 */
export function createMemoryEtagCache(maxEntries = 64): EtagCache {
  const entries = new Map<string, CacheEntry>();
  return {
    read: (url) => entries.get(url) ?? null,
    write: (url, entry) => {
      // Refresh insertion order so the oldest URL is the one evicted.
      entries.delete(url);
      entries.set(url, entry);
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    },
  };
}
