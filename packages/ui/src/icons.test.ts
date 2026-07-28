import { CATEGORY_IDS } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import { CATEGORY_ICON_PATHS, ICON_STROKE_WIDTH, ICON_VIEWBOX } from "./icons/paths";
import { buildSpriteSheet } from "./icons/sprite";

describe("category icon set", () => {
  it("covers exactly the contract taxonomy", () => {
    expect(Object.keys(CATEGORY_ICON_PATHS).sort()).toEqual([...CATEGORY_IDS].sort());
  });

  it("keeps the family rules: 16 grid, 1.5 stroke", () => {
    expect(ICON_VIEWBOX).toBe(16);
    expect(ICON_STROKE_WIDTH).toBe(1.5);
  });

  it("every glyph is distinct, non-empty path data", () => {
    const paths = Object.values(CATEGORY_ICON_PATHS);
    expect(new Set(paths).size).toBe(paths.length);
    for (const d of paths) {
      expect(d.startsWith("M")).toBe(true);
      expect(d.length).toBeGreaterThan(10);
    }
  });

  it("every coordinate stays inside the 16px box", () => {
    for (const [id, d] of Object.entries(CATEGORY_ICON_PATHS)) {
      const numbers = d.match(/-?\d*\.?\d+/g) ?? [];
      expect(numbers.length).toBeGreaterThan(0);
      for (const n of numbers.map(Number)) {
        expect(n, `${id}: value ${n} escapes the grid`).toBeGreaterThanOrEqual(0);
        expect(n, `${id}: value ${n} escapes the grid`).toBeLessThanOrEqual(ICON_VIEWBOX);
      }
    }
  });

  it("buildSpriteSheet emits one symbol per contract icon slug", () => {
    const sheet = buildSpriteSheet();
    expect(sheet.startsWith("<svg")).toBe(true);
    expect(sheet).toContain('aria-hidden="true"');
    for (const id of CATEGORY_IDS) {
      expect(sheet).toContain(`<symbol id="icon-${id}"`);
    }
    expect(sheet.match(/<symbol /g)?.length).toBe(CATEGORY_IDS.length);
  });
});
