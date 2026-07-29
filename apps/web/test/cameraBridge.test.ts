import type { Map as MaplibreMap } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { bridgeCameraSeam } from "../src/map/cameraBridge";

/**
 * Unit coverage for the maplibre-6/react-map-gl camera seam repair — the
 * end-to-end proof (drags + easeTo tour with zero pageerrors) lives in
 * e2e/perf.e2e.ts against a live map.
 */

type SeamFixture = {
  transform?: unknown;
  transformCameraUpdate?: unknown;
  _camera?: { transform: unknown; transformCameraUpdate: unknown };
};

const asMap = (fixture: SeamFixture): MaplibreMap => fixture as unknown as MaplibreMap;

describe("bridgeCameraSeam", () => {
  it("re-points the stranded hook and aliases map.transform to the camera's", () => {
    const hook = (): void => {};
    const cameraTransform = { center: { lng: -71.4, lat: 41.826 } };
    const fixture: SeamFixture = {
      transformCameraUpdate: hook,
      _camera: { transform: cameraTransform, transformCameraUpdate: null },
    };
    bridgeCameraSeam(asMap(fixture));
    expect(fixture._camera?.transformCameraUpdate).toBe(hook);
    expect(fixture.transform).toBe(cameraTransform);
  });

  it("no-ops when the seam is intact (pre-v6 map, transform present)", () => {
    const existingHook = (): void => {};
    const ownTransform = { center: { lng: 0, lat: 0 } };
    const fixture: SeamFixture = {
      transform: ownTransform,
      transformCameraUpdate: (): void => {},
      _camera: { transform: {}, transformCameraUpdate: existingHook },
    };
    bridgeCameraSeam(asMap(fixture));
    expect(fixture._camera?.transformCameraUpdate).toBe(existingHook);
    expect(fixture.transform).toBe(ownTransform);
  });

  it("no-ops entirely when the map has no _camera", () => {
    const fixture: SeamFixture = { transformCameraUpdate: (): void => {} };
    bridgeCameraSeam(asMap(fixture));
    expect(fixture.transform).toBeUndefined();
  });
});
