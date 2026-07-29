import { describe, expect, it } from "vitest";
import {
  AthleticsVenuesSchema,
  CATEGORIES,
  CATEGORY_IDS,
  EventOutSchema,
  HealthOutSchema,
  OrgLivewhaleGroupsSchema,
  SeedCourseMeetingSchema,
  SeedEventSchema,
  SeedPlaceSchema,
  tokens,
} from "../src/index";

describe("taxonomy", () => {
  it("has exactly the 10 contract §4 categories, each with icon + color", () => {
    expect(CATEGORY_IDS).toHaveLength(10);
    expect(CATEGORIES).toHaveLength(10);
    for (const c of CATEGORIES) {
      expect(c.icon).toBe(`icon-${c.id}`);
      expect(c.colorToken).toBe(`--cat-${c.id}`);
      expect(c.colorHex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("category colors are unique", () => {
    const hexes = CATEGORIES.map((c) => c.colorHex);
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});

describe("tokens", () => {
  it("pins the §6.1 background stack and single accent", () => {
    expect(tokens.bg.base).toBe("#0B0E12");
    expect(tokens.accent).toBe("#D96C3D");
    expect(tokens.radius.max).toBeLessThanOrEqual(6);
    expect(tokens.type.scale).toEqual([12, 13, 15, 18, 24]);
  });
});

describe("EventOut", () => {
  it("accepts a contract §3-shaped event", () => {
    const out = EventOutSchema.parse({
      id: "5b0c7f9e-0000-4000-8000-000000000000",
      title: "CS Colloquium",
      description: null,
      start: "2026-09-10T20:00:00Z",
      end: "2026-09-10T21:00:00Z",
      allDay: false,
      lat: 41.8268,
      lng: -71.3998,
      placeId: "cit",
      placeName: "Watson CIT",
      locationRaw: "CIT 368",
      orgId: null,
      orgName: null,
      category: "academic",
      tags: [],
      url: "https://events.brown.edu/event/x",
      cost: null,
      source: "livewhale",
      confidence: 1,
      isCanceled: false,
    });
    expect(out.category).toBe("academic");
  });

  it("rejects a category outside the taxonomy", () => {
    expect(
      EventOutSchema.safeParse({
        id: "x",
        title: "t",
        description: null,
        start: "2026-09-10T20:00:00Z",
        end: null,
        allDay: false,
        lat: null,
        lng: null,
        placeId: null,
        placeName: null,
        locationRaw: null,
        orgId: null,
        orgName: null,
        category: "party",
        tags: [],
        url: null,
        cost: null,
        source: "livewhale",
        confidence: 1,
        isCanceled: false,
      }).success,
    ).toBe(false);
  });
});

describe("seed rows (contract §6)", () => {
  it("accepts a place row with WKT polygon", () => {
    const p = SeedPlaceSchema.parse({
      id: "barus-holley",
      name: "Barus & Holley",
      aliases: ["B&H", "BH", "Barus and Holley"],
      kind: "academic",
      lat: 41.8266,
      lng: -71.3996,
      polygon: "MULTIPOLYGON(((-71.4 41.82,-71.399 41.82,-71.399 41.827,-71.4 41.82)))",
      source: "osm",
    });
    expect(p.aliases).toContain("B&H");
  });

  it("accepts an event row and defaults confidence/tags", () => {
    const e = SeedEventSchema.parse({
      source: "clubs",
      source_id: "brown-outing-club-weekly",
      title: "Outing Club General Meeting",
      start_ts: "2026-09-08T23:00:00Z",
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      location_raw: "Wilson 302",
    });
    expect(e.confidence).toBe(1);
    expect(e.tags).toEqual([]);
    expect(e.is_canceled).toBe(false);
  });

  it("validates course-meeting day patterns", () => {
    const base = {
      id: "202610-12345-0",
      srcdb: "202610",
      crn: "12345",
      course_code: "CSCI 0150",
      title: "Intro to Object-Oriented Programming",
      days: "TTh",
      start_time: "13:00",
      end_time: "14:20",
    };
    expect(SeedCourseMeetingSchema.parse(base).days).toBe("TTh");
    expect(SeedCourseMeetingSchema.safeParse({ ...base, days: "TR" }).success).toBe(false);
  });
});

describe("OrgLivewhaleGroups sidecar (schema v1, coordinated with the ingestion lane)", () => {
  const valid = {
    schema_version: 1,
    generated_at: "2026-07-28T12:00:00Z",
    mappings: [
      {
        organization_id: "brown-outing-club",
        livewhale_group: "Brown Outing Club",
        match_method: "exact",
        score: 100,
      },
    ],
  };

  it("accepts the ingestion-lane v1 envelope", () => {
    const parsed = OrgLivewhaleGroupsSchema.parse(valid);
    expect(parsed.mappings[0]?.match_method).toBe("exact");
  });

  it("accepts fuzzy matches with fractional scores in 0..100", () => {
    const mapping = { ...valid.mappings[0], match_method: "fuzzy", score: 87.5 };
    expect(OrgLivewhaleGroupsSchema.safeParse({ ...valid, mappings: [mapping] }).success).toBe(
      true,
    );
  });

  it("rejects match_method outside exact|fuzzy", () => {
    const mapping = { ...valid.mappings[0], match_method: "alias" };
    expect(OrgLivewhaleGroupsSchema.safeParse({ ...valid, mappings: [mapping] }).success).toBe(
      false,
    );
  });

  it("rejects scores outside 0..100", () => {
    for (const score of [-1, 101]) {
      const mapping = { ...valid.mappings[0], score };
      expect(OrgLivewhaleGroupsSchema.safeParse({ ...valid, mappings: [mapping] }).success).toBe(
        false,
      );
    }
  });

  it("requires generated_at as an ISO timestamp", () => {
    const { generated_at: _generatedAt, ...missing } = valid;
    expect(OrgLivewhaleGroupsSchema.safeParse(missing).success).toBe(false);
    expect(
      OrgLivewhaleGroupsSchema.safeParse({ ...valid, generated_at: "yesterday" }).success,
    ).toBe(false);
  });

  it("rejects any schema_version other than 1 — a future v2 must fail loudly", () => {
    expect(OrgLivewhaleGroupsSchema.safeParse({ ...valid, schema_version: 2 }).success).toBe(false);
  });
});

describe("AthleticsVenues sidecar (schema v1, coordinated with the ingestion lane)", () => {
  const valid = {
    schema_version: 1,
    generated_at: "2026-07-29T05:19:12.064957Z",
    mappings: [
      { source_name: "Stevenson-Pincince Field", place_id: "stevenson-pincince-field" },
      { source_name: "OMAC", place_id: "olney-margolies-athletic-center" },
    ],
  };

  it("accepts the ingestion-lane v1 envelope", () => {
    const parsed = AthleticsVenuesSchema.parse(valid);
    expect(parsed.mappings).toHaveLength(2);
    expect(parsed.mappings[1]?.place_id).toBe("olney-margolies-athletic-center");
  });

  it("rejects the obsolete flat venue → place_id map — the pre-v1 shape must fail loudly", () => {
    expect(
      AthleticsVenuesSchema.safeParse({
        "Stevenson-Pincince Field": "stevenson-pincince-field",
        OMAC: "olney-margolies-athletic-center",
      }).success,
    ).toBe(false);
  });

  it('rejects schema_version "1" as a string — the version is a number', () => {
    expect(AthleticsVenuesSchema.safeParse({ ...valid, schema_version: "1" }).success).toBe(false);
  });

  it("rejects any schema_version other than 1 — a future v2 must fail loudly", () => {
    expect(AthleticsVenuesSchema.safeParse({ ...valid, schema_version: 2 }).success).toBe(false);
  });

  it("requires generated_at as an ISO timestamp", () => {
    const { generated_at: _generatedAt, ...missing } = valid;
    expect(AthleticsVenuesSchema.safeParse(missing).success).toBe(false);
    expect(AthleticsVenuesSchema.safeParse({ ...valid, generated_at: "yesterday" }).success).toBe(
      false,
    );
  });

  it("rejects empty source_name or place_id", () => {
    for (const mapping of [
      { source_name: "", place_id: "brown-stadium" },
      { source_name: "Brown Stadium", place_id: "" },
    ]) {
      expect(AthleticsVenuesSchema.safeParse({ ...valid, mappings: [mapping] }).success).toBe(
        false,
      );
    }
  });
});

describe("HealthOut", () => {
  it("accepts an empty sources list", () => {
    expect(HealthOutSchema.parse({ sources: [] }).sources).toEqual([]);
  });
});
