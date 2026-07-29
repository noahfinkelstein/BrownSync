// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { router } from "../src/router";
import { createServer, resetSeenRequests } from "./helpers/msw";
import { makeQueryClient, stubScrolling } from "./helpers/render";

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

describe("/p/$id — place page (handoff §3.3)", () => {
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
