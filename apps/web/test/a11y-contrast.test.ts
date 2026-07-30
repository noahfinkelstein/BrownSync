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

/**
 * Flatten a translucent fill against an opaque surface.
 *
 * Needed because the light theme composites where the dark theme used solid
 * tokens: `bg-accent/8` behind an accent Badge is a real background that real
 * text sits on, and WCAG is computed on the flattened result, not on the
 * declared color.
 */
function composite(fg: string, bg: string, alpha: number): string {
  const f = fg.replace("#", "");
  const b = bg.replace("#", "");
  const mix = (i: number): string => {
    const v = Math.round(
      alpha * Number.parseInt(f.slice(i, i + 2), 16) +
        (1 - alpha) * Number.parseInt(b.slice(i, i + 2), 16),
    );
    return v.toString(16).padStart(2, "0");
  };
  return `#${mix(0)}${mix(2)}${mix(4)}`;
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
  "status-ok": "#2c862e",
  "status-stale": "#966e1d",
  "status-error": "#df323e",
} as const;

describe("§6.1 token pairs used for TEXT meet WCAG AA 4.5:1", () => {
  // Every place the app paints text: primary body/titles, secondary
  // metadata/mono tiers, accent live indicators (TimelineRow live time,
  // Badge variant=accent), and brand-brown structural chrome — each over all
  // three background stack levels.
  //
  // `status-error` USED to be audited here as text (the HealthStrip error line
  // and the "canceled" Badge). It is not, any more: see the status-ramp block
  // below. Dropping it is not a relaxation — the ramp is now pinned by a
  // stricter pair of assertions AND a source scan in packages/ui.
  const textPairs: [string, string, string, string][] = [];
  for (const [bgName, bg] of Object.entries(BACKGROUNDS)) {
    textPairs.push(["text-primary", tokens.text.primary, bgName, bg]);
    textPairs.push(["text-secondary", tokens.text.secondary, bgName, bg]);
    textPairs.push(["accent", tokens.accent, bgName, bg]);
    textPairs.push(["brand-brown", tokens.brand.brown, bgName, bg]);
    textPairs.push(["brand-brown-soft", tokens.brand.brownSoft, bgName, bg]);
    // Badge variant="accent" reads accent type over its own `bg-accent/8`
    // wash, which is 0.5–1.0 lower than accent over the bare surface.
    textPairs.push([
      "accent on bg-accent/8",
      tokens.accent,
      `${bgName} + accent/8`,
      composite(tokens.accent, bg, 0.08),
    ]);
  }
  // Primary Button: bg-accent with text-bg-base (packages/ui Button).
  textPairs.push(["bg-base (button label)", tokens.bg.base, "accent", tokens.accent]);
  // SegmentedControl's active segment: white label on filled seal brown. The
  // dark theme marked it with `bg-bg-overlay`, an 8% lift; on paper that step
  // is 4% and the mode switch stopped announcing which mode you were in.
  textPairs.push(["bg-base (segment label)", tokens.bg.base, "brand-brown", tokens.brand.brown]);

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

/**
 * The status ramp is an INDICATOR ramp on light — dots, not sentences.
 *
 * Re-derived for white it lands in a band (3.83 – 4.62:1) that clears WCAG
 * 1.4.11's 3:1 for a 6px StatusDot and misses AA text on two of the three
 * surfaces. `--status-error` reaches 4.5032:1 on `--bg-base` — three
 * thousandths of margin, which is not a guarantee, it is a coincidence — and
 * falls to 4.17:1 on `--bg-raised` and 3.83:1 on `--bg-overlay`, i.e. on every
 * Panel and every card, which is exactly where error copy actually lives.
 *
 * So error COPY takes `--text-primary` (or `--accent`, 5.5:1 at worst) beside a
 * status dot; the ramp itself never paints type. This block pins BOTH ends of
 * that: the ramp must stay usable as an indicator, and it must stay unusable
 * as body text, so nobody "fixes" the ban by nudging the token up 3% and
 * silently re-legalising 12px red-on-warm-white.
 */
describe("the status ramp is an indicator ramp, not a text ramp", () => {
  const statusPairs = Object.entries(STATUS).flatMap(([name, hex]) =>
    Object.entries(BACKGROUNDS).map(
      ([bgName, bg]) => [name, hex, bgName, bg] as [string, string, string, string],
    ),
  );

  it.each(statusPairs)("%s is a legal INDICATOR on %s (≥ 3:1)", (_n, fg, _bn, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it("is not AA text on the two surfaces error copy actually renders on", () => {
    for (const bg of [tokens.bg.raised, tokens.bg.overlay]) {
      for (const hex of Object.values(STATUS)) {
        expect(contrastRatio(hex, bg)).toBeLessThan(AA_TEXT);
      }
    }
  });
});

describe("documented failure: --text-faint is NOT a text color", () => {
  it("fails AA on every background — hence banned for text app-wide", () => {
    // #8C8078 lands ≈3.84:1 on bg-base, 3.56:1 on bg-raised and 3.26:1 on
    // bg-overlay. The light re-derivation kept the failure deliberate: the
    // token is the app's ornament ink, and giving it AA would make it a fourth
    // text tier nobody designed. Every in-app TEXT usage is --text-secondary
    // (the token itself is untouched per the handoff — usage was fixed).
    // --text-faint remains legitimate — and, on paper, more useful than it was
    // — for non-text ornament: hairline borders (the DataTable header rule
    // leans on it precisely because --line is a 1.4:1 whisper on white), tick
    // marks, aria-hidden geometry.
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
    // MapView's boot overlay styles with raw hex by design (it covers the map
    // canvas, which is still dark) — so catch `text-[#8c8078]` too, not just
    // the utility. Built from the token so it tracks a re-derivation.
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
