import { CATEGORY_BY_ID, tokens } from "@brownsync/contract";
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import { CAMPUS_BEFORE_ID } from "./campusBuildings";

/**
 * Campus amenity points — "where is the nearest blue-light phone / AED /
 * all-gender restroom / hydration station / bike rack".
 *
 * 823 points across 11 kinds from five of Brown Facilities' public ArcGIS
 * services, published by the Python `amenities` job as one artifact. One
 * source and one pair of layers, filtered by `kind`, rather than eleven
 * sources: MapLibre re-parses a GeoJSON source on every `setData`, and eleven
 * of them would also be eleven independent label-collision groups.
 */

export const AMENITY_SOURCE_ID = "bs-amenities";
export const AMENITY_DATA_URL = "/data/campus-amenities.geojson";

export const AMENITY_LAYER_IDS = {
  dots: "bs-amenity-dots",
  labels: "bs-amenity-labels",
} as const;

/** Amenity kinds, mirroring `ingest/brownsync_ingest/campus/amenities.py`. */
export const AMENITY_KINDS = [
  "blue-light",
  "aed",
  "narcan",
  "restroom",
  "restroom-inclusive",
  "hydration",
  "printer",
  "menstrual",
  "lactation",
  "bike",
  "dining",
] as const;

export type AmenityKind = (typeof AMENITY_KINDS)[number];

/** Human-facing labels for artifact kinds, independent of map toggle exposure. */
export const AMENITY_LABELS: Readonly<Record<AmenityKind, string>> = {
  "blue-light": "Blue-light phones",
  aed: "AEDs",
  narcan: "Naloxone (Narcan)",
  restroom: "Restrooms",
  "restroom-inclusive": "All-gender restrooms",
  hydration: "Hydration stations",
  printer: "Printers",
  menstrual: "Menstrual products",
  lactation: "Lactation rooms",
  bike: "Bike racks",
  dining: "Dining",
};

/**
 * Colour per kind, drawn from the existing category palette rather than a new
 * one — every value here is already contrast-audited against all three
 * background levels in `a11y-contrast.test.ts`.
 */
export const AMENITY_COLORS: Readonly<Record<AmenityKind, string>> = {
  "blue-light": CATEGORY_BY_ID.academic.colorHex,
  aed: CATEGORY_BY_ID.athletics.colorHex,
  narcan: CATEGORY_BY_ID.athletics.colorHex,
  restroom: CATEGORY_BY_ID.wellness.colorHex,
  "restroom-inclusive": CATEGORY_BY_ID.wellness.colorHex,
  hydration: CATEGORY_BY_ID.career.colorHex,
  printer: CATEGORY_BY_ID.admin.colorHex,
  menstrual: CATEGORY_BY_ID.wellness.colorHex,
  lactation: CATEGORY_BY_ID.social.colorHex,
  bike: CATEGORY_BY_ID.club.colorHex,
  dining: CATEGORY_BY_ID.food.colorHex,
};

export function amenityColorExpression(): ExpressionSpecification {
  return [
    "match",
    ["get", "kind"],
    ...AMENITY_KINDS.flatMap((kind) => [kind, AMENITY_COLORS[kind]] as const),
    // `match` REQUIRES a fallback; without it MapLibre rejects the whole
    // style and the layer never adds.
    CATEGORY_BY_ID.academic.colorHex,
  ] as unknown as ExpressionSpecification;
}

/**
 * Filter for the enabled kinds.
 *
 * `["in", ["get", "kind"], ["literal", [...]]]` and NOT a `match` — a filter
 * has to evaluate to a boolean, and an empty enabled set must produce
 * `false` rather than an error. Returning a literal `false` for the empty
 * case keeps the layer mounted (so its source stays warm) while drawing
 * nothing.
 */
export function amenityFilter(kinds: readonly AmenityKind[]): ExpressionSpecification {
  if (kinds.length === 0) return ["==", ["literal", 1], ["literal", 0]];
  return ["in", ["get", "kind"], ["literal", [...kinds]]] as ExpressionSpecification;
}

/**
 * Amenities are a "find the nearest one" layer, not a browsing layer: they
 * appear only once the user is zoomed into walking distance. At z15 all 823
 * would draw at once and bury the events, which are the point of the map.
 */
export const AMENITY_MIN_ZOOM = 16;
export const AMENITY_LABEL_MIN_ZOOM = 17;

export function amenityDotsLayer(kinds: readonly AmenityKind[]): CircleLayerSpecification {
  return {
    id: AMENITY_LAYER_IDS.dots,
    type: "circle",
    source: AMENITY_SOURCE_ID,
    minzoom: AMENITY_MIN_ZOOM,
    filter: amenityFilter(kinds),
    paint: {
      "circle-color": amenityColorExpression(),
      "circle-radius": ["interpolate", ["linear"], ["zoom"], AMENITY_MIN_ZOOM, 2.5, 18, 5],
      "circle-opacity": 0.9,
      // A hairline ring in the page background, so a dot over a pale roof
      // still reads as a dot rather than dissolving into it.
      "circle-stroke-width": 1,
      "circle-stroke-color": tokens.map.labelHalo,
      "circle-stroke-opacity": 0.8,
    },
  };
}

export function amenityLabelsLayer(kinds: readonly AmenityKind[]): SymbolLayerSpecification {
  return {
    id: AMENITY_LAYER_IDS.labels,
    type: "symbol",
    source: AMENITY_SOURCE_ID,
    minzoom: AMENITY_LABEL_MIN_ZOOM,
    filter: amenityFilter(kinds),
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 10,
      "text-max-width": 7,
      "text-variable-anchor": ["top", "bottom", "left", "right"],
      "text-radial-offset": 0.7,
      "text-justify": "auto",
      "text-padding": 2,
      "text-allow-overlap": false,
      // Building labels are the primary tier and must win every collision:
      // symbol-sort-key is LOWER-wins, and the campus layer's keys are
      // rank-based and small, so a large constant here loses to all of them.
      "symbol-sort-key": 900,
    },
    paint: {
      "text-color": amenityColorExpression(),
      "text-halo-color": tokens.map.labelHalo,
      "text-halo-width": 1.1,
    },
  };
}

/** Insert below the same basemap label anchor the campus layers use. */
export const AMENITY_BEFORE_ID = CAMPUS_BEFORE_ID;

export function amenityLayers(kinds: readonly AmenityKind[]) {
  return [amenityDotsLayer(kinds), amenityLabelsLayer(kinds)] as const;
}
