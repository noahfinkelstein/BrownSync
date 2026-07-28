import { describe, expect, it } from "vitest";
import { DEFAULT_USER_AGENT } from "../src/http";
import { isSource, SOURCES } from "../src/sources";

describe("poller sources", () => {
  it("owns exactly the structured feeds", () => {
    expect(SOURCES).toEqual(["livewhale", "athletics", "bdh"]);
  });

  it("guards unknown sources", () => {
    expect(isSource("livewhale")).toBe(true);
    expect(isSource("cab")).toBe(false);
  });

  it("always identifies as BrownSync (lane requirement: exact UA)", () => {
    expect(DEFAULT_USER_AGENT).toBe("BrownSync/1.0 (+noah_finkelstein@brown.edu)");
  });
});
