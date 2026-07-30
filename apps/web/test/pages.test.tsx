// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setCursorSource } from "../src/data/cursor";
import { usePlaceWeekEvents } from "../src/data/places";
import { OrgPage } from "../src/pages/OrgPage";
import { PlacePage } from "../src/pages/PlacePage";
import { router } from "../src/router";
import { createTimeCursor } from "../src/time";
import { MEETINGS, mkEvent, ORGS, PLACES } from "./helpers/fixtures";
import { createServer, resetSeenRequests } from "./helpers/msw";
import { makeQueryClient, renderWithHarness, stubScrolling } from "./helpers/render";

/**
 * Route-level tests against the REAL router (src/router.tsx): /p/$id and
 * /o/$id must be registered and pass their params into the pages. The index
 * route (MapView/WebGL) is never rendered here.
 */

const server = createServer();
beforeAll(() => {
  stubScrolling();
  server.listen({ onUnhandledRequest: "error" });
});
beforeEach(() => resetSeenRequests());
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

async function renderApp(path: string) {
  // The app router is a singleton; point it at the test location and reload
  // the matches before mounting.
  router.update({ history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function queryParam(url: URL | null, name: string): string | null {
  return url?.searchParams.get(name) ?? null;
}

describe("/p/$id — place page (handoff §3.3)", () => {
  it("shows cursor-date library hours on a matching place page", async () => {
    const cursor = createTimeCursor();
    cursor.setAt(new Date("2026-07-29T16:00:00.000Z"));
    setCursorSource(cursor);

    server.use(
      http.get("*/api/places/:id/activity", () =>
        HttpResponse.json({
          place: {
            id: "john-d-rockefeller-jr-library",
            name: "John D. Rockefeller Jr. Library",
            aliases: ["The Rock"],
            kind: "library",
            lat: 41.8257,
            lng: -71.4051,
            address: "10 Prospect Street",
          },
          events: [],
          meetings: [],
        }),
      ),
      http.get("*/api/events", () => HttpResponse.json({ events: [] })),
      http.get("*/data/campus-amenities.geojson", () =>
        HttpResponse.json({ type: "FeatureCollection", features: [] }),
      ),
      http.get("*/data/library-hours.json", () =>
        HttpResponse.json({
          schema_version: 1,
          generated_at: "2026-07-29T21:39:49.185560-04:00",
          attribution: "Brown University Library",
          libraries: [
            {
              id: "rock",
              name: "Rockefeller Library",
              placeId: "john-d-rockefeller-jr-library",
              hours: [
                {
                  date: "2026-07-29",
                  open: "2026-07-29T08:00:00-04:00",
                  close: "2026-07-29T21:00:00-04:00",
                  note: null,
                },
              ],
            },
          ],
        }),
      ),
    );

    renderWithHarness(<PlacePage id="john-d-rockefeller-jr-library" renderMiniMap={() => null} />);

    await screen.findByRole("heading", { name: "Library hours" });
    await screen.findByText("Rockefeller Library");
    await screen.findByText("08:00–21:00");
  });

  it("renders header, aliases, in-session courses, and the week timeline", async () => {
    await renderApp("/p/salomon-center");
    await screen.findByRole("heading", { name: "Salomon Center" });
    // kind badge + aliases line (mono).
    await screen.findByText("academic");
    await screen.findByText("Salomon · Salomon Center for Teaching");
    await screen.findByText("79 Waterman St");
    // Mini-map placeholder seam: mono coords.
    await screen.findByText("41.8262 · -71.4032");
    // Activity: course meetings table rows for this place only.
    await screen.findByRole("table", { name: "Courses in session" });
    expect(screen.getAllByText("CSCI 0150").length).toBeGreaterThan(0);
    expect(screen.queryByText("MATH 0100")).toBeNull();
    // Events at the place.
    await screen.findByText("Salomon Lecture: Quantum Computing");
    // Back seam to the map.
    expect(screen.getByRole("link", { name: "← map" }).getAttribute("href")).toBe("/");
  });

  it("param flows through: a different id loads a different place", async () => {
    await renderApp("/p/sayles-hall");
    await screen.findByRole("heading", { name: "Sayles Hall" });
    await screen.findByText("MATH 0100");
    expect(screen.queryByText("CSCI 0150")).toBeNull();
  });

  it("loads place activity at the shared time cursor", async () => {
    const at = new Date("2026-09-16T14:30:00.000Z");
    const cursor = createTimeCursor();
    cursor.setAt(at);
    setCursorSource(cursor);
    let requestedAt: string | null = null;
    let requestedWeekUrl: URL | null = null;
    const endedLastNight = mkEvent({
      id: "ended-last-night",
      title: "Ended last night",
      start: "2026-09-15T21:00:00.000Z",
      end: "2026-09-15T22:00:00.000Z",
      placeId: "salomon-center",
      placeName: "Salomon Center",
    });

    server.use(
      http.get("*/api/places/:id/activity", ({ params, request }) => {
        const place = PLACES.find((candidate) => candidate.id === params.id);
        if (!place) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        requestedAt = new URL(request.url).searchParams.get("at");
        return HttpResponse.json({
          place,
          events: [],
          meetings:
            requestedAt === at.toISOString()
              ? MEETINGS.filter((meeting) => meeting.placeId === place.id)
              : [],
        });
      }),
      http.get("*/api/events", ({ request }) => {
        requestedWeekUrl = new URL(request.url);
        return HttpResponse.json({ events: [endedLastNight] });
      }),
    );

    await renderApp("/p/salomon-center");
    await screen.findByRole("heading", { name: "Salomon Center" });
    expect(requestedAt).toBe(at.toISOString());
    expect(queryParam(requestedWeekUrl, "from")).toBe("2026-09-16T02:00:00.000Z");
    expect(queryParam(requestedWeekUrl, "to")).toBe("2026-09-24T02:00:00.000Z");
    await screen.findByRole("table", { name: "Courses in session" });
    expect(screen.getAllByText("CSCI 0150").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ended last night")).toBeNull();
  });

  it("shares one cursor-window fetch while filtering each place independently", async () => {
    const cursor = new Date("2026-09-16T14:30:00.000Z");
    const salomonEvent = mkEvent({
      id: "week-salomon",
      title: "Salomon week event",
      start: "2026-09-18T18:00:00.000Z",
      placeId: "salomon-center",
      placeName: "Salomon Center",
    });
    const saylesEvent = mkEvent({
      id: "week-sayles",
      title: "Sayles week event",
      start: "2026-09-19T18:00:00.000Z",
      placeId: "sayles-hall",
      placeName: "Sayles Hall",
    });
    let requests = 0;
    let requestedUrl: URL | null = null;
    server.use(
      http.get("*/api/events", ({ request }) => {
        requests += 1;
        requestedUrl = new URL(request.url);
        return HttpResponse.json({ events: [salomonEvent, saylesEvent] });
      }),
    );

    function PlaceWeekProbe({ id }: { id: string }) {
      const week = usePlaceWeekEvents(id, cursor);
      return (
        <section data-testid={`week-${id}`}>
          {(week.data ?? []).map((event) => (
            <span key={event.id}>{event.title}</span>
          ))}
        </section>
      );
    }

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <PlaceWeekProbe id="salomon-center" />
        <PlaceWeekProbe id="sayles-hall" />
      </QueryClientProvider>,
    );

    const salomon = screen.getByTestId("week-salomon-center");
    const sayles = screen.getByTestId("week-sayles-hall");
    await within(salomon).findByText("Salomon week event");
    await within(sayles).findByText("Sayles week event");
    expect(within(salomon).queryByText("Sayles week event")).toBeNull();
    expect(within(sayles).queryByText("Salomon week event")).toBeNull();
    expect(requests).toBe(1);
    expect(queryParam(requestedUrl, "from")).toBe("2026-09-16T02:00:00.000Z");
    expect(queryParam(requestedUrl, "to")).toBe("2026-09-24T02:00:00.000Z");
  });

  it("404s get the designed empty state, not a crash", async () => {
    await renderApp("/p/definitely-not-a-building");
    await screen.findByText("No such place");
    await screen.findByText(/definitely-not-a-building/);
  });
});

describe("/o/$id — org page (handoff §3.4)", () => {
  it("renders club info, links, upcoming and past timelines", async () => {
    await renderApp("/o/brown-outing-club");
    await screen.findByRole("heading", { name: "Brown Outing Club" });
    await screen.findByText(/Hiking, climbing, and paddling/);
    // kind badge.
    await screen.findByText("club");
    // Links out.
    const website = await screen.findByRole("link", { name: /website/ });
    expect(website.getAttribute("href")).toBe("https://brownoutingclub.example.edu");
    const insta = screen.getByRole("link", { name: /@brownoutingclub/ });
    expect(insta.getAttribute("href")).toBe("https://instagram.com/brownoutingclub");
    // Upcoming + past.
    await screen.findByText("Outing Club GBM");
    await screen.findByText("Fall Break Camping Trip Info Session");
  });

  it("loads and labels organization events at the shared time cursor", async () => {
    const cursor = createTimeCursor();
    cursor.setAt(new Date("2026-09-16T14:32:00.000Z"));
    setCursorSource(cursor);
    const upcoming = mkEvent({
      id: "cursor-org-event",
      title: "Cursor-relative org event",
      start: "2026-09-16T15:32:00.000Z",
      orgId: "brown-outing-club",
      orgName: "Brown Outing Club",
    });
    let requestedUrl: URL | null = null;
    server.use(
      http.get("*/api/orgs/:id", ({ request }) => {
        requestedUrl = new URL(request.url);
        return HttpResponse.json({
          ...ORGS[0],
          upcoming: [upcoming],
          past: [],
        });
      }),
    );

    renderWithHarness(<OrgPage id="brown-outing-club" />);
    await screen.findByText("Cursor-relative org event");
    expect(queryParam(requestedUrl, "at")).toBe("2026-09-16T14:30:00.000Z");
    await screen.findByText("in 1 h");
  });

  it("normalizes scheme-less organization links", async () => {
    server.use(
      http.get("*/api/orgs/:id", () =>
        HttpResponse.json({
          ...ORGS[0],
          url: "brownoutingclub.com",
          instagram: "instagram.com/brownoutingclub",
          upcoming: [],
          past: [],
        }),
      ),
    );

    renderWithHarness(<OrgPage id="brown-outing-club" />);
    expect((await screen.findByRole("link", { name: /website/ })).getAttribute("href")).toBe(
      "https://brownoutingclub.com",
    );
    expect(screen.getByRole("link", { name: /@brownoutingclub/ }).getAttribute("href")).toBe(
      "https://instagram.com/brownoutingclub",
    );
  });

  it("does not render organization links with non-web schemes", async () => {
    server.use(
      http.get("*/api/orgs/:id", () =>
        HttpResponse.json({
          ...ORGS[0],
          url: "mailto:club@brown.edu",
          instagram: "#",
          upcoming: [],
          past: [],
        }),
      ),
    );

    renderWithHarness(<OrgPage id="brown-outing-club" />);
    await screen.findByRole("heading", { name: "Brown Outing Club" });
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: /website/ })).toBeNull();
      expect(screen.queryByRole("link", { name: /^@/ })).toBeNull();
    });
  });

  it("unknown org id gets the designed empty state", async () => {
    await renderApp("/o/club-that-never-was");
    await screen.findByText("No such organization");
  });
});

describe("router-level §6.4 states (lazy chunks + unrouted URLs)", () => {
  it("unrouted URLs render the designed not-found state with a way back to the map", async () => {
    await renderApp("/definitely/not/a/route");
    await screen.findByText("Nothing lives at this address");
    await screen.findByText("/definitely/not/a/route");
    const back = screen.getByRole("link", { name: "← back to the map" });
    expect(back.getAttribute("href")).toBe("/");
  });

  it("both lazy profile routes declare a pending skeleton; the router carries backstops", () => {
    // The profile pages are lazy route chunks (P3B): the pendingComponent is
    // the Suspense fallback that paints while the chunk downloads. Without
    // it, navigation renders literally nothing — pin the wiring.
    expect(router.routesById["/p/$id"].options.pendingComponent).toBeDefined();
    expect(router.routesById["/o/$id"].options.pendingComponent).toBeDefined();
    expect(router.options.defaultPendingComponent).toBeDefined();
    // Loader-pending timing convention: no flash-and-swap on fast loads.
    expect(router.options.defaultPendingMs).toBe(300);
    expect(router.options.defaultPendingMinMs).toBe(300);
  });
});
