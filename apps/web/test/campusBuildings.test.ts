import { readFileSync } from "node:fs";
import path from "node:path";
import { CATEGORIES } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import style from "../../../map/style.json";
import {
  buildingColorExpression,
  CAMPUS_AGE_DARK,
  CAMPUS_AGE_LIGHT,
  CAMPUS_AGE_MAX,
  CAMPUS_AGE_MID,
  CAMPUS_AGE_MID_YEAR,
  CAMPUS_AGE_MIN,
  CAMPUS_BEFORE_ID,
  CAMPUS_DATA_URL,
  CAMPUS_PROMOTE_ID,
  CAMPUS_SOURCE_ID,
  campusExtrusionLayer,
  campusFlatLayer,
  campusLabelLayer,
  campusLayers,
  campusOutlineLayer,
  RANK_MIN_ZOOM,
  visibleRanksAt,
} from "../src/map/campusBuildings";
import { landmarkLabelLayer, landmarkLayers } from "../src/map/campusLandmarks";
import { MAX_SURFACE_LUMINANCE, relativeLuminance } from "../src/map/daylight";

/**
 * The campus building layer is where every Brown building label on the map
 * comes from — Protomaps basemaps v4 has no `name` on `buildings` at all.
 * These tests pin the parts that fail SILENTLY if they regress.
 */

const artifact = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../db/seeds/campus_buildings.geojson"), "utf8"),
);

