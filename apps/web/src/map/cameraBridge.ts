import type { Map as MaplibreMap } from "maplibre-gl";

/**
 * maplibre-gl v6 / react-map-gl 8.1.1 camera seam repair.
 *
 * v6 moved the camera internals behind `map._camera` (see the DeckOverlay
 * note in MapView.tsx), but react-map-gl's Maplibre bridge still:
 *
 *  1. assigns its `transformCameraUpdate` hook onto the MAP object — where
 *     v6 never reads it (the live hook slot is `map._camera
 *     .transformCameraUpdate`) — so `_propsedCameraUpdate` stays null, and
 *  2. falls back to `transformToViewState(map.transform)` in its camera
 *     event handler — `map.transform` no longer exists.
 *
 * Net effect without this bridge: EVERY camera event (`movestart`, `move`,
 * drags, `easeTo`/`flyTo`) throws `Cannot read properties of undefined
 * (reading 'center')` inside react-map-gl's listener. Because that listener
 * was registered first, the throw aborts the whole `fire()` — sibling
 * listeners (the viewport list `moveend` sync, hover handlers) never run,
 * and programmatic `flyTo` on selection dies at `movestart`.
 *
 * The bridge re-points the hook where v6 looks for it and aliases
 * `map.transform` to the camera's transform. Verified against a live map in
 * e2e/perf.e2e.ts (camera tour) — remove when react-map-gl ships real
 * maplibre-6 support.
 */

type CameraSeam = {
  transform?: unknown;
  transformCameraUpdate?: unknown;
  _camera?: {
    transform: unknown;
    transformCameraUpdate: unknown;
  };
};

/** Idempotent; a no-op on maplibre versions where the seam is intact. */
export function bridgeCameraSeam(map: MaplibreMap): void {
  const m = map as unknown as CameraSeam;
  const camera = m._camera;
  if (!camera) return;
  if (typeof m.transformCameraUpdate === "function" && !camera.transformCameraUpdate) {
    camera.transformCameraUpdate = m.transformCameraUpdate;
  }
  if (m.transform === undefined) {
    Object.defineProperty(m, "transform", {
      get: () => camera.transform,
      configurable: true,
    });
  }
}
