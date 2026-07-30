import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTimeCursor } from "../src/time/cursor";
import { createRouterUrlAdapter } from "../src/time/routerUrlAdapter";
import {
  connectTimeCursorToUrl,
  createHistoryUrlAdapter,
  decodeAt,
  encodeAt,
  type HistoryWindowLike,
  type UrlAdapter,
} from "../src/time/urlSync";

const T0 = new Date("2026-07-28T14:00:00.000Z");
const DEBOUNCE = 250;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

type FakeAdapter = UrlAdapter & {
  writes: (string | null)[];
  /** Simulate external navigation (back/forward). */
  emit(value: string | null): void;
};

type RouterSearch = Record<string, unknown>;

function fakeRouter(initialSearch: RouterSearch = {}) {
  const listeners = new Set<(event: unknown) => void>();
  const historyListeners = new Set<(event: unknown) => void>();
  const pending: Array<{ search: RouterSearch; finish: () => void }> = [];
  const searchString = (search: RouterSearch): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const query = params.toString();
    return query ? `?${query}` : "";
  };
  const router = {
    state: { location: { search: initialSearch } },
    history: {
      location: { search: searchString(initialSearch) },
      subscribe(listener: (event: unknown) => void): () => void {
        historyListeners.add(listener);
        return () => historyListeners.delete(listener);
      },
    },
    navigate(options: { search: (previous: RouterSearch) => RouterSearch }): Promise<void> {
      const search = options.search(router.state.location.search);
      router.state.location.search = search;
      router.history.location.search = searchString(search);
      for (const listener of historyListeners) {
        listener({ action: { type: "REPLACE" }, location: router.history.location });
      }
      let finish = () => {};
      const navigation = new Promise<void>((resolve) => {
        finish = resolve;
      });
      pending.push({ search, finish });
      return navigation;
    },
    subscribe(_event: "onResolved", listener: (event: unknown) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async resolveOwn(index = 0): Promise<void> {
      const navigation = pending[index];
      if (!navigation) throw new Error(`missing pending navigation ${index}`);
      // TanStack's navigate promise can resolve before React's Transitioner
      // emits onResolved in a later layout effect.
      navigation.finish();
      await Promise.resolve();
      for (const listener of listeners) {
        listener({ type: "onResolved", toLocation: { search: navigation.search } });
      }
    },
    emitExternal(search: RouterSearch, action = "BACK"): void {
      router.state.location.search = search;
      router.history.location.search = searchString(search);
      for (const listener of historyListeners) {
        listener({ action: { type: action }, location: router.history.location });
      }
      for (const listener of listeners) {
        listener({ type: "onResolved", toLocation: { search } });
      }
    },
  };
  return router;
}

