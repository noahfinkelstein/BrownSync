import { describe, expect, it } from "vitest";
import { SeedManifestSchema } from "../src/index";

const sha = "a".repeat(64);

const valid = {
  schema_version: 1,
  generated_at: "2026-07-29T06:23:22.481640Z",
  generation: "30cbef95b0874a0fbb0fdc1bc133839a",
  artifacts: {
    "places.ndjson": { bytes: 138468, sha256: sha },
    "course_meetings.ndjson": { bytes: 1614349, sha256: sha },
  },
};

describe("SeedManifestSchema", () => {
  it("accepts the shape ingestion publishes (microsecond UTC timestamps included)", () => {
    const parsed = SeedManifestSchema.parse(valid);
    expect(Object.keys(parsed.artifacts)).toHaveLength(2);
    expect(parsed.artifacts["places.ndjson"]?.bytes).toBe(138468);
  });

  it("rejects unknown schema versions loudly", () => {
    expect(SeedManifestSchema.safeParse({ ...valid, schema_version: 2 }).success).toBe(false);
  });

  it("rejects malformed sha256 digests and negative sizes", () => {
    const badSha = {
      ...valid,
      artifacts: { "places.ndjson": { bytes: 1, sha256: "not-hex" } },
    };
    expect(SeedManifestSchema.safeParse(badSha).success).toBe(false);
    const badBytes = {
      ...valid,
      artifacts: { "places.ndjson": { bytes: -1, sha256: sha } },
    };
    expect(SeedManifestSchema.safeParse(badBytes).success).toBe(false);
  });
});
