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

  it("is a buzz layer: no coords, no place, category admin, tags [news]", () => {
    for (const row of rows) {
      expect(row.lat).toBeNull();
      expect(row.lng).toBeNull();
      expect(row.place_id).toBeNull();
      expect(row.location_raw).toBeNull();
      expect(row.org_id).toBeNull();
      expect(row.category).toBe("admin");
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

  it("strips article HTML into a bounded plain-text teaser", () => {
    for (const row of rows) {
      if (row.description) {
        expect(row.description).not.toMatch(/<[a-z]+[^>]*>/i);
        expect(row.description.length).toBeLessThanOrEqual(500);
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
});
