import { useMemo, useSyncExternalStore } from "react";

/**
 * Time-cursor seam (Phase 2 F <-> G integration point).
 *
 * Lane G builds the real `useTimeCursor()` store in `src/time/`. Lane F codes
 * against this EXACT contract without importing lane G's module:
 *
 *   { now: () => Date; isLive: boolean; subscribe(cb): unsubscribe }
 *
 * Everything in F reads time through this module. The integrator connects
 * G's store with ONE call, e.g. in the app entry:
 *
 *   import { setCursorSource } from "./data/cursor";
 *   import { timeCursorSource } from "./time/…"; // G's store, same shape
 *   setCursorSource(timeCursorSource);
 *
 * Until that call, an internal source defaulting to live "now" (30 s tick)
 * drives the map, so this lane works standalone.
 */
export type TimeCursorSource = {
  /** The current cursor instant. Live mode: wall-clock now. */
  now: () => Date;
  /** True when tracking wall-clock time (the NOW ● state). */
  isLive: boolean;
  /** Notify on cursor change; returns an unsubscribe. */
  subscribe: (cb: () => void) => () => void;
};

/** Default source: wall-clock now, ticking every `tickMs` while observed. */
export function createLiveCursorSource(tickMs = 30_000): TimeCursorSource {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    now: () => new Date(),
    isLive: true,
    subscribe(cb) {
      listeners.add(cb);
      if (listeners.size === 1) {
        timer = setInterval(() => {
          for (const notify of listeners) notify();
        }, tickMs);
      }
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
  };
}

type CursorSnapshot = { now: () => Date; isLive: boolean; version: number };

let source: TimeCursorSource = createLiveCursorSource();
let version = 0;
let snapshot: CursorSnapshot = makeSnapshot();
const outerListeners = new Set<() => void>();
let detachFromSource: (() => void) | null = null;

function makeSnapshot(): CursorSnapshot {
  return { now: () => source.now(), isLive: source.isLive, version };
}

function bump(): void {
  version += 1;
  snapshot = makeSnapshot();
  for (const notify of outerListeners) notify();
}

/**
 * Swap the cursor source. THE integration seam: call once with lane G's
 * store and every layer/panel/header in lane F follows the scrubber.
 */
export function setCursorSource(next: TimeCursorSource): void {
  source = next;
  if (outerListeners.size > 0) {
    detachFromSource?.();
    detachFromSource = source.subscribe(bump);
  }
  bump();
}

export function getCursorSource(): TimeCursorSource {
  return source;
}

/** Subscribe to cursor changes (source swaps AND ticks of the active source). */
export function subscribeCursor(cb: () => void): () => void {
  outerListeners.add(cb);
  if (outerListeners.size === 1) {
    detachFromSource = source.subscribe(bump);
  }
  return () => {
    outerListeners.delete(cb);
    if (outerListeners.size === 0) {
      detachFromSource?.();
      detachFromSource = null;
    }
  };
}

export function getCursorSnapshot(): CursorSnapshot {
  return snapshot;
}

/** React binding, same shape as lane G's contract. */
export function useTimeCursor(): { now: () => Date; isLive: boolean } {
  return useSyncExternalStore(subscribeCursor, getCursorSnapshot);
}

/**
 * Convenience: a `Date` that is referentially stable between cursor changes,
 * so memoized GeoJSON/format work re-runs only when the cursor moves.
 */
export function useCursorDate(): { cursor: Date; isLive: boolean } {
  const snap = useSyncExternalStore(subscribeCursor, getCursorSnapshot);
  const cursor = useMemo(() => snap.now(), [snap]);
  return { cursor, isLive: snap.isLive };
}
