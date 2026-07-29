/**
 * The time cursor — single source of truth every layer re-filters through
 * (handoff §2G). Two modes:
 *
 *   live      now() tracks the wall clock; subscribers are ticked so layers
 *             re-evaluate "what's happening now" without any user input.
 *   scrubbed  now() is frozen at the scrubbed instant; the ticker stops.
 *
 * Scrubbing is CLIENT-SIDE ONLY (handoff §5): layers filter already-fetched
 * data through this cursor. Nothing here fetches, and consumers must not
 * refetch on cursor changes while scrubbing.
 *
 * Framework-agnostic on purpose: deck.gl layer factories and the map's
 * GeoJSON filter subscribe directly; React components go through
 * `useTimeCursor()` which wraps `subscribe`/`version` in useSyncExternalStore.
 */

import { HOUR_MS, MINUTE_MS } from "./tz";

/** How often live mode notifies subscribers (imminence rings, readouts). */
export const LIVE_TICK_MS = 30_000;

/** Contract §3 events may have `end: null`; treat them as an hour long. */
export const FALLBACK_EVENT_DURATION_MS = HOUR_MS;

/** Default map window around the cursor: recent past hour + next three. */
export const DEFAULT_WINDOW_BEFORE_MS = HOUR_MS;
export const DEFAULT_WINDOW_AFTER_MS = 3 * HOUR_MS;

export type TimeWindow = { from: Date; to: Date };

export type TimeCursorStore = {
  /** The cursor instant: wall clock while live, frozen while scrubbed. */
  now(): Date;
  /** The wall clock regardless of mode — the scrubber's NOW marker. */
  liveNow(): Date;
  readonly isLive: boolean;
  /** Return to live mode (wall clock, ticking). No-op when already live. */
  setLive(): void;
  /** Freeze the cursor at `d`. Invalid dates are ignored. */
  setAt(d: Date): void;
  /** Notify on any cursor change (scrub, mode switch, live tick). */
  subscribe(cb: () => void): () => void;
  /** Monotonic change counter — the useSyncExternalStore snapshot. */
  version(): number;
  /** Window around the cursor for layer filtering. */
  windowAround(beforeMs?: number, afterMs?: number): TimeWindow;
  /** Is the cursor inside [start, end]? Null/omitted end = start + 1 h. */
  isWithin(start: Date | string | number, end?: Date | string | number | null): boolean;
};

export type TimeCursorOptions = {
  /** Live-mode notify cadence; default LIVE_TICK_MS. */
  tickMs?: number;
  /** Wall-clock source; default Date.now (fake timers hook in here). */
  clock?: () => number;
};

function coerceMs(value: Date | string | number): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return new Date(value).getTime();
  return value.getTime();
}

export function createTimeCursor(options: TimeCursorOptions = {}): TimeCursorStore {
  const tickMs = options.tickMs ?? LIVE_TICK_MS;
  const clock = options.clock ?? Date.now;

  /** Frozen instant in ms while scrubbed; null while live. */
  let at: number | null = null;
  let version = 0;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function notify(): void {
    version += 1;
    for (const cb of [...listeners]) cb();
  }

  /** The ticker runs only while live AND observed — no idle work. */
  function syncTimer(): void {
    const shouldTick = at === null && listeners.size > 0;
    if (shouldTick && timer === null) {
      timer = setInterval(notify, tickMs);
    } else if (!shouldTick && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function nowMs(): number {
    return at ?? clock();
  }

  return {
    now(): Date {
      return new Date(nowMs());
    },

    liveNow(): Date {
      return new Date(clock());
    },

    get isLive(): boolean {
      return at === null;
    },

    setLive(): void {
      if (at === null) return;
      at = null;
      syncTimer();
      notify();
    },

    setAt(d: Date): void {
      const ms = d.getTime();
      if (Number.isNaN(ms) || ms === at) return;
      at = ms;
      syncTimer();
      notify();
    },

    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      syncTimer();
      return () => {
        listeners.delete(cb);
        syncTimer();
      };
    },

    version(): number {
      return version;
    },

    windowAround(
      beforeMs: number = DEFAULT_WINDOW_BEFORE_MS,
      afterMs: number = DEFAULT_WINDOW_AFTER_MS,
    ): TimeWindow {
      const center = nowMs();
      return { from: new Date(center - beforeMs), to: new Date(center + afterMs) };
    },

    isWithin(start: Date | string | number, end?: Date | string | number | null): boolean {
      const startMs = coerceMs(start);
      if (Number.isNaN(startMs)) return false;
      const endMs = end == null ? startMs + FALLBACK_EVENT_DURATION_MS : coerceMs(end);
      if (Number.isNaN(endMs)) return false;
      const cursor = nowMs();
      return cursor >= startMs && cursor <= endMs;
    },
  };
}

/**
 * The app-wide cursor. Everything on screen filters through this one store;
 * creating additional cursors is for tests only.
 */
export const timeCursor: TimeCursorStore = createTimeCursor();

/** Quantize an instant to whole minutes — scrubber output, URL values. */
export function floorToMinute(d: Date | number): Date {
  const ms = typeof d === "number" ? d : d.getTime();
  return new Date(ms - (((ms % MINUTE_MS) + MINUTE_MS) % MINUTE_MS));
}
