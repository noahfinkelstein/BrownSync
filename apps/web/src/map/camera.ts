import type { FlyToOptions, LngLatBoundsLike, Map as MaplibreMap } from "maplibre-gl";

/**
 * Camera constants — handoff §5. The camera is bounds-locked to College Hill;
 * default pitch/bearing make campus read "up the hill".
 */

/** Campus proper: 41.820,-71.410 -> 41.834,-71.393. */
export const CAMPUS_BOUNDS = {
  west: -71.41,
  south: 41.82,
  east: -71.393,
  north: 41.834,
} as const;

/** Max pan extent: campus padded ~0.012 lng / 0.008 lat on every side. */
export const MAX_BOUNDS: LngLatBoundsLike = [
  [-71.422, 41.812],
  [-71.381, 41.842],
];

export const INITIAL_VIEW = {
  longitude: -71.4015,
  latitude: 41.8268,
  zoom: 15.1,
  pitch: 45,
  bearing: -15,
} as const;

export const MAX_PITCH = 60;
export const MIN_ZOOM = 13;
export const MAX_ZOOM = 17.5;

/** Zoom used when flying to a selected event/place without an explicit zoom. */
export const SELECTION_ZOOM = 16.5;

export type CameraTarget = {
  lng: number;
  lat: number;
  zoom?: number;
  pitch?: number;
  bearing?: number;
};

/**
 * Smooth camera move for selections (handoff §5 "smooth flyTo on selection").
 * Later phases pass the map handed out by `<MapView onMapLoad>`; extra
 * MapLibre `FlyToOptions` may override the defaults.
 */
export function flyToTarget(
  map: Pick<MaplibreMap, "flyTo">,
  target: CameraTarget,
  options?: FlyToOptions,
): void {
  map.flyTo({
    center: [target.lng, target.lat],
    zoom: target.zoom ?? SELECTION_ZOOM,
    pitch: target.pitch ?? INITIAL_VIEW.pitch,
    bearing: target.bearing ?? INITIAL_VIEW.bearing,
    duration: 900,
    curve: 1.35,
    essential: true,
    ...options,
  });
}
