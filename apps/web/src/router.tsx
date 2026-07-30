import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { App } from "./App";
import { IndexPage } from "./pages/IndexPage";
import { NotFoundScreen, ProfilePagePending, RoutePendingFallback } from "./pages/routeStates";

/**
 * Routes: `/` the composed live-map screen (map + list split pane, lanes
 * F+H), `/p/$id` place page and `/o/$id` org page (Phase 2 H). `/dev/ui`
 * and `/health` are still to come.
 *
 * Perf (Phase 3 P3B): the profile pages are route-level lazy chunks so the
 * default screen never downloads them; the index route stays eager — it IS
 * the app. Every lazy route declares a §6.4 pendingComponent (chunk loads
 * suspend into it) and the router carries a themed backstop + not-found —
 * navigation never paints an undesigned blank.
 */

const PlacePage = lazyRouteComponent(() => import("./pages/PlacePage"), "PlacePage");
const OrgPage = lazyRouteComponent(() => import("./pages/OrgPage"), "OrgPage");
// Directories are route-level lazy chunks: the map screen is the front door
// and must not pay for them, but they are the answer to "the map is the only
// way to interact with the info".
const EventsDirectory = lazyRouteComponent(
  () => import("./events/EventsDirectory"),
  "EventsDirectory",
);
const ClubsDirectory = lazyRouteComponent(() => import("./orgs/ClubsDirectory"), "ClubsDirectory");

const rootRoute = createRootRoute({ component: App, notFoundComponent: NotFoundScreen });

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
  pendingComponent: ProfilePagePending,
});

function OrgScreen() {
  const { id } = orgRoute.useParams();
  return <OrgPage id={id} />;
}

const orgRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/o/$id",
  component: OrgScreen,
  pendingComponent: ProfilePagePending,
});

function EventsScreen() {
  return <EventsDirectory />;
}

const eventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events",
  component: EventsScreen,
  pendingComponent: RoutePendingFallback,
});

function ClubsScreen() {
  return <ClubsDirectory />;
}

const clubsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clubs",
  component: ClubsScreen,
  pendingComponent: RoutePendingFallback,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  placeRoute,
  orgRoute,
  eventsRoute,
  clubsRoute,
]);

export const router = createRouter({
  routeTree,
  // Backstop pending for any route that forgets its own design (§6.4).
  defaultPendingComponent: RoutePendingFallback,
  // Loader-driven pendings: appear only past 300 ms, and once shown hold for
  // 300 ms — no flash-and-swap on fast loads. (Chunk-load Suspense fallbacks
  // get the same guarantee from the bs-route-pending CSS delay instead.)
  defaultPendingMs: 300,
  defaultPendingMinMs: 300,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
