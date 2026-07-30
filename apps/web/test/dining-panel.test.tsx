// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setCursorSource } from "../src/data/cursor";
import { DiningPanel } from "../src/dining/DiningPanel";
import type { DiningDocument } from "../src/dining/model";
import { createTimeCursor } from "../src/time";
import { makeQueryClient } from "./helpers/render";

const DINING: DiningDocument = {
  schema_version: 1,
  generated_at: "2026-07-29T16:00:00.000Z",
  attribution: "Brown Dining",
  icon_labels: {},
  locations: [
    {
      locationId: "CLOSED",
      name: "Closed Hall",
      address: null,
      placeId: "closed-hall",
      services: [
        {
          date: "2026-07-30",
          meal: "Breakfast",
          name: "Breakfast",
          start: "2026-07-30T08:00:00-04:00",
          end: "2026-07-30T10:00:00-04:00",
          stations: [],
        },
      ],
    },
  ],
};

const server = setupServer(http.get("*/data/dining-menus.json", () => HttpResponse.json(DINING)));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  const cursor = createTimeCursor();
  cursor.setAt(new Date("2026-07-29T16:00:00.000Z"));
  setCursorSource(cursor);
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

describe("DiningPanel unavailable rows", () => {
  it("announces a dining artifact failure", async () => {
    server.use(http.get("*/data/dining-menus.json", () => new HttpResponse(null, { status: 503 })));
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <DiningPanel />
      </QueryClientProvider>,
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Dining hours are unavailable right now.",
    );
  });

  it("labels and visibly disables a hall with no service on the cursor date", async () => {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <DiningPanel />
      </QueryClientProvider>,
    );

    const button = (await screen.findByRole("button", {
      name: /Closed Hall.*no service today/i,
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.className).toContain("disabled:cursor-not-allowed");
    expect(button.className).toContain("disabled:opacity-60");
  });
});
