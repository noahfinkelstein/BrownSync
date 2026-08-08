import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MAX_HEADLINE_CHARS,
  MIN_LISTING_ITEMS,
  parseBrownNewsListing,
} from "@brownsync/sources/brown_news/index";
import { describe, expect, it } from "vitest";
import { FIXTURES_DIR } from "../src/paths";

/**
 * Parser proof over the ONE recorded listing (fixture policy: a single
 * polite live request with the declared UA recorded 2026-08-07; every test
 * replays it — CI never touches brown.edu).
 */

const fixtureHtml = readFileSync(path.join(FIXTURES_DIR, "brown-news-listing.html"), "utf8");

describe("parseBrownNewsListing (recorded fixture)", () => {
  const items = parseBrownNewsListing(fixtureHtml);

  it("recovers every unique dateful listing item, past the fail-closed floor", () => {
    // The 2026-08-07 recording carries 43 unique /news/YYYY-MM-DD/slug hrefs,
    // each linked up to three times (image tile, headline, Read-Article chip).
    expect(items).toHaveLength(43);
    expect(items.length).toBeGreaterThanOrEqual(MIN_LISTING_ITEMS);
    expect(new Set(items.map((i) => i.source_id)).size).toBe(items.length);
  });

  it("keeps the headline anchor, never the Read-Article chip or an image tile", () => {
    for (const item of items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.title.length).toBeLessThanOrEqual(MAX_HEADLINE_CHARS);
      expect(item.title).not.toMatch(/read article/i);
      // stripHtml leaves no markup or collapsed-whitespace artifacts behind.
      expect(item.title).not.toMatch(/[<>]/);
      expect(item.title).not.toMatch(/\s{2,}/);
    }
    // A known 2026-08-07 headline, entity-decoding included ("Brown's").
    const mtl = items.find((i) => i.source_id.endsWith("/multidisciplinary-teaching-laboratories"));
    expect(mtl?.title).toBe(
      "Meet the scientists behind the science, at Brown’s Multidisciplinary Teaching Laboratories",
    );
  });

  it("derives url, source_id and published_at from the href alone", () => {
    for (const item of items) {
      expect(item.source_id).toMatch(/^\/news\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9\-_.]*$/);
      expect(item.url).toBe(`https://www.brown.edu${item.source_id}`);
      expect(item.listing_date).toBe(item.source_id.split("/")[2]);
      // Midnight America/New_York of the listing date, expressed in UTC —
      // 04:00Z during EDT, 05:00Z during EST.
      expect(item.published_at).toMatch(/^\d{4}-\d{2}-\d{2}T0[45]:00:00Z$/);
    }
    const known = items.find((i) => i.listing_date === "2026-08-06");
    expect(known?.published_at).toBe("2026-08-06T04:00:00Z");
  });

  it("sorts newest-first with a path tiebreak so replays are deterministic", () => {
    const dates = items.map((i) => i.listing_date);
    const sorted = [...dates].sort((a, b) => b.localeCompare(a));
    expect(dates).toEqual(sorted);
  });

  it("yields title+URL+date and NOTHING else — no body, no teaser, no image", () => {
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual([
        "listing_date",
        "published_at",
        "source_id",
        "title",
        "url",
      ]);
    }
  });
});

describe("parseBrownNewsListing (hostile/drifted input)", () => {
  it("returns few-or-no items on selector drift instead of guessing", () => {
    expect(parseBrownNewsListing("")).toEqual([]);
    expect(parseBrownNewsListing("<html><body><a href='/about'>About</a></body></html>")).toEqual(
      [],
    );
    // A redesign that drops the dateful path shape must yield zero, so the
    // runner's <MIN_LISTING_ITEMS gate fires and nothing is upserted.
    expect(parseBrownNewsListing('<a href="/news/some-slug">Headline</a>')).toEqual([]);
  });

  it("never stores a card-wide anchor blob as a title (licence guard, fails CLOSED)", () => {
    // The accessibility-driven Drupal card pattern: ONE anchor wrapping the
    // whole card — headline + category + date + dek. Longest-text-wins alone
    // would be GUARANTEED to store the dek-bearing blob under `title`, the
    // one text column the headline_only CHECKs exempt. The cap must reject
    // the blob; with no other anchor for the href, the ITEM fails — and a
    // page of such cards then trips the MIN_LISTING_ITEMS gate.
    const dek =
      "A sweeping new dek paragraph describing the research in licensed editorial prose, " +
      "long enough that no plausible headline could ever reach it, repeated for weight. ".repeat(3);
    const card =
      '<a href="/news/2026-08-06/card-redesign" class="card">' +
      "<h3>Real headline inside the card</h3>" +
      '<span class="category">Science</span><time>August 6, 2026</time>' +
      `<p>${dek}</p></a>`;
    expect(parseBrownNewsListing(card)).toEqual([]);

    // If a separate plain headline anchor for the same href SURVIVES the
    // redesign, the item recovers with the bounded headline — never the blob.
    const cardPlusHeadline =
      `${card}\n<a href="/news/2026-08-06/card-redesign">Real headline inside the card</a>`;
    const recovered = parseBrownNewsListing(cardPlusHeadline);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.title).toBe("Real headline inside the card");
    expect(recovered[0]?.title.length).toBeLessThanOrEqual(MAX_HEADLINE_CHARS);
    expect(recovered[0]?.title).not.toContain("dek");
  });

  it("skips impossible dates and empty anchors, never fabricates", () => {
    const html = [
      '<a href="/news/2026-02-30/bad-date">Impossible date</a>',
      '<a href="/news/2026-13-01/bad-month">Impossible month</a>',
      '<a href="/news/2026-08-06/good"><img src="x.jpg"></a>',
      '<a href="/news/2026-08-06/good">A &amp; real headline</a>',
    ].join("\n");
    const items = parseBrownNewsListing(html);
    expect(items).toHaveLength(1);
    expect(items[0]?.source_id).toBe("/news/2026-08-06/good");
    expect(items[0]?.title).toBe("A & real headline");
  });
});
