// @vitest-environment jsdom
import type { EventOut } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import {
  allDayRange,
  calendarLinks,
  campusDayKey,
  downloadEventsIcs,
  eventInterval,
  eventsToIcs,
  exportableEvents,
  foldIcsLine,
  googleCalendarUrl,
  googleDatesParam,
  icsCalendarFilename,
  outlookCalendarUrl,
} from "../src/events/calendar";
import { absoluteHttpUrl } from "../src/events/url";
import { mkEvent } from "./helpers/fixtures";

/**
 * Every test here names the concrete broken-calendar-entry it prevents.
 * The class of bug is the same one throughout: the export "works" — no
 * error, no empty screen — and lands on the wrong day, or at "now".
 */

/** 19:04 ET on Oct 1 2026 (EDT, UTC−4). */
const TIMED: EventOut = mkEvent({
  id: "e-timed",
  title: "Outing Club — General Body Meeting; bring gear, snacks 🏕",
  start: "2026-10-01T23:04:00Z",
  end: "2026-10-02T00:34:00Z",
  placeName: "Stephen Robert '62 Campus Center",
  locationRaw: "Petteruti Lounge",
  orgId: "brown-outing-club",
  orgName: "Brown Outing Club",
  description: "Line one\nLine two",
  url: "https://events.brown.example.edu/event/boc-gbm",
});

/** All-day on Oct 1 2026: start is campus midnight (04:00 UTC in EDT). */
const ALL_DAY: EventOut = mkEvent({
  id: "e-allday",
  title: "Family Weekend",
  start: "2026-10-01T04:00:00Z",
  end: null,
  allDay: true,
});

const STAMP = new Date("2026-09-30T12:00:00Z");

describe("googleDatesParam — the silent 'event lands at now' bug", () => {
  it("emits BASIC-format UTC, never toISOString()'s extended format", () => {
    // Google accepts ONLY YYYYMMDDTHHMMSSZ. Handed the extended form it
    // drops the parameter without complaint and opens the composer at the
    // current time — no error anywhere, wrong event everywhere.
    expect(googleDatesParam(TIMED)).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);
    expect(googleDatesParam(TIMED)).toBe("20261001T230400Z/20261002T003400Z");
    expect(googleDatesParam(TIMED)).not.toContain("-");
    expect(googleDatesParam(TIMED)).not.toContain(":");
    expect(googleDatesParam(TIMED)).not.toContain(".");
  });

  it("gives an event with no end the map's default duration, not zero", () => {
    // A zero-length range is discarded by Google exactly like a malformed
    // one, so an open-ended event would also land at "now".
    const open = { ...TIMED, end: null };
    expect(googleDatesParam(open)).toBe("20261001T230400Z/20261002T003400Z");
    const { start, end } = eventInterval(open);
    expect(end.getTime() - start.getTime()).toBe(90 * 60_000);
  });

  it("clamps a feed that reports end <= start", () => {
    const backwards = { ...TIMED, end: "2026-10-01T22:00:00Z" };
    expect(googleDatesParam(backwards)).toBe("20261001T230400Z/20261002T003400Z");
  });

  it("all-day uses YYYYMMDD with an EXCLUSIVE end date", () => {
    // Inclusive ends make every all-day event a day short; a ONE-day event
    // becomes zero days long and never appears in the calendar at all.
    expect(googleDatesParam(ALL_DAY)).toMatch(/^\d{8}\/\d{8}$/);
    expect(googleDatesParam(ALL_DAY)).toBe("20261001/20261002");
  });
});

describe("allDayRange — campus dates, both end conventions", () => {
  it("reads an end at campus midnight as ALREADY exclusive", () => {
    // RFC 5545's own convention: DTEND for a DATE value is exclusive. A feed
    // that follows it would otherwise gain a spurious trailing day.
    const twoDays = { ...ALL_DAY, end: "2026-10-03T04:00:00Z" };
    expect(allDayRange(twoDays)).toEqual({ start: "2026-10-01", end: "2026-10-03" });
  });

  it("reads a mid-day end as inclusive of that day", () => {
    const throughFriday = { ...ALL_DAY, end: "2026-10-02T21:00:00Z" };
    expect(allDayRange(throughFriday)).toEqual({ start: "2026-10-01", end: "2026-10-03" });
  });

  it("never emits an end at or before the start", () => {
    const degenerate = { ...ALL_DAY, end: "2026-10-01T04:00:00Z" };
    expect(allDayRange(degenerate)).toEqual({ start: "2026-10-01", end: "2026-10-02" });
  });

  it("resolves the day in campus time, not the viewer's or UTC", () => {
    // 21:00 ET on Oct 1 is already Oct 2 in UTC. Keying off UTC would file
    // every evening event under the following day.
    expect(campusDayKey(new Date("2026-10-02T01:00:00Z"))).toBe("2026-10-01");
  });
});

