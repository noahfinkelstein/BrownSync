import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/**
 * Fixture timestamps are written as "@now", "@now-4m", "@now+2h" tokens and
 * materialized to ISO strings at request time, so relative readouts
 * ("4 min ago", "in 26 min") stay truthful whenever the suite runs.
 */
const NOW_TOKEN = /^@now(?:([+-])(\d+)(s|m|h|d))?$/;
const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function materialize(value: unknown, nowMs: number): unknown {
  if (typeof value === "string") {
    const match = NOW_TOKEN.exec(value);
    if (!match) return value;
    const sign = match[1] === "-" ? -1 : 1;
    const amount = match[2] ? Number(match[2]) : 0;
    const unitMs = match[3] ? (UNIT_MS[match[3]] ?? 0) : 0;
    return new Date(nowMs + sign * amount * unitMs).toISOString();
  }
  if (Array.isArray(value)) return value.map((entry) => materialize(entry, nowMs));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, materialize(entry, nowMs)]),
    );
  }
  return value;
}

export function loadFixture(name: string, nowMs: number = Date.now()): unknown {
  const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf8");
  return materialize(JSON.parse(raw), nowMs);
}

function fixtureFor(path: string): unknown | undefined {
  if (path === "/api/health") return loadFixture("health");
  if (path === "/api/now") return loadFixture("now");
  if (path === "/api/meetings") return loadFixture("meetings");
  if (path === "/api/events") return loadFixture("events");
  if (/^\/api\/events\/[^/]+$/.test(path)) return loadFixture("event-detail");
  if (path === "/api/places") return loadFixture("places");
  if (/^\/api\/places\/[^/]+\/activity$/.test(path)) return loadFixture("place-activity");
  if (path === "/api/orgs") return loadFixture("orgs");
  if (/^\/api\/orgs\/[^/]+$/.test(path)) return loadFixture("org-detail");
  return undefined;
}

export type ApiCall = { path: string; url: string };

/** Serve every /api/* request from fixture JSON; returns the call log. */
export async function mockApi(page: Page): Promise<ApiCall[]> {
  const calls: ApiCall[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    calls.push({ path: url.pathname, url: url.toString() });
    const body = fixtureFor(url.pathname);
    if (body === undefined) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "not_found", message: `no e2e fixture for ${url.pathname}` },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return calls;
}

// --- basemap glyphs -------------------------------------------------------

function varint(n: number): number[] {
  const out: number[] = [];
  let rest = n;
  do {
    let byte = rest & 0x7f;
    rest >>>= 7;
    if (rest) byte |= 0x80;
    out.push(byte);
  } while (rest);
  return out;
}

function pbfTag(field: number, wireType: number): number[] {
  return varint((field << 3) | wireType);
}

function pbfString(field: number, value: string): number[] {
  const bytes = [...Buffer.from(value, "utf8")];
  return [...pbfTag(field, 2), ...varint(bytes.length), ...bytes];
}

/**
 * Minimal valid glyphs PBF — a fontstack with name + range and zero glyphs.
 * MapLibre parses it happily and renders no label text; nothing 404s, no
 * request leaves the box.
 */
export function emptyGlyphsPbf(fontstack: string, range: string): Buffer {
  const stack = [...pbfString(1, fontstack), ...pbfString(2, range)];
  return Buffer.from([...pbfTag(1, 2), ...varint(stack.length), ...stack]);
}

/** map/style.json points at the Protomaps glyph CDN — answer locally. */
export async function mockBasemapGlyphs(page: Page): Promise<void> {
  await page.route("**/basemaps-assets/fonts/**", async (route) => {
    const segments = new URL(route.request().url()).pathname.split("/");
    const range = (segments.pop() ?? "0-255.pbf").replace(".pbf", "");
    const fontstack = decodeURIComponent(segments.pop() ?? "font");
    await route.fulfill({
      status: 200,
      contentType: "application/x-protobuf",
      body: emptyGlyphsPbf(fontstack, range),
    });
  });
}

/** Belt-and-braces hermeticity: abort anything that isn't localhost. Install
 *  FIRST so the more specific mocks above (registered later) win. */
export async function blockExternal(page: Page): Promise<void> {
  await page.route(
    (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
    (route) => route.abort(),
  );
}
