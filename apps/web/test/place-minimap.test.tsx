// @vitest-environment jsdom
import type { PlaceOut } from "@brownsync/contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  canRenderMiniMap,
  formatLl,
  MINI_CAMERA,
  PlaceMiniMap,
  parseLl,
} from "../src/pages/PlaceMiniMap";
import { renderWithHarness, stubScrolling } from "./helpers/render";

/**
 * Place mini-map (Phase 3): static-camera basemap with a click-through to
 * the live map. jsdom has no WebGL, so these tests pin the degrade path —
 * the real map render is covered by e2e/a11y.e2e.ts in Chromium.
 */

const PLACE: PlaceOut = {
  id: "sayles-hall",
  name: "Sayles Hall",
  aliases: ["Sayles"],
  kind: "academic",
  lat: 41.8262,
  lng: -71.4032,
  address: "79 Waterman St",
};

beforeAll(stubScrolling);
afterEach(cleanup);

describe("PlaceMiniMap", () => {
  it("degrades without WebGL: mono coords + the same click-through link", async () => {
    expect(canRenderMiniMap()).toBe(false); // jsdom baseline for this suite
    renderWithHarness(<PlaceMiniMap place={PLACE} />);
    expect(await screen.findByTestId("place-minimap-fallback")).toBeDefined();
    expect(screen.getByText("41.8262 · -71.4032")).toBeDefined();
    const link = screen.getByRole("link", { name: "Open Sayles Hall on the live map" });
    expect(link.getAttribute("href")).toContain("/?");
    expect(link.getAttribute("href")).toContain("ll=");
    // No wireframe-rectangle cosplay: the fallback is a plain data row.
    expect(screen.queryByTestId("place-minimap")).toBeNull();
  });

  it("click-through lands on the index route with ?ll=<lat,lng>", async () => {
    const { router } = renderWithHarness(<PlaceMiniMap place={PLACE} />, { path: "/p/x" });
    const link = await screen.findByRole("link", { name: "Open Sayles Hall on the live map" });
    link.click();
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    const search = router.state.location.search as Record<string, unknown>;
    expect(parseLl(search.ll)).toEqual({ lat: PLACE.lat, lng: PLACE.lng });
  });
});

describe("ll round-trip (mini-map → /?ll= → flyTo)", () => {
  it("formatLl/parseLl round-trip exactly", () => {
    expect(parseLl(formatLl(PLACE))).toEqual({ lat: 41.8262, lng: -71.4032 });
  });

  it("parseLl rejects junk", () => {
    expect(parseLl(undefined)).toBeNull();
    expect(parseLl("")).toBeNull();
    expect(parseLl("banana")).toBeNull();
    expect(parseLl("41.8262")).toBeNull();
    expect(parseLl("41.8,-71.4,9")).toBeNull();
    expect(parseLl(["41.8", "-71.4"])).toBeNull();
  });
});

describe("MINI_CAMERA", () => {
  it("is static and matches the main map's oblique identity (§5)", () => {
    // Static camera on the centroid: zoom past cluster level, main-map
    // pitch family, and the campus "up the hill" bearing.
    expect(MINI_CAMERA).toEqual({ zoom: 16.2, pitch: 40, bearing: -15 });
  });
});
