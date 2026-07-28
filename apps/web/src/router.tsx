import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { App } from "./App";
import { MapView } from "./map/MapView";

/**
 * Single index route in Phase 1: the full-bleed map. Phase 2 H adds
 * `/p/:id`, `/o/:id`, `/dev/ui`, `/health` as siblings under the root.
 */

const rootRoute = createRootRoute({ component: App });

function IndexScreen() {
  return <MapView />;
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexScreen,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
