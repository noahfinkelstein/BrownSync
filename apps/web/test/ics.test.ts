import type { EventOut } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import { escapeIcsText, eventToIcs, foldIcsLine, icsFilename, toIcsUtc } from "../src/panels/ics";

const event: EventOut = {
  id: "00000000-0000-4000-8000-000000000002",
  title: "Outing Club — General Body Meeting; bring gear, snacks",
  description: "Line one\nLine two",
  start: "2026-10-01T23:04:00Z",
  end: "2026-10-02T00:04:00Z",
  allDay: false,
  lat: 41.8267,
  lng: -71.4025,
  placeId: "faunce-house",
  placeName: "Stephen Robert '62 Campus Center",
  locationRaw: "Petteruti Lounge",
  orgId: "brown-outing-club",
  orgName: "Brown Outing Club",
  category: "club",
  tags: ["gbm"],
  url: "https://events.brown.example.edu/event/boc-gbm",
  cost: null,
  source: "livewhale",
  confidence: 1,
  isCanceled: false,
};

const STAMP = new Date("2026-10-01T20:00:00Z");

describe("ICS building blocks", () => {
  it("escapes TEXT per RFC 5545", () => {
    expect(escapeIcsText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
  });

  it("renders basic-format UTC stamps", () => {
    expect(toIcsUtc("2026-10-01T23:04:00Z")).toBe("20261001T230400Z");
    expect(toIcsUtc("2026-01-05T03:00:09.500Z")).toBe("20260105T030009Z");
  });

  it("folds long lines with leading-space continuations", () => {
    const long = `SUMMARY:${"x".repeat(200)}`;
    const folded = foldIcsLine(long);
    for (const [i, line] of folded.split("\r\n").entries()) {
      expect(line.length).toBeLessThanOrEqual(74);
      if (i > 0) expect(line.startsWith(" ")).toBe(true);
    }
    expect(folded.split("\r\n").join("").replaceAll("\r\n ", "")).toContain("SUMMARY:");
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
  });
});

describe("eventToIcs", () => {
  const ics = eventToIcs(event, STAMP);
  const unfolded = ics.replaceAll("\r\n ", "");

  it("is a complete CRLF-terminated VCALENDAR", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
  });

  it("carries UID, stamps, summary, location, url", () => {
    expect(unfolded).toContain(`UID:${event.id}@brownsync`);
    expect(unfolded).toContain("DTSTAMP:20261001T200000Z");
    expect(unfolded).toContain("DTSTART:20261001T230400Z");
    expect(unfolded).toContain("DTEND:20261002T000400Z");
    expect(unfolded).toContain(
      "SUMMARY:Outing Club — General Body Meeting\\; bring gear\\, snacks",
    );
    expect(unfolded).toContain("LOCATION:Stephen Robert '62 Campus Center — Petteruti Lounge");
    expect(unfolded).toContain("URL:https://events.brown.example.edu/event/boc-gbm");
  });

  it("defaults a missing end to +90 min and flags cancellations", () => {
    const open = eventToIcs({ ...event, end: null }, STAMP);
    expect(open.replaceAll("\r\n ", "")).toContain("DTEND:20261002T003400Z");
    const canceled = eventToIcs({ ...event, isCanceled: true }, STAMP);
    expect(canceled).toContain("STATUS:CANCELLED");
  });
});

describe("icsFilename", () => {
  it("slugs the title", () => {
    expect(icsFilename(event)).toBe("outing-club-general-body-meeting-bring-gear-snacks.ics");
    expect(icsFilename({ ...event, title: "→←" })).toBe("event.ics");
  });
});
