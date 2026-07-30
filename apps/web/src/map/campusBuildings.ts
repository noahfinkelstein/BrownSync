import { tokens } from "@brownsync/contract";
import type {
  ExpressionSpecification,
  FillExtrusionLayerSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import { activeBuildingColor } from "./classesLayer";

/**
 * Brown's own building layer — footprints, names, heights and colour.
 *
 * WHY THIS EXISTS. Protomaps basemaps v4 carries **no `name` attribute on the
 * `buildings` source-layer** (fields are exactly `addr_housenumber`, `height`,
 * `kind`, `kind_detail`, `layer`, `min_height`, `sort_rank` — verified with
 * `pmtiles show --metadata` against the committed extract). The `pois` layer
 * names only ~15-20 Brown buildings out of 231 named POIs in the campus tile.
 * So campus building labels cannot come from the basemap at all; they come
 * from `db/seeds/campus_buildings.geojson`, built by the Python `campus` job
 * from Brown Facilities' public ArcGIS layer.
 *
 * Owning the polygons also buys `feature-state`: the Protomaps buildings have
 * no stable per-feature id to `promoteId`, which is why the previous
 * class-activity tint had to hit-test centroids against rendered basemap
 * features. Ours are keyed by `propertyCode`.
 *
 * SOURCE DATA (262 features, one page, EPSG:4326, 6-dp coordinates):
 *   propertyCode  stable id — `promoteId` target, 262/262 unique and non-null
 *   label         resolved display name (see ingest campus/aliases_parse.py)
 *   rank          0-3 label tier; LOWER draws first and wins collisions
 *   sortKey       rank + size tiebreak, precomputed offline
 *   labelMinZoom  the zoom this feature's label starts at
 *   heightM       derived from gross area / footprint area -> floors
 *   year          Year_of_Construction, null when the source's 0 sentinel
 *   placeId       primary curated place (click-through)
 *   placeIds      every curated place inside this footprint (tint)
 */

export const CAMPUS_SOURCE_ID = "bs-campus";
export const CAMPUS_DATA_URL = "/data/campus-buildings.geojson";

/** MUST be the string form for a GeoJSON source; `generateId` yields unstable indices. */
export const CAMPUS_PROMOTE_ID = "propertyCode";

export const CAMPUS_LAYER_IDS = {
  flat: "bs-campus-flat",
  extrusion: "bs-campus-extrusion",
  outline: "bs-campus-outline",
  labels: "bs-campus-labels",
} as const;

/** Basemap layer the campus layers insert before, so event pins always win. */
export const CAMPUS_BEFORE_ID = "label-roads";

/**
 * Age as a MATERIAL ramp — brick → stone → glass.
 *
 * `Year_of_Construction` is populated for 225/263 rows spanning 1770-2026, so
 * it is a real axis. The first version rendered it as lightness alone, between
 * two blue-greys 0.0096 and 0.0258 apart in relative luminance. On screen that
 * is very nearly invisible: the whole campus read as one flat grey mass, which
 * is exactly the thing owning these polygons was meant to fix.
 *
 * The constraint that forced it is real and still holds — every one of these
 * surfaces has a label drawn on top of it in `tokens.map.labelMuted`, and
 * 4.5:1 against that caps a surface at 0.026251 relative luminance
 * (`MAX_SURFACE_LUMINANCE`). Brightness is spent; there is none left.
 *
 * NOTE the token: map type is pinned to the MAP's surface, not the page's.
 * These used to read `tokens.text.*`, which worked only while the app was
 * also dark; the light-theme flip would have drawn near-black labels with a
 * white halo on a near-black basemap.
 *
 * But **hue is free**. Contrast is a luminance ratio, so rotating hue at a
 * fixed luminance costs exactly nothing. So the ramp now moves through hue as
 * well as value, and the three stops are the actual construction materials of
 * College Hill:
 *
 *   1770 `#301F17` brick   hue  19°  L 0.01670  → 5.14:1
 *   1930 `#2A2724` stone   hue  30°  L 0.02071  → 4.85:1
 *   2026 `#202C3C` glass   hue 214°  L 0.02435  → 4.62:1
 *
 * Luminance still rises monotonically, so the old low core reads dark and the
 * new build reads brighter exactly as before — the hue rotation is additive,
 * not a replacement. Every stop stays under the ceiling with margin, and
 * `daylight.test.ts` asserts that for all three across every daylight level.
 *
 * `year` is null for the 38 unknown-year rows; `coalesce` lands them on the
 * stone midpoint rather than pegging them at "oldest".
 */
export const CAMPUS_AGE_MIN = 1770;
export const CAMPUS_AGE_MID_YEAR = 1930;
export const CAMPUS_AGE_MAX = 2026;
export const CAMPUS_AGE_DARK = "#301F17";
export const CAMPUS_AGE_MID = "#2A2724";
export const CAMPUS_AGE_LIGHT = "#202C3C";

export function buildingColorExpression(
  dark: string = CAMPUS_AGE_DARK,
  mid: string = CAMPUS_AGE_MID,
  light: string = CAMPUS_AGE_LIGHT,
): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["get", "year"], CAMPUS_AGE_MID_YEAR],
    CAMPUS_AGE_MIN,
    dark,
    CAMPUS_AGE_MID_YEAR,
    mid,
    CAMPUS_AGE_MAX,
    light,
  ];
}

