import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES, tokens } from "@brownsync/contract";
import { describe, expect, it } from "vitest";

/**
 * §6.1 contrast audit, pinned against the canonical token values in
 * @brownsync/contract (the ui stylesheet is already pinned to those by
 * packages/ui/src/tokens.test.ts, so auditing the contract audits the CSS).
 *
 * Policy (WCAG 2.1 AA, strict): EVERY text pairing must hit 4.5:1. Nothing
 * in the §6.2 type scale (12–24 px, regular/medium) qualifies for the 3:1
 * "large text" carve-out — 12 px mono secondary text is still normal-size.
 * Non-text indicators (category dots/icons, status dots) must hit 3:1
 * (WCAG 1.4.11).
 */

// --- WCAG relative luminance + contrast ratio ------------------------------

function channel(hex2: string): number {
  const c = Number.parseInt(hex2, 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  expect(h).toMatch(/^[0-9a-fA-F]{6}$/);
  return (
    0.2126 * channel(h.slice(0, 2)) +
    0.7152 * channel(h.slice(2, 4)) +
    0.0722 * channel(h.slice(4, 6))
  );
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

const BACKGROUNDS = {
  "bg-base": tokens.bg.base,
  "bg-raised": tokens.bg.raised,
  "bg-overlay": tokens.bg.overlay,
} as const;

// Status ramp mirrors packages/ui/src/styles.css (reuses category chroma).
const STATUS = {
  "status-ok": "#81b482",
  "status-stale": "#bfa060",
  "status-error": "#d78d92",
} as const;

describe("§6.1 token pairs used for TEXT meet WCAG AA 4.5:1", () => {
  // Every place the app paints text: primary body/titles, secondary
  // metadata/mono tiers, accent live indicators (TimelineRow live time,
  // Badge variant=accent), status-error copy (HealthStrip error line,
  // "canceled" badge) — each over all three background stack levels.
  const textPairs: [string, string, string, string][] = [];
  for (const [bgName, bg] of Object.entries(BACKGROUNDS)) {
    textPairs.push(["text-primary", tokens.text.primary, bgName, bg]);
    textPairs.push(["text-secondary", tokens.text.secondary, bgName, bg]);
    textPairs.push(["accent", tokens.accent, bgName, bg]);
    textPairs.push(["status-error", STATUS["status-error"], bgName, bg]);
  }
  // Primary Button: bg-accent with text-bg-base (packages/ui Button).
  textPairs.push(["bg-base (button label)", tokens.bg.base, "accent", tokens.accent]);

  it.each(textPairs)("%s on %s ≥ 4.5:1", (_fgName, fg, _bgName, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("non-text indicators meet WCAG 1.4.11 3:1", () => {
  const pairs: [string, string, string, string][] = [];
  for (const [bgName, bg] of Object.entries(BACKGROUNDS)) {
    for (const cat of CATEGORIES) {
      pairs.push([`cat-${cat.id}`, cat.colorHex, bgName, bg]);
    }
    for (const [name, hex] of Object.entries(STATUS)) {
      pairs.push([name, hex, bgName, bg]);
    }
  }

  it.each(pairs)("%s on %s ≥ 3:1", (_fgName, fg, _bgName, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe("documented failure: --text-faint is NOT a text color", () => {
  it("fails AA on every background — hence banned for text app-wide", () => {
    // #566070 lands ≈3.0:1 on bg-base and ≈2.7:1 on bg-overlay. The Phase 3
    // a11y pass therefore moved every in-app text usage to --text-secondary
    // (the token itself is untouched per the handoff — usage was fixed).
    // --text-faint remains legitimate for non-text ornament: hairline
    // borders, tick marks, aria-hidden geometry.
    //
    // The matching @brownsync/ui component pass lives in
    // packages/ui/src/contrast.test.ts (Kbd, TimelineRow `sub`, Chip `count`,
    // StatusDot `detail`, DataTable headers, EmptyState body/icon,
    // SearchInput placeholder/glyph, SegmentedControl inactive labels).
    for (const bg of Object.values(BACKGROUNDS)) {
      expect(contrastRatio(tokens.text.faint, bg)).toBeLessThan(AA_TEXT);
    }
  });

  it("regression scan: no text-colored --text-faint usage in app source", () => {
    const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const offenders: string[] = [];
    const faintHex = tokens.text.faint.replace("#", "");
    // The map pane styles with raw hex by design — catch text-[#566070] too.
    const rawHexText = new RegExp(`text-\\[#${faintHex}\\]`, "i");
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        const isCss = /\.css$/.test(entry.name);
        if (!/\.(ts|tsx|css)$/.test(entry.name)) continue;
        const text = readFileSync(path, "utf8");
        // Text-painting utilities only; border-text-faint / bg-* stay legal.
        if (
          !isCss &&
          (/(?:^|[^-\w])text-text-faint|placeholder:text-text-faint/.test(text) ||
            rawHexText.test(text))
        ) {
          offenders.push(path.slice(srcRoot.length + 1));
        }
        // Stylesheets: `color: var(--text-faint)` paints text (map chrome).
        if (isCss && /color:\s*var\(--text-faint\)/.test(text)) {
          offenders.push(path.slice(srcRoot.length + 1));
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
