import { describe, expect, it } from "vitest";
import style from "../../../map/style.json";
import { BUILDING_2D_BASE, BUILDING_3D_BASE } from "../src/map/buildingColors";

/**
 * Token hygiene (Phase 3): `map/style.json` is the source of truth for the
 * basemap building paint; `src/map/buildingColors.ts` is the one TS copy the
 * classes-activity layer blends/restores against. Drift = failure.
 */

type StyleLayer = { id: string; paint?: Record<string, unknown> };

function paintOf(id: string): Record<string, unknown> {
  const layer = (style.layers as StyleLayer[]).find((l) => l.id === id);
  if (!layer?.paint) throw new Error(`map/style.json layer ${id} with paint not found`);
  return layer.paint;
}

describe("building base colors match map/style.json", () => {
  it("BUILDING_3D_BASE equals buildings-3d fill-extrusion-color", () => {
    expect(paintOf("buildings-3d")["fill-extrusion-color"]).toBe(BUILDING_3D_BASE);
  });

  it("BUILDING_2D_BASE equals buildings-2d fill-color", () => {
    expect(paintOf("buildings-2d")["fill-color"]).toBe(BUILDING_2D_BASE);
  });
});