/**
 * Class-activity tint, driven by `feature-state` rather than the centroid
 * hit-test the previous implementation needed against nameless basemap
 * buildings. `feature-state` is readable in **paint** expressions only — never
 * in `filter` or `layout` — which is why a focused-label treatment needs its
 * own source rather than a state-driven `text-allow-overlap`.
 *
 * Reuses `activeBuildingColor` so the campus layer and the legacy basemap tint
 * cannot drift apart on what "a class is happening here" looks like.
 */
export function campusActivityColorExpression(
  dark: string = CAMPUS_AGE_DARK,
  mid: string = CAMPUS_AGE_MID,
  light: string = CAMPUS_AGE_LIGHT,
): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["feature-state", "classActivity"], 0],
    0,
    buildingColorExpression(dark, mid, light),
    1,
    // The fully-active tint has to be a concrete colour, not a nested
    // expression: MapLibre will not interpolate *to* another interpolate.
    // Basing it on the ramp's own midpoint keeps "class in session" reading
    // as a tint of the campus rather than an unrelated swatch.
    activeBuildingColor(mid),
  ] as unknown as ExpressionSpecification;
}

export function campusFlatLayer(enabled = true): FillLayerSpecification {
  return {
    id: CAMPUS_LAYER_IDS.flat,
    type: "fill",
    source: CAMPUS_SOURCE_ID,
    maxzoom: 14,
    layout: { visibility: enabled ? "visible" : "none" },
    paint: { "fill-color": buildingColorExpression(), "fill-opacity": 1 },
  };
}

export function campusExtrusionLayer(enabled = true): FillExtrusionLayerSpecification {
  return {
    id: CAMPUS_LAYER_IDS.extrusion,
    type: "fill-extrusion",
    source: CAMPUS_SOURCE_ID,
    minzoom: 14,
    layout: { visibility: enabled ? "visible" : "none" },
    paint: {
      "fill-extrusion-color": campusActivityColorExpression(),
      // Real heights: floors derived from Brown's own gross-area/footprint
      // ratio. The basemap fallback was a flat 12 m for ~86% of buildings,
      // which is exactly why the massing read uniform.
      "fill-extrusion-height": ["coalesce", ["get", "heightM"], 11],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 1,
      "fill-extrusion-vertical-gradient": true,
    },
  };
}

