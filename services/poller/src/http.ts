import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type CacheEntry,
  createHttpCore,
  type EtagCache,
  type HttpClient,
  type HttpResponse,
} from "@brownsync/sources/http";

/**
 * Node lane of the polite fetch wrapper. The core (UA, per-host spacing,
 * retries, ETag revalidation) moved to packages/sources so the Worker
 * dispatcher shares it; what stays here is exactly the Node-coupled part —
 * the fs-backed ETag/body cache persisted under .cache/ (gitignored).
 * Public surface is unchanged: same options, same defaults.
 */

export { DEFAULT_USER_AGENT, resolveUserAgent } from "@brownsync/sources/http";
export type { HttpClient, HttpResponse };

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
  /** Per-attempt ceiling on a single fetch; a hung socket becomes a normal error. */
  timeoutMs?: number;
  userAgent?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** ETag/body cache as JSON files named by URL hash, one per URL. */
function createFsEtagCache(cacheDir: string): EtagCache {
  function cachePath(url: string): string {
    const hash = createHash("sha256").update(url).digest("hex").slice(0, 24);
    return path.join(cacheDir, `${hash}.json`);
  }
  return {
    read: (url) => {
      const file = cachePath(url);
      if (!existsSync(file)) return null;
      try {
        const entry = JSON.parse(readFileSync(file, "utf8")) as CacheEntry;
        return entry.url === url && typeof entry.etag === "string" ? entry : null;
      } catch {
        return null;
      }
    },
    write: (url, entry) => {
      const file = cachePath(url);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(entry));
    },
  };
}

export function createHttpClient(opts: HttpClientOptions = {}): HttpClient {
  const cacheDir = opts.cacheDir === undefined ? path.join(process.cwd(), ".cache") : opts.cacheDir;
  const { cacheDir: _cacheDir, ...core } = opts;
  return createHttpCore({
    ...core,
    cache: cacheDir === null ? null : createFsEtagCache(cacheDir),
  });
}
