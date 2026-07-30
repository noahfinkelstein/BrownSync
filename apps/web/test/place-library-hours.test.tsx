// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setCursorSource } from "../src/data/cursor";
import { PlaceLibraryHours } from "../src/pages/PlaceLibraryHours";
import { createTimeCursor, type TimeCursorStore } from "../src/time";
import { makeQueryClient } from "./helpers/render";

const DOCUMENT = {
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
        {
          date: "2026-07-30",
          open: "2026-07-30T09:00:00-04:00",
          close: "2026-07-30T22:00:00-04:00",
          note: null,
        },
      ],
    },
    {
      id: "rock-services",
      name: "Rockefeller Library Services",
      placeId: "john-d-rockefeller-jr-library",
      hours: [
        {
          date: "2026-07-29",
          open: "2026-07-29T09:00:00-04:00",
          close: "2026-07-29T17:00:00-04:00",
          note: null,
        },
        {
          date: "2026-07-30",
          open: null,
          close: null,
          note: "Closed",
        },
      ],
    },
    {
      id: "rock-swipe",
      name: "Rockefeller Library Brown ID Swipe Access",
      placeId: "john-d-rockefeller-jr-library",
      hours: [
        {
          date: "2026-07-29",
          open: "2026-07-29T08:00:00-04:00",
          close: "2026-07-29T23:00:00-04:00",
          note: null,
        },
        {
          date: "2026-07-30",
          open: "2026-07-30T07:00:00-04:00",
          close: "2026-07-30T23:00:00-04:00",
          note: null,
        },
      ],
    },
  ],
} as const;

const server = setupServer(
  http.get("*/data/library-hours.json", () => HttpResponse.json(DOCUMENT)),
);

let cursor: TimeCursorStore;

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  cursor = createTimeCursor();
  cursor.setAt(new Date("2026-07-29T16:00:00.000Z"));
  setCursorSource(cursor);
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

function renderHours(placeId: string) {
  const queryClient = makeQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <PlaceLibraryHours placeId={placeId} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

describe("PlaceLibraryHours", () => {
  it("shows every matching schedule and follows the campus-date cursor", async () => {
    renderHours("john-d-rockefeller-jr-library");

    await screen.findByText("Rockefeller Library");
    expect(screen.getByText("Rockefeller Library Services")).toBeTruthy();
    expect(screen.getByText("Rockefeller Library Brown ID Swipe Access")).toBeTruthy();
    expect(screen.getByText("08:00–21:00")).toBeTruthy();
    expect(screen.getByText("09:00–17:00")).toBeTruthy();
    expect(screen.getByText("08:00–23:00")).toBeTruthy();

    act(() => cursor.setAt(new Date("2026-07-30T16:00:00.000Z")));

    await waitFor(() => expect(screen.getByText("09:00–22:00")).toBeTruthy());
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getByText("07:00–23:00")).toBeTruthy();
  });

  it("renders no section for a place without library schedules", async () => {
    const { queryClient } = renderHours("sayles-hall");

    await waitFor(() => expect(queryClient.getQueryData(["library-hours"])).toEqual(DOCUMENT));
    expect(screen.queryByTestId("place-library-hours")).toBeNull();
  });

  it("surfaces an artifact failure", async () => {
    server.use(
      http.get("*/data/library-hours.json", () => new HttpResponse(null, { status: 503 })),
    );
    renderHours("john-d-rockefeller-jr-library");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Library hours are unavailable right now.",
    );
  });
});
