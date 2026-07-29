import { type PlaceOut, tokens } from "@brownsync/contract";
import { cn, FOCUS_RING } from "@brownsync/ui";
import { Link } from "@tanstack/react-router";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import { AttributionControl, Layer, Map as MapGL, Source, useMap } from "react-map-gl/maplibre";
import { registerPmtilesProtocol } from "../map/pmtiles";
import { buildMapStyle } from "../map/style";
import { configureMaplibreWorker } from "../map/worker";

registerPmtilesProtocol();
configureMaplibreWorker();

/**
 * Place-page mini-map (handoff §3.3, Phase 3 hardening): the committed dark
 * basemap with a static camera on the place centroid and the building
 * footprint highlighted. Non-interactive by design — the ONLY interaction is
 * the click-through link to the main map, which lands the live map on this
 * place via `/?ll=`.
 */

/** Matches the main map's oblique identity (camera.ts INITIAL_VIEW). */
export const MINI_CAMERA = { zoom: 16.2, pitch: 40, bearing: -15 } as const;

/** Round-trippable `?ll=` payload for the click-through (lat,lng). */
export function formatLl(place: Pick<PlaceOut, "lat" | "lng">): string {
  return `${place.lat},${place.lng}`;
}

const LL_RE = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;

/** Parse a `?ll=` value; null unless it is exactly "lat,lng". */
export function parseLl(raw: unknown): { lat: number; lng: number } | null {
  if (typeof raw !== "string") return null;
  const match = LL_RE.exec(raw.trim());
  if (!match?.[1] || !match[2]) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * WebGL probe: jsdom (unit tests) and old machines can't run MapLibre — the
 * mini-map degrades to a plain coords row with the same click-through.
 */
export function canRenderMiniMap(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null;
  } catch {
    return false;
  }
}

/** Centroid hit-test box in screen px — small so we only match the building under the pin. */
export const FOOTPRINT_PROBE_PX = 4;

const FOOTPRINT_LAYERS = ["buildings-3d", "buildings-2d"];

/**
 * Highlights the footprint of the building under the place centroid. The
 * read API doesn't serve gazetteer polygons yet (PlaceOut, contract §3), so
 * — like the main map's class-activity layer — the footprint comes from the
 * basemap's own building features: hit-test the centroid against rendered
 * buildings once tiles are in, then outline the matched geometry. Places
 * without a building under the pin (greens, quads) simply get no highlight.
 */
function FootprintHighlight({ lng, lat }: { lng: number; lat: number }) {
  const { current: mapRef } = useMap();
  const [footprint, setFootprint] = useState<GeoJSON.Feature | null>(null);

  useEffect(() => {
    if (!mapRef) return;
    const map: MaplibreMap = mapRef.getMap();
    let found = false;
    const probe = (): void => {
      if (found) return;
      const layers = FOOTPRINT_LAYERS.filter((l) => map.getLayer(l));
      if (layers.length === 0) return;
      const p = map.project([lng, lat]);
      const box: [[number, number], [number, number]] = [
        [p.x - FOOTPRINT_PROBE_PX, p.y - FOOTPRINT_PROBE_PX],
        [p.x + FOOTPRINT_PROBE_PX, p.y + FOOTPRINT_PROBE_PX],
      ];
      const feature = map.queryRenderedFeatures(box, { layers })[0];
      if (!feature) return;
      found = true;
      setFootprint({ type: "Feature", geometry: feature.geometry, properties: {} });
      map.off("idle", probe);
      map.off("sourcedata", probe);
    };
    // Tiles stream in async: probe now, then on every tile arrival/settle
    // until the building under the centroid renders (or never — no-op).
    probe();
    map.on("idle", probe);
    map.on("sourcedata", probe);
    return () => {
      map.off("idle", probe);
      map.off("sourcedata", probe);
    };
  }, [mapRef, lng, lat]);

  if (!footprint) return null;
  return (
    <Source id="minimap-footprint" type="geojson" data={footprint}>
      <Layer
        id="minimap-footprint-fill"
        type="fill"
        paint={{ "fill-color": tokens.text.primary, "fill-opacity": 0.08 }}
      />
      <Layer
        id="minimap-footprint-line"
        type="line"
        paint={{ "line-color": tokens.text.primary, "line-opacity": 0.85, "line-width": 1.5 }}
      />
    </Source>
  );
}

export type PlaceMiniMapProps = {
  place: PlaceOut;
  className?: string;
};

export function PlaceMiniMap({ place, className }: PlaceMiniMapProps) {
  const [supported] = useState(canRenderMiniMap);
  const mapStyle = useMemo(buildMapStyle, []);
  const ll = formatLl(place);

  if (!supported) {
    return (
      <div
        data-testid="place-minimap-fallback"
        className={cn(
          "flex items-center justify-between gap-3 border-y border-line py-2",
          className,
        )}
      >
        <span className="font-mono text-12 text-text-secondary">
          {place.lat.toFixed(4)} · {place.lng.toFixed(4)}
        </span>
        <MiniMapLink ll={ll} name={place.name} className="font-mono text-12" />
      </div>
    );
  }

  return (
    <div
      data-testid="place-minimap"
      className={cn(
        "relative h-40 w-full overflow-hidden rounded-6 border border-line bg-bg-base",
        // Attribution must stay clickable above the click-through overlay.
        "[&_.maplibregl-ctrl-bottom-right]:z-20",
        className,
      )}
    >
      <MapGL
        mapStyle={mapStyle}
        initialViewState={{ longitude: place.lng, latitude: place.lat, ...MINI_CAMERA }}
        interactive={false}
        attributionControl={false}
        style={{ position: "absolute", inset: 0 }}
      >
        <AttributionControl compact position="bottom-right" />
        <FootprintHighlight lng={place.lng} lat={place.lat} />
      </MapGL>
      {/* Full-cover click-through: the map is inert, the link is the control. */}
      <Link
        to="/"
        search={{ ll } as never}
        aria-label={`Open ${place.name} on the live map`}
        className={cn("absolute inset-0 z-10 block", FOCUS_RING)}
      >
        <span className="absolute bottom-2 left-2 rounded-4 border border-line bg-bg-base/85 px-1.5 py-0.5 font-mono text-12 text-text-secondary">
          open on the live map ↗
        </span>
      </Link>
    </div>
  );
}

function MiniMapLink({ ll, name, className }: { ll: string; name: string; className?: string }) {
  return (
    <Link
      to="/"
      search={{ ll } as never}
      aria-label={`Open ${name} on the live map`}
      className={cn(
        "shrink-0 text-text-secondary transition-colors duration-150 ease-out hover:text-text-primary",
        FOCUS_RING,
        className,
      )}
    >
      open on the live map ↗
    </Link>
  );
}
