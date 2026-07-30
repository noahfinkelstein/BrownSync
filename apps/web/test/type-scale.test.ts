import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { tokens } from "@brownsync/contract";
import { describe, expect, it } from "vitest";

/**
 * §6.2 type-scale enforcement — the *usage* side.
 *
 * `packages/ui/src/tokens.test.ts` already pins what the stylesheet
 * **declares**. Nothing pinned what source **uses**, and that gap fails
 * silently in a way no build step catches:
 *
 *   packages/ui/src/styles.css does `--text-*: initial;` inside `@theme`,
 *   which DELETES Tailwind's stock size ramp. So `text-sm`, `text-base` and
 *   `text-14` are not "wrong classes that render wrong" — they generate NO
 *   CSS AT ALL. The element silently inherits `body { font-size }` and looks
 *   plausible, so a typo survives review, CI, and production.
 *
 * This walks every source tree that ships UI and fails on any size outside
 * `tokens.type.scale`. It is deliberately a text scan rather than a rendered
 * assertion: the failure mode is a class that produces nothing, which no DOM
 * query can see.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

/** Every tree whose files become UI. `dev/` is the component gallery — it is
 *  the one place a stray size is most likely to be copy-pasted from. */
const ROOTS = ["apps/web/src", "apps/web/e2e", "packages/ui/src", "packages/ui/dev"] as const;

const SCALE: readonly number[] = tokens.type.scale;
const ALLOWED = new Set<number>(SCALE);

/** Comments legitimately name sizes ("the 12/13/15 ramp", "@see text-13"), and
 *  a doc line must not fail the build. Only real code counts. */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    // An optional root (the e2e harness) may not exist in every checkout.
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        // dist/ is build output: it contains the COMPILED sizes, which are by
        // definition whatever the last build emitted, not authored source.
        if (entry.name === "dist" || entry.name === "node_modules") continue;
        walk(path);
        continue;
      }
      if (/\.(ts|tsx|css)$/.test(entry.name)) found.push(path);
    }
  };
  for (const root of ROOTS) walk(join(REPO, root));
  return found.sort();
}

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly token: string;
  readonly size: number;
}

/** Utility classes in TS/TSX: `text-13` and the arbitrary-value escape hatch
 *  `text-[13px]`. The second is the sneakier one — it keeps working after a
 *  size leaves the scale, so it drifts off-scale without ever breaking. */
const TSX_PATTERNS = [/(?<![\w-])text-(\d+)(?![\w-])/g, /(?<![\w-])text-\[(\d+)px\]/g] as const;

/** Stylesheets: the `--text-N` declarations plus any literal or token-valued
 *  `font-size`. `apps/web/src/styles.css` styles the MapLibre attribution
 *  control, which Tailwind never sees. */
const CSS_PATTERNS = [
  /--text-(\d+)(?=[-:])/g,
  /font-size:\s*(\d+)px/g,
  /font-size:\s*var\(--text-(\d+)\)/g,
] as const;

function scan(): Offence[] {
  const offences: Offence[] = [];
  for (const path of sourceFiles()) {
    const isCss = path.endsWith(".css");
    const patterns = isCss ? CSS_PATTERNS : TSX_PATTERNS;
    const lines = codeOnly(readFileSync(path, "utf8")).split("\n");
    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        for (const match of line.matchAll(pattern)) {
          const size = Number(match[1]);
          if (!ALLOWED.has(size)) {
            offences.push({
              file: relative(REPO, path),
              line: index + 1,
              token: match[0],
              size,
            });
          }
        }
      }
    });
  }
  return offences;
}

describe("§6.2 type scale is the only source of font sizes", () => {
  it("no source file uses a size outside tokens.type.scale", () => {
    const offences = scan();
    const report = offences.map((o) => `${o.file}:${o.line} → ${o.token}`);
    expect(report, `allowed sizes: ${SCALE.join(", ")}`).toEqual([]);
  });

  it("actually finds the sizes it claims to police", () => {
    // A scanner that matches nothing passes vacuously forever. Pin that the
    // patterns really do fire on real source before trusting the green above.
    let hits = 0;
    for (const path of sourceFiles()) {
      const isCss = path.endsWith(".css");
      const text = codeOnly(readFileSync(path, "utf8"));
      for (const pattern of isCss ? CSS_PATTERNS : TSX_PATTERNS) {
        pattern.lastIndex = 0;
        hits += [...text.matchAll(pattern)].length;
      }
    }
    expect(hits).toBeGreaterThan(100);
  });

  it("rejects a size that is one off the scale", () => {
    // The exact silent failure: `text-14` against a scale without 14 compiles
    // to nothing. Proven here on a literal rather than trusting the walk.
    const offScale = SCALE.map((s) => s + 1).find((s) => !ALLOWED.has(s));
    expect(offScale).toBeDefined();
    // matchAll, not match: these patterns are /g, and String.match with a
    // global regex returns the whole-match list and DISCARDS capture groups.
    TSX_PATTERNS[0].lastIndex = 0;
    const [first] = [...`text-${offScale}`.matchAll(TSX_PATTERNS[0])];
    expect(Number(first?.[1])).toBe(offScale);
    expect(ALLOWED.has(Number(first?.[1]))).toBe(false);
  });
});

describe("the scale itself is well-formed", () => {
  it("is strictly ascending with no duplicates", () => {
    expect([...SCALE]).toEqual([...new Set(SCALE)].sort((a, b) => a - b));
  });

  it("declares a body size that is on the scale", () => {
    expect(ALLOWED.has(tokens.type.body)).toBe(true);
  });

  it("gives every size a line height", () => {
    const lineHeights: Record<number, number> = tokens.type.lineHeights;
    for (const size of SCALE) {
      const lineHeight = lineHeights[size] ?? 0;
      expect(lineHeight, `--text-${size} has no line height`).toBeGreaterThan(size);
      // Anything past ~1.6 is a paragraph setting, not a UI ramp; anything
      // under 1.15 clips descenders on Instrument Sans.
      expect(lineHeight / size).toBeGreaterThanOrEqual(1.15);
      expect(lineHeight / size).toBeLessThanOrEqual(1.6);
    }
  });
});
