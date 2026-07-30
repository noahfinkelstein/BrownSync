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

/**
 * Fold content lines to RFC 5545's 75-**octet** limit.
 *
 * The previous implementation sliced by JavaScript string length, which is
 * UTF-16 code units, and got two things wrong at once:
 *
 *   - **It measured the wrong thing.** An emoji is 4 octets and 2 code units,
 *     so a line of them emitted ~148 octets per fold — nearly double the
 *     limit, and strict parsers reject it.
 *   - **It could corrupt the text.** A slice at an odd offset splits a
 *     surrogate pair, leaving a lone surrogate that is not encodable as UTF-8
 *     at all. A single emoji in an event title was enough.
 *
 * So: measure in octets with TextEncoder, and iterate by code POINT (`for…of`
 * over a string yields whole code points) so a boundary can never land inside
 * one.
 */
const encoder = new TextEncoder();

export function foldIcsLine(line: string, limit = 75): string {
  if (encoder.encode(line).length <= limit) return line;
  const out: string[] = [];
  let buffer = "";
  let octets = 0;
  // A continuation line spends one of its octets on the leading space.
  const budget = (): number => (out.length === 0 ? limit : limit - 1);
  const flush = (): void => {
    out.push(out.length === 0 ? buffer : ` ${buffer}`);
    buffer = "";
    octets = 0;
  };
  // `for…of` over a string yields whole CODE POINTS, so a fold boundary can
  // never land inside a surrogate pair.
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > budget()) flush();
    buffer += char;
    octets += size;
  }
  if (buffer !== "") flush();
  return out.join(CRLF);
}

/** `YYYYMMDD` for the CAMPUS-local calendar day an instant falls on. */
function icsDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(iso))
    .replaceAll("-", "");
}

/** The exclusive DTEND for an all-day event: at least start + 1 day. */
function exclusiveEndDate(startIso: string, endIso: string | null): string {
  const DAY = 24 * 60 * MIN;
  const start = Date.parse(startIso);
  const end = endIso ? Date.parse(endIso) : Number.NaN;
  // A feed that already gives an exclusive end, or none at all, still has to
  // produce a range of at least one day — a zero-length all-day event is
  // dropped silently by most clients.
  const target = Number.isFinite(end) && end > start ? end : start + DAY;
  return new Date(target).toISOString();
}

/** One event → a complete VCALENDAR document. `stamp` defaults to now. */
export function eventToIcs(event: EventOut, stamp: Date = new Date()): string {
  const location = [event.placeName, event.locationRaw].filter(Boolean).join(" — ");
  const description = [event.description, event.url].filter(Boolean).join("\n\n");
  const endIso = event.end ?? new Date(Date.parse(event.start) + 90 * MIN).toISOString();

  // All-day events are DATE values, not midnight datetimes.
  //
  // Writing `DTSTART:20260910T040000Z` for an all-day event on the 10th means
  // "04:00 UTC", which every viewer renders in ITS OWN zone — so anyone west
  // of Providence sees it on the 9th. `DTSTART;VALUE=DATE:20260910` is
  // zoneless and lands on the 10th everywhere. RFC 5545 also makes the DATE
  // form's DTEND exclusive, hence the +1 day.
  const timing = event.allDay
    ? [
        `DTSTART;VALUE=DATE:${icsDate(event.start)}`,
        `DTEND;VALUE=DATE:${icsDate(exclusiveEndDate(event.start, event.end))}`,
      ]
    : [`DTSTART:${toIcsUtc(event.start)}`, `DTEND:${toIcsUtc(endIso)}`];

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BrownSync//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.id}@brownsync`,
    `DTSTAMP:${toIcsUtc(stamp.toISOString())}`,
    ...timing,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ];
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  if (event.url) lines.push(`URL:${escapeIcsText(event.url)}`);
  if (event.isCanceled) lines.push("STATUS:CANCELLED");
  lines.push("END:VEVENT", "END:VCALENDAR");

  // `lines.map((line) => …)`, NOT `lines.map(foldIcsLine)`. Array#map passes
  // (element, INDEX, array), so the point-free form feeds the index in as
  // `limit` — index 0 means a limit of 0 and every character folds onto its
  // own line. Safe while the function took one parameter; a latent trap the
  // moment it took two.
  return `${lines.map((line) => foldIcsLine(line)).join(CRLF)}${CRLF}`;
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
