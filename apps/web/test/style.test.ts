import { describe, expect, it } from "vitest";
import style from "../../../map/style.json";

/** Source layers present in the Protomaps v4 extract (pmtiles show --metadata). */
const KNOWN_SOURCE_LAYERS = [
  "boundaries",
  "buildings",
  "earth",
  "landcover",
  "landuse",
  "places",
  "pois",
  "roads",
  "water",
];

type AnyLayer = {
  id: string;
  type: string;
  source?: string;
  "source-layer"?: string;
  minzoom?: number;
  paint?: Record<string, unknown>;
  filter?: unknown;
};

const layers = style.layers as AnyLayer[];
const byId = new Map(layers.map((l) => [l.id, l]));

describe("map/style.json (canonical basemap style)", () => {
  it("is a v8 style with protomaps glyphs and a pmtiles vector source", () => {
    expect(style.version).toBe(8);
    expect(style.glyphs).toBe(
      "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    );
    const source = style.sources.protomaps;
    expect(source.type).toBe("vector");
    expect(source.url.startsWith("pmtiles://")).toBe(true);
    expect(source.attribution).toContain("OpenStreetMap");
    expect(source.attribution).toContain("Protomaps");
  });

  it("references only source layers that exist in the extract", () => {
    for (const layer of layers) {
      if (layer.type === "background") continue;
      expect(layer.source, layer.id).toBe("protomaps");
      expect(KNOWN_SOURCE_LAYERS, `${layer.id} source-layer`).toContain(layer["source-layer"]);
    }
  });

  it("holds the §6.3 near-monochrome palette", () => {
    expect(byId.get("earth")?.paint?.["fill-color"]).toBe("#0B0E12");
    expect(byId.get("water")?.paint?.["fill-color"]).toBe("#0D1319");
    expect(byId.get("landuse-green")?.paint?.["fill-color"]).toBe("#131A16");
    for (const id of ["roads-minor", "roads-medium", "roads-major"]) {
      expect(byId.get(id)?.paint?.["line-color"], id).toBe("#1C222B");
    }
  });

  it("extrudes context buildings with a clamped height fallback", () => {
    // Measured against the committed extract: the campus z15 tile has 889
    // buildings and only 121 (13.6%) carry `height`, with a minimum of
    // 0.3048 m (a 1-foot data-entry artifact). The old flat 12 m fallback was
    // therefore doing the work for ~86% of buildings, which is precisely why
    // the massing read uniform. `max(coalesce(height, 9), 6)` clamps the 1-ft
    // artifacts up and drops the fallback so real heights stand out.
    //
    // Brown's own buildings no longer use this layer at all — they are drawn
    // by bs-campus-extrusion from measured floor counts (see campusBuildings.ts).
    const b3d = byId.get("buildings-3d");
    expect(b3d?.type).toBe("fill-extrusion");
    expect(b3d?.paint?.["fill-extrusion-height"]).toEqual([
      "max",
      ["coalesce", ["get", "height"], 9],
      6,
    ]);
    expect(b3d?.paint?.["fill-extrusion-base"]).toEqual(["coalesce", ["get", "min_height"], 0]);
  });

  it("recedes context buildings so the campus layer reads as figure", () => {
    // Non-Brown College Hill is context. Brown's own footprints draw above it
    // at full opacity from bs-campus-*, so pushing this darker is the cheapest
    // available legibility win.
    expect(byId.get("buildings-3d")?.paint?.["fill-extrusion-color"]).toBe("#141821");
    expect(byId.get("buildings-3d")?.paint?.["fill-extrusion-opacity"]).toBe(0.9);
    expect(byId.get("buildings-2d")?.paint?.["fill-color"]).toBe("#141821");
  });

  it("gates labels to at most 3 tiers at any zoom", () => {
    const symbolLayers = layers.filter((l) => l.type === "symbol");
    // Tiers: locality > neighbourhood > street. `label-pois-civic` was retired
    // when the campus label layer landed: Protomaps `pois` names only ~15-20
    // Brown buildings out of 231 named POIs in the campus tile, so it was the
    // weakest tier and is strictly superseded by bs-campus-labels (262
    // buildings). Retiring it also keeps the visible-tier count at 3 once the
    // app-side campus tier is counted — see campusBuildings.test.ts, which
    // probes the union of style.json symbols and the app's own layers.
    expect(symbolLayers).toHaveLength(3);
    for (const probe of [7, 12, 14, 15, 16, 17.5]) {
      const visible = symbolLayers.filter((l) => {
        const min = l.minzoom ?? 0;
        const max = (l as { maxzoom?: number }).maxzoom ?? 24;
        return probe >= min && probe < max;
      });
      expect(visible.length, `zoom ${probe}`).toBeLessThanOrEqual(3);
    }
  });

  it("hides commercial POI clutter (no POI layer at all)", () => {
    // STRONGER than the previous rule, not weaker. This used to allow exactly
    // one whitelisted civic-POI layer and assert its filter excluded
    // restaurant/cafe/bar/shop/fast_food. Now no layer reads `pois`, so
    // commercial clutter cannot reach the map by any filter mistake.
    const poiLayers = layers.filter((l) => l["source-layer"] === "pois");
    expect(poiLayers).toHaveLength(0);
  });
});
