import { type SeedEvent, SeedEventSchema } from "@brownsync/contract";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { toIsoUtc } from "../util";

/**
 * Brown Daily Herald RSS 2.0 — the "buzz" layer (contract §5): article rows
 * with no coords, tags `["news"]`, start_ts = pubDate. Category stays null —
 * the fixed §4 taxonomy has no news slot and `admin` means deadlines /
 * university ops; the buzz layer is identified by `source = "bdh"` instead.
 *
 * HEADLINE-ONLY, DELIBERATELY. The BDH's Terms of Use prohibit obtaining,
 * copying, monitoring, indexing, or data-mining their content by automated
 * means, and their content is copyright The Brown Daily Herald, Inc. Their
 * robots.txt permits crawling (`Crawl-delay: 10`), but terms of service govern
 * over a permissive robots.txt.
 *
 * Their `<description>` carries the FULL article body in CDATA — a single item
 * in the recorded fixture is 5.5 kB of multi-paragraph prose. So:
 *
 *   - `description` is always null. We never read the body.
 *   - `raw` carries identifiers and bibliographic metadata ONLY (guid, link,
 *     pubDate, categories, author) — facts about the article, never its text.
 *
 * We store the headline, the link, the timestamp, and the byline, and we send
 * readers to the Herald. Loosening this requires written permission from
 * herald@browndailyherald.com, and is an explicit, reviewable change here —
 * not a quiet widening of a truncation constant.
 *
 * See BROWNSYNC_V2_PLAN.md gate G1.
 */

const FeedSchema = z.looseObject({
  rss: z.looseObject({
    channel: z.looseObject({
      // A single <item> parses as an object, many as an array; isArray below
      // forces the array shape, but keep the union for schema honesty.
      item: z.union([z.array(z.unknown()), z.unknown()]).nullish(),
    }),
  }),
});

const parser = new XMLParser({
  ignoreAttributes: false,
  // Keep every value a string — SNworks titles/guids must not be number-coerced.
  parseTagValue: false,
  isArray: (_name, jpath) => jpath === "rss.channel.item",
});

/** RSS values may be plain strings or {#text, @_attr} objects (e.g. guid isPermaLink). */
function text(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && "#text" in v) {
    return text((v as Record<string, unknown>)["#text"]);
  }
  return null;
}

/** `<category>` repeats; the parser yields a string for one and an array for many. */
function textList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const entry of raw) {
    const s = text(entry);
    if (s) out.push(s);
  }
  return out;
}

/**
 * The ONLY fields we retain from a BDH item. An allowlist, not a denylist:
 * a new element appearing in their feed must be added here deliberately
 * rather than being swept into `raw` by default.
 */
function safeMetadata(rec: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    guid: text(rec.guid),
    link: text(rec.link),
    pubDate: text(rec.pubDate),
  };
  const categories = textList(rec.category);
  if (categories.length > 0) meta.categories = categories;
  const author = text(rec.author) ?? text(rec["dc:creator"]);
  if (author) meta.author = author;
  return meta;
}

/** Raw RSS text → validated contract rows. Malformed individual items are skipped. */
export function normalizeBdh(xmlText: string): SeedEvent[] {
  const doc = FeedSchema.parse(parser.parse(xmlText));
  const items = Array.isArray(doc.rss.channel.item) ? doc.rss.channel.item : [];
  const rows: SeedEvent[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const title = text(rec.title);
    const link = text(rec.link);
    const sourceId = text(rec.guid) ?? link;
    const pubDate = text(rec.pubDate);
    const published = pubDate ? new Date(pubDate) : null;
    if (!title || !sourceId || !published || Number.isNaN(published.getTime())) continue;

    rows.push(
      SeedEventSchema.parse({
        source: "bdh",
        source_id: sourceId,
        title,
        // Never the article body — see the licence note at the top of this file.
        description: null,
        start_ts: toIsoUtc(published),
        end_ts: null,
        is_all_day: false,
        rrule: null,
        location_raw: null,
        place_id: null,
        lat: null,
        lng: null,
        org_id: null,
        // Null, not "admin": no taxonomy slot fits news, and "admin" would
        // surface articles under the deadlines/university-ops filter chip.
        category: null,
        tags: ["news"],
        url: link,
        cost: null,
        confidence: 1,
        is_canceled: false,
        // Metadata allowlist, never the item — `rec.description` is the full body.
        raw: safeMetadata(rec),
      }),
    );
  }
  return rows;
}
