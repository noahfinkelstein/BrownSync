import { type SeedEvent, SeedEventSchema } from "@brownsync/contract";
import { decodeEntities, stripHtml, toIsoUtc } from "../util";
import { categorize, groupKey } from "./categories";
import { type LivewhaleEvent, LivewhaleFeedSchema } from "./schema";

/** org id lookup by normalized LiveWhale group name (see orgs.ts). */
export type OrgByGroup = ReadonlyMap<string, string>;

const UTC_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;

/** LiveWhale "YYYY-MM-DD HH:MM:SS" (already UTC) → contract ISO string. */
export function livewhaleUtcToIso(s: string): string | null {
  const m = UTC_RE.exec(s);
  return m ? `${m[1]}T${m[2]}Z` : null;
}

function coord(v: number | string | null | undefined, min: number, max: number): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  // 0 is treated as a missing-value sentinel (null island), not a campus coordinate.
  return Number.isFinite(n) && n >= min && n <= max && n !== 0 ? n : null;
}

function startIso(ev: LivewhaleEvent): string {
  const fromUtc = livewhaleUtcToIso(ev.date_utc);
  if (fromUtc) return fromUtc;
  if (ev.date_iso) {
    const parsed = new Date(ev.date_iso);
    if (!Number.isNaN(parsed.getTime())) return toIsoUtc(parsed);
  }
  throw new Error(`livewhale event ${ev.id}: unparseable date_utc ${JSON.stringify(ev.date_utc)}`);
}

function endIso(ev: LivewhaleEvent): string | null {
  if (ev.date2_utc) {
    const fromUtc = livewhaleUtcToIso(ev.date2_utc);
    if (fromUtc) return fromUtc;
  }
  if (ev.date2_iso) {
    const parsed = new Date(ev.date2_iso);
    if (!Number.isNaN(parsed.getTime())) return toIsoUtc(parsed);
  }
  return null;
}

export function normalizeLivewhaleEvent(ev: LivewhaleEvent, orgByGroup: OrgByGroup): SeedEvent {
  // LiveWhale pre-expands repeat series into one row per occurrence sharing
  // `id`; `id:date_ts` is the stable per-occurrence identity (verified unique
  // across the recorded feed).
  const sourceId = `${ev.id}:${ev.date_ts}`;

  let lat = coord(ev.location_latitude, -90, 90);
  let lng = coord(ev.location_longitude, -180, 180);
  if (lat === null || lng === null) {
    lat = null;
    lng = null;
  }

  const locationRaw = ev.location ?? ev.location_title ?? null;
  const orgId = ev.group ? (orgByGroup.get(groupKey(ev.group)) ?? null) : null;
  const description = ev.description ? stripHtml(ev.description) : null;
  const cost = ev.cost == null ? null : String(ev.cost).trim() || null;

  return SeedEventSchema.parse({
    source: "livewhale",
    source_id: sourceId,
    title: decodeEntities(ev.title).trim(),
    description: description || null,
    start_ts: startIso(ev),
    end_ts: endIso(ev),
    is_all_day: Boolean(ev.is_all_day),
    // `repeats` is prose ("every weekday (Monday to Friday)"), not an iCal
    // RRULE, and occurrences arrive pre-expanded — so rrule stays null.
    rrule: null,
    location_raw: locationRaw ? decodeEntities(locationRaw).trim() || null : null,
    place_id: null,
    lat,
    lng,
    org_id: orgId,
    category: categorize(ev.event_types, ev.group),
    tags: (ev.tags ?? []).map((t) => decodeEntities(t).trim()).filter((t) => t.length > 0),
    url: ev.url ?? null,
    cost,
    confidence: 1,
    is_canceled: Boolean(ev.is_canceled),
    raw: ev,
  });
}

/** Raw response text → validated contract rows. Throws if the feed shape drifts. */
export function normalizeLivewhaleFeed(rawText: string, orgByGroup: OrgByGroup): SeedEvent[] {
  const feed = LivewhaleFeedSchema.parse(JSON.parse(rawText));
  return feed.map((ev) => normalizeLivewhaleEvent(ev, orgByGroup));
}
