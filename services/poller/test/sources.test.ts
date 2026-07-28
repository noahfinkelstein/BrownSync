import { describe, expect, it } from "vitest";
import { isSource, SOURCES, USER_AGENT } from "../src/sources";

describe("poller sources", () => {
  it("owns exactly the structured feeds", () => {
    expect(SOURCES).toEqual(["livewhale", "athletics", "bdh"]);
  });

  it("guards unknown sources", () => {
    expect(isSource("livewhale")).toBe(true);
    expect(isSource("cab")).toBe(false);
  });

  it("always identifies as BrownSync", () => {
    expect(USER_AGENT).toMatch(/^BrownSync\/1\.0 \(\+.+\)$/);
  });
});
