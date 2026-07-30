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
    // RFC 5545 constrains OCTETS, not JS string length. The assertion used to
    // be `line.length <= 74`, which is neither the spec's unit nor its number
    // — and it passed happily while the implementation emitted ~148-octet
    // lines for emoji.
    const octets = (line: string): number => new TextEncoder().encode(line).length;
    const long = `SUMMARY:${"x".repeat(200)}`;
    const folded = foldIcsLine(long);
    for (const [i, line] of folded.split("\r\n").entries()) {
      expect(octets(line)).toBeLessThanOrEqual(75);
      if (i > 0) expect(line.startsWith(" ")).toBe(true);
    }
    expect(folded.split("\r\n").join("").replaceAll("\r\n ", "")).toContain("SUMMARY:");
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("ignores extra positional arguments, so Array#map cannot poison the limit", () => {
    // `lines.map(foldIcsLine)` passes (element, index, array). With an
    // optional second parameter that index lands in `limit`: index 0 gives a
    // limit of 0 and folds every character onto its own line, which is
    // exactly what shipped for one commit.
    const line = "SUMMARY:BEGIN";
    expect(["a", line].map((l) => foldIcsLine(l))).toEqual(["a", line]);
    // The default must survive being called the way map calls it.
    expect(foldIcsLine(line, undefined)).toBe(line);
  });

  it("never splits a code point, and measures multi-byte characters honestly", () => {
    // THE bug. Slicing by code unit at an odd offset splits a surrogate pair,
    // leaving a lone surrogate that is not encodable as UTF-8 — one emoji in
    // an event title was enough. And an emoji is 4 octets to 2 code units, so
    // the old fold ran to roughly double the limit before breaking.
    const octets = (line: string): number => new TextEncoder().encode(line).length;
    const folded = foldIcsLine(`SUMMARY:${"🎉".repeat(60)}`);
    for (const line of folded.split("\r\n")) {
      expect(octets(line)).toBeLessThanOrEqual(75);
      // The real check, and sufficient on its own: a lone surrogate is not
      // encodable as UTF-8, so encode→decode replaces it with U+FFFD and the
      // round-trip stops being an identity.
      expect(new TextDecoder().decode(new TextEncoder().encode(line))).toBe(line);
    }
    // Nothing lost: unfolding restores every emoji.
    const unfolded = folded.replaceAll("\r\n ", "");
    expect([...unfolded.matchAll(/🎉/gu)]).toHaveLength(60);
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