describe("campus building layers", () => {
  it.each([
    { enabled: false, visibility: "none" },
    { enabled: true, visibility: "visible" },
  ] as const)(
    "sets every owned layer to $visibility when enabled=$enabled",
    ({ enabled, visibility }) => {
      for (const layer of campusLayers(enabled)) {
        expect(layer.layout?.visibility, layer.id).toBe(visibility);
      }

      const labels = campusLabelLayer(enabled);
      expect(labels.layout?.["text-field"]).toEqual(["get", "label"]);
      expect(labels.layout?.["symbol-sort-key"]).toEqual(["get", "sortKey"]);
    },
  );

  it("keys the source on a stable id for promoteId", () => {
    // `generateId: true` would yield indices that change on every setData,
    // making feature-state target a different building after any reload.
    expect(CAMPUS_PROMOTE_ID).toBe("propertyCode");
    expect(CAMPUS_SOURCE_ID).toBe("bs-campus");
    expect(CAMPUS_DATA_URL.startsWith("/")).toBe(true);
  });

  it("draws flat below z14 and extruded above, mirroring the basemap handoff", () => {
    expect(campusFlatLayer().maxzoom).toBe(14);
    expect(campusExtrusionLayer().minzoom).toBe(14);
  });

  it("extrudes from the measured height, not a flat fallback", () => {
    const paint = campusExtrusionLayer().paint ?? {};
    expect(paint["fill-extrusion-height"]).toEqual(["coalesce", ["get", "heightM"], 11]);
    expect(paint["fill-extrusion-vertical-gradient"]).toBe(true);
  });

  it("colours buildings by age as a three-stop material ramp", () => {
    const [op, , input, min, dark, midYear, mid, max, light] =
      buildingColorExpression() as unknown as [
        string,
        unknown,
        unknown,
        number,
        string,
        number,
        string,
        number,
        string,
      ];
    expect(op).toBe("interpolate");
    // The 38 rows whose Year_of_Construction is the source's 0 sentinel must
    // land mid-ramp, not pegged at "oldest".
    expect(input).toEqual(["coalesce", ["get", "year"], CAMPUS_AGE_MID_YEAR]);
    expect(min).toBe(CAMPUS_AGE_MIN);
    expect(midYear).toBe(CAMPUS_AGE_MID_YEAR);
    expect(max).toBe(CAMPUS_AGE_MAX);
    expect([dark, mid, light]).toEqual([CAMPUS_AGE_DARK, CAMPUS_AGE_MID, CAMPUS_AGE_LIGHT]);
  });

  it("bounds the §6.3 chroma bend: hue is allowed, brightness is not", () => {
    // This layer deliberately BENDS the near-monochrome design law — the
    // original ramp ran between two blue-greys 0.0096..0.0258 apart in
    // luminance and the campus rendered as one flat grey mass. The bend is
    // bounded rather than unbounded: saturation may rise, but only along the
    // axis that costs nothing.
    //
    //   - luminance: hard-capped, because every one of these surfaces has a
    //     label on it. 4.5:1 against --text-secondary caps a surface at
    //     0.026251. Enforced across all daylight levels in daylight.test.ts.
    //   - chroma: capped well below a category colour, so buildings can never
    //     compete with the event palette, which is the actual point of §6.3.
    const stops = [CAMPUS_AGE_DARK, CAMPUS_AGE_MID, CAMPUS_AGE_LIGHT];
    const channels = (hex: string): number[] =>
      [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

    for (const hex of stops) {
      const c = channels(hex);
      const spread = Math.max(...c) - Math.min(...c);
      // Muted, not saturated: the search that produced these rejected the
      // luminance-maximal candidates (#501900, #002B5A) as heat-map loud.
      expect(spread, `${hex} chroma spread`).toBeLessThanOrEqual(40);
      // ...but every stop must still be under the WCAG surface ceiling.
      expect(relativeLuminance(hex), `${hex} luminance`).toBeLessThanOrEqual(MAX_SURFACE_LUMINANCE);
    }

    // Every category colour is more saturated than any building, so a
    // building can never read as an event.
    const quietest = Math.min(
      ...CATEGORIES.map((cat) => {
        const c = channels(cat.colorHex);
        return Math.max(...c) - Math.min(...c);
      }),
    );
    const loudest = Math.max(
      ...stops.map((hex) => {
        const c = channels(hex);
        return Math.max(...c) - Math.min(...c);
      }),
    );
    expect(loudest).toBeLessThan(quietest);
  });

  it("configures label collision the way MapLibre actually requires", () => {
    const layout = campusLabelLayer().layout ?? {};
    // text-offset is IGNORED when text-variable-anchor is set.
    expect(layout["text-radial-offset"]).toBeDefined();
    expect(layout["text-offset"]).toBeUndefined();
    // Collision must stay on — `true` here would produce overlapping mush.
    expect(layout["text-allow-overlap"]).toBe(false);
    // Lower sortKey wins; the value is precomputed offline per feature.
    expect(layout["symbol-sort-key"]).toEqual(["get", "sortKey"]);
    // Three anchors, not five: placement cost is linear in anchor count and
    // this layer places ~262 labels.
    expect((layout["text-variable-anchor"] as string[]).length).toBe(3);
    // The font must be one the Protomaps glyph server actually serves.
    expect(layout["text-font"]).toEqual(["Noto Sans Medium"]);
  });

  it("filters labels by the per-feature tier rather than splitting layers", () => {
    // One layer, four tiers. Separate layers would collide independently in
    // draw order and lose global symbol-sort-key control.
    const symbols = campusLayers().filter((l) => l.type === "symbol");
    expect(symbols).toHaveLength(1);
    expect(campusLabelLayer().filter).toEqual([">=", ["zoom"], ["get", "labelMinZoom"]]);
  });

  it("targets a beforeId that actually exists in the style", () => {
    // A missing `beforeId` makes map.addLayer THROW, which surfaces to the
    // user as the fatal "Basemap unavailable" screen. This was an unpinned
    // coupling to a style.json layer id.
    const ids = (style.layers as { id: string }[]).map((l) => l.id);
    expect(ids).toContain(CAMPUS_BEFORE_ID);
    for (const layer of campusLayers()) {
      expect(layer.source).toBe(CAMPUS_SOURCE_ID);
    }
    expect(campusOutlineLayer().minzoom).toBe(15);
  });

  it("stages label tiers at INTEGER zooms", () => {
    // MapLibre evaluates ["zoom"] inside a filter at the integer tile zoom, so
    // fractional thresholds fire a whole zoom level late. Rank 0 uses 0 and
    // relies on the layer's own (fractional-aware) minzoom instead.
    for (const [rank, zoom] of Object.entries(RANK_MIN_ZOOM)) {
      expect(Number.isInteger(zoom), `rank ${rank} -> ${zoom}`).toBe(true);
    }
    expect(RANK_MIN_ZOOM[0]).toBe(0);
    expect(campusLabelLayer().minzoom).toBe(14.5);
  });
});

describe("label tiers — the ≤3 visible rule, counted across BOTH sources", () => {
  // The design law caps visible label tiers at 3. Tiers now live in two
  // places: map/style.json's symbol layers and this app's campus layer. Each
  // file alone can satisfy its own test while the union violates the rule, so
  // the accounting has to happen here.
  const styleSymbols = (style.layers as { type: string; minzoom?: number; maxzoom?: number }[])
    .filter((l) => l.type === "symbol")
    .map((l) => ({ min: l.minzoom ?? 0, max: l.maxzoom ?? 24 }));

  it.each([7, 12, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5])("holds at zoom %s", (zoom) => {
    const fromStyle = styleSymbols.filter((l) => zoom >= l.min && zoom < l.max).length;
    // Each app-side symbol layer is ONE tier regardless of how many ranks are
    // eligible inside it — one layer, one collision pass.
    const fromCampus = zoom >= (campusLabelLayer().minzoom ?? 0) ? 1 : 0;
    const fromLandmarks = zoom >= (landmarkLabelLayer().minzoom ?? 0) ? 1 : 0;
    expect(fromStyle + fromCampus + fromLandmarks, `zoom ${zoom}`).toBeLessThanOrEqual(3);
  });

  it("stages ranks so only landmarks label at low zoom", () => {
    expect(visibleRanksAt(14.4)).toEqual([]);
    expect(visibleRanksAt(14.5)).toEqual([0]);
    expect(visibleRanksAt(17)).toEqual([0, 1, 2, 3]);
  });
});

describe("published artifact ↔ layer contract", () => {
  it("carries every property the layers read", () => {
    // `placeIds` was missing from this list — the ONE property that drives the
    // class-activity tint (CampusBuildingLayers reads properties.placeIds to
    // build its index). Omitting it meant the tint could break with no test
    // noticing, and setFeatureState fails silently.
    const required = [
      "propertyCode",
      "label",
      "rank",
      "sortKey",
      "labelMinZoom",
      "heightM",
      "placeId",
      "placeIds",
    ];
    for (const feature of artifact.features) {
      for (const key of required) {
        expect(feature.properties, feature.properties?.propertyCode).toHaveProperty(key);
      }
    }
  });

  it("has a unique non-null promoteId on every feature", () => {
    // This is the silent-failure guard: if propertyCode is missing or
    // duplicated, setFeatureState no-ops and the class tint never appears
    // with no error anywhere.
    const codes = artifact.features.map(
      (f: { properties: { propertyCode: string } }) => f.properties.propertyCode,
    );
    expect(codes.every(Boolean)).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("uses only labelMinZoom values the layer stages", () => {
    const staged = new Set(Object.values(RANK_MIN_ZOOM));
    for (const feature of artifact.features) {
      expect(staged.has(feature.properties.labelMinZoom)).toBe(true);
      expect(RANK_MIN_ZOOM[feature.properties.rank]).toBe(feature.properties.labelMinZoom);
    }
  });

  it("gives every building a non-empty label", () => {
    for (const feature of artifact.features) {
      expect(String(feature.properties.label).trim().length).toBeGreaterThan(0);
    }
  });

  it("carries plausible measured heights, not a uniform fallback", () => {
    const heights = artifact.features.map(
      (f: { properties: { heightM: number } }) => f.properties.heightM,
    );
    expect(Math.min(...heights)).toBeGreaterThan(3);
    expect(Math.max(...heights)).toBeLessThan(60);
    // The whole point: massing must actually vary.
    expect(new Set(heights).size).toBeGreaterThan(8);
  });

  it("credits the source", () => {
    expect(artifact.attribution).toContain("Brown University Facilities");
  });

  it("every placeId and placeIds entry resolves to a real place", () => {
    // These are foreign keys into places.ndjson, whose slugs are referenced by
    // 1,755 course_meetings rows. A dangling id silently breaks click-through
    // and the class tint with no error anywhere.
    const known = new Set(
      readFileSync(path.resolve(__dirname, "../../../db/seeds/places.ndjson"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line).id as string),
    );
    for (const feature of artifact.features) {
      const { placeId, placeIds } = feature.properties;
      if (placeId) expect(known.has(placeId), `dangling placeId ${placeId}`).toBe(true);
      for (const id of placeIds ?? []) {
        expect(known.has(id), `dangling placeIds entry ${id}`).toBe(true);
      }
      // The primary must be one of the occupants.
      if (placeId) expect(placeIds).toContain(placeId);
    }
  });

  it("binds Gregorian Quad A to its own place, not the umbrella complex", () => {
    // Regression: stage-2 conflation was first-come, so the umbrella place took
    // this footprint at 20.7 m while vartan-gregorian-quad-a — 1.0 m away —
    // shipped unmatched and absent from every placeIds array.
    const feature = artifact.features.find(
      (f: { properties: { propertyCode: string } }) => f.properties.propertyCode === "100036",
    );
    expect(feature?.properties.placeId).toBe("vartan-gregorian-quad-a");
  });
});

describe("campus landmarks", () => {
  const landmarks = JSON.parse(
    readFileSync(path.resolve(__dirname, "../../../db/seeds/campus_landmarks.geojson"), "utf8"),
  );

  it("separates ground from labels: fills have no minzoom, labels do", () => {
    expect(landmarkLayers().filter((l) => l.type === "symbol")).toHaveLength(1);
    expect(landmarkLabelLayer().minzoom).toBe(14.5);
  });

  it("labels and outlines only the NAMED spaces", () => {
    // 516 of 552 polygons are unnamed lawn and planting beds. Outlining or
    // labelling them would be noise, not information.
    for (const layer of landmarkLayers()) {
      if (layer.type === "symbol" || layer.type === "line") {
        expect(layer.filter).toEqual(["has", "label"]);
      }
    }
  });

  it("sorts landmark labels beneath every building label", () => {
    // symbol-sort-key: LOWER wins placement. A green is context for the
    // buildings standing on it, so it must never displace one.
    expect(landmarkLabelLayer().layout?.["symbol-sort-key"]).toBe(-1);
  });

  it("gives the curated greens the geometry places.ndjson lacks", () => {
    // The six `outdoor` places carry NO polygon in the seed bundle. Five now
    // bind to a Facilities green-space polygon; van-wickle-gates is a gate,
    // not an open space, and correctly stays unbound.
    const bound = landmarks.features
      .filter((f: { properties: { placeId?: string } }) => f.properties.placeId)
      .map((f: { properties: { placeId: string } }) => f.properties.placeId)
      .sort();
    expect(bound).toEqual([
      "pembroke-green",
      "ruth-j-simmons-quadrangle",
      "the-college-green",
      "the-quiet-green",
      "wriston-quadrangle",
    ]);
  });

  it("labels every bound green, including the ones whose polygon is unnamed", () => {
    // Wriston Quad and the Ruth J. Simmons Quadrangle sit inside UNNAMED
    // polygons; without inheriting the curated place name they would render
    // as anonymous grass.
    for (const feature of landmarks.features) {
      if (feature.properties.placeId) {
        expect(String(feature.properties.label ?? "").length).toBeGreaterThan(0);
      }
    }
  });

  it("carries only the two kinds the layers filter on", () => {
    const kinds = new Set(
      landmarks.features.map((f: { properties: { kind: string } }) => f.properties.kind),
    );
    expect([...kinds].sort()).toEqual(["field", "green"]);
  });
});

describe("feature-state is guarded against the style race", () => {
  /** Comments legitimately mention the APIs below; only real code counts. */
  function codeOnly(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  it("checks isStyleLoaded before calling setFeatureState", () => {
    // `setFeatureState` THROWS "Style is not done loading" — it is NOT the
    // silent no-op that an unknown feature id gets. react-map-gl materializes
    // its MapRef well before `style.load`, so on a cold load the tint effect
    // can win that race, throw, and take the entire <MapView> subtree down
    // through the error boundary: the user sees "Something went wrong", not a
    // missing tint. Observed live on 2026-07-29 after markReady was deferred
    // to a microtask, which shifted the effect ordering just enough.
    const source = codeOnly(
      readFileSync(path.resolve(__dirname, "../src/map/CampusBuildingLayers.tsx"), "utf8"),
    );
    expect(source).toMatch(/isStyleLoaded\(\)/);
    // ...and it must RE-RUN once the style settles, or the tint is lost for
    // the whole session rather than just the first frame.
    const guard = source.slice(source.indexOf("isStyleLoaded()"));
    expect(guard).toMatch(/once\("idle"/);
    expect(source.indexOf("isStyleLoaded()")).toBeLessThan(source.indexOf("setFeatureState"));
  });
});
