import { type SeedEvent, SeedEventSchema } from "@brownsync/contract";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { stripHtml, toIsoUtc, truncate } from "../util";

/**
 * Brown Daily Herald RSS 2.0 — the "buzz" layer (contract §5): article rows
 * with no coords, tags `["news"]`, start_ts = pubDate. Category stays null —
 * the fixed §4 taxonomy has no news slot and `admin` means deadlines /
 * university ops; the buzz layer is identified by `source = "bdh"` instead.
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

/** Article description capped — the buzz layer wants a teaser, not the full body. */
const DESCRIPTION_MAX = 500;

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
    const description = text(rec.description);

    rows.push(
      SeedEventSchema.parse({
        source: "bdh",
        source_id: sourceId,
        title,
        description: description ? truncate(stripHtml(description), DESCRIPTION_MAX) : null,
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
        raw: rec,
      }),
    );
  }
  return rows;
}
