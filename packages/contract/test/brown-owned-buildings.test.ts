import { describe, expect, it } from "vitest";
import { BrownOwnedBuildingsSchema } from "../src/index";

/** Mirrors db/seeds/brown_owned_buildings.json as ingestion publishes it (register §5). */
const valid = {
  schema_version: 1,
  generated_at: "2026-07-29T14:59:22.804120Z",
  attribution:
    "Building way ids © OpenStreetMap contributors, licensed under the Open Database License (ODbL) 1.0 — https://www.openstreetmap.org/copyright",
  osm_way_ids: [141129271, 141567737, 177342771],
  place_ids: ["121-south-main-street", "kassar-house", "verney-woolley"],
};

describe("BrownOwnedBuildingsSchema", () => {
  it("accepts the shape ingestion publishes (microsecond UTC timestamps included)", () => {
    const parsed = BrownOwnedBuildingsSchema.parse(valid);
    expect(parsed.osm_way_ids).toHaveLength(3);
    expect(parsed.place_ids).toContain("kassar-house");
  });

  it("rejects unknown schema versions loudly", () => {
    expect(BrownOwnedBuildingsSchema.safeParse({ ...valid, schema_version: 2 }).success).toBe(
      false,
    );
  });

  it("requires the ODbL attribution key and that it credits OpenStreetMap", () => {
    const { attribution: _omitted, ...missing } = valid;
    expect(BrownOwnedBuildingsSchema.safeParse(missing).success).toBe(false);
    expect(BrownOwnedBuildingsSchema.safeParse({ ...valid, attribution: "" }).success).toBe(false);
    expect(
      BrownOwnedBuildingsSchema.safeParse({ ...valid, attribution: "no credit given" }).success,
    ).toBe(false);
  });

  it("rejects non-integer, non-positive, or stringly-typed way ids", () => {
    expect(BrownOwnedBuildingsSchema.safeParse({ ...valid, osm_way_ids: [1.5] }).success).toBe(
      false,
    );
    expect(BrownOwnedBuildingsSchema.safeParse({ ...valid, osm_way_ids: [0] }).success).toBe(false);
    expect(
      BrownOwnedBuildingsSchema.safeParse({ ...valid, osm_way_ids: ["141129271"] }).success,
    ).toBe(false);
  });

  it("rejects empty place slugs", () => {
    expect(BrownOwnedBuildingsSchema.safeParse({ ...valid, place_ids: [""] }).success).toBe(false);
  });

  it("tolerates empty arrays (a campus with no expressible footprints is valid, just useless)", () => {
    expect(
      BrownOwnedBuildingsSchema.safeParse({ ...valid, osm_way_ids: [], place_ids: [] }).success,
    ).toBe(true);
  });
});
