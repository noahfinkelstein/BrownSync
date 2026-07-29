import type { EventOut } from "@brownsync/contract";

/**
 * Add-to-calendar: render one event as an RFC 5545 VCALENDAR/VEVENT and
 * trigger a client-side .ics download. Pure builders are unit-tested;
 * `downloadIcs` is the only DOM-touching piece.
 */

const CRLF = "\r\n";
const MIN = 60_000;

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, newlines. */
export function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/g, "\\n");
}

/** UTC date-time in iCalendar basic format: 20261031T230400Z. */
export function toIcsUtc(iso: string): string {
  const d = new Date(iso);
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(
    d.getUTCHours(),
  )}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Fold content lines longer than 75 octets (simple char-based fold). */
export function foldIcsLine(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 74));
  rest = rest.slice(74);
  while (rest.length > 0) {
    parts.push(` ${rest.slice(0, 73)}`);
    rest = rest.slice(73);
  }
  return parts.join(CRLF);
}

/** One event → a complete VCALENDAR document. `stamp` defaults to now. */
export function eventToIcs(event: EventOut, stamp: Date = new Date()): string {
  const location = [event.placeName, event.locationRaw].filter(Boolean).join(" — ");
  const description = [event.description, event.url].filter(Boolean).join("\n\n");
  const endIso = event.end ?? new Date(Date.parse(event.start) + 90 * MIN).toISOString();

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BrownSync//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.id}@brownsync`,
    `DTSTAMP:${toIcsUtc(stamp.toISOString())}`,
    `DTSTART:${toIcsUtc(event.start)}`,
    `DTEND:${toIcsUtc(endIso)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ];
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  if (event.url) lines.push(`URL:${escapeIcsText(event.url)}`);
  if (event.isCanceled) lines.push("STATUS:CANCELLED");
  lines.push("END:VEVENT", "END:VCALENDAR");

  return `${lines.map(foldIcsLine).join(CRLF)}${CRLF}`;
}

/** "outing-club-general-body-meeting.ics" */
export function icsFilename(event: EventOut): string {
  const slug = event.title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "")
    .slice(0, 60);
  return `${slug || "event"}.ics`;
}

/** Browser-only: build the file and hand it to the user agent. */
export function downloadIcs(event: EventOut): void {
  const blob = new Blob([eventToIcs(event)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = icsFilename(event);
  anchor.click();
  URL.revokeObjectURL(url);
}
