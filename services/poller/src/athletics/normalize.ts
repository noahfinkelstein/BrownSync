import { type SeedEvent, SeedEventSchema } from "@brownsync/contract";
import ical from "node-ical";
import { decodeEntities, newYorkToUtc, toIsoUtc } from "../util";

/** place_id lookup by normalized venue string (see venues.ts). */
export type VenueToPlace = ReadonlyMap<string, string>;

/**
 * SIDEARM LOCATION format is "City, St." for away games and
 * "Providence, R.I., <venue>" for home games (contract §5: resolve home venues
 * via the gazetteer; away/city-level locations stay unresolved).
 */
const HOME_RE = /^Providence,\s*R\.I\.(?:,\s*(.+))?$/i;

export function venueKey(venue: string): string {
  return venue.trim().toLowerCase();
}

/** node-ical values are usually strings but may be {params, val} objects. */
function icalText(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && "val" in v) {
    const val = (v as { val: unknown }).val;
    if (typeof val === "string") return val.trim() || null;
  }
  return null;
}

/**
 * Minimal structural view of a node-ical component — its published union
 * (VEvent | VCalendar | …) is not a discriminated union TS can narrow, so we
 * validate every field defensively instead.
 */
type IcalComponent = {
  type?: unknown;
  uid?: unknown;
  summary?: unknown;
  start?: unknown;
  end?: unknown;
  datetype?: unknown;
  location?: unknown;
  url?: unknown;
  description?: unknown;
  status?: unknown;
};

/**
 * All-day VEVENTs (VALUE=DATE) are parsed by node-ical as *system-local*
 * midnight; the local date components recover the intended calendar date in
 * any TZ, which we then anchor to America/New_York midnight per contract §2.
 */
function allDayIso(d: Date): string {
  return toIsoUtc(newYorkToUtc(d.getFullYear(), d.getMonth() + 1, d.getDate()));
}

/** Raw ICS text → validated contract rows. */
export function normalizeAthletics(icsText: string, venueToPlace: VenueToPlace): SeedEvent[] {
  const parsed = ical.sync.parseICS(icsText);
  const rows: SeedEvent[] = [];
  for (const value of Object.values(parsed)) {
    const comp = value as IcalComponent | undefined;
    if (comp?.type !== "VEVENT") continue;
    const uid = icalText(comp.uid);
    const title = icalText(comp.summary);
    const start = comp.start instanceof Date ? comp.start : null;
    if (!uid || !title || !start) continue;

    const isAllDay = comp.datetype === "date";
    const end = comp.end instanceof Date ? comp.end : null;
    const startTs = isAllDay ? allDayIso(start) : toIsoUtc(start);
    const endTs = end ? (isAllDay ? allDayIso(end) : toIsoUtc(end)) : null;

    const location = icalText(comp.location);
    const home = location ? HOME_RE.exec(location) : null;
    const venue = home?.[1]?.trim() ?? null;
    const placeId = venue ? (venueToPlace.get(venueKey(venue)) ?? null) : null;
    const url = icalText(comp.url);
    const description = icalText(comp.description);
    const status = icalText(comp.status);

    rows.push(
      SeedEventSchema.parse({
        source: "athletics_ics",
        source_id: uid,
        title,
        description,
        start_ts: startTs,
        end_ts: endTs,
        is_all_day: isAllDay,
        rrule: null,
        location_raw: location,
        place_id: placeId,
        lat: null,
        lng: null,
        org_id: null,
        category: "athletics",
        tags: home ? ["home"] : [],
        url: url ? decodeEntities(url) : null,
        cost: null,
        confidence: 1,
        is_canceled: status?.toUpperCase() === "CANCELLED",
        // Compact JSON-safe echo of the VEVENT (node-ical objects carry Dates).
        raw: {
          uid,
          summary: title,
          start: startTs,
          end: endTs,
          datetype: typeof comp.datetype === "string" ? comp.datetype : null,
          location,
          url,
          description,
          status,
        },
      }),
    );
  }
  return rows;
}
