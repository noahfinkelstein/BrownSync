import { describe, expect, it } from "vitest";
import { decodeEntities, newYorkToUtc, stripHtml, toIsoUtc, truncate } from "../src/util";

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("Health &amp; Society")).toBe("Health & Society");
    expect(decodeEntities("King&#8217;s College")).toBe("King’s College");
    expect(decodeEntities("A &#x26; B")).toBe("A & B");
  });

  it("leaves unknown sequences alone", () => {
    expect(decodeEntities("R&D &unknown; ok")).toBe("R&D &unknown; ok");
  });
});

describe("stripHtml", () => {
  it("drops tags, decodes entities, collapses whitespace", () => {
    expect(stripHtml("<p>\n  Come learn <b>more</b> &amp; register!\n</p>")).toBe(
      "Come learn more & register!",
    );
  });
});

describe("truncate", () => {
  it("passes short strings through and ellipsizes long ones", () => {
    expect(truncate("short", 10)).toBe("short");
    const cut = truncate("a".repeat(600), 500);
    expect(cut.length).toBeLessThanOrEqual(500);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("newYorkToUtc", () => {
  it("anchors EDT dates at -04:00", () => {
    expect(toIsoUtc(newYorkToUtc(2026, 8, 23))).toBe("2026-08-23T04:00:00Z");
  });

  it("anchors EST dates at -05:00", () => {
    expect(toIsoUtc(newYorkToUtc(2026, 12, 25))).toBe("2026-12-25T05:00:00Z");
  });

  it("carries wall-clock times through", () => {
    expect(toIsoUtc(newYorkToUtc(2026, 11, 6, 19, 30))).toBe("2026-11-07T00:30:00Z");
  });
});
