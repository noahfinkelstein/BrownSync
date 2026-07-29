import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { AppHeader } from "./panels/Header";

/**
 * Root shell (Phase 2 F): header bar with the reserved lane slots on top,
 * routed content below. The map screen itself is `src/map/LiveMap.tsx` —
 * the router's index route mounts it (lane H owns router.tsx; see
 * integration notes).
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
      </div>
    </QueryClientProvider>
  );
}
