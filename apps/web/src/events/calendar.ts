import { CATEGORY_BY_ID, type EventOut } from "@brownsync/contract";
import { CAMPUS_TZ } from "../data/format";
import { DEFAULT_DURATION_MS } from "../map/eventsLayer";
import { escapeIcsText, foldIcsLine, icsFilename, toIcsUtc } from "../panels/ics";
import { absoluteHttpUrl } from "./url";

/**
 * "Add to calendar" that actually lands on the right day.
 *
 * Three targets — Google, Outlook Web, and a downloadable .ics — for one
 * event or for a whole filtered set.
 *
 * The RFC 5545 primitives (`escapeIcsText`, `toIcsUtc`) and the single-event
 * filename slug come from `../panels/ics`; this module does NOT restate them.
 * What it adds is everything that file cannot express:
 *   - a MULTI-event VCALENDAR (`eventToIcs` there emits one whole VCALENDAR
 *     per event, so concatenating two of them yields an invalid document),
 *   - all-day events as `VALUE=DATE` with an EXCLUSIVE end,
 *   - octet-correct line folding (see `foldIcsLine` below),
 *   - the Google/Outlook URL builders.
 *
 * Timezone rule: campus events happen on College Hill, so every DATE-valued
 * calculation resolves in America/New_York, matching `../data/format`. Only
 * all-day events are affected — timed events are exported as UTC instants,
 * which carry no date ambiguity at all.
 */

const CRLF = "\r\n";
const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ time -- */

const campusDayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: CAMPUS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const campusClockFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: CAMPUS_TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function part(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/** Campus calendar day as "2026-10-01". Sorts chronologically as a string. */
export function campusDayKey(d: Date): string {
  // formatToParts rather than trusting en-CA to print ISO order — the locale
  // pattern is ICU data, and ICU data changes between Node releases.
  const parts = campusDayFmt.formatToParts(d);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

/** Campus calendar day in iCalendar/Google basic form: "20261001". */
export function campusBasicDate(d: Date): string {
  return campusDayKey(d).replaceAll("-", "");
}

/**
 * Shift a "YYYY-MM-DD" key by whole days. Pure UTC arithmetic anchored at
 * noon, so a DST transition (which moves campus midnight, never noon) can
 * never bump the result onto the neighbouring date.
 */
function addDays(key: string, days: number): string {
  const [y = 0, m = 1, d = 1] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d, 12) + days * DAY_MS);
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )}`;
}

function isCampusMidnight(d: Date): boolean {
  const parts = campusClockFmt.formatToParts(d);
  return (
    part(parts, "hour") === "00" && part(parts, "minute") === "00" && part(parts, "second") === "00"
  );
}

/**
 * Start/end instants for a TIMED event.
 *
 * A missing `end` falls back to the same window the map treats an open-ended
 * event as occupying (`DEFAULT_DURATION_MS`), so an event that exports has
 * exactly the duration the rest of the product already shows. A feed that
 * reports `end <= start` gets the same treatment: a zero-length block makes
 * Google discard the range and drop the event at "now".
 */
export function eventInterval(event: EventOut): { start: Date; end: Date } {
  const start = new Date(event.start);
  const fallback = new Date(start.getTime() + DEFAULT_DURATION_MS);
  if (!event.end) return { start, end: fallback };
  const end = new Date(event.end);
  if (!Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) {
    return { start, end: fallback };
  }
  return { start, end };
}

/**
 * First and last-plus-one campus dates of an ALL-DAY event, as "YYYY-MM-DD".
 *
 * Google, Outlook and RFC 5545 all treat the end of an all-day range as
 * EXCLUSIVE: a one-day event on Oct 1 is `20261001/20261002`. Emitting the
 * inclusive last day instead makes every all-day event a day short — the
 * single-day ones vanish from the calendar entirely.
 *
 * Feeds disagree about what `end` means for an all-day row, so both live
 * conventions are accepted: an `end` at campus midnight is read as already
 * exclusive, anything later in the day as inclusive of that day.
 */
export function allDayRange(event: EventOut): { start: string; end: string } {
  const startKey = campusDayKey(new Date(event.start));
  const minimum = addDays(startKey, 1);
  if (!event.end) return { start: startKey, end: minimum };
  const end = new Date(event.end);
  if (!Number.isFinite(end.getTime())) return { start: startKey, end: minimum };
  const endKey = campusDayKey(end);
  const exclusive = isCampusMidnight(end) ? endKey : addDays(endKey, 1);
  // String compare is chronological for zero-padded ISO keys.
  return { start: startKey, end: exclusive > startKey ? exclusive : minimum };
}

/* ------------------------------------------------------------------ text -- */

/** Location line shared by every target: resolved place, then the raw line. */
export function calendarLocation(event: EventOut): string {
  return [event.placeName, event.locationRaw].filter(Boolean).join(" — ");
}

/** Body/description shared by every target: blurb, then the source link. */
export function calendarDescription(event: EventOut): string {
  return [event.description, absoluteHttpUrl(event.url)].filter(Boolean).join("\n\n");
}

/* ------------------------------------------------------------- web links -- */

/** `a=1&b=2` with every value percent-encoded; empty values are dropped. */
function queryString(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] != null && entry[1] !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
}

/**
 * The `dates` value for a Google Calendar TEMPLATE link.
 *
 * Timed: `YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ` — iCalendar BASIC format, no
 * dashes or colons. `Date#toISOString()` produces EXTENDED format
 * (`2026-10-01T23:04:00.000Z`); Google does not reject it, it silently
 * ignores the whole parameter and opens the composer at the current time.
 * That failure is invisible in code review, which is why
 * `test/calendar.test.ts` pins the shape with a regex.
 *
 * All-day: `YYYYMMDD/YYYYMMDD`, end exclusive (see `allDayRange`).
 */
