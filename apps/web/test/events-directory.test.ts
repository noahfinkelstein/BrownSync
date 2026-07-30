// @vitest-environment jsdom
import type { EventOut } from "@brownsync/contract";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  EventsDirectory,
  eventMatchesQuery,
  filterEvents,
  groupEventsByDay,
  organizerOptions,
} from "../src/events/EventsDirectory";
import { mkEvent } from "./helpers/fixtures";
import { createServer } from "./helpers/msw";
import { renderWithHarness, searchOf, stubScrolling } from "./helpers/render";

/**
 * The directory is the surface a student browses instead of the map, so the
 * failures worth pinning are: a filter that silently eats an unrelated URL
 * param, an anchor that goes nowhere, and a canceled event that reads as a
 * normal one (or worse, offers to add itself to a calendar).
 */

const server = createServer();
beforeAll(() => {
  stubScrolling();
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

/** Deterministic afternoon clock; every fixture time is derived from it. */
const NOW = new Date("2026-07-28T19:00:00Z"); // 15:00 ET
const clock = () => NOW;

function at(hoursFromNow: number): string {
  return new Date(NOW.getTime() + hoursFromNow * 3_600_000).toISOString();
}

const DIRECTORY_EVENTS: EventOut[] = [
  mkEvent({
    id: "d-live",
    title: "Poster Session",
    start: at(-0.5),
    end: at(1),
    category: "academic",
    placeId: "salomon-center",
    placeName: "Salomon Center",
  }),
  mkEvent({
    id: "d-concert",
    title: "Orchestra Fall Concert",
    start: at(4),
    end: at(6),
    category: "arts",
    placeId: "sayles-hall",
    placeName: "Sayles Hall",
    orgId: "brown-university-orchestra",
    orgName: "Brown University Orchestra",
    url: "https://events.brown.example.edu/orchestra",
  }),
  mkEvent({
    id: "d-canceled",
    title: "Rained-Out Barbecue",
    start: at(5),
    category: "food",
    isCanceled: true,
    orgId: "brown-outing-club",
    orgName: "Brown Outing Club",
  }),
  mkEvent({
    id: "d-tomorrow",
    title: "Farmers Market",
    start: at(20),
    category: "food",
    // No place id and a junk url: the card must render neither as a link.
    placeId: null,
    placeName: null,
    locationRaw: "Wriston Quad",
    url: "#",
  }),
];

function serveEvents(events: readonly EventOut[] = DIRECTORY_EVENTS) {
  server.use(http.get("*/api/events", () => HttpResponse.json({ events })));
}

function renderDirectory(path = "/") {
  return renderWithHarness(createElement(EventsDirectory, { now: clock }), { path });
}

/* ------------------------------------------------------------------- pure */

describe("filtering and grouping (pure)", () => {
  it("ANDs search terms across title, org, place, tags", () => {
    const concert = DIRECTORY_EVENTS[1] as EventOut;
    // A single-substring match would miss this: no one field holds both words.
    expect(eventMatchesQuery(concert, "orchestra sayles")).toBe(true);
    expect(eventMatchesQuery(concert, "orchestra hockey")).toBe(false);
    // Punctuation- and case-insensitive, matching the palette's normalizer.
    expect(eventMatchesQuery(concert, "  FALL, concert ")).toBe(true);
    expect(eventMatchesQuery(concert, "")).toBe(true);
  });

  it("combines query, category and organizer filters", () => {
    expect(
      filterEvents(DIRECTORY_EVENTS, { query: "", categories: ["food"], orgId: "" }).map(
        (e) => e.id,
      ),
    ).toEqual(["d-canceled", "d-tomorrow"]);
    expect(
      filterEvents(DIRECTORY_EVENTS, {
        query: "",
        categories: [],
        orgId: "brown-university-orchestra",
      }).map((e) => e.id),
    ).toEqual(["d-concert"]);
    expect(
      filterEvents(DIRECTORY_EVENTS, { query: "market", categories: ["arts"], orgId: "" }),
    ).toEqual([]);
  });

  it("groups by CAMPUS day, chronologically, sorted inside each day", () => {
    // 21:00 ET is already the next day in UTC — grouping on UTC would file
    // every evening event under tomorrow.
    const evening = mkEvent({ id: "d-late", title: "Late Show", start: "2026-07-29T01:00:00Z" });
    const groups = groupEventsByDay([...DIRECTORY_EVENTS, evening], NOW);
    expect(groups.map((g) => g.key)).toEqual(["2026-07-28", "2026-07-29"]);
    expect(groups[0]?.label).toBe("Today");
    expect(groups[1]?.label).toBe("Tomorrow");
    expect(groups[0]?.events.map((e) => e.id)).toEqual([
      "d-live",
      "d-concert",
      "d-canceled",
      "d-late",
    ]);
  });

  it("lists only organizers that actually appear, with counts", () => {
    expect(organizerOptions(DIRECTORY_EVENTS)).toEqual([
      { id: "brown-outing-club", name: "Brown Outing Club", count: 1 },
      { id: "brown-university-orchestra", name: "Brown University Orchestra", count: 1 },
    ]);
  });
});

/* ---------------------------------------------------------------- rendered */

describe("EventsDirectory", () => {
  it("renders every event in the window grouped by day", async () => {
    serveEvents();
    renderDirectory();
    await screen.findByText("Poster Session");
    expect(screen.getAllByTestId("event-card")).toHaveLength(4);
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings[0]?.textContent).toContain("Today");
    expect(headings.at(-1)?.textContent).toContain("Tomorrow");
    await screen.findByText("4 events");
  });

  it("syncs ?q= without destroying sibling params (the ?at= regression)", async () => {
    serveEvents();
    const user = userEvent.setup();
    // `at` is the time cursor's param and lives on the same route. An
    // object-form search update would drop it on the first keystroke.
    const { router } = renderDirectory("/?at=2026-07-28T19%3A00%3A00.000Z&cats=arts");
    await screen.findByText("Orchestra Fall Concert");

    await user.type(screen.getByRole("searchbox", { name: "Search events" }), "orchestra");
    await waitFor(() => expect(searchOf(router).q).toBe("orchestra"));
    expect(searchOf(router).at).toBe("2026-07-28T19:00:00.000Z");
    expect(searchOf(router).cats).toBe("arts");
  });

  it("reads ?q= and ?cats= from the URL on first paint", async () => {
    serveEvents();
    renderDirectory("/?q=market");
    await screen.findByText("Farmers Market");
    expect(screen.queryByText("Poster Session")).toBeNull();
    await screen.findByText("1 event of 4");
  });

  it("filters by organizer through ?org=", async () => {
    serveEvents();
    const user = userEvent.setup();
    const { router } = renderDirectory();
    await screen.findByText("Poster Session");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter by organizer" }),
      "brown-university-orchestra",
    );
    await waitFor(() => expect(searchOf(router).org).toBe("brown-university-orchestra"));
    await screen.findByText("Orchestra Fall Concert");
    expect(screen.queryByText("Poster Session")).toBeNull();
  });

  it("offers a way out of a filtered-empty result", async () => {
    serveEvents();
    const user = userEvent.setup();
    renderDirectory("/?q=quidditch");
    await screen.findByText("No events match");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByText("Poster Session");
  });

  it("has NO dead links: every anchor is a real destination", async () => {
    serveEvents();
    renderDirectory();
    await screen.findByText("Poster Session");
    const anchors = [...document.querySelectorAll("a")];
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href");
      // `href=""` reloads the page and `href="#"` scrolls to the top — both
      // look like links and do nothing, and both are what a missing id or a
      // junk feed url produces if it is rendered unguarded.
      expect(href, anchor.outerHTML).toBeTruthy();
      expect(href).not.toBe("#");
      if (href?.startsWith("http")) {
        // Off-site links must not hand the opener over to the target.
        expect(anchor.getAttribute("target")).toBe("_blank");
        expect(anchor.getAttribute("rel")).toContain("noreferrer");
        expect(anchor.getAttribute("rel")).toContain("noopener");
      }
    }
  });

  it("renders a place with no id as plain text, never an empty link", async () => {
    serveEvents();
    renderDirectory();
    const card = await screen.findByRole("article", { name: "Farmers Market" });
    // Location present as text…
    within(card).getByText(/Wriston Quad/);
    // …but the only anchors on this card are the calendar links: no place
    // link (no placeId) and no source link (url is "#").
    for (const anchor of within(card).queryAllByRole("link")) {
      expect(anchor.getAttribute("href")).toMatch(/^https:\/\/(calendar\.google|outlook)\./);
    }
    expect(within(card).queryByText("Source ↗")).toBeNull();
  });

  it("links the org and the place when both resolve", async () => {
    serveEvents();
    renderDirectory();
    const card = await screen.findByRole("article", { name: "Orchestra Fall Concert" });
    expect(within(card).getByRole("link", { name: "Sayles Hall" }).getAttribute("href")).toBe(
      "/p/sayles-hall",
    );
    expect(
      within(card).getByRole("link", { name: "Brown University Orchestra" }).getAttribute("href"),
    ).toBe("/o/brown-university-orchestra");
    expect(within(card).getByRole("link", { name: "Source ↗" }).getAttribute("href")).toBe(
      "https://events.brown.example.edu/orchestra",
    );
  });

  it("marks a canceled event unmistakably and refuses to export it", async () => {
    serveEvents();
    renderDirectory();
    const card = await screen.findByRole("article", { name: "Rained-Out Barbecue" });
    within(card).getByText("Canceled");
    // Struck through, not just badged — the badge alone is missable in a
    // long scroll.
    expect(within(card).getByRole("heading", { name: "Rained-Out Barbecue" }).className).toContain(
      "line-through",
    );
    expect(within(card).queryByTestId("add-to-calendar")).toBeNull();
    for (const anchor of within(card).queryAllByRole("link")) {
      expect(anchor.getAttribute("href")).not.toContain("calendar.google");
    }
  });

  it("gives a live event calendar links for all three targets", async () => {
    serveEvents();
    renderDirectory();
    const card = await screen.findByRole("article", { name: "Orchestra Fall Concert" });
    const google = within(card).getByRole("link", { name: "Google ↗" });
    expect(new URL(google.getAttribute("href") ?? "").searchParams.get("dates")).toMatch(
      /^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/,
    );
    within(card).getByRole("link", { name: "Outlook ↗" });
    within(card).getByRole("button", { name: "Download .ics" });
  });

  it("exports the FILTERED set, excluding canceled events", async () => {
    serveEvents();
    renderDirectory("/?cats=food");
    // Two food events in the window, one of them canceled — only the live
    // one may go into the file.
    await screen.findByText("Farmers Market");
    await screen.findByRole("button", { name: "Add 1 to calendar (.ics)" });
  });

  it("shows the designed error state with retry, never a bare spinner", async () => {
    server.use(
      http.get("*/api/events", () =>
        HttpResponse.json({ error: { code: "db", message: "down" } }, { status: 503 }),
      ),
    );
    renderDirectory();
    await screen.findByText("Events unavailable", undefined, { timeout: 8000 });
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
