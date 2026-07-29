import { readFileSync } from "node:fs";
import path from "node:path";
import { SeedEventSchema } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import {
  livewhaleUtcToIso,
  normalizeLivewhaleEvent,
  normalizeLivewhaleFeed,
} from "../src/livewhale/normalize";
import { LivewhaleEventSchema, LivewhaleFeedSchema } from "../src/livewhale/schema";
import { FIXTURES_DIR } from "../src/paths";

const fixtureText = readFileSync(path.join(FIXTURES_DIR, "livewhale-events.json"), "utf8");
const noOrgs = new Map<string, string>();

describe("livewhale schema", () => {
  it("parses the recorded real response", () => {
    const feed = LivewhaleFeedSchema.parse(JSON.parse(fixtureText));
    expect(feed.length).toBe(1000);
  });
});

describe("livewhaleUtcToIso", () => {
  it("converts the feed's UTC format", () => {
    expect(livewhaleUtcToIso("2026-07-28 04:00:00")).toBe("2026-07-28T04:00:00Z");
    expect(livewhaleUtcToIso("not a date")).toBeNull();
  });
});

describe("normalizeLivewhaleFeed (recorded fixture)", () => {
  const rows = normalizeLivewhaleFeed(fixtureText, noOrgs);

  it("normalizes every row to a valid contract seed event", () => {
    expect(rows.length).toBe(1000);
    for (const row of rows) {
      expect(() => SeedEventSchema.parse(row)).not.toThrow();
      expect(row.source).toBe("livewhale");
    }
  });

  it("produces stable, unique source_ids across expanded repeat occurrences", () => {
    expect(new Set(rows.map((r) => r.source_id)).size).toBe(1000);
    for (const row of rows) expect(row.source_id).toMatch(/^\d+:\d+$/);
  });

  it("stores UTC timestamps", () => {
    for (const row of rows) {
      expect(row.start_ts.endsWith("Z")).toBe(true);
      if (row.end_ts) expect(row.end_ts.endsWith("Z")).toBe(true);
    }
  });

  it("keeps coords only when both are present, finite and in range", () => {
    const withCoords = rows.filter((r) => r.lat != null && r.lng != null);
    expect(withCoords.length).toBeGreaterThan(300);
    for (const row of withCoords) {
      const lat = row.lat as number;
      const lng = row.lng as number;
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lng)).toBeLessThanOrEqual(180);
    }
    expect(rows.every((r) => (r.lat == null) === (r.lng == null))).toBe(true);
  });

  it("decodes HTML entities out of titles", () => {
    expect(rows.some((r) => r.title.includes("&amp;"))).toBe(false);
  });
});

describe("normalizeLivewhaleEvent", () => {
  const base = {
    id: 334850,
    title: "Study Abroad in Australia &amp; New Zealand Info Session",
    url: "https://events.brown.edu/event/334850",
    date_utc: "2026-07-28 04:00:00",
    date_iso: "2026-07-28T00:00:00-04:00",
    date_ts: 1785211200,
    date2_utc: "2026-07-28 05:30:00",
    is_all_day: false,
    is_canceled: null,
    description: "<p>Come learn &amp; register!</p>",
    cost: 15,
    location: "164 Angell Street",
    location_title: null,
    location_latitude: 41.828299,
    location_longitude: "-71.401003",
    event_types: [" Open to the Public", "Lectures, Seminars and Workshops"],
    tags: ["Research"],
    group: "Alumni &amp; Friends",
  };

  it("normalizes one event end to end", () => {
    const row = normalizeLivewhaleEvent(LivewhaleEventSchema.parse(base), noOrgs);
    expect(row).toMatchObject({
      source: "livewhale",
      source_id: "334850:1785211200",
      title: "Study Abroad in Australia & New Zealand Info Session",
      description: "Come learn & register!",
      start_ts: "2026-07-28T04:00:00Z",
      end_ts: "2026-07-28T05:30:00Z",
      is_all_day: false,
      location_raw: "164 Angell Street",
      lat: 41.828299,
      lng: -71.401003,
      org_id: null,
      category: "academic",
      cost: "15",
      confidence: 1,
      is_canceled: false,
    });
  });

  it("attributes org_id via the inverted Codex group map (entity/case-insensitive)", () => {
    const orgs = new Map([["alumni & friends", "alumni-and-friends"]]);
    const row = normalizeLivewhaleEvent(LivewhaleEventSchema.parse(base), orgs);
    expect(row.org_id).toBe("alumni-and-friends");
  });

  it("nulls half-missing or out-of-range coords", () => {
    const ev = LivewhaleEventSchema.parse({
      ...base,
      location_latitude: 41.8,
      location_longitude: null,
    });
    const row = normalizeLivewhaleEvent(ev, noOrgs);
    expect(row.lat).toBeNull();
    expect(row.lng).toBeNull();
  });

  it("flags canceled occurrences", () => {
    const ev = LivewhaleEventSchema.parse({ ...base, is_canceled: 1 });
    expect(normalizeLivewhaleEvent(ev, noOrgs).is_canceled).toBe(true);
  });

  it("survives hostile numeric character references in titles", () => {
    // decodeEntities runs on the title — an out-of-range or lone-surrogate
    // reference in one event must not RangeError the whole poll run.
    const ev = LivewhaleEventSchema.parse({
      ...base,
      title: "Concert &#x110000; tonight &#xD800; only",
    });
    const row = normalizeLivewhaleEvent(ev, noOrgs);
    expect(row.title).toBe("Concert � tonight � only");
  });
});
