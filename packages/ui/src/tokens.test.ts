import { readFileSync } from "node:fs";
import { CATEGORIES, tokens } from "@brownsync/contract";
import { describe, expect, it } from "vitest";

/** styles.css must stay in lockstep with @brownsync/contract — this suite
 *  parses the stylesheet and fails on any drift. */
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Value of a custom-property *declaration* (ignores var() references). */
function cssVar(name: string): string | undefined {
  const m = css.match(new RegExp(`(?<=[\\s{;])${escapeRe(name)}\\s*:\\s*([^;]+);`));
  return m?.[1]?.trim().toLowerCase();
}

describe("styles.css stays in sync with @brownsync/contract", () => {
  it("renders the §6.1 background stack, line, text triad, and accent", () => {
    expect(cssVar("--bg-base")).toBe(tokens.bg.base.toLowerCase());
    expect(cssVar("--bg-raised")).toBe(tokens.bg.raised.toLowerCase());
    expect(cssVar("--bg-overlay")).toBe(tokens.bg.overlay.toLowerCase());
    expect(cssVar("--line")).toBe(tokens.line.toLowerCase());
    expect(cssVar("--text-primary")).toBe(tokens.text.primary.toLowerCase());
    expect(cssVar("--text-secondary")).toBe(tokens.text.secondary.toLowerCase());
    expect(cssVar("--text-faint")).toBe(tokens.text.faint.toLowerCase());
    expect(cssVar("--accent")).toBe(tokens.accent.toLowerCase());
  });

  it("renders the cartography colors", () => {
    expect(cssVar("--map-road")).toBe(tokens.map.road.toLowerCase());
    expect(cssVar("--map-water")).toBe(tokens.map.water.toLowerCase());
    expect(cssVar("--map-green")).toBe(tokens.map.green.toLowerCase());
  });

  it("renders every category colorToken with the contract hex", () => {
    for (const c of CATEGORIES) {
      expect(cssVar(c.colorToken), c.colorToken).toBe(c.colorHex.toLowerCase());
    }
  });

  it("maps every token into the Tailwind theme (--color-* → var(token))", () => {
    for (const c of CATEGORIES) {
      expect(css).toContain(`--color-cat-${c.id}: var(${c.colorToken});`);
    }
    for (const name of [
      "--color-bg-base: var(--bg-base)",
      "--color-bg-raised: var(--bg-raised)",
      "--color-bg-overlay: var(--bg-overlay)",
      "--color-line: var(--line)",
      "--color-text-primary: var(--text-primary)",
      "--color-text-secondary: var(--text-secondary)",
      "--color-text-faint: var(--text-faint)",
      "--color-accent: var(--accent)",
    ]) {
      expect(css).toContain(name);
    }
  });

  it("caps radius at the contract max (6px) — declared and enforced", () => {
    expect(cssVar("--radius-max")).toBe(`${tokens.radius.max}px`);
    const declared = [...css.matchAll(/--radius-(\d+)\s*:/g)].map((m) => Number(m[1]));
    expect(declared.length).toBeGreaterThan(0);
    for (const r of declared) {
      expect(r).toBeLessThanOrEqual(tokens.radius.max);
    }
  });

  it("declares exactly the §6.2 type scale (12/13/15/18/24)", () => {
    for (const size of tokens.type.scale) {
      expect(cssVar(`--text-${size}`)).toBe(`${size}px`);
    }
    const declared = [...css.matchAll(/--text-(\d+)\s*:/g)].map((m) => Number(m[1]));
    const allowed = new Set<number>(tokens.type.scale);
    for (const size of declared) {
      expect(allowed.has(size), `--text-${size} is outside the type scale`).toBe(true);
    }
  });

  it("declares the §6.2 font stacks", () => {
    expect(cssVar("--font-display")).toContain("instrument sans");
    expect(cssVar("--font-mono")).toContain("ibm plex mono");
  });

  it("declares §6.4 motion bounds", () => {
    expect(cssVar("--motion-fast")).toBe(`${tokens.motion.minMs}ms`);
    expect(cssVar("--motion-slow")).toBe(`${tokens.motion.maxMs}ms`);
  });

  it("bans gradients and stray shadows (§6.1)", () => {
    expect(css).not.toMatch(/gradient\(/);
    const shadows = [...css.matchAll(/box-shadow\s*:/g)];
    expect(shadows.length, "only the Panel may carry a shadow").toBeLessThanOrEqual(1);
  });
});
