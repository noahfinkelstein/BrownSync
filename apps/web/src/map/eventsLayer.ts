import type { Category, EventOut } from "@brownsync/contract";
import { CATEGORIES, tokens } from "@brownsync/contract";
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";

/**
 * Events as GPU layers (handoff §5): one GeoJSON source (clustered below
 * zoom 16 via MapLibre's built-in supercluster), circle layer with radius by
 * imminence + category color from the contract tokens, SDF-free glyph symbol
 * layer at zoom ≥ 16 from the @brownsync/ui map-sprite build. NO DOM markers.
 */

const MIN = 60_000;

export const EVENTS_SOURCE_ID = "bs-events";

export const EVENT_LAYER_IDS = {
  clusters: "bs-event-clusters",
  clusterCounts: "bs-event-cluster-counts",
  dots: "bs-event-dots",
  icons: "bs-event-icons",
} as const;

/** Icons take over at zoom 16 — cluster right up to that handoff. */
export const ICON_MIN_ZOOM = 16;
export const CLUSTER_MAX_ZOOM = 15;
export const CLUSTER_RADIUS = 44;

/** "Starting soon" horizon: the ≤30-min pulse window (§6.4). */
export const SOON_MS = 30 * MIN;
/** Upcoming events stay on the map this far ahead of the cursor. */
export const LOOKAHEAD_MS = 2 * 60 * MIN;
/** Open-ended events count as in-progress for 90 min. */
export const DEFAULT_DURATION_MS = 90 * MIN;

export type LayerToggles = { events: boolean; classes: boolean; athletics: boolean };

const startMs = (e: EventOut): number => Date.parse(e.start);
const endMs = (e: EventOut): number =>
  e.end ? Date.parse(e.end) : startMs(e) + DEFAULT_DURATION_MS;

/** In progress at the cursor, or starting within the 2 h lookahead. */
export function isEventLive(e: EventOut, cursorMs: number): boolean {
  if (e.isCanceled) return false;
  return startMs(e) <= cursorMs + LOOKAHEAD_MS && endMs(e) >= cursorMs;
}

/** Time-window filter only — toggles are applied separately (rail counts). */
export function eventsInWindow(events: readonly EventOut[], cursor: Date): EventOut[] {
  const c = cursor.getTime();
  return events.filter((e) => e.lat !== null && e.lng !== null && isEventLive(e, c));
}

/** Layer-rail split: athletics is its own toggle; everything else = events. */
export function filterByToggles(events: readonly EventOut[], toggles: LayerToggles): EventOut[] {
  return events.filter((e) => (e.category === "athletics" ? toggles.athletics : toggles.events));
}

/**
 * 0..1 urgency: 1 while in progress or starting ≤30 min, easing to 0 at the
 * 2 h lookahead. Drives circle radius (and nothing else).
 */
export function imminence(e: EventOut, cursorMs: number): number {
  const until = startMs(e) - cursorMs;
  if (until <= SOON_MS) return endMs(e) >= cursorMs || until > 0 ? 1 : 0;
  const t = (until - SOON_MS) / (LOOKAHEAD_MS - SOON_MS);
  return Math.max(0, 1 - t);
}

/** Starting within (0, 30] min — the pulse set. */
export function isStartingSoon(e: EventOut, cursorMs: number): boolean {
  const until = startMs(e) - cursorMs;
  return until > 0 && until <= SOON_MS;
}

export type EventFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { id: string; category: Category; imminence: number; soon: 0 | 1 };
};

export type EventFeatureCollection = {
  type: "FeatureCollection";
  features: EventFeature[];
};

