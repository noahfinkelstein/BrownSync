import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AMENITY_KINDS, amenityFilter, amenityLayers } from "../src/map/campusAmenities";
import {
  amenityKindsFor,
  DEFAULT_LAYER_STATE,
  LAYER_BY_ID,
  LAYER_GROUPS,
  LAYERS,
  type LayerId,
  type LayerState,
  LIVE_LAYERS,
  parseLayers,
  serializeLayers,
} from "../src/map/layerRegistry";

const artifact = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../db/seeds/campus_amenities.geojson"), "utf8"),
);

describe("the layer catalogue", () => {
  it("has a unique id per layer and a group that exists", () => {
    const ids = LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(LAYER_GROUPS.map((g) => g.id));
    for (const layer of LAYERS) expect(groups.has(layer.group), layer.id).toBe(true);
  });

  it("puts every group's layers somewhere reachable", () => {
    // A group with no layers renders as a header that expands to nothing.
    for (const group of LAYER_GROUPS) {
      expect(
        LAYERS.some((l) => l.group === group.id),
        group.id,
      ).toBe(true);
    }
  });

  it("leaves the default screen showing activity and campus only", () => {
    // 823 amenity points on by default would bury the events the map is for.
    const on = LAYERS.filter((l) => l.on).map((l) => l.id);
    expect(on).toEqual(["events", "classes", "athletics", "buildings", "greens"]);
    // Safety/amenity toggles are gone from the map entirely — the panel is
    // about what is happening, not wayfinding.
    expect(LAYERS.map((l) => l.id)).not.toContain("aed");
  });
});

describe("amenity layers agree with the published artifact", () => {
  it("names only kinds the artifact actually contains", () => {
    const published = new Set<string>(
      (artifact.features as { properties: { kind: string } }[]).map((f) => f.properties.kind),
    );
    for (const kind of AMENITY_KINDS) {
      expect(published.has(kind), `${kind} is declared but never published`).toBe(true);
    }
    for (const kind of published) {
      expect(AMENITY_KINDS as readonly string[], `${kind} is published but undeclared`).toContain(
        kind,
      );
    }
  });

  it("maps every amenity-backed layer onto a real kind", () => {
    for (const layer of LAYERS) {
      if (!layer.amenityKind) continue;
      expect(AMENITY_KINDS as readonly string[], layer.id).toContain(layer.amenityKind);
    }
  });

  it("exposes only kinds the artifact actually publishes", () => {
    // Direction reversed 2026-07-29. It used to assert the converse — every
    // published kind must be reachable as a map layer — on the reasoning that
    // an unreachable kind is dead weight. That stopped being true when the
    // safety/amenity layers were pulled from the map: the artifact now feeds
    // the place pages ("what's inside this building") and the dining layer,
    // so most kinds are legitimately not map toggles. What must still hold is
    // that no layer points at a kind the job does not emit.
    const published = new Set<string>(
      (artifact.features as { properties: { kind: string } }[]).map((f) => f.properties.kind),
    );
    for (const layer of LAYERS) {
      if (!layer.amenityKind) continue;
      expect(published.has(layer.amenityKind), `${layer.id} → ${layer.amenityKind}`).toBe(true);
    }
  });

  it("draws nothing — and does not crash — when no amenity is enabled", () => {
    // The empty case has to be a valid BOOLEAN expression. A `match` with no
    // branches, or an `in` over an empty literal, is a style-validation error
    // that rejects the whole layer.
    expect(amenityKindsFor(DEFAULT_LAYER_STATE)).toEqual([]);
    const filter = amenityFilter([]);
    expect(Array.isArray(filter)).toBe(true);
    expect(filter[0]).toBe("==");
  });

  it("filters to exactly the enabled kinds", () => {
    const state = { ...DEFAULT_LAYER_STATE, dining: true } as LayerState;
    expect(amenityKindsFor(state)).toEqual(["dining"]);
    expect(amenityFilter(["dining"])).toEqual(["in", ["get", "kind"], ["literal", ["dining"]]]);
  });

  it("keeps amenity labels below building labels in collision priority", () => {
    // symbol-sort-key is LOWER-wins. Building keys are rank-based single
    // digits, so a large constant here means an AED label can never displace
    // "Sciences Library".
    const [, labels] = amenityLayers(["aed"]);
    expect(labels.layout?.["symbol-sort-key"]).toBeGreaterThan(100);
    expect(labels.layout?.["text-allow-overlap"]).toBe(false);
  });
});

describe("?layers= round-trips as a DIFF against the defaults", () => {
  it("serializes nothing when everything is default", () => {
    expect(serializeLayers(DEFAULT_LAYER_STATE)).toBeUndefined();
  });

  it("marks a default-on layer switched off with a leading dash", () => {
    const state = { ...DEFAULT_LAYER_STATE, classes: false } as LayerState;
    expect(serializeLayers(state)).toBe("-classes");
    expect(parseLayers("-classes")).toEqual(state);
  });

  it("marks a default-off layer switched on by bare id", () => {
    const state = { ...DEFAULT_LAYER_STATE, dining: true } as LayerState;
    expect(serializeLayers(state)).toBe("dining");
    expect(parseLayers("dining")).toEqual(state);
  });

  it("round-trips a mixed selection", () => {
    const state = {
      ...DEFAULT_LAYER_STATE,
      classes: false,
      greens: false,
      dining: true,
    } as LayerState;
    const encoded = serializeLayers(state);
    expect(encoded).toBeDefined();
    expect(parseLayers(encoded)).toEqual(state);
  });

  it("survives a link naming a layer this build does not have", () => {
    // THE reason the encoding is a diff, and no longer hypothetical: `aed`
    // and `bike` WERE real layers and were removed. Links shared while they
    // existed must still open, honouring the parts this build understands.
    expect(parseLayers("aed,bike,dining")).toEqual({ ...DEFAULT_LAYER_STATE, dining: true });
    expect(parseLayers("shuttle,dining")).toEqual({ ...DEFAULT_LAYER_STATE, dining: true });
    expect(parseLayers("")).toEqual(DEFAULT_LAYER_STATE);
    expect(parseLayers(undefined)).toEqual(DEFAULT_LAYER_STATE);
    expect(parseLayers(42)).toEqual(DEFAULT_LAYER_STATE);
  });

  it("never enables a layer that has no data behind it", () => {
    const pending = LAYERS.filter((l) => l.pending).map((l) => l.id);
    for (const id of pending) {
      expect(parseLayers(id)[id as LayerId], id).toBe(false);
    }
  });

  it("keeps pending layers out of LIVE_LAYERS — the panel renders only LIVE_LAYERS", () => {
    // UI audit: disabled "… soon" placeholder rows were dead weight in the
    // panel. LayerPanel now maps over LIVE_LAYERS, so this is the seam that
    // keeps a future pending entry invisible until it is wired up.
    expect(LIVE_LAYERS.every((l) => !l.pending)).toBe(true);
    expect(LIVE_LAYERS.length).toBe(LAYERS.filter((l) => !l.pending).length);
  });

  it("keeps LAYER_BY_ID complete", () => {
    for (const layer of LAYERS) expect(LAYER_BY_ID[layer.id]).toBe(layer);
  });
});
