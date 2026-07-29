import type {
  Category,
  EventDetailOut,
  EventOut,
  HealthOut,
  MeetingOut,
  NowOut,
  OrgDetailOut,
  OrgOut,
  PlaceActivityOut,
  PlaceOut,
} from "@brownsync/contract";
import { CATEGORY_IDS } from "@brownsync/contract";
import { campusDayToken, campusMinutes, type FixtureData, makeFixtureData } from "./fixtures";

/**
 * Pure, contract-faithful (§3) query semantics over a FixtureData set.
 * Used by the MSW handlers AND by fixture-mode `src/data/api.ts` (set
 * `VITE_USE_FIXTURES=1`) so the app runs with zero backend.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export type EventsFilter = {
  from?: string;
  to?: string;
  /** "w,s,e,n" lng/lat — api_events envelope semantics. */
  bbox?: string;
  category?: string;
  q?: string;
};

/** "w,s,e,n" → tuple, or null when malformed (malformed = unfiltered). */
function parseBbox(bbox: string): [number, number, number, number] | null {
  const parts = bbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts as [number, number, number, number];
}

/** Overlap semantics with contract defaults (from=at-issue "now", to=+7 d). */
export function queryEvents(data: FixtureData, filter: EventsFilter = {}): EventOut[] {
  const from = filter.from ? Date.parse(filter.from) : data.base.getTime();
  const to = filter.to ? Date.parse(filter.to) : from + 7 * DAY;
  const q = filter.q?.toLowerCase();
  const box = filter.bbox ? parseBbox(filter.bbox) : null;
  return data.events
    .filter((e) => {
      const start = Date.parse(e.start);
      const end = e.end ? Date.parse(e.end) : start;
      if (start > to || end < from) return false;
      if (filter.category && e.category !== filter.category) return false;
      if (box) {
        // api_events: bbox only ever matches LOCATED events.
        const [w, s, east, n] = box;
        if (e.lat === null || e.lng === null) return false;
        if (e.lng < w || e.lng > east || e.lat < s || e.lat > n) return false;
      }
      if (q) {
        const hay = `${e.title} ${e.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, 500);
}

export function getEventDetail(data: FixtureData, id: string): EventDetailOut | null {
  const event = data.events.find((e) => e.id === id);
  if (!event) return null;
  return {
    ...event,
    org: data.orgs.find((o) => o.id === event.orgId) ?? null,
    place: data.places.find((p) => p.id === event.placeId) ?? null,
  };
}

const DAY_TOKEN_RE = /Su|Th|M|T|W|F|S/g;

const hhmmToMinutes = (t: string): number => {
  const [h = "0", m = "0"] = t.split(":");
  return Number(h) * 60 + Number(m);
};

/** Course meetings in session at instant `at` (campus wall-clock expansion). */
export function meetingsAt(data: FixtureData, atIso?: string): MeetingOut[] {
  const at = atIso ? new Date(atIso) : data.base;
  const day = campusDayToken(at);
  const minutes = campusMinutes(at);
  return data.meetings.filter((m) => {
    const tokens: string[] = m.days.match(DAY_TOKEN_RE) ?? [];
    if (!tokens.includes(day)) return false;
    return hhmmToMinutes(m.startTime) <= minutes && minutes < hhmmToMinutes(m.endTime);
  });
}

/** `/api/now`: events in progress or starting within 2 h + in-session meetings. */
export function nowSnapshot(data: FixtureData, atIso?: string): NowOut {
  const at = atIso ? Date.parse(atIso) : data.base.getTime();
  const events = data.events
    .filter((e) => {
      if (e.isCanceled) return false;
      const start = Date.parse(e.start);
      const end = e.end ? Date.parse(e.end) : start + 90 * MIN;
      return start <= at + 2 * HOUR && end >= at;
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const meetings = meetingsAt(data, atIso);
  const countsByCategory = Object.fromEntries(CATEGORY_IDS.map((c) => [c, 0])) as Record<
    Category,
    number
  >;
  for (const e of events) countsByCategory[e.category] += 1;
  countsByCategory.class += meetings.length;
  return { events, meetings, countsByCategory };
}

export function healthSnapshot(data: FixtureData): HealthOut {
  return data.health;
}

/** `/api/places` — the whole gazetteer, name-sorted (apps/api `places()`). */
export function listPlaces(data: FixtureData): PlaceOut[] {
  return [...data.places].sort((a, b) => a.name.localeCompare(b.name));
}

/** `/api/orgs` — all organizations, name-sorted (apps/api `orgs()`). */
export function listOrgs(data: FixtureData): OrgOut[] {
  return [...data.orgs].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * `/api/orgs/:id` — the org with events split around `at` (default now):
 * upcoming = still running or later (coalesce(end,start) >= at, soonest
 * first); past = fully over (latest first). Mirrors apps/api `eventsByOrg`.
 */
export function getOrgDetail(data: FixtureData, id: string, atIso?: string): OrgDetailOut | null {
  const org = data.orgs.find((o) => o.id === id);
  if (!org) return null;
  const at = atIso ? Date.parse(atIso) : data.base.getTime();
  const mine = data.events.filter((e) => e.orgId === id);
  const endOf = (e: EventOut): number => (e.end ? Date.parse(e.end) : Date.parse(e.start));
  return {
    ...org,
    upcoming: mine
      .filter((e) => endOf(e) >= at)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
      .slice(0, 100),
    past: mine
      .filter((e) => endOf(e) < at)
      .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))
      .slice(0, 100),
  };
}

/**
 * `/api/places/:id/activity` — the place, events there overlapping
 * [at, at+24 h] (soonest first), and course meetings in session at `at`
 * filtered to the place. Mirrors apps/api `placeActivityRoute`.
 */
export function getPlaceActivity(
  data: FixtureData,
  id: string,
  atIso?: string,
): PlaceActivityOut | null {
  const place = data.places.find((p) => p.id === id);
  if (!place) return null;
  const at = atIso ? Date.parse(atIso) : data.base.getTime();
  const to = at + DAY;
  return {
    place,
    events: data.events
      .filter((e) => {
        if (e.placeId !== id) return false;
        const start = Date.parse(e.start);
        const end = e.end ? Date.parse(e.end) : start;
        return start <= to && end >= at;
      })
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
      .slice(0, 200),
    meetings: meetingsAt(data, atIso).filter((m) => m.placeId === id),
  };
}

let defaultData: FixtureData | null = null;

/** Lazily-built dataset anchored at first access ("now"). */
export function getDefaultFixtureData(): FixtureData {
  if (!defaultData) defaultData = makeFixtureData(new Date());
  return defaultData;
}

/** Test hook: re-anchor or clear the shared dataset. */
export function resetDefaultFixtureData(base?: Date): void {
  defaultData = base ? makeFixtureData(base) : null;
}
