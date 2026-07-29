import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { App } from "./App";
import { IndexPage } from "./pages/IndexPage";
import { OrgPage } from "./pages/OrgPage";
import { PlacePage } from "./pages/PlacePage";

/**
 * Routes: `/` the composed live-map screen (map + list split pane, lanes
 * F+H), `/p/$id` place page and `/o/$id` org page (Phase 2 H). `/dev/ui`
 * and `/health` are still to come.
 */

const rootRoute = createRootRoute({ component: App });

function IndexScreen() {
  return <IndexPage />;
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexScreen,
});

function PlaceScreen() {
  const { id } = placeRoute.useParams();
  return <PlacePage id={id} />;
}

const placeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$id",
  component: PlaceScreen,
});

function OrgScreen() {
  const { id } = orgRoute.useParams();
  return <OrgPage id={id} />;
}

const orgRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/o/$id",
  component: OrgScreen,
});

const routeTree = rootRoute.addChildren([indexRoute, placeRoute, orgRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
