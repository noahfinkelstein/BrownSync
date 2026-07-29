import { useSyncExternalStore } from "react";
import { type TimeCursorStore, timeCursor } from "./cursor";

/**
 * React binding for the time cursor. Subscribes the component to cursor
 * changes (scrubs, live ticks, mode switches) and hands back the store —
 * read `store.now()` / `store.isLive` during render, they are consistent
 * with the subscription.
 *
 *   const cursor = useTimeCursor();
 *   const visible = events.filter((e) => cursor.isWithin(e.start, e.end));
 *
 * Non-React consumers (deck.gl layer updaters, the map GeoJSON filter)
 * subscribe to the `timeCursor` singleton directly.
 */
export function useTimeCursor(store: TimeCursorStore = timeCursor): TimeCursorStore {
  useSyncExternalStore(store.subscribe, store.version, store.version);
  return store;
}
