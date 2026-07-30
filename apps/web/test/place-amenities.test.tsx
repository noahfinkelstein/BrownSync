// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PlaceAmenities } from "../src/pages/PlaceAmenities";
import { renderWithHarness, stubScrolling } from "./helpers/render";

const server = setupServer(
  http.get("*/data/campus-amenities.geojson", () => new HttpResponse(null, { status: 503 })),
);

beforeAll(() => {
  stubScrolling();
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

describe("PlaceAmenities", () => {
  it("surfaces an artifact failure instead of looking like an amenity-free building", async () => {
    renderWithHarness(<PlaceAmenities placeId="john-d-rockefeller-jr-library" />);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Building amenities are unavailable right now.",
    );
  });

  it("uses human labels for every artifact amenity kind", async () => {
    server.use(
      http.get("*/data/campus-amenities.geojson", () =>
        HttpResponse.json({
          type: "FeatureCollection",
          features: [
            {
              properties: {
                id: "inclusive-1",
                kind: "restroom-inclusive",
                label: "All-gender restroom",
                placeIds: ["john-d-rockefeller-jr-library"],
              },
            },
            {
              properties: {
                id: "blue-light-1",
                kind: "blue-light",
                label: "Blue-light phone",
                placeIds: ["john-d-rockefeller-jr-library"],
              },
            },
          ],
        }),
      ),
    );

    renderWithHarness(<PlaceAmenities placeId="john-d-rockefeller-jr-library" />);

    await screen.findByText("All-gender restrooms");
    await screen.findByText("Blue-light phones");
    expect(screen.queryByText("restroom-inclusive")).toBeNull();
    expect(screen.queryByText("blue-light")).toBeNull();
  });
});
