import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * MAP TOKEN SCOPE — the law that bounds the "white splotches" bug class.
 *
 * The map is its own surface with its own background. Page-scoped tokens
 * (`tokens.bg.*`, `tokens.text.*`, `tokens.line`) follow the app chrome; when
 * the chrome flipped light on 2026-07-29 every map paint that referenced one
 * silently inverted — a white daytime landmass (`DAY.earth`), cream cluster
 * discs, white dot rings, washed-out glyph sprites. Map paints must pin to
 * `tokens.map.*` or to literal basemap hexes, so the two surfaces can move
 * independently. See the MAP TYPOGRAPHY comment block in
 * packages/contract/src/tokens.ts and handoffs/CURSOR_LIGHT_CARTOGRAPHY.md.
 *
 * Source-scanning style mirrors daylight.test.ts's rAF/interval scan.
 */

const MAP_DIR = join(__dirname, "..", "src", "map");

// Page-scoped token accesses. `tokens.line` needs a negative lookbehind so it
// doesn't match the map-scoped `tokens.map.line`.
const PAGE_TOKEN_PATTERNS: readonly [RegExp, string][] = [
  [/tokens\.bg\./, "tokens.bg.* (page background)"],
  [/tokens\.text\./, "tokens.text.* (page typography)"],
  [/(?<!map\.)tokens\.line/, "tokens.line (page hairline)"],
];

function mapSourceFiles(): string[] {
  return readdirSync(MAP_DIR)
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .map((name) => join(MAP_DIR, name));
}

describe("map token scope", () => {
  it("finds map source files", () => {
    expect(mapSourceFiles().length).toBeGreaterThan(5);
  });

  for (const [pattern, label] of PAGE_TOKEN_PATTERNS) {
    it(`never references ${label} in a map module`, () => {
      for (const file of mapSourceFiles()) {
        const source = readFileSync(file, "utf8");
        const offenders = source
          .split("\n")
          .map((line, i) => ({ line, n: i + 1 }))
          // Comments may cite the pattern when documenting the rule.
          .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line))
          .filter(({ line }) => pattern.test(line));
        expect(
          offenders,
          `${file} references ${label}: ${offenders.map((o) => `line ${o.n}`).join(", ")}`,
        ).toEqual([]);
      }
    });
  }
});
