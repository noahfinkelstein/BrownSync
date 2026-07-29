import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { App } from "./App";
import { IndexPage } from "./pages/IndexPage";

/**
 * Routes: `/` the composed live-map screen (map + list split pane, lanes
 * F+H), `/p/$id` place page and `/o/$id` org page (Phase 2 H). `/dev/ui`
 * and `/health` are still to come.
 *
 * Perf (Phase 3 P3B): the profile pages are route-level lazy chunks so the
 * default screen never downloads them; the index route stays eager — it IS
 * the app.
 */

const PlacePage = lazyRouteComponent(() => import("./pages/PlacePage"), "PlacePage");
const OrgPage = lazyRouteComponent(() => import("./pages/OrgPage"), "OrgPage");

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
