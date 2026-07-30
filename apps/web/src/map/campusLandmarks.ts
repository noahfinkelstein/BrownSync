import { tokens } from "@brownsync/contract";
import type {
  FillLayerSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import { CAMPUS_BEFORE_ID } from "./campusBuildings";

/**
 * Campus greens, quads and athletic fields.
 *
 * Two jobs, and they are worth separating:
 *
 * 1. **Legibility.** The six curated `outdoor` places — Main Green, Quiet
 *    Green, Ruth Simmons Quad, Pembroke Green, Wriston Quad, Van Wickle Gates —
 *    have no polygon of their own in `places.ndjson` (156 polygons across 174
 *    places; every green is in the missing 18). Five of them now bind to a
 *    Brown Facilities green-space polygon, so they finally have geometry and a
 *    label. A named, outlined Main Green is the strongest "this is Brown"
 *    signal on the map after building names.
 *
 * 2. **Ground texture.** 516 of the 552 polygons are unnamed lawn and planting
 *    beds. They carry no label and no interaction — they exist so campus reads
 *    as green space rather than undifferentiated dark, which is most of what
 *    "make it feel like campus" actually means visually.
 *
 * Greens draw BELOW the buildings (they are ground), and their labels ride the
 * same tier budget as rank-0 buildings.
 */

export const LANDMARK_SOURCE_ID = "bs-landmarks";
export const LANDMARK_DATA_URL = "/data/campus-landmarks.geojson";

export const LANDMARK_LAYER_IDS = {
  green: "bs-landmark-green",
  field: "bs-landmark-field",
  outline: "bs-landmark-outline",
  labels: "bs-landmark-labels",
} as const;

/**
 * Ground colours, lifted just clear of the basemap's `landuse-green`
 * (`tokens.map.green`, #131A16) so Brown's own open space separates from
 * generic city parkland without introducing a new hue.
 */
export const LANDMARK_GREEN_FILL = "#16211A";
export const LANDMARK_GREEN_LINE = "#1C2A20";
/** Fields read as maintained surface — cooler and flatter than lawn. */
export const LANDMARK_FIELD_FILL = "#182320";

export function landmarkGreenLayer(enabled = true): FillLayerSpecification {
  return {
    id: LANDMARK_LAYER_IDS.green,
    type: "fill",
    source: LANDMARK_SOURCE_ID,
    filter: ["==", ["get", "kind"], "green"],
    layout: { visibility: enabled ? "visible" : "none" },
    paint: { "fill-color": LANDMARK_GREEN_FILL, "fill-opacity": 1 },
  };
}

export function landmarkFieldLayer(enabled = true): FillLayerSpecification {
  return {
    id: LANDMARK_LAYER_IDS.field,
    type: "fill",
    source: LANDMARK_SOURCE_ID,
    filter: ["==", ["get", "kind"], "field"],
    layout: { visibility: enabled ? "visible" : "none" },
    paint: { "fill-color": LANDMARK_FIELD_FILL, "fill-opacity": 1 },
  };
}

/** Outline only the named spaces — outlining 516 lawn patches is noise. */
export function landmarkOutlineLayer(enabled = true): LineLayerSpecification {
  return {
    id: LANDMARK_LAYER_IDS.outline,
    type: "line",
    source: LANDMARK_SOURCE_ID,
    minzoom: 14.5,
    filter: ["has", "label"],
    layout: { visibility: enabled ? "visible" : "none" },
    paint: {
      "line-color": LANDMARK_GREEN_LINE,
      "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 14.5, 0.5, 17.5, 1.4],
    },
  };
}

/**
 * Landmark labels are a SECOND symbol tier alongside the buildings, which is
 * why `label-places-neighbourhood` had its maxzoom pulled from 16 to 15 in
 * `map/style.json`: once individual building names are legible, the
 * neighbourhood name is redundant, and the design law caps visible label tiers
 * at 3. `apps/web/test/campusBuildings.test.ts` counts the union across both
 * sources at every probe zoom.
 */
export function landmarkLabelLayer(enabled = true): SymbolLayerSpecification {
  return {
    id: LANDMARK_LAYER_IDS.labels,
    type: "symbol",
    source: LANDMARK_SOURCE_ID,
    minzoom: 14.5,
    filter: ["has", "label"],
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Medium"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 14.5, 11, 17.5, 14],
      "text-max-width": 7,
      "text-letter-spacing": 0.06,
      "text-transform": "uppercase",
      "text-variable-anchor": ["center", "top", "bottom"],
      "text-radial-offset": 0.4,
      "text-justify": "auto",
      "text-padding": 4,
      // Below every building label: a green is context for the buildings on it.
      "symbol-sort-key": -1,
      "text-allow-overlap": false,
      visibility: enabled ? "visible" : "none",
    },
    paint: {
      "text-color": tokens.map.labelMuted,
      "text-halo-color": tokens.map.labelHalo,
      "text-halo-width": 1.4,
      "text-halo-blur": 0.4,
    },
  };
}

/** Ground layers draw beneath the campus buildings; labels above them. */
export const LANDMARK_FILL_BEFORE_ID = "buildings-2d";
export const LANDMARK_LABEL_BEFORE_ID = CAMPUS_BEFORE_ID;

export function landmarkLayers(enabled = true) {
  return [
    landmarkGreenLayer(enabled),
    landmarkFieldLayer(enabled),
    landmarkOutlineLayer(enabled),
    landmarkLabelLayer(enabled),
  ] as const;
}
