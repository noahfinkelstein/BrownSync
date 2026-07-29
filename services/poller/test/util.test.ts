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

  // Hostile numeric character references: a feed can put ANY digits inside
  // `&#…;`. String.fromCodePoint throws RangeError past 0x10FFFF (and on lone
  // surrogates), and one bad title must never crash a poll run.
  it("never throws on out-of-range numeric references", () => {
    expect(() => decodeEntities("&#x110000;")).not.toThrow();
    expect(() => decodeEntities("&#1114112;")).not.toThrow();
    expect(() => decodeEntities(`&#${"9".repeat(400)};`)).not.toThrow();
  });

  it("replaces out-of-range and overflow references with U+FFFD", () => {
    expect(decodeEntities("Game &#x110000; on")).toBe("Game � on");
    expect(decodeEntities("Game &#1114112; on")).toBe("Game � on");
    // Number("9".repeat(400)) is Infinity — must not reach fromCodePoint.
    expect(decodeEntities(`&#${"9".repeat(400)};`)).toBe("�");
    expect(decodeEntities(`&#x${"f".repeat(100)};`)).toBe("�");
  });

  it("replaces lone surrogates and NUL with U+FFFD", () => {
    expect(decodeEntities("&#xD800;")).toBe("�");
    expect(decodeEntities("&#xDFFF;")).toBe("�");
    expect(decodeEntities("&#55296;")).toBe("�");
    expect(decodeEntities("&#0;")).toBe("�");
  });

  it("still decodes the extremes of the valid range", () => {
    expect(decodeEntities("&#x10FFFF;")).toBe("\u{10FFFF}");
    expect(decodeEntities("&#x1F389;")).toBe("🎉");
    expect(decodeEntities("&#1;")).toBe("\u0001");
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
