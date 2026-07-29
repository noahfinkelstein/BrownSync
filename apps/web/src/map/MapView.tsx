import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { type ReactNode, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AttributionControl, Map as MapGL, type MapRef, useControl } from "react-map-gl/maplibre";
import { INITIAL_VIEW, MAX_BOUNDS, MAX_PITCH, MAX_ZOOM, MIN_ZOOM } from "./camera";
import { getOverlayLayers, subscribeOverlayLayers } from "./overlay";
import { registerPmtilesProtocol } from "./pmtiles";
import { buildMapStyle, pmtilesUrl } from "./style";
import { configureMaplibreWorker } from "./worker";

registerPmtilesProtocol();
configureMaplibreWorker();

/**
 * deck.gl seam (handoff Phase 1 A -> Phase 2 F): a MapboxOverlay fed
 * reactively from `./overlay`. Phase 2 never touches this component — it
 * calls `setOverlayLayers(layers)`.
 *
 * NOT interleaved (integration): maplibre-gl 6 moved `map.transform` behind
 * `_camera`, and @deck.gl/mapbox <= 9.3.7 still reads `map.transform.height`
 * on the interleaved custom-layer path — the first frame with any deck layer
 * (the pulse) threw every rAF and killed the map. Overlaid mode sticks to
 * official map APIs. Revisit when deck.gl ships maplibre-6 support; the only
 * visual cost is pulse rings not being occluded by 3D building extrusions.
 */
function DeckOverlay() {
  const overlay = useControl<MapboxOverlay>(
    () => new MapboxOverlay({ interleaved: false, layers: getOverlayLayers() }),
  );
  const layers = useSyncExternalStore(subscribeOverlayLayers, getOverlayLayers);
  overlay.setProps({ layers });
  return null;
}

export type MapViewProps = {
  /** Fires once the style + tiles are in; hands later phases the raw map for `flyToTarget`. */
  onMapLoad?: (map: MaplibreMap) => void;
  /** Map children (react-map-gl `<Source>`/`<Layer>` data layers — Phase 2 F). */
  children?: ReactNode;
};

type MapStatus = "loading" | "ready" | "error";

/**
 * Full-bleed 2.5D campus map: dark Protomaps basemap (canonical style in
 * `map/style.json`), 3D building extrusions, camera bounds-locked to College
 * Hill per handoff §5, compact OSM/Protomaps attribution bottom-right.
 */
export function MapView({ onMapLoad, children }: MapViewProps) {
  const mapStyle = useMemo(buildMapStyle, []);
  const [status, setStatus] = useState<MapStatus>("loading");
  const announcedRef = useRef(false);

  const markReady = (map: MaplibreMap): void => {
    if (announcedRef.current) return;
    announcedRef.current = true;
    setStatus("ready");
    onMapLoad?.(map);
  };

  // StrictMode double-mounts recycle the map instance: `load` can fire while
  // the map is parked between mounts, after which the fully-loaded map sits
  // dormant and emits nothing — so watch the instance state directly. A
  // callback ref (not an effect) because react-map-gl materializes its
  // MapRef on a later render, re-invoking the callback when it does.
  const watchStopRef = useRef<(() => void) | null>(null);
  const watchReadiness = (ref: MapRef | null): void => {
    watchStopRef.current?.();
    watchStopRef.current = null;
    if (!ref) return;
    const map = ref.getMap();
    const check = (): void => {
      if (map.loaded()) markReady(map);
    };
    check();
    map.on("render", check);
    const poll = setInterval(check, 250);
    watchStopRef.current = () => {
      map.off("render", check);
      clearInterval(poll);
    };
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0B0E12]">
      <MapGL
        ref={watchReadiness}
        mapStyle={mapStyle}
        initialViewState={INITIAL_VIEW}
        maxBounds={MAX_BOUNDS}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        maxPitch={MAX_PITCH}
        attributionControl={false}
        style={{ position: "absolute", inset: 0 }}
        onLoad={(e) => markReady(e.target)}
        // `load` can fire before React attaches handlers (StrictMode double
        // mount + cached style); `idle` re-fires after every settled render,
        // so it reliably clears the boot overlay in that race.
        onIdle={(e) => markReady(e.target)}
        onError={() => {
          // Only a failure before first load is fatal (missing/corrupt
          // archive); transient tile errors afterwards are non-events.
          setStatus((s) => (s === "loading" ? "error" : s));
        }}
      >
        <AttributionControl compact position="bottom-right" />
        <DeckOverlay />
        {children}
      </MapGL>

      <div
        aria-hidden={status === "ready"}
        className={`absolute inset-0 z-10 flex items-center justify-center bg-[#0B0E12] transition-opacity duration-150 ease-out ${
          status === "ready" ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        {status === "error" ? (
          <div className="flex max-w-sm flex-col items-start gap-3 rounded-[6px] border border-[#232A35] bg-[#11151B] p-4">
            <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-[#E8ECF1]">
              Basemap unavailable
            </p>
            <p className="text-[13px] leading-relaxed text-[#8B94A3]">
              Tiles failed to load from{" "}
              <span className="font-mono text-[12px] text-[#E8ECF1]">{pmtilesUrl()}</span>. Run{" "}
              <span className="font-mono text-[12px]">scripts/basemap-extract.sh</span>, then
              reload.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-[4px] border border-[#232A35] px-3 py-1.5 text-[13px] text-[#E8ECF1] transition-colors duration-150 ease-out hover:bg-[#171C24]"
            >
              Reload
            </button>
          </div>
        ) : (
          <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-[#566070]">
            Loading basemap…
          </p>
        )}
      </div>
    </div>
  );
}