/** Visible events → GeoJSON for the single `setData`-updated source. */
export function eventsToGeoJSON(events: readonly EventOut[], cursor: Date): EventFeatureCollection {
  const c = cursor.getTime();
  const features: EventFeature[] = [];
  for (const e of events) {
    if (e.lat === null || e.lng === null) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [e.lng, e.lat] },
      properties: {
        id: e.id,
        category: e.category,
        imminence: Number(imminence(e, c).toFixed(3)),
        soon: isStartingSoon(e, c) ? 1 : 0,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** [lng, lat] of events starting ≤30 min — fed to the deck.gl pulse. */
export function pulsePositions(events: readonly EventOut[], cursor: Date): [number, number][] {
  const c = cursor.getTime();
  const out: [number, number][] = [];
  for (const e of events) {
    if (e.lat !== null && e.lng !== null && isStartingSoon(e, c)) out.push([e.lng, e.lat]);
  }
  return out;
}

/** Category → color, straight from the contract palette (§6.1 tokens). */
export function categoryColorExpression(): ExpressionSpecification {
  const branches = CATEGORIES.flatMap((c) => [c.id, c.colorHex] as const);
  return [
    "match",
    ["get", "category"],
    ...branches,
    tokens.text.faint,
  ] as unknown as ExpressionSpecification;
}

const IMM = ["get", "imminence"];
/** Radius grows with zoom and with imminence; steps up when glyphs appear. */
const radiusExpression = [
  "interpolate",
  ["linear"],
  ["zoom"],
  13,
  ["+", 2.5, ["*", 2, IMM]],
  15.8,
  ["+", 4, ["*", 2.5, IMM]],
  16,
  ["+", 6.5, ["*", 2.5, IMM]],
  17.5,
  ["+", 8, ["*", 3.5, IMM]],
] as unknown as ExpressionSpecification;

/** Unclustered event dots — color by category, radius by imminence. */
export const eventDotsLayer: CircleLayerSpecification = {
  id: EVENT_LAYER_IDS.dots,
  type: "circle",
  source: EVENTS_SOURCE_ID,
  filter: ["!", ["has", "point_count"]],
  paint: {
    "circle-color": categoryColorExpression(),
    "circle-radius": radiusExpression,
    "circle-stroke-color": tokens.bg.base,
    "circle-stroke-width": 1.5,
    "circle-opacity": ["+", 0.6, ["*", 0.4, IMM]] as unknown as ExpressionSpecification,
  },
};

/** Category glyphs (ui map-sprite via map.addImage) centered on dots, z ≥ 16. */
export const eventIconsLayer: SymbolLayerSpecification = {
  id: EVENT_LAYER_IDS.icons,
  type: "symbol",
  source: EVENTS_SOURCE_ID,
  minzoom: ICON_MIN_ZOOM,
  filter: ["!", ["has", "point_count"]],
  layout: {
    "icon-image": ["concat", "icon-", ["get", "category"]],
    // Glyphs rasterized at 64 px with pixelRatio 4 → 16 px nominal; 0.6 ≈ 10 px.
    "icon-size": 0.6,
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
  },
  paint: {
    "icon-opacity": 0.92,
  },
};

/** Cluster discs: neutral surface, never category-colored (mixed contents). */
export const eventClustersLayer: CircleLayerSpecification = {
  id: EVENT_LAYER_IDS.clusters,
  type: "circle",
  source: EVENTS_SOURCE_ID,
  filter: ["has", "point_count"],
  paint: {
    "circle-color": tokens.bg.overlay,
    "circle-stroke-color": tokens.line,
    "circle-stroke-width": 1.25,
    "circle-radius": [
      "step",
      ["get", "point_count"],
      10,
      5,
      13,
      15,
      16,
      40,
      20,
    ] as unknown as ExpressionSpecification,
  },
};

/**
 * Cluster counts. IBM Plex Mono is not on the Protomaps glyph server, so map-
 * internal text uses the basemap's Noto stack (same as its labels).
 */
export const eventClusterCountsLayer: SymbolLayerSpecification = {
  id: EVENT_LAYER_IDS.clusterCounts,
  type: "symbol",
  source: EVENTS_SOURCE_ID,
  filter: ["has", "point_count"],
  layout: {
    "text-field": ["get", "point_count_abbreviated"],
    "text-font": ["Noto Sans Medium"],
    "text-size": 12,
    "text-allow-overlap": true,
  },
  paint: {
    "text-color": tokens.text.primary,
  },
};
