import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpClient, resolveUserAgent } from "../src/http";

/** Everything injected: fake fetch, fake clock, recorded sleeps. Zero network, zero real time. */
function harness(
  responses: Array<() => Response>,
  opts: { cacheDir?: string | null; minSpacingMs?: number; baseDelayMs?: number } = {},
) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const sleeps: number[] = [];
  let clock = 1_000_000;
  let i = 0;
  const client = createHttpClient({
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      });
      const make = responses[i] ?? responses[responses.length - 1];
      i++;
      if (!make) throw new Error("no scripted response");
      return make();
    }) as typeof fetch,
    cacheDir: opts.cacheDir ?? null,
    minSpacingMs: opts.minSpacingMs ?? 1000,
    maxRetries: 2,
    baseDelayMs: opts.baseDelayMs ?? 500,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  });
  return { client, calls, sleeps, tick: (ms: number) => (clock += ms) };
}

const ok =
  (body: string, headers: Record<string, string> = {}) =>
  () =>
    new Response(body, { status: 200, headers });

describe("http client", () => {
  it("sends the BrownSync User-Agent on every request", async () => {
    const { client, calls } = harness([ok("hi")]);
    await client.get("https://events.brown.edu/live/json/events");
    expect(calls[0]?.headers["user-agent"]).toBe(resolveUserAgent());
    expect(resolveUserAgent()).toMatch(/^BrownSync\/1\.0 \(\+.+\)$/);
  });

  it("spaces same-host requests >= minSpacingMs apart", async () => {
    const { client, sleeps } = harness([ok("a"), ok("b")], { minSpacingMs: 1000 });
    await client.get("https://events.brown.edu/a");
    await client.get("https://events.brown.edu/b");
    // Second request had to wait the full gap (fake clock does not advance on its own).
    expect(sleeps).toEqual([1000]);
  });

  it("does not throttle across different hosts", async () => {
    const { client, sleeps } = harness([ok("a"), ok("b")]);
    await client.get("https://events.brown.edu/a");
    await client.get("https://brownbears.com/b");
    expect(sleeps).toEqual([]);
  });

  it("retries 5xx with exponential backoff, then succeeds", async () => {
    const fail = () => new Response("boom", { status: 500 });
    const { client, calls, sleeps } = harness([fail, fail, ok("recovered")], {
      minSpacingMs: 0,
      baseDelayMs: 500,
    });
    const res = await client.get("https://events.brown.edu/flaky");
    expect(res.body).toBe("recovered");
    expect(calls.length).toBe(3);
    expect(sleeps).toEqual([500, 1000]); // 500 * 2^0, 500 * 2^1
  });

  it("gives up after maxRetries and throws", async () => {
    const fail = () => new Response("boom", { status: 503 });
    const { client, calls } = harness([fail], { minSpacingMs: 0 });
    await expect(client.get("https://events.brown.edu/down")).rejects.toThrow(/failed after 3/);
    expect(calls.length).toBe(3);
  });

  it("does not retry 4xx", async () => {
    const { client, calls } = harness([() => new Response("nope", { status: 404 })]);
    await expect(client.get("https://events.brown.edu/missing")).rejects.toThrow(/404/);
    expect(calls.length).toBe(1);
  });

  describe("etag cache", () => {
    let dir: string;
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("persists ETags and serves the cached body on 304", async () => {
      dir = mkdtempSync(path.join(os.tmpdir(), "poller-http-"));
      const first = harness([ok("payload-v1", { etag: '"v1"' })], { cacheDir: dir });
      const res1 = await first.client.get("https://events.brown.edu/cached");
      expect(res1.fromCache).toBe(false);

      // Fresh client, same cache dir — revalidates with If-None-Match.
      const second = harness([() => new Response(null, { status: 304 })], { cacheDir: dir });
      const res2 = await second.client.get("https://events.brown.edu/cached");
      expect(second.calls[0]?.headers["if-none-match"]).toBe('"v1"');
      expect(res2.fromCache).toBe(true);
      expect(res2.body).toBe("payload-v1");
    });
  });
});