describe("URL escaping", () => {
  const google = new URL(googleCalendarUrl(TIMED));

  it("round-trips a title with a comma, semicolon, newline and emoji", () => {
    expect(google.searchParams.get("text")).toBe(TIMED.title);
    expect(google.searchParams.get("details")).toContain("Line one\nLine two");
    expect(google.searchParams.get("location")).toBe(
      "Stephen Robert '62 Campus Center — Petteruti Lounge",
    );
    // The raw query string must be encoded — a bare newline or ';' there
    // truncates the parameter at the transport layer.
    expect(google.search).not.toContain("\n");
    expect(google.search).toContain("%0A");
  });

  it("targets the documented Google TEMPLATE endpoint", () => {
    expect(google.origin + google.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(google.searchParams.get("action")).toBe("TEMPLATE");
    expect(google.searchParams.get("dates")).toBe("20261001T230400Z/20261002T003400Z");
  });

  it("Outlook wants EXTENDED ISO datetimes — the opposite of Google", () => {
    const outlook = new URL(outlookCalendarUrl(TIMED));
    expect(outlook.host).toBe("outlook.live.com");
    expect(outlook.searchParams.get("startdt")).toBe("2026-10-01T23:04:00.000Z");
    expect(outlook.searchParams.get("enddt")).toBe("2026-10-02T00:34:00.000Z");
    expect(outlook.searchParams.get("subject")).toBe(TIMED.title);
    expect(outlook.searchParams.get("allday")).toBeNull();
    expect(new URL(outlookCalendarUrl(TIMED, "work")).host).toBe("outlook.office.com");
  });

  it("Outlook all-day sends bare dates plus allday=true", () => {
    const outlook = new URL(outlookCalendarUrl(ALL_DAY));
    expect(outlook.searchParams.get("allday")).toBe("true");
    expect(outlook.searchParams.get("startdt")).toBe("2026-10-01");
    expect(outlook.searchParams.get("enddt")).toBe("2026-10-02");
  });

  it("every emitted link is an absolute https URL", () => {
    // Never a fragment, a relative path or an empty string — the directory
    // renders these straight into an href.
    for (const href of [googleCalendarUrl(TIMED), outlookCalendarUrl(TIMED)]) {
      expect(absoluteHttpUrl(href)).not.toBeNull();
      expect(new URL(href).protocol).toBe("https:");
    }
  });
});

describe("absoluteHttpUrl — the no-dead-links gate", () => {
  it("rejects everything a feed hands us that is not a real link", () => {
    for (const junk of [
      "",
      "  ",
      "#",
      "TBD",
      "/events/1",
      "javascript:alert(1)",
      null,
      undefined,
    ]) {
      expect(absoluteHttpUrl(junk)).toBeNull();
    }
    expect(absoluteHttpUrl("https://brown.edu/x")).toBe("https://brown.edu/x");
    expect(absoluteHttpUrl("  http://brown.edu/x  ")).toBe("http://brown.edu/x");
    expect(absoluteHttpUrl("events.brown.edu/x")).toBe("https://events.brown.edu/x");
    expect(absoluteHttpUrl("//events.brown.edu/x")).toBe("https://events.brown.edu/x");
  });
});

describe("canceled events are never exported", () => {
  const canceled = { ...TIMED, isCanceled: true };

  it("calendarLinks returns null so the UI cannot render the affordance", () => {
    expect(calendarLinks(canceled)).toBeNull();
    expect(calendarLinks(TIMED)).not.toBeNull();
  });

  it("the bulk .ics path drops them too — no back door", () => {
    expect(exportableEvents([TIMED, canceled])).toEqual([TIMED]);
    const ics = eventsToIcs([TIMED, canceled], STAMP);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).not.toContain("STATUS:CANCELLED");
  });

  it("downloadEventsIcs reports false rather than pretending", () => {
    expect(downloadEventsIcs([canceled])).toBe(false);
  });
});

