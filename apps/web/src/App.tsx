import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { AppHeader } from "./panels/Header";
import { TimeMachineDock } from "./time/TimeMachineDock";

/**
 * Root shell (Phase 2 F): header bar on top, routed content in the middle,
 * the time machine docked full-width at the bottom. The map screen itself is
 * `src/map/LiveMap.tsx` — the router's index route mounts it (lane H owns
 * router.tsx; see integration notes).
 *
 * The dock is shell-level, not index-level, because the cursor is global:
 * the place and org pages list events at the same cursor, and mounting the
 * scrubber per-route would tear it down and re-anchor its 14-day window on
 * every navigation.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-dvh w-full flex-col overflow-hidden bg-bg-base text-text-primary">
        <AppHeader />
        <main className="relative min-h-0 grow">
          <Outlet />
        </main>
        <TimeMachineDock />
      </div>
    </QueryClientProvider>
  );
}
