import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  categorize,
  EVENT_TYPE_CATEGORIES,
  IGNORED_EVENT_TYPES,
} from "../src/livewhale/categories";
import { FIXTURES_DIR } from "../src/paths";

describe("livewhale category mapping", () => {
  it("covers every event_type present in the recorded real feed", () => {
    const feed = JSON.parse(
      readFileSync(path.join(FIXTURES_DIR, "livewhale-events.json"), "utf8"),
    ) as Array<{ event_types: string[] | null }>;
    const seen = new Set(feed.flatMap((e) => e.event_types ?? []).map((t) => t.trim()));
    const mapped = new Set(EVENT_TYPE_CATEGORIES.map(([t]) => t));
    for (const type of seen) {
      expect(mapped.has(type) || IGNORED_EVENT_TYPES.has(type)).toBe(true);
    }
  });

  it("maps topical types per the table", () => {
    expect(categorize(["Performances, Concerts and Exhibitions"], null)).toBe("arts");
    expect(categorize(["Lectures, Seminars and Workshops"], null)).toBe("academic");
    expect(categorize(["Conferences and Colloquia"], null)).toBe("academic");
    expect(categorize(["Free Food"], null)).toBe("food");
    expect(categorize(["Social Event, Study Break"], null)).toBe("social");
    expect(categorize(["Awards, Receptions and Celebrations"], null)).toBe("social");
  });

  it("prioritizes the more student-actionable signal on multi-typed events", () => {
    expect(categorize(["Lectures, Seminars and Workshops", "Free Food"], null)).toBe("food");
    expect(
      categorize(["Social Event, Study Break", "Performances, Concerts and Exhibitions"], null),
    ).toBe("arts");
  });

  it("ignores audience qualifiers, including LiveWhale's stray leading space", () => {
    expect(categorize([" Open to the Public"], null)).toBe("academic");
    expect(categorize(["Open to the Public", "Free Food"], null)).toBe("food");
  });

  it("falls back to the publisher group when no topical type is present", () => {
    expect(categorize(null, "Athletics")).toBe("athletics");
    expect(categorize([], "Academic Calendar")).toBe("admin");
    expect(categorize(null, "Tisch Career Center")).toBe("career");
    expect(categorize(null, "Student Health &amp; Wellness")).toBe("wellness");
    expect(categorize(null, "Human Resources")).toBe("admin");
  });

  it("defaults to academic for unmapped rows (info sessions, defenses, office hours)", () => {
    expect(categorize(null, "Nelson Center for Entrepreneurship")).toBe("academic");
    expect(categorize(null, null)).toBe("academic");
  });
});
