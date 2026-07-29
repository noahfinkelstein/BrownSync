import { useCallback, useSyncExternalStore } from "react";

/**
 * Viewport seam — handoff §2 H. The list view depends on the map viewport
 * ONLY through this interface; the integrator connects it to MapLibre
 * (`moveend` → `set(map.getBounds()…)`). Until then everything runs against
 * the full-campus default, so this lane never imports src/map/**.
 */

/** `[west, south, east, north]` in lng/lat — the API's bbox order (contract §3). */
export type Bbox = readonly [number, number, number, number];

/** College Hill campus box — handoff §5; mirrors map/camera CAMPUS_BOUNDS. */
export const FULL_CAMPUS_BBOX: Bbox = [-71.41, 41.82, -71.393, 41.834];

export interface ViewportSource {
  /**
   * Current bbox. Must return a stable reference until the viewport actually
   * changes (useSyncExternalStore snapshot contract) — return the same array,
   * not a fresh one per call.
   */
  bbox(): Bbox;
  /** Notify `cb` on every viewport change; returns an unsubscribe. */
  subscribe(cb: () => void): () => void;
}

/** Static default: the whole campus, never changes. */
export const fullCampusViewport: ViewportSource = {
  bbox: () => FULL_CAMPUS_BBOX,
  subscribe: () => () => {},
};

/**
 * Ready-made store for the integrator: push map bboxes in with `set`,
 * hand the source to `<ListView viewport={…}>`. Debounce upstream if the
 * map emits per-frame.
 */
export function createViewportSource(
  initial: Bbox = FULL_CAMPUS_BBOX,
): ViewportSource & { set: (next: Bbox) => void } {
  let current = initial;
  const subs = new Set<() => void>();
  return {
    bbox: () => current,
    subscribe: (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    set: (next) => {
      const [w, s, e, n] = current;
      if (next[0] === w && next[1] === s && next[2] === e && next[3] === n) return;
      current = next;
      for (const cb of subs) cb();
    },
  };
}

/** Reactive bbox from any ViewportSource. */
export function useViewportBbox(source: ViewportSource): Bbox {
  const subscribe = useCallback((cb: () => void) => source.subscribe(cb), [source]);
  const getSnapshot = useCallback(() => source.bbox(), [source]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Serialize for the `bbox` query param — "w,s,e,n", 5 decimals (~1 m). */
export function bboxParam(bbox: Bbox): string {
  return bbox.map((n) => n.toFixed(5)).join(",");
}