describe("eventsToIcs — a multi-event VCALENDAR", () => {
  const ics = eventsToIcs([TIMED, ALL_DAY], STAMP);
  const unfolded = ics.replaceAll("\r\n ", "");

  it("is ONE calendar wrapping N events, not N concatenated calendars", () => {
    // panels/ics.ts#eventToIcs emits a whole VCALENDAR per event; gluing two
    // together produces a document most clients import as a single event or
    // reject outright.
    expect(ics.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
    expect(ics.match(/END:VCALENDAR/g)).toHaveLength(1);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("escapes TEXT per RFC 5545 (backslash, semicolon, comma, newline)", () => {
    expect(unfolded).toContain(
      "SUMMARY:Outing Club — General Body Meeting\\; bring gear\\, snacks 🏕",
    );
    expect(unfolded).toContain("DESCRIPTION:Line one\\nLine two\\n\\nhttps://events.brown");
    expect(unfolded).toContain("LOCATION:Stephen Robert '62 Campus Center — Petteruti Lounge");
  });

  it("writes all-day events as VALUE=DATE with the exclusive end", () => {
    // A midnight DTSTART would carry a timezone, and a viewer one hour west
    // would see the event on the previous day.
    expect(unfolded).toContain("DTSTART;VALUE=DATE:20261001");
    expect(unfolded).toContain("DTEND;VALUE=DATE:20261002");
    expect(unfolded).toContain("DTSTART:20261001T230400Z");
    expect(unfolded).toContain("DTEND:20261002T003400Z");
    expect(unfolded).toContain("DTSTAMP:20260930T120000Z");
  });

  it("uses CRLF everywhere — a bare LF is rejected by strict parsers", () => {
    expect(ics.split("\r\n").length).toBeGreaterThan(10);
    expect(ics.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("omits a URL line when the feed's url is not a real link", () => {
    const junk = eventsToIcs([{ ...TIMED, url: "#" }], STAMP);
    expect(junk).not.toContain("URL:");
  });

  it("normalizes a scheme-less feed URL in exported calendar data", () => {
    const normalized = eventsToIcs(
      [{ ...TIMED, url: "events.brown.edu/event/boc-gbm" }],
      STAMP,
    ).replaceAll("\r\n ", "");

    expect(normalized).toContain("URL:https://events.brown.edu/event/boc-gbm");
  });
});

describe("foldIcsLine — 75 OCTETS, not 75 characters", () => {
  it("keeps short lines untouched", () => {
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds with a leading-space continuation that unfolds losslessly", () => {
    const line = `SUMMARY:${"x".repeat(300)}`;
    const folded = foldIcsLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const [i, part] of parts.entries()) {
      if (i > 0) expect(part.startsWith(" ")).toBe(true);
    }
    expect(folded.replaceAll("\r\n ", "")).toBe(line);
  });

  it("counts UTF-8 octets, so an emoji line stays within the limit", () => {
    // A char-based fold slices at 74 UTF-16 units; 74 units of 4-octet emoji
    // is ~148 octets, twice the RFC ceiling.
    const line = `SUMMARY:${"🏕".repeat(60)}`;
    const encoder = new TextEncoder();
    for (const part of foldIcsLine(line).split("\r\n")) {
      expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
    }
  });

  it("never splits a surrogate pair", () => {
    // Slicing mid-pair yields a lone surrogate, which is not encodable as
    // UTF-8 — the emoji reaches the calendar as replacement characters.
    const line = `SUMMARY:${"🏕".repeat(60)}`;
    const folded = foldIcsLine(line);
    expect(folded).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(folded).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(folded.replaceAll("\r\n ", "")).toBe(line);
  });

  it("folds the real emoji-bearing summary inside a whole calendar", () => {
    const long = eventsToIcs([{ ...TIMED, description: "🏕".repeat(80) }], STAMP);
    const encoder = new TextEncoder();
    for (const line of long.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});

describe("icsCalendarFilename", () => {
  it("slugs a single event and names a set generically", () => {
    expect(icsCalendarFilename([ALL_DAY])).toBe("family-weekend.ics");
    expect(icsCalendarFilename([TIMED, ALL_DAY])).toBe("brownsync-events.ics");
    expect(icsCalendarFilename([])).toBe("brownsync-events.ics");
  });
});
