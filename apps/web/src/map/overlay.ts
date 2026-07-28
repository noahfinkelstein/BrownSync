import type { LayersList } from "@deck.gl/core";

/**
 * The deck.gl overlay seam. Phase 1 ships an empty layer list; Phase 2 F
 * (live map view) calls `setOverlayLayers` with pulse/glow layers and the
 * mounted `<MapView>` picks them up reactively — no map internals exposed.
 */

type OverlayListener = () => void;

let overlayLayers: LayersList = [];
const listeners = new Set<OverlayListener>();

/** Replace the full deck.gl layer list rendered over the basemap. */
export function setOverlayLayers(layers: LayersList): void {
  overlayLayers = layers;
  for (const notify of listeners) {
    notify();
  }
}

export function getOverlayLayers(): LayersList {
  return overlayLayers;
}

/** Subscribe to layer-list swaps; returns an unsubscribe. */
export function subscribeOverlayLayers(listener: OverlayListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
