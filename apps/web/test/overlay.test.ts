import { describe, expect, it } from "vitest";
import { getOverlayLayers, setOverlayLayers, subscribeOverlayLayers } from "../src/map/overlay";

describe("overlay store (deck.gl seam for Phase 2 F)", () => {
  it("starts empty", () => {
    expect(getOverlayLayers()).toEqual([]);
  });

  it("swaps the layer list and notifies subscribers", () => {
    let notified = 0;
    const unsubscribe = subscribeOverlayLayers(() => {
      notified += 1;
    });

    const fakeLayers = [{ id: "pulse" }] as unknown as Parameters<typeof setOverlayLayers>[0];
    setOverlayLayers(fakeLayers);
    expect(getOverlayLayers()).toBe(fakeLayers);
    expect(notified).toBe(1);

    unsubscribe();
    setOverlayLayers([]);
    expect(notified).toBe(1);
    expect(getOverlayLayers()).toEqual([]);
  });
});
