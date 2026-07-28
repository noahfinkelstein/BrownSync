import { readFileSync } from "node:fs";
import path from "node:path";
import { SeedEventSchema } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import { normalizeAthletics } from "../src/athletics/normalize";
import { FIXTURES_DIR } from "../src/paths";

const fixtureText = readFileSync(path.join(FIXTURES_DIR, "athletics-calendar.ics"), "utf8");
const noVenues = new Map<string, string>();

describe("normalizeAthletics (recorded fixture)", () => {
  const rows = normalizeAthletics(fixtureText, noVenues);

  it("normalizes every VEVENT to a valid contract seed event", () => {
    expect(rows.length).toBe(170);
    for (const row of rows) {
      expect(() => SeedEventSchema.parse(row)).not.toThrow();
      expect(row.source).toBe("athletics_ics");
      expect(row.category).toBe("athletics");
      expect(row.org_id).toBeNull();
      expect(row.lat).toBeNull();
      expect(row.lng).toBeNull();
    }
  });

  it("uses the ICS UID as the stable source_id", () => {
    expect(new Set(rows.map((r) => r.source_id)).size).toBe(rows.length);
    expect(rows.some((r) => r.source_id === "vcal_20893-admin.brownbears.com")).toBe(true);
  });

  it("passes timed events through in UTC", () => {
    const game = rows.find((r) => r.source_id === "vcal_20893-admin.brownbears.com");
    expect(game).toMatchObject({
      title: "Brown University Women's Soccer vs New Haven",
      start_ts: "2026-08-20T23:00:00Z",
      end_ts: "2026-08-21T01:00:00Z",
      is_all_day: false,
      location_raw: "Providence, R.I., Stevenson-Pincince Field",
      tags: ["home"],
    });
  });

  it("anchors all-day events to America/New_York midnight regardless of system TZ", () => {
    const allDay = rows.find((r) => r.source_id === "vcal_20894-admin.brownbears.com");
    expect(allDay).toMatchObject({
      is_all_day: true,
      start_ts: "2026-08-23T04:00:00Z",
      end_ts: "2026-08-24T04:00:00Z",
      tags: [],
    });
  });

  it("decodes HTML entities in URLs", () => {
    const game = rows.find((r) => r.source_id === "vcal_20893-admin.brownbears.com");
    expect(game?.url).toBe("https://admin.brownbears.com/calendar.aspx?game_id=20893&sport_id=32");
  });

  it("keeps location_raw and a null place_id when no venue map exists", () => {
    for (const row of rows) expect(row.place_id).toBeNull();
  });

  it("resolves home venues through the Codex venue map, away games never", () => {
    const venues = new Map([["stevenson-pincince field", "stevenson-pincince-field"]]);
    const resolved = normalizeAthletics(fixtureText, venues);
    const home = resolved.find((r) => r.source_id === "vcal_20893-admin.brownbears.com");
    expect(home?.place_id).toBe("stevenson-pincince-field");
    // Away game at a named venue must NOT resolve (only Providence homes do).
    const away = resolved.find(
      (r) => r.location_raw === "Worcester, Mass., Linda Johnson Smith Soccer Stadium",
    );
    expect(away?.place_id).toBeNull();
    expect(away?.tags).toEqual([]);
  });
});
