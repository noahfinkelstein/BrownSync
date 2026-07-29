// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ListView } from "../src/browse/ListView";
import { createViewportSource } from "../src/browse/viewport";
import { mkEvent } from "./helpers/fixtures";
import { createServer, resetSeenRequests, seenRequests } from "./helpers/msw";
import { renderWithHarness, stubScrolling } from "./helpers/render";

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

/** Deterministic clock: an afternoon so every bucket is reachable. */
const NOW = new Date(2026, 6, 28, 15, 0);
const clock = () => NOW;

function iso(hours: number, minutes = 0, dayOffset = 0): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

const LIST_EVENTS = [
  mkEvent({ id: "l-live", title: "Poster session", start: iso(14, 30), end: iso(16, 0) }),
  mkEvent({ id: "l-soon", title: "Tea time", start: iso(15, 40), category: "food" }),
  mkEvent({
    id: "l-tonight",
    title: "A cappella showcase",
    start: iso(19, 0),
    category: "arts",
    placeId: "sayles-hall",
    placeName: "Sayles Hall",
  }),
  mkEvent({ id: "l-tmw", title: "Farmers market", start: iso(11, 0, 1), category: "food" }),
];

function useListHandlers() {
  server.use(
    http.get("*/api/events", ({ request }) => {
      seenRequests.push(new URL(request.url));
      return HttpResponse.json({ events: LIST_EVENTS });
    }),
  );
}

describe("ListView (viewport-synced, grouped by time — §3.2, §6.4)", () => {
  it("groups viewport events under time headings, timeline rows not cards", async () => {
    useListHandlers();
    const viewport = createViewportSource([-71.405, 41.824, -71.398, 41.83]);
    renderWithHarness(<ListView viewport={viewport} now={clock} />);

    await screen.findByText("Poster session");
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "Happening now1",
      "Next hour1",
      "Tonight1",
      "Tomorrow1",
    ]);
    // The bbox went to the server in contract w,s,e,n form.
    const req = seenRequests.find((u) => u.pathname === "/api/events");
    expect(req?.searchParams.get("bbox")).toBe("-71.40500,41.82400,-71.39800,41.83000");
    // Count strip.
    await screen.findByText("4 events in view");
  });

  it("refetches when the viewport moves", async () => {
    useListHandlers();
    const viewport = createViewportSource();
    renderWithHarness(<ListView viewport={viewport} now={clock} />);
    await screen.findByText("Poster session");

    viewport.set([-71.402, 41.825, -71.396, 41.829]);
    await waitFor(() => {
      expect(
        seenRequests.some(
          (u) => u.searchParams.get("bbox") === "-71.40200,41.82500,-71.39600,41.82900",
        ),
      ).toBe(true);
    });
  });

  it("applies the URL category filter client-side", async () => {
    useListHandlers();
    renderWithHarness(<ListView now={clock} />, { path: "/?cats=arts" });
    await screen.findByText("A cappella showcase");
    expect(screen.queryByText("Poster session")).toBeNull();
    await screen.findByText("1 event in view");
  });

  it("filtered-empty state offers to clear the filters", async () => {
    useListHandlers();
    const user = userEvent.setup();
    renderWithHarness(<ListView now={clock} />, { path: "/?cats=athletics" });
    await screen.findByText("No events in view");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByText("Poster session");
  });

  it("shows the designed error state with retry (§6.4, never bare spinners)", async () => {
    server.use(
      http.get("*/api/events", () =>
        HttpResponse.json({ error: { code: "db", message: "down" } }, { status: 503 }),
      ),
    );
    renderWithHarness(<ListView now={clock} />);
    // The 503 is retried with backoff (~3 s) before the error state lands.
    await screen.findByText("Events unavailable", undefined, { timeout: 8000 });
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
