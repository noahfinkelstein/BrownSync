import { describe, expect, it } from "vitest";
import { landmarkLabelLayer, landmarkLayers } from "../src/map/campusLandmarks";

describe("campus landmark layer visibility", () => {
  it.each([
    { enabled: false, visibility: "none" },
    { enabled: true, visibility: "visible" },
  ] as const)(
    "sets every owned layer to $visibility when enabled=$enabled",
    ({ enabled, visibility }) => {
      for (const layer of landmarkLayers(enabled)) {
        expect(layer.layout?.visibility, layer.id).toBe(visibility);
      }

      const labels = landmarkLabelLayer(enabled);
      expect(labels.layout?.["text-field"]).toEqual(["get", "label"]);
      expect(labels.layout?.["symbol-sort-key"]).toBe(-1);
    },
  );
});
