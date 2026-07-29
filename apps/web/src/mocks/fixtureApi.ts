import type {
  Category,
  EventDetailOut,
  EventOut,
  HealthOut,
  MeetingOut,
  NowOut,
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
  category?: string;
  q?: string;
};

/** Overlap semantics with contract defaults (from=at-issue "now", to=+7 d). */
export function queryEvents(data: FixtureData, filter: EventsFilter = {}): EventOut[] {
  const from = filter.from ? Date.parse(filter.from) : data.base.getTime();
  const to = filter.to ? Date.parse(filter.to) : from + 7 * DAY;
  const q = filter.q?.toLowerCase();
  return data.events
    .filter((e) => {
      const start = Date.parse(e.start);
      const end = e.end ? Date.parse(e.end) : start;
      if (start > to || end < from) return false;
      if (filter.category && e.category !== filter.category) return false;
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
