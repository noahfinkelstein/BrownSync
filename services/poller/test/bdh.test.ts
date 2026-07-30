import { readFileSync } from "node:fs";
import path from "node:path";
import { SeedEventSchema } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import { normalizeBdh } from "../src/bdh/normalize";
import { FIXTURES_DIR } from "../src/paths";

const fixtureText = readFileSync(path.join(FIXTURES_DIR, "bdh-feed.xml"), "utf8");

describe("normalizeBdh (recorded fixture)", () => {
  const rows = normalizeBdh(fixtureText);

  it("normalizes every item to a valid contract seed event", () => {
    expect(rows.length).toBe(35);
    for (const row of rows) {
      expect(() => SeedEventSchema.parse(row)).not.toThrow();
      expect(row.source).toBe("bdh");
    }
  });

  it("is a buzz layer: no coords, no place, null category, tags [news]", () => {
    for (const row of rows) {
      expect(row.lat).toBeNull();
      expect(row.lng).toBeNull();
      expect(row.place_id).toBeNull();
      expect(row.location_raw).toBeNull();
      expect(row.org_id).toBeNull();
      // No taxonomy slot fits news; the layer is identified by source="bdh".
      expect(row.category).toBeNull();
      expect(row.tags).toEqual(["news"]);
      expect(row.end_ts).toBeNull();
      expect(row.is_all_day).toBe(false);
    }
  });

  it("uses the guid as source_id and pubDate as start_ts (UTC)", () => {
    const first = rows[0];
    expect(first?.source_id).toBe(
      "https://www.browndailyherald.com/article/2026/07/university-report-finds-split-ai-adoption-patterns-concerns-of-risks",
    );
    expect(first?.url).toBe(first?.source_id);
    // "Fri, 10 Jul 2026 00:36:45 -0400" → UTC
    expect(first?.start_ts).toBe("2026-07-10T04:36:45Z");
    expect(new Set(rows.map((r) => r.source_id)).size).toBe(rows.length);
  });

  // The BDH's Terms of Use prohibit automated indexing/data-mining of their
  // content, and their <description> carries the FULL article body in CDATA
  // (5.5 kB for a single item in this fixture). These four tests are the
  // regression guard for gate G1 in BROWNSYNC_V2_PLAN.md. Do not relax them
  // without written permission from herald@browndailyherald.com.
  it("never stores the article body as a description", () => {
    for (const row of rows) {
      expect(row.description).toBeNull();
    }
  });

  it("keeps only a metadata allowlist in raw — never the item, never the body", () => {
    const allowed = new Set(["guid", "link", "pubDate", "categories", "author"]);
    for (const row of rows) {
      const raw = row.raw as Record<string, unknown> | null;
      expect(raw).not.toBeNull();
      for (const key of Object.keys(raw ?? {})) {
        expect(allowed.has(key), `unexpected key in bdh raw: ${key}`).toBe(true);
      }
      expect(raw).not.toHaveProperty("description");
      expect(raw).not.toHaveProperty("content:encoded");
    }
  });

  it("retains bibliographic metadata that is fact, not expression", () => {
    const first = rows[0]?.raw as Record<string, unknown>;
    expect(first.author).toBe("Ivy Huang");
    expect(first.categories).toEqual(["University News", "homepage"]);
    expect(first.pubDate).toBe("Fri, 10 Jul 2026 00:36:45 -0400");
  });

  it("carries no article prose anywhere in the serialized row", () => {
    // The fixture's first article contains this sentence; a byte-level check
    // catches body text leaking through any field, present or future.
    const bodyFragment = "asymmetric patterns of generative AI use";
    expect(fixtureText).toContain(bodyFragment);
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain(bodyFragment);
    }
    // No row should carry a paragraph-sized string at all.
    for (const row of rows) {
      for (const value of Object.values(row.raw as Record<string, unknown>)) {
        if (typeof value === "string") expect(value.length).toBeLessThan(300);
      }
    }
  });

  it("skips malformed items instead of failing the run", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>No date</title><guid>g1</guid></item>
      <item><title>Good</title><guid>g2</guid><link>https://x.test/a</link><pubDate>Tue, 28 Jul 2026 12:00:00 -0400</pubDate></item>
    </channel></rss>`;
    const out = normalizeBdh(xml);
    expect(out.length).toBe(1);
    expect(out[0]?.source_id).toBe("g2");
    expect(out[0]?.start_ts).toBe("2026-07-28T16:00:00Z");
  });

  it("survives hostile numeric character references (one bad article must not kill the run)", () => {
    // `&amp;#x110000;` in the XML is the literal text `&#x110000;` after XML
    // parsing. decodeEntities' overflow/surrogate handling is covered directly
    // in util.test.ts; here we only assert the run survives a hostile item and
    // that the body is still not retained.
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item>
        <title>Overflow &amp;#x110000; attack</title>
        <guid>hostile</guid>
        <link>https://x.test/hostile</link>
        <pubDate>Tue, 28 Jul 2026 12:00:00 -0400</pubDate>
        <description>Body with &amp;#x110000; and &amp;#xD800; refs</description>
      </item>
    </channel></rss>`;
    const out = normalizeBdh(xml);
    expect(out.length).toBe(1);
    expect(out[0]?.description).toBeNull();
    expect(JSON.stringify(out[0])).not.toContain("Body with");
  });

  it("tolerates an item with no categories or author", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Bare</title><guid>bare</guid><link>https://x.test/b</link>
        <pubDate>Tue, 28 Jul 2026 12:00:00 -0400</pubDate></item>
    </channel></rss>`;
    const out = normalizeBdh(xml);
    expect(out.length).toBe(1);
    const raw = out[0]?.raw as Record<string, unknown>;
    expect(raw).not.toHaveProperty("categories");
    expect(raw).not.toHaveProperty("author");
    expect(raw.guid).toBe("bare");
  });
});
