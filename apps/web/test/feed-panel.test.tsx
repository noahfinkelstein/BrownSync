// @vitest-environment jsdom
import type { EventOut } from "@brownsync/contract";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { delay, HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setCursorSource } from "../src/data/cursor";
import type { DiningDocument } from "../src/dining/model";
import { FeedPanel } from "../src/feed/FeedPanel";
import type { PublicationsDocument } from "../src/feed/model";
import { createTimeCursor } from "../src/time";
import { renderWithHarness, stubScrolling } from "./helpers/render";

const AT = new Date("2026-07-29T16:00:00.000Z");

const EVENT: EventOut = {
  id: "feed-event",
  title: "Campus talk",
  description: null,
  start: "2026-07-29T16:30:00.000Z",
  end: "2026-07-29T17:30:00.000Z",
  allDay: false,
  lat: 41.8268,
  lng: -71.4025,
  placeId: "sayles-hall",
  placeName: "Sayles Hall",
  locationRaw: null,
  orgId: null,
  orgName: null,
  category: "academic",
  tags: [],
  url: "https://events.brown.edu/feed-event",
  cost: null,
  source: "livewhale",
  confidence: 1,
  isCanceled: false,
};

const PUBLICATIONS: PublicationsDocument = {
  schema_version: 1,
  generated_at: AT.toISOString(),
  sources: [
    {
      id: "bdh",
      name: "Brown Daily Herald",
      homepage: "https://www.browndailyherald.com",
      license: "headline-only",
    },
  ],
  articles: [
    {
      id: "news-item",
      sourceId: "bdh",
      title: "News headline",
      url: "https://www.browndailyherald.com/article/news-item",
      published: "2026-07-29T15:50:00.000Z",
      section: null,
      author: null,
    },
  ],
};

const DINING: DiningDocument = {
  schema_version: 1,
  generated_at: AT.toISOString(),
  attribution: "Brown Dining",
  icon_labels: {},
  locations: [
    {
      locationId: "BR",
      name: "Blue Room",
      address: "75 Waterman St",
      placeId: "blue-room",
      services: [
        {
          date: "2026-07-29",
          meal: "Lunch",
          name: "Lunch",
          start: "2026-07-29T11:00:00-04:00",
          end: "2026-07-29T15:00:00-04:00",
          stations: [],
        },
      ],
    },
  ],
};

const successHandlers = [
  http.get("*/api/events", () => HttpResponse.json({ events: [EVENT] })),
  http.get("*/data/publications.json", () => HttpResponse.json(PUBLICATIONS)),
  http.get("*/data/dining-menus.json", () => HttpResponse.json(DINING)),
];

const server = setupServer(...successHandlers);

beforeAll(() => {
  stubScrolling();
  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(() => {
  const cursor = createTimeCursor();
  cursor.setAt(AT);
  setCursorSource(cursor);
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => server.close());

describe("FeedPanel destinations", () => {
  it("opens event rows through the in-app event callback", async () => {
    const onSelectEvent = vi.fn();
    renderWithHarness(<FeedPanel onSelectEvent={onSelectEvent} />);

    fireEvent.click(await screen.findByRole("button", { name: /Campus talk/ }));

    expect(onSelectEvent).toHaveBeenCalledOnce();
    expect(onSelectEvent).toHaveBeenCalledWith(EVENT);
  });

  it("links dining rows to their BrownSync place page", async () => {
    renderWithHarness(<FeedPanel />);

    const link = await screen.findByRole("link", { name: /Blue Room — Lunch/ });
    expect(link.getAttribute("href")).toBe("/p/blue-room");
  });

  it("keeps article rows as external links", async () => {
    renderWithHarness(<FeedPanel />);

    const link = await screen.findByRole("link", { name: /News headline/ });
    expect(link.getAttribute("href")).toBe("https://www.browndailyherald.com/article/news-item");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });
});

describe("FeedPanel degraded sources", () => {
  it("shows a loading state instead of a false empty state on a cold load", async () => {
    server.use(
      http.get("*/api/events", async () => {
        await delay(100);
        return HttpResponse.json({ events: [] });
      }),
      http.get("*/data/publications.json", async () => {
        await delay(100);
        return HttpResponse.json({ ...PUBLICATIONS, articles: [] });
      }),
      http.get("*/data/dining-menus.json", async () => {
        await delay(100);
        return HttpResponse.json({ ...DINING, locations: [] });
      }),
    );

    renderWithHarness(<FeedPanel />);

    await screen.findByText("Loading feed…");
    expect(screen.queryByText("Nothing to show at this time.")).toBeNull();
  });

  it("does not describe an all-source failure as an empty feed", async () => {
    server.use(
      http.get("*/api/events", () => new HttpResponse(null, { status: 503 })),
      http.get("*/data/publications.json", () => new HttpResponse(null, { status: 503 })),
      http.get("*/data/dining-menus.json", () => new HttpResponse(null, { status: 503 })),
    );

    renderWithHarness(<FeedPanel />);

    await screen.findByRole("alert");
    expect(screen.getByText("No feed items could be loaded.")).toBeTruthy();
    expect(screen.queryByText("Nothing to show at this time.")).toBeNull();
  });

  it.each([
    ["events", "*/api/events"],
    ["publications", "*/data/publications.json"],
    ["dining", "*/data/dining-menus.json"],
  ] as const)("keeps partial results visible when %s fails", async (_source, url) => {
    server.use(http.get(url, () => new HttpResponse(null, { status: 503 })));
    renderWithHarness(<FeedPanel />);

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /some feed sources unavailable/i,
    );
    expect(screen.queryByText("Nothing to show at this time.")).toBeNull();
    expect(screen.getByTestId("feed-panel")).toBeTruthy();
  });
});
