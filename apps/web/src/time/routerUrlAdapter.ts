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
  // A router REPLACE triggered by this adapter is a write-only echo. Track
  // its target value so the synchronous history notification cannot feed an
  // older URL back into a cursor that the user has already moved again.
  const ownWritesInFlight = new Map<string | null, number>();

  function read(): string | null {
    return new URLSearchParams(router.history.location.search).get(AT_PARAM);
  }

  function addOwnWrite(value: string | null): void {
    ownWritesInFlight.set(value, (ownWritesInFlight.get(value) ?? 0) + 1);
  }

  function consumeOwnWrite(value: string | null): boolean {
    const count = ownWritesInFlight.get(value) ?? 0;
    if (count === 0) return false;
    if (count === 1) ownWritesInFlight.delete(value);
    else ownWritesInFlight.set(value, count - 1);
    return true;
  }

  return {
    read,
    write(value: string | null): void {
      addOwnWrite(value);
      let navigation: Promise<void>;
      try {
        navigation = router.navigate({
          to: ".",
          replace: true,
          resetScroll: false,
          // Functional update preserves sibling params (?cats= from lane H, …).
          search: (prev: Record<string, unknown>) => ({
            ...prev,
            [AT_PARAM]: value ?? undefined,
          }),
        } as never);
      } catch (error) {
        consumeOwnWrite(value);
        throw error;
      }
      // Successful router navigations notify history before their promise
      // resolves. A rejected/superseded write may never notify, so disarm it.
      void Promise.resolve(navigation).catch(() => {
        consumeOwnWrite(value);
      });
    },
    subscribe(cb: () => void): () => void {
      // Do not blanket-ignore PUSH/REPLACE: another in-app navigation may
      // intentionally remove or change `at`, and the URL must still own the
      // cursor. Suppress only the matching REPLACE initiated by write().
      return router.history.subscribe(({ action }: { action: { type: string } }) => {
        if (action.type === "REPLACE" && consumeOwnWrite(read())) return;
        cb();
      });
    },
  };
}
