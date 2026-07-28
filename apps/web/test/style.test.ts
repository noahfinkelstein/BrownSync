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

  it("extrudes buildings with the height attr and a 12 m fallback", () => {
    const b3d = byId.get("buildings-3d");
    expect(b3d?.type).toBe("fill-extrusion");
    expect(b3d?.paint?.["fill-extrusion-height"]).toEqual(["coalesce", ["get", "height"], 12]);
    expect(b3d?.paint?.["fill-extrusion-base"]).toEqual(["coalesce", ["get", "min_height"], 0]);
  });

  it("gates labels to at most 3 tiers at any zoom", () => {
    const symbolLayers = layers.filter((l) => l.type === "symbol");
    // Tiers: neighbourhood > street > civic POI (locality hands off below z13).
    expect(symbolLayers).toHaveLength(4);
    for (const probe of [7, 12, 14, 15, 16, 17.5]) {
      const visible = symbolLayers.filter((l) => {
        const min = l.minzoom ?? 0;
        const max = (l as { maxzoom?: number }).maxzoom ?? 24;
        return probe >= min && probe < max;
      });
      expect(visible.length, `zoom ${probe}`).toBeLessThanOrEqual(3);
    }
  });

  it("hides commercial POI clutter (single whitelisted civic POI layer)", () => {
    const poiLayers = layers.filter((l) => l["source-layer"] === "pois");
    expect(poiLayers).toHaveLength(1);
    const filter = JSON.stringify(poiLayers[0]?.filter);
    for (const kind of ["restaurant", "cafe", "bar", "shop", "fast_food"]) {
      expect(filter).not.toContain(kind);
    }
    expect(filter).toContain("university");
  });
});