/** Crisp edges on a dark basemap — near-zero cost, large legibility win. */
export function campusOutlineLayer(enabled = true): LineLayerSpecification {
  return {
    id: CAMPUS_LAYER_IDS.outline,
    type: "line",
    source: CAMPUS_SOURCE_ID,
    minzoom: 15,
    layout: { visibility: enabled ? "visible" : "none" },
    paint: {
      "line-color": tokens.map.line,
      "line-opacity": 0.5,
      "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 15, 0.4, 17.5, 1.2],
    },
  };
}

/**
 * ONE symbol layer covers all four tiers, filtered by the per-feature
 * `labelMinZoom`. Four separate layers would be four label tiers that collide
 * independently in draw order, losing global `symbol-sort-key` control.
 *
 * Collision notes that are easy to get wrong:
 *   - `symbol-sort-key`: LOWER wins.
 *   - `text-offset` is IGNORED when `text-variable-anchor` is set — use
 *     `text-radial-offset`.
 *   - `text-allow-overlap: true` defeats collision entirely; only the focused
 *     label may use it.
 *   - three variable anchors, not five: placement cost is linear in anchor
 *     count and we place ~262 labels.
 *   - the font must be one the Protomaps glyph server actually serves.
 */
export function campusLabelLayer(enabled = true): SymbolLayerSpecification {
  return {
    id: CAMPUS_LAYER_IDS.labels,
    type: "symbol",
    source: CAMPUS_SOURCE_ID,
    minzoom: 14.5,
    filter: [">=", ["zoom"], ["get", "labelMinZoom"]],
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Medium"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 14.5, 10, 16, 11.5, 17.5, 13],
      "text-max-width": 8,
      "text-letter-spacing": 0.02,
      "text-line-height": 1.15,
      "text-variable-anchor": ["center", "top", "bottom"],
      "text-radial-offset": 0.6,
      "text-justify": "auto",
      "text-padding": 3,
      "symbol-sort-key": ["get", "sortKey"],
      "text-allow-overlap": false,
      visibility: enabled ? "visible" : "none",
    },
    paint: {
      // Landmarks read primary; everything else recedes to secondary. Both
      // clear WCAG AA against the campus surfaces (a11y-contrast.test.ts).
      "text-color": ["step", ["get", "rank"], tokens.map.label, 1, tokens.map.labelMuted],
      "text-halo-color": tokens.map.labelHalo,
      // 1.4 rather than the basemap's 1.2: these sit on lit roofs. The blur
      // stops the halo reading as an outline.
      "text-halo-width": 1.4,
      "text-halo-blur": 0.4,
    },
  };
}

export function campusLayers(enabled = true) {
  return [
    campusFlatLayer(enabled),
    campusExtrusionLayer(enabled),
    campusOutlineLayer(enabled),
    campusLabelLayer(enabled),
  ] as const;
}

/**
 * Zooms at which each rank's labels become eligible. Mirrors the ingest job.
 *
 * INTEGERS, deliberately. MapLibre evaluates `["zoom"]` inside a **filter** at
 * the integer tile zoom rather than the fractional map zoom, so the original
 * 14.5 / 15.5 / 16.5 thresholds silently rounded up to 15 / 16 / 17: rank 1 was
 * hidden until z16 and rank 2 until z17, leaving 94 buildings labelled only
 * between 17.0 and MAX_ZOOM 17.5. Rank 0 uses 0 and is gated instead by the
 * layer's own `minzoom: 14.5`, which IS fractional-aware.
 */
export const RANK_MIN_ZOOM: Readonly<Record<number, number>> = {
  0: 0,
  1: 16,
  2: 17,
  3: 17,
};

/** How many label tiers are eligible at `zoom` — the design law caps this at 3. */
export function visibleRanksAt(zoom: number): number[] {
  // Mirrors what MapLibre actually does: the filter sees the integer tile zoom.
  const tileZoom = Math.floor(zoom);
  if (zoom < (campusLabelLayer().minzoom ?? 0)) return [];
  return Object.entries(RANK_MIN_ZOOM)
    .filter(([, min]) => tileZoom >= min)
    .map(([rank]) => Number(rank));
}