function fakeAdapter(initial: string | null = null): FakeAdapter {
  let value = initial;
  const listeners = new Set<() => void>();
  const writes: (string | null)[] = [];
  return {
    writes,
    read: () => value,
    write(v) {
      value = v;
      writes.push(v);
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit(v) {
      value = v;
      for (const cb of listeners) cb();
    },
  };
}

describe("encodeAt / decodeAt", () => {
  it("encodes minute-precision instants without seconds", () => {
    expect(encodeAt(new Date("2026-07-28T19:04:00.000Z"))).toBe("2026-07-28T19:04Z");
  });

  it("keeps seconds when they are nonzero", () => {
    expect(encodeAt(new Date("2026-07-28T19:04:30.000Z"))).toBe("2026-07-28T19:04:30Z");
  });

  it("round-trips exactly", () => {
    for (const iso of ["2026-07-28T19:04:00.000Z", "2026-11-01T05:30:00.000Z"]) {
      const d = new Date(iso);
      expect(decodeAt(encodeAt(d))?.getTime()).toBe(d.getTime());
    }
  });

  it("decodes null/empty/garbage to null", () => {
    expect(decodeAt(null)).toBeNull();
    expect(decodeAt("")).toBeNull();
    expect(decodeAt("not-a-date")).toBeNull();
  });
});

describe("connectTimeCursorToUrl — mount", () => {
  it("a valid ?at freezes the cursor there", () => {
    const store = createTimeCursor();
    const adapter = fakeAdapter("2026-07-28T21:30Z");
    connectTimeCursorToUrl(store, adapter);

    expect(store.isLive).toBe(false);
    expect(store.now().toISOString()).toBe("2026-07-28T21:30:00.000Z");
  });

  it("no param or a garbage param means live", () => {
    for (const initial of [null, "garbage"]) {
      const store = createTimeCursor();
      store.setAt(new Date("2026-07-28T09:00:00Z")); // pre-frozen; URL wins
      connectTimeCursorToUrl(store, fakeAdapter(initial));
      expect(store.isLive).toBe(true);
    }
  });

  it("mount does not echo a write back to the URL", () => {
    const adapter = fakeAdapter("2026-07-28T21:30Z");
    connectTimeCursorToUrl(createTimeCursor(), adapter);
    vi.advanceTimersByTime(DEBOUNCE * 4);
    expect(adapter.writes).toEqual([]);
  });
});

describe("connectTimeCursorToUrl — store drives URL (debounced)", () => {
  it("writes the scrubbed instant after the debounce", () => {
    const store = createTimeCursor();
    const adapter = fakeAdapter();
    connectTimeCursorToUrl(store, adapter);

    store.setAt(new Date("2026-07-28T21:30:00Z"));
    expect(adapter.writes).toEqual([]); // not yet — debounced
    vi.advanceTimersByTime(DEBOUNCE);
    expect(adapter.writes).toEqual(["2026-07-28T21:30Z"]);
  });

  it("collapses a drag into a single trailing write", () => {
    const store = createTimeCursor();
    const adapter = fakeAdapter();
    connectTimeCursorToUrl(store, adapter);

    store.setAt(new Date("2026-07-28T20:00:00Z"));
    vi.advanceTimersByTime(100);
    store.setAt(new Date("2026-07-28T20:15:00Z"));
    vi.advanceTimersByTime(100);
    store.setAt(new Date("2026-07-28T20:30:00Z"));
    vi.advanceTimersByTime(DEBOUNCE);

    expect(adapter.writes).toEqual(["2026-07-28T20:30Z"]);
  });

  it("returning to live removes the param", () => {
    const store = createTimeCursor();
    const adapter = fakeAdapter("2026-07-28T21:30Z");
    connectTimeCursorToUrl(store, adapter);

    store.setLive();
    vi.advanceTimersByTime(DEBOUNCE);
    expect(adapter.writes).toEqual([null]);
    expect(adapter.read()).toBeNull();
  });

  it("live ticks never touch the URL", () => {
    const store = createTimeCursor();
    const adapter = fakeAdapter();
    connectTimeCursorToUrl(store, adapter);

    vi.advanceTimersByTime(10 * 60_000); // many live ticks
    expect(adapter.writes).toEqual([]);
  });

  it("round-trips: scrub → URL → fresh store reads the same instant", () => {
    const store = createTimeCursor();
    const adapter = fakeAdapter();
    connectTimeCursorToUrl(store, adapter);

    const scrubbed = new Date("2026-07-30T01:15:00Z");
    store.setAt(scrubbed);
    vi.advanceTimersByTime(DEBOUNCE);

    const restored = createTimeCursor();
    connectTimeCursorToUrl(restored, adapter);
    expect(restored.isLive).toBe(false);
    expect(restored.now().getTime()).toBe(scrubbed.getTime());
  });
});

describe("connectTimeCursorToUrl — URL drives store", () => {
  it("external navigation scrubs the cursor", () => {
    const store = createTimeCursor();
    const adapter = fakeAdapter();
    connectTimeCursorToUrl(store, adapter);

    adapter.emit("2026-07-29T02:00Z");
    expect(store.isLive).toBe(false);
    expect(store.now().toISOString()).toBe("2026-07-29T02:00:00.000Z");

    vi.advanceTimersByTime(DEBOUNCE * 4); // no echo write
    expect(adapter.writes).toEqual([]);
  });

  it("external navigation back to a bare URL returns to live", () => {
    const store = createTimeCursor();
    const adapter = fakeAdapter("2026-07-29T02:00Z");
    connectTimeCursorToUrl(store, adapter);

    adapter.emit(null);
    expect(store.isLive).toBe(true);
  });
});

describe("createRouterUrlAdapter", () => {
  it("suppresses a delayed echo from its own write without swallowing external navigation", async () => {
    const router = fakeRouter();
    const adapter = createRouterUrlAdapter(router as never);
    const store = createTimeCursor();
    connectTimeCursorToUrl(store, adapter);

    const first = new Date("2026-07-28T20:15:00Z");
    const newer = new Date("2026-07-29T20:15:00Z");
    store.setAt(first);
    vi.advanceTimersByTime(DEBOUNCE);
    expect(adapter.read()).toBe("2026-07-28T20:15Z");

    // The user steps again before the router finishes resolving the first
    // debounced write. Its delayed onResolved event must not rewind the store.
    store.setAt(newer);
    await router.resolveOwn();
    expect(store.now().getTime()).toBe(newer.getTime());

    // A genuine navigation still owns the cursor.
    router.emitExternal({ at: "2026-07-31T08:00Z" });
    expect(store.now().toISOString()).toBe("2026-07-31T08:00:00.000Z");
  });

  it("applies unrelated in-app replacements that remove the cursor parameter", () => {
    const router = fakeRouter({ at: "2026-07-28T20:15Z" });
    const store = createTimeCursor();
    connectTimeCursorToUrl(store, createRouterUrlAdapter(router as never));
    expect(store.isLive).toBe(false);

    router.emitExternal({ event: "fixture-event" }, "REPLACE");
    expect(store.isLive).toBe(true);
  });
});

describe("connectTimeCursorToUrl — disconnect", () => {
  it("cancels the pending write and detaches from the store", () => {
    const store = createTimeCursor();
    const adapter = fakeAdapter();
    const disconnect = connectTimeCursorToUrl(store, adapter);

    store.setAt(new Date("2026-07-28T21:30:00Z"));
    disconnect();
    vi.advanceTimersByTime(DEBOUNCE * 4);
    expect(adapter.writes).toEqual([]);

    store.setAt(new Date("2026-07-28T22:00:00Z"));
    vi.advanceTimersByTime(DEBOUNCE * 4);
    expect(adapter.writes).toEqual([]);
  });
});

describe("createHistoryUrlAdapter", () => {
  function fakeWindow(initialSearch: string): HistoryWindowLike & {
    replacedUrls: string[];
    popstateListeners: Set<() => void>;
  } {
    const replacedUrls: string[] = [];
    const popstateListeners = new Set<() => void>();
    const win = {
      location: { pathname: "/map", search: initialSearch, hash: "#h" },
      history: {
        replaceState(_data: unknown, _unused: string, url: string) {
          replacedUrls.push(url);
          const u = new URL(url, "http://local");
          win.location.pathname = u.pathname;
          win.location.search = u.search;
          win.location.hash = u.hash;
        },
      },
      addEventListener(_type: "popstate", cb: () => void) {
        popstateListeners.add(cb);
      },
      removeEventListener(_type: "popstate", cb: () => void) {
        popstateListeners.delete(cb);
      },
      replacedUrls,
      popstateListeners,
    };
    return win;
  }

  it("reads ?at from the query string", () => {
    const win = fakeWindow("?x=1&at=2026-07-28T21%3A30Z");
    expect(createHistoryUrlAdapter(win).read()).toBe("2026-07-28T21:30Z");
    expect(createHistoryUrlAdapter(fakeWindow("?x=1")).read()).toBeNull();
  });

  it("writes via replaceState, preserving other params and the hash", () => {
    const win = fakeWindow("?x=1");
    const adapter = createHistoryUrlAdapter(win);

    adapter.write("2026-07-28T21:30Z");
    expect(win.replacedUrls).toHaveLength(1);
    expect(win.location.search).toContain("x=1");
    expect(adapter.read()).toBe("2026-07-28T21:30Z");
    expect(win.replacedUrls[0]).toContain("#h");

    adapter.write(null);
    expect(adapter.read()).toBeNull();
    expect(win.location.search).toBe("?x=1");
  });

  it("drops the query string entirely when the last param is removed", () => {
    const win = fakeWindow("?at=2026-07-28T21%3A30Z");
    const adapter = createHistoryUrlAdapter(win);
    adapter.write(null);
    expect(win.replacedUrls[0]).toBe("/map#h");
  });

  it("subscribes to popstate and unsubscribes cleanly", () => {
    const win = fakeWindow("");
    const adapter = createHistoryUrlAdapter(win);
    let fired = 0;
    const unsub = adapter.subscribe?.(() => {
      fired += 1;
    });
    expect(win.popstateListeners.size).toBe(1);
    for (const cb of win.popstateListeners) cb();
    expect(fired).toBe(1);
    unsub?.();
    expect(win.popstateListeners.size).toBe(0);
  });
});
