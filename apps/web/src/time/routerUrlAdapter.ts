import type { AnyRouter } from "@tanstack/react-router";
import { AT_PARAM, type UrlAdapter } from "./urlSync";

/**
 * TanStack-Router-backed `UrlAdapter` (integration wiring). The history
 * adapter would fight the router: raw `replaceState` writes bypass the
 * router's location model, so the next `navigate({ search: prev => … })`
 * (e.g. lane H's `?cats=` chips) would drop `?at=` — and back/forward would
 * resurrect stale cursors. Routing every read/write through the router keeps
 * `?at=` and `?cats=` composable in one URL.
 */
export function createRouterUrlAdapter(router: AnyRouter): UrlAdapter {
  return {
    read(): string | null {
      const search = router.state.location.search as Record<string, unknown>;
      const value = search[AT_PARAM];
      return typeof value === "string" && value !== "" ? value : null;
    },
    write(value: string | null): void {
      void router.navigate({
        to: ".",
        replace: true,
        resetScroll: false,
        // Functional update preserves sibling params (?cats= from lane H, …).
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          [AT_PARAM]: value ?? undefined,
        }),
      } as never);
    },
    subscribe(cb: () => void): () => void {
      // Fires on every resolved navigation, including this adapter's own
      // writes — connectTimeCursorToUrl absorbs the echo (identical values
      // no-op in both directions).
      return router.subscribe("onResolved", cb);
    },
  };
}
