import { CATEGORY_IDS, MeetingOutSchema } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import {
  aggregateHealth,
  buildCountsByCategory,
  KNOWN_SOURCES,
  mapEvent,
  mapMeeting,
  mapOrg,
  mapPlace,
  normalizeCategory,
} from "../src/mappers";
import { eventRow, healthRows, meetingRow, orgRow, placeRow } from "./fixtures";

describe("mapEvent", () => {
  it("maps snake_case row to camelCase EventOut with ISO timestamps", () => {
    const out = mapEvent(eventRow);
    expect(out).toEqual({
      id: eventRow.id,
      title: eventRow.title,
      description: eventRow.description,
      start: "2026-09-15T22:00:00.000Z",
      end: "2026-09-15T23:30:00.000Z",
      allDay: false,
      lat: 41.8268,
      lng: -71.4025,
      placeId: "salomon-center",
      placeName: "Salomon Center",
      locationRaw: "Salomon Center 101",
      orgId: "brown-lecture-board",
      orgName: "Brown Lecture Board",
      category: "academic",
      tags: ["lecture", "maps"],
      url: eventRow.url,
      cost: null,
      source: "livewhale",
      confidence: 1,
      isCanceled: false,
      mergedSources: ["cab"],
    });
  });

  it("keeps nullable fields null (open-ended event, no place/org)", () => {
    const out = mapEvent({
      ...eventRow,
      end_ts: null,
      place_id: null,
      place_name: null,
      org_id: null,
      org_name: null,
      merged_sources: [],
    });
    expect(out.end).toBeNull();
    expect(out.placeId).toBeNull();
    expect(out.orgName).toBeNull();
    expect(out.mergedSources).toEqual([]);
  });

  it("falls back to 'academic' for null or off-taxonomy categories", () => {
    expect(mapEvent({ ...eventRow, category: null }).category).toBe("academic");
    expect(mapEvent({ ...eventRow, category: "livewhale-raw-type" }).category).toBe("academic");
    expect(normalizeCategory("athletics")).toBe("athletics");
  });
});

describe("mapPlace / mapOrg", () => {
  it("maps place row and degrades unknown kind to 'other'", () => {
    expect(mapPlace(placeRow).kind).toBe("academic");
    expect(mapPlace({ ...placeRow, kind: "spaceship" }).kind).toBe("other");
    expect(mapPlace(placeRow).address).toBe(placeRow.address);
  });

  it("maps org row, degrades unknown kind to 'external' and unknown category to null", () => {
    const out = mapOrg(orgRow);
    expect(out.defaultPlaceId).toBe("salomon-center");
    expect(out.kind).toBe("club");
    expect(mapOrg({ ...orgRow, kind: "??" }).kind).toBe("external");
    expect(mapOrg({ ...orgRow, category: "not-a-category" }).category).toBeNull();
  });
});

describe("mapMeeting", () => {
  it("truncates Postgres time strings to HH:MM", () => {
    const out = mapMeeting(meetingRow);
    expect(out.startTime).toBe("14:00");
    expect(out.endTime).toBe("15:20");
    expect(out.courseCode).toBe("CSCI 0150");
    expect(out.days).toBe("TTh");
    expect(MeetingOutSchema.parse(out)).toEqual(out);
  });

  it("passes HH:MM through unchanged and keeps unresolved places null", () => {
    const out = mapMeeting({
      ...meetingRow,
      start_time: "09:00",
      end_time: "09:50",
      place_id: null,
      place_name: null,
      lat: null,
      lng: null,
    });
    expect(out.startTime).toBe("09:00");
    expect(out.placeId).toBeNull();
    expect(out.lat).toBeNull();
  });
});

describe("buildCountsByCategory", () => {
  it("emits every taxonomy key, counts events, and adds meetings to 'class'", () => {
    const events = [mapEvent(eventRow), mapEvent({ ...eventRow, category: "arts" })];
    const counts = buildCountsByCategory(events, 3);
    expect(Object.keys(counts).sort()).toEqual([...CATEGORY_IDS].sort());
    expect(counts.academic).toBe(1);
    expect(counts.arts).toBe(1);
    expect(counts.class).toBe(3);
    expect(counts.food).toBe(0);
  });
});

describe("aggregateHealth", () => {
  it("keeps latest-run rows and synthesizes 'never' for known sources without runs", () => {
    const out = aggregateHealth(healthRows);
    const sources = out.sources.map((s) => s.source);
    expect(sources).toEqual([...sources].sort());
    for (const known of KNOWN_SOURCES) expect(sources).toContain(known);

    const livewhale = out.sources.find((s) => s.source === "livewhale");
    expect(livewhale).toMatchObject({
      status: "ok",
      lastRunAt: "2026-07-28T12:00:00.000Z",
      lastOkAt: "2026-07-28T12:00:00.000Z",
      itemsUpserted: 321,
      error: null,
    });

    const cab = out.sources.find((s) => s.source === "cab");
    expect(cab).toMatchObject({ status: "error", error: "HTTP 500 from cab.brown.edu" });

    const bdh = out.sources.find((s) => s.source === "bdh");
    expect(bdh).toMatchObject({ status: "never", lastRunAt: null, lastOkAt: null });
  });

  it("includes unknown-but-seen sources and degrades unknown statuses to 'error'", () => {
    const out = aggregateHealth([
      {
        source: "manual",
        status: "wat",
        last_run_at: new Date("2026-07-28T09:00:00Z"),
        last_ok_at: null,
        items_upserted: 2,
        error: null,
      },
    ]);
    const manual = out.sources.find((s) => s.source === "manual");
    expect(manual).toMatchObject({ status: "error", itemsUpserted: 2 });
    expect(out.sources).toHaveLength(KNOWN_SOURCES.length + 1);
  });
});
