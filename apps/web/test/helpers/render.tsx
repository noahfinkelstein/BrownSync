import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** jsdom lacks scrollIntoView + ResizeObserver (cmdk) and scrollTo (router). */
export function stubScrolling(): void {
  Element.prototype.scrollIntoView = () => {};
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
  }
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/**
 * Router harness: mounts `ui` at the root of a memory router with probe
 * routes for `/`, `/p/$id`, `/o/$id`, so palette/chips tests can assert
 * navigation without booting MapView (WebGL) or the real pages.
 */
export function renderWithHarness(ui: ReactNode, opts: { path?: string } = {}) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        {ui}
        <Outlet />
      </>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const placeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$id",
    component: () => <div data-testid="place-probe" />,
  });
  const orgRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/o/$id",
    component: () => <div data-testid="org-probe" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, placeRoute, orgRoute]),
    history: createMemoryHistory({ initialEntries: [opts.path ?? "/"] }),
  });
  const queryClient = makeQueryClient();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}

/** Current search params of a harness router, loosely typed for asserts. */
export function searchOf(router: { state: { location: { search: unknown } } }) {
  return router.state.location.search as Record<string, unknown>;
}