export function googleDatesParam(event: EventOut): string {
  if (event.allDay) {
    const { start, end } = allDayRange(event);
    return `${start.replaceAll("-", "")}/${end.replaceAll("-", "")}`;
  }
  const { start, end } = eventInterval(event);
  return `${toIcsUtc(start.toISOString())}/${toIcsUtc(end.toISOString())}`;
}

export function googleCalendarUrl(event: EventOut): string {
  const query = queryString({
    action: "TEMPLATE",
    text: event.title,
    dates: googleDatesParam(event),
    details: calendarDescription(event),
    location: calendarLocation(event),
  });
  return `https://calendar.google.com/calendar/render?${query}`;
}

/**
 * Outlook Web deep link.
 *
 * Unlike Google, the compose endpoint wants ISO-8601 EXTENDED datetimes —
 * the exact opposite convention, which is why the two builders cannot share
 * a formatter. All-day rows switch to bare dates plus `allday=true`, and the
 * end stays exclusive to match.
 *
 * `flavor` picks the tenant: personal Microsoft accounts live on
 * outlook.live.com, work/school (Microsoft 365) on outlook.office.com.
 */
export type OutlookFlavor = "personal" | "work";

export function outlookCalendarUrl(event: EventOut, flavor: OutlookFlavor = "personal"): string {
  const host = flavor === "work" ? "outlook.office.com" : "outlook.live.com";
  const times = event.allDay
    ? { allday: "true", ...allDayRange(event) }
    : (() => {
        const { start, end } = eventInterval(event);
        return { allday: undefined, start: start.toISOString(), end: end.toISOString() };
      })();
  const query = queryString({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: times.start,
    enddt: times.end,
    allday: times.allday,
    body: calendarDescription(event),
    location: calendarLocation(event),
  });
  return `https://${host}/calendar/0/deeplink/compose?${query}`;
}

export type CalendarLinks = { google: string; outlook: string };

