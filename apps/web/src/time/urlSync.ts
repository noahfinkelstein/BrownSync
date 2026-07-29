/**
 * URL ⇄ cursor sync (handoff §2G): scrubbed mode serializes to `?at=<ISO>`,
 * live mode keeps the URL clean. Writes are debounced so dragging does not
 * spam history; reads happen on connect and on external navigation.
 *
 * The store never touches the URL directly — it talks to a `UrlAdapter`.
 * `createHistoryUrlAdapter()` is the standalone window.history implementation;
 * at integration time the wiring agent can swap in a TanStack Router adapter
 * (search-param read/write over the same three methods) without touching any
 * cursor logic.
 */

import type { TimeCursorStore } from "./cursor";

export const AT_PARAM = "at";

export type UrlAdapter = {
  /** Current raw `?at` value, or null when absent. */
  read(): string | null;
  /** Set (string) or remove (null) the `?at` param. Must not add history entries. */
  write(value: string | null): void;
  /** Notify on external URL changes (back/forward). Optional. */
  subscribe?(cb: () => void): () => void;
};

/**
 * Compact ISO for URLs: minute precision when seconds are zero
 * (`2026-07-28T23:04Z`), second precision otherwise. Always UTC —
 * `new Date(encodeAt(d))` round-trips exactly (ms are quantized away
 * upstream by `floorToMinute`).
 */
export function encodeAt(d: Date): string {
  return d
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:00Z$/, "Z");
}

/** Strict-ish parse: anything `Date` can read; null for garbage. */
export function decodeAt(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The subset of `window` the history adapter needs — injectable for tests. */
export type HistoryWindowLike = {
  location: { pathname: string; search: string; hash: string };
  history: { replaceState(data: unknown, unused: string, url: string): void };
  addEventListener(type: "popstate", cb: () => void): void;
  removeEventListener(type: "popstate", cb: () => void): void;
};

/**
 * Standalone adapter over window.history/URLSearchParams. Uses replaceState
 * (scrubbing is one gesture, not a history trail) and preserves every other
 * query param untouched.
 */
export function createHistoryUrlAdapter(
  win: HistoryWindowLike = window as unknown as HistoryWindowLike,
): UrlAdapter {
  return {
    read(): string | null {
      return new URLSearchParams(win.location.search).get(AT_PARAM);
    },
    write(value: string | null): void {
      const params = new URLSearchParams(win.location.search);
      if (value === null) params.delete(AT_PARAM);
      else params.set(AT_PARAM, value);
      const query = params.toString();
      const url = `${win.location.pathname}${query ? `?${query}` : ""}${win.location.hash}`;
      win.history.replaceState(null, "", url);
    },
    subscribe(cb: () => void): () => void {
      win.addEventListener("popstate", cb);
      return () => win.removeEventListener("popstate", cb);
    },
  };
}

export type ConnectUrlOptions = {
  /** Trailing debounce for writes while dragging. Default 250 ms. */
  debounceMs?: number;
};

/**
 * Wire a cursor store to a URL adapter. On connect the URL wins: a valid
 * `?at` freezes the cursor there, anything else means live. Afterwards the
 * store drives the URL (debounced), and external navigation drives the store.
 * Returns a disconnect function that cancels any pending write.
 */
export function connectTimeCursorToUrl(
  store: TimeCursorStore,
  adapter: UrlAdapter,
  options: ConnectUrlOptions = {},
): () => void {
  const debounceMs = options.debounceMs ?? 250;
  let pending: ReturnType<typeof setTimeout> | null = null;

  function applyFromUrl(): void {
    const parsed = decodeAt(adapter.read());
    if (parsed) store.setAt(parsed);
    else store.setLive();
  }

  function flush(): void {
    pending = null;
    const desired = store.isLive ? null : encodeAt(store.now());
    // Skipping identical writes also absorbs the echo after applyFromUrl and
    // keeps live-mode ticks from touching the URL at all.
    if (desired !== adapter.read()) adapter.write(desired);
  }

  function onStoreChange(): void {
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(flush, debounceMs);
  }

  applyFromUrl();
  const unsubscribeStore = store.subscribe(onStoreChange);
  const unsubscribeUrl = adapter.subscribe?.(applyFromUrl);

  return () => {
    if (pending !== null) clearTimeout(pending);
    pending = null;
    unsubscribeStore();
    unsubscribeUrl?.();
  };
}
