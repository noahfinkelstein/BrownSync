import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Polite fetch wrapper (handoff §8 scraper etiquette, contract §5):
 * - identifies via the POLLER_USER_AGENT env User-Agent on every request
 * - >= 1 s spacing between requests to the same host
 * - ETag / If-None-Match revalidation cache persisted under .cache/ (gitignored)
 * - exponential-backoff retries on network errors, 429 and 5xx
 *
 * Every collaborator (fetch, clock, sleep, cache dir) is injectable so tests
 * never touch the network or real time.
 */

export const DEFAULT_USER_AGENT = "BrownSync/1.0 (+noah_finkelstein@brown.edu)";

/** Resolved per request so `.env` loading order never bites. */
export function resolveUserAgent(): string {
  return process.env.POLLER_USER_AGENT ?? DEFAULT_USER_AGENT;
}

type CacheEntry = {
  url: string;
  etag: string;
  body: string;
  fetchedAt: string;
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

export type HttpClientOptions = {
  fetchImpl?: typeof fetch;
  /** Directory for the ETag/body cache; `null` disables caching. */
  cacheDir?: string | null;
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

export function createHttpClient(opts: HttpClientOptions = {}): HttpClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cacheDir = opts.cacheDir === undefined ? path.join(process.cwd(), ".cache") : opts.cacheDir;
  const minSpacingMs = opts.minSpacingMs ?? 1000;
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const lastRequestAt = new Map<string, number>();

  function cachePath(url: string): string | null {
    if (!cacheDir) return null;
    const hash = createHash("sha256").update(url).digest("hex").slice(0, 24);
    return path.join(cacheDir, `${hash}.json`);
  }

  function readCache(url: string): CacheEntry | null {
    const file = cachePath(url);
    if (!file || !existsSync(file)) return null;
    try {
      const entry = JSON.parse(readFileSync(file, "utf8")) as CacheEntry;
      return entry.url === url && typeof entry.etag === "string" ? entry : null;
    } catch {
      return null;
    }
  }

  function writeCache(url: string, etag: string, body: string): void {
    const file = cachePath(url);
    if (!file) return;
    mkdirSync(path.dirname(file), { recursive: true });
    const entry: CacheEntry = { url, etag, body, fetchedAt: new Date(now()).toISOString() };
    writeFileSync(file, JSON.stringify(entry));
  }

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
    const cached = readCache(url);
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
      if (etag) writeCache(url, etag, body);
      return { status: res.status, body, fromCache: false };
    }
    throw new Error(`GET ${url} failed after ${maxRetries + 1} attempts: ${String(lastError)}`);
  }

  return { get };
}
