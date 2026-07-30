import { describe, expect, it } from "vitest";
import { DAILY_ARTIFACT_QUERY_OPTIONS } from "../src/data/artifacts";

describe("daily artifact query policy", () => {
  it("refreshes long-lived sessions without polling more than hourly", () => {
    expect(DAILY_ARTIFACT_QUERY_OPTIONS.staleTime).toBeGreaterThan(0);
    expect(DAILY_ARTIFACT_QUERY_OPTIONS.staleTime).toBeLessThanOrEqual(60 * 60_000);
    expect(DAILY_ARTIFACT_QUERY_OPTIONS.refetchInterval).toBe(60 * 60_000);
    expect(DAILY_ARTIFACT_QUERY_OPTIONS.refetchOnWindowFocus).toBe(true);
  });
});