/**
 * Web calendar links for one event, or null when it must not be exported.
 *
 * Canceled events return null: putting a canceled event on someone's
 * calendar is the single worst outcome this feature can produce, and a
 * `null` here means the UI cannot render the affordance by accident.
 */
export function calendarLinks(event: EventOut): CalendarLinks | null {
  if (!isExportable(event)) return null;
  return { google: googleCalendarUrl(event), outlook: outlookCalendarUrl(event) };
}

export function isExportable(event: EventOut): boolean {
  return !event.isCanceled;
}

/** The subset of `events` that may be written to a calendar. */
export function exportableEvents(events: readonly EventOut[]): EventOut[] {
  return events.filter(isExportable);
}

/* ------------------------------------------------------------------- ics -- */

/**
 * Re-exported, not reimplemented.
 *
 * This module briefly carried its own octet-correct fold because
 * `panels/ics.ts` sliced by UTF-16 code unit. That bug is fixed at the source
 * now, so a second copy here would be two implementations of one RFC rule —
 * and the next person to fix a folding bug would fix exactly one of them.
 *
 * The primitive lives in `panels/ics.ts` rather than here because the
 * dependency already runs that way (this file imports `escapeIcsText`,
 * `toIcsUtc` and `icsFilename` from it); importing back would be a cycle.
 */
export { foldIcsLine };

function veventLines(event: EventOut, stamp: Date): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.id}@brownsync`,
    `DTSTAMP:${toIcsUtc(stamp.toISOString())}`,
  ];
  if (event.allDay) {
    // VALUE=DATE, not a midnight datetime: a datetime DTSTART drags the event
    // into a timezone and a viewer an hour west sees it on the previous day.
    const { start, end } = allDayRange(event);
    lines.push(
      `DTSTART;VALUE=DATE:${start.replaceAll("-", "")}`,
      `DTEND;VALUE=DATE:${end.replaceAll("-", "")}`,
    );
  } else {
    const { start, end } = eventInterval(event);
    lines.push(`DTSTART:${toIcsUtc(start.toISOString())}`, `DTEND:${toIcsUtc(end.toISOString())}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
  const location = calendarLocation(event);
  if (location !== "") lines.push(`LOCATION:${escapeIcsText(location)}`);
  const description = calendarDescription(event);
  if (description !== "") lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  const url = absoluteHttpUrl(event.url);
  if (url) lines.push(`URL:${escapeIcsText(url)}`);
  lines.push(`CATEGORIES:${escapeIcsText(CATEGORY_BY_ID[event.category].label)}`);
  lines.push("END:VEVENT");
  return lines;
}

/**
 * One VCALENDAR holding every exportable event — the shape a calendar app
 * needs to import a whole filtered set in a single file.
 *
 * Canceled events are dropped rather than emitted with `STATUS:CANCELLED`:
 * the product rule is that a canceled event is never exported, and letting
 * the bulk path emit them would be a back door around the per-event rule.
 */
export function eventsToIcs(events: readonly EventOut[], stamp: Date = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BrownSync//Events Directory//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const event of exportableEvents(events)) lines.push(...veventLines(event, stamp));
  lines.push("END:VCALENDAR");
  return `${lines.map((line) => foldIcsLine(line)).join(CRLF)}${CRLF}`;
}

/** One event → its title slug; a set → a stable generic name. */
export function icsCalendarFilename(events: readonly EventOut[]): string {
  const only = events.length === 1 ? events[0] : undefined;
  return only ? icsFilename(only) : "brownsync-events.ics";
}

/**
 * Browser-only: build the calendar and hand it to the user agent. Returns
 * false when there was nothing exportable, so a caller never claims a
 * download that did not happen.
 */
export function downloadEventsIcs(events: readonly EventOut[], filename?: string): boolean {
  const exportable = exportableEvents(events);
  if (exportable.length === 0) return false;
  const blob = new Blob([eventsToIcs(exportable)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename ?? icsCalendarFilename(exportable);
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}
