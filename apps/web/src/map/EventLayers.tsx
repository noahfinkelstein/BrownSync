import type { EventOut } from "@brownsync/contract";
import { CATEGORY_IDS, tokens } from "@brownsync/contract";
import { buildMapImages, mapIconId } from "@brownsync/ui";
import type { GeoJSONSource, Map as MaplibreMap, MapMouseEvent } from "maplibre-gl";
import { useEffect } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import {
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
  EVENT_LAYER_IDS,
  EVENTS_SOURCE_ID,
  type EventFeatureCollection,
  eventClusterCountsLayer,
  eventClustersLayer,
  eventDotsLayer,
  eventIconsLayer,
} from "./eventsLayer";

export type EventHover = { event: EventOut; x: number; y: number };

export type EventLayersProps = {
  data: EventFeatureCollection;
  /** Lookup for hover/click → full event (GeoJSON carries only ids). */
  eventsById: ReadonlyMap<string, EventOut>;
  onHover: (hover: EventHover | null) => void;
  onSelect: (event: EventOut) => void;
};

/** Rasterize the ui category glyphs (dark-on-dot) into the map's image atlas. */
function registerCategoryImages(map: MaplibreMap): void {
  if (typeof OffscreenCanvas === "undefined") return; // jsdom/SSR: symbols just don't render
  const images = buildMapImages(64, tokens.bg.base);
  for (const category of CATEGORY_IDS) {
    const id = mapIconId(category);
    if (!map.hasImage(id)) map.addImage(id, images[category], { pixelRatio: 4 });
  }
}

const INTERACTIVE_LAYERS = [EVENT_LAYER_IDS.dots, EVENT_LAYER_IDS.icons, EVENT_LAYER_IDS.clusters];

/**
 * The live events layer set: clustered GeoJSON source + circle/symbol layers
 * (see eventsLayer.ts for the specs) + pointer interactions. Everything stays
 * on the GPU; hover/click resolve features back to events via `eventsById`.
 */
export function EventLayers({ data, eventsById, onHover, onSelect }: EventLayersProps) {
  const { current: mapRef } = useMap();

  // Category glyphs for the symbol layer (zoom ≥ 16), re-added on style resets.
  useEffect(() => {
    if (!mapRef) return;
    const map = mapRef.getMap();
    registerCategoryImages(map);
    const onMissing = (): void => registerCategoryImages(map);
    map.on("styleimagemissing", onMissing);
    return () => {
      map.off("styleimagemissing", onMissing);
    };
  }, [mapRef]);

  // Pointer interactions. Bound map-wide with an existence-guarded layer
  // filter so binding order vs. layer mount order never matters.
  useEffect(() => {
    if (!mapRef) return;
    const map = mapRef.getMap();
    const presentLayers = (): string[] => INTERACTIVE_LAYERS.filter((id) => map.getLayer(id));

    const featureAt = (e: MapMouseEvent) => {
      const layers = presentLayers();
      if (layers.length === 0) return undefined;
      return map.queryRenderedFeatures(e.point, { layers })[0];
    };

    const handleMove = (e: MapMouseEvent): void => {
      // Perf: `mousemove` also fires throughout drag-pans/zooms —
      // `queryRenderedFeatures` mid-animation burns the 16 ms frame budget.
      // Hover resolves again on the first still frame.
      if (map.isMoving()) {
        map.getCanvas().style.cursor = "";
        onHover(null);
        return;
      }
      const feature = featureAt(e);
      if (!feature) {
        map.getCanvas().style.cursor = "";
        onHover(null);
        return;
      }
      map.getCanvas().style.cursor = "pointer";
      const id = feature.properties?.id;
      const event = typeof id === "string" ? eventsById.get(id) : undefined;
      onHover(event ? { event, x: e.point.x, y: e.point.y } : null);
    };

    const handleLeave = (): void => {
      map.getCanvas().style.cursor = "";
      onHover(null);
    };

    const handleClick = (e: MapMouseEvent): void => {
      const feature = featureAt(e);
      if (!feature) return;
      const clusterId = feature.properties?.cluster_id;
      if (typeof clusterId === "number") {
        const source = map.getSource(EVENTS_SOURCE_ID) as GeoJSONSource | undefined;
        const geometry = feature.geometry;
        if (!source || geometry.type !== "Point") return;
        const [lng, lat] = geometry.coordinates;
        if (lng === undefined || lat === undefined) return;
        void source.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({ center: [lng, lat], zoom: Math.min(zoom + 0.25, 17.5), duration: 450 });
        });
        return;
      }
      const id = feature.properties?.id;
      const event = typeof id === "string" ? eventsById.get(id) : undefined;
      if (event) onSelect(event);
    };

    map.on("mousemove", handleMove);
    map.on("mouseout", handleLeave);
    map.on("click", handleClick);
    return () => {
      map.off("mousemove", handleMove);
      map.off("mouseout", handleLeave);
      map.off("click", handleClick);
    };
  }, [mapRef, eventsById, onHover, onSelect]);

  return (
    <Source
      id={EVENTS_SOURCE_ID}
      type="geojson"
      data={data}
      cluster
      clusterMaxZoom={CLUSTER_MAX_ZOOM}
      clusterRadius={CLUSTER_RADIUS}
    >
      <Layer {...eventClustersLayer} />
      <Layer {...eventClusterCountsLayer} />
      <Layer {...eventDotsLayer} />
      <Layer {...eventIconsLayer} />
    </Source>
  );
}
