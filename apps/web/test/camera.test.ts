import { describe, expect, it, vi } from "vitest";
import {
  CAMPUS_BOUNDS,
  flyToTarget,
  INITIAL_VIEW,
  MAX_BOUNDS,
  MAX_PITCH,
  SELECTION_ZOOM,
} from "../src/map/camera";

describe("camera (handoff §5)", () => {
  it("locks the camera to a padded College Hill box", () => {
    const [[west, south], [east, north]] = MAX_BOUNDS as [[number, number], [number, number]];
    // Padding: max bounds strictly contain campus proper.
    expect(west).toBeLessThan(CAMPUS_BOUNDS.west);
    expect(south).toBeLessThan(CAMPUS_BOUNDS.south);
    expect(east).toBeGreaterThan(CAMPUS_BOUNDS.east);
    expect(north).toBeGreaterThan(CAMPUS_BOUNDS.north);
  });

  it("opens tilted up the hill: pitch 45, bearing -15, maxPitch 60", () => {
    expect(INITIAL_VIEW.pitch).toBe(45);
    expect(INITIAL_VIEW.bearing).toBe(-15);
    expect(MAX_PITCH).toBe(60);
    // Initial center sits inside campus bounds.
    expect(INITIAL_VIEW.longitude).toBeGreaterThan(CAMPUS_BOUNDS.west);
    expect(INITIAL_VIEW.longitude).toBeLessThan(CAMPUS_BOUNDS.east);
    expect(INITIAL_VIEW.latitude).toBeGreaterThan(CAMPUS_BOUNDS.south);
    expect(INITIAL_VIEW.latitude).toBeLessThan(CAMPUS_BOUNDS.north);
  });

  it("flyToTarget fills smooth defaults and allows overrides", () => {
    const flyTo = vi.fn();
    flyToTarget({ flyTo }, { lng: -71.4, lat: 41.826 });
    expect(flyTo).toHaveBeenCalledWith(
      expect.objectContaining({
        center: [-71.4, 41.826],
        zoom: SELECTION_ZOOM,
        pitch: INITIAL_VIEW.pitch,
        bearing: INITIAL_VIEW.bearing,
        essential: true,
      }),
    );

    flyToTarget({ flyTo }, { lng: -71.4, lat: 41.826, zoom: 17 }, { duration: 400 });
    expect(flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 17, duration: 400 }));
  });
});
