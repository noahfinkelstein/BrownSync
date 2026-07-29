import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { absolutizeOgImages } from "../vite.config";

/**
 * OG absolute-URL transform (Phase 3): production builds set
 * VITE_CANONICAL_ORIGIN and the vite plugin rewrites the root-relative
 * og:image / twitter:image tags in index.html to absolute URLs. Run against
 * the REAL index.html so tag drift breaks the test, not the share cards.
 */

const INDEX_HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"),
  "utf8",
);

const ORIGIN = "https://brownsync.example.org";

describe("absolutizeOgImages", () => {
  it("index.html ships root-relative og:image + twitter:image (dev default)", () => {
    expect(INDEX_HTML).toContain('<meta property="og:image" content="/og.png" />');
    expect(INDEX_HTML).toContain('<meta name="twitter:image" content="/og.png" />');
  });

  it("rewrites BOTH image tags to absolute URLs when the origin is set", () => {
    const out = absolutizeOgImages(INDEX_HTML, ORIGIN);
    expect(out).toContain(`<meta property="og:image" content="${ORIGIN}/og.png" />`);
    expect(out).toContain(`<meta name="twitter:image" content="${ORIGIN}/og.png" />`);
    expect(out).not.toContain('content="/og.png"');
  });

  it("leaves every other tag alone", () => {
    const out = absolutizeOgImages(INDEX_HTML, ORIGIN);
    // Same document except the two image tags.
    expect(out).toContain('<meta property="og:image:width" content="1200" />');
    expect(out).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    expect(out.length).toBe(INDEX_HTML.length + 2 * ORIGIN.length);
  });

  it("is a no-op when the origin is unset or blank", () => {
    expect(absolutizeOgImages(INDEX_HTML, undefined)).toBe(INDEX_HTML);
    expect(absolutizeOgImages(INDEX_HTML, "")).toBe(INDEX_HTML);
    expect(absolutizeOgImages(INDEX_HTML, "  ")).toBe(INDEX_HTML);
  });

  it("normalizes a trailing slash on the origin", () => {
    const out = absolutizeOgImages(INDEX_HTML, `${ORIGIN}/`);
    expect(out).toContain(`content="${ORIGIN}/og.png"`);
    expect(out).not.toContain(`${ORIGIN}//og.png`);
  });

  it("never double-prefixes an already-absolute URL", () => {
    const once = absolutizeOgImages(INDEX_HTML, ORIGIN);
    expect(absolutizeOgImages(once, ORIGIN)).toBe(once);
  });
});
