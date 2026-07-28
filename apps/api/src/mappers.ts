import {
  CATEGORY_IDS,
  type Category,
  type EventOut,
  type HealthOut,
  type MeetingOut,
  ORG_KINDS,
  type OrgKind,
  type OrgOut,
  PLACE_KINDS,
  type PlaceKind,
  type PlaceOut,
} from "@brownsync/contract";
import type { EventApiRow, MeetingRow, OrgRow, PlaceRow, SourceHealthRow } from "./queries";

/**
 * snake_case DB rows → camelCase contract Out-shapes. Pure functions; unit
 * tested without a database.
 */

/**
 * Sources the MVP pollers/scrapers write (contract §1 `events.source`
 * comment). /api/health synthesizes a `status: "never"` row for any of these
 * that has no source_runs history yet, so the ops strip shows every expected
 * feed from day zero instead of silently omitting the ones that never ran.
 */
export const KNOWN_SOURCES = ["livewhale", "athletics_ics", "cab", "clubs", "bdh"] as const;

const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORY_IDS);
const PLACE_KIND_SET: ReadonlySet<string> = new Set(PLACE_KINDS);
const ORG_KIND_SET: ReadonlySet<string> = new Set(ORG_KINDS);

/**
 * events.category is nullable in the DB but EventOut.category is a required
 * taxonomy member. Ingestion is contract-bound to map into the taxonomy, but
 * we never drop a row over a null/unknown category — data breadth is the
 * product. Fallback: "academic" (the broadest campus-events bucket).
 */
export function normalizeCategory(category: string | null): Category {
  return category !== null && CATEGORY_SET.has(category) ? (category as Category) : "academic";
}

function normalizePlaceKind(kind: string): PlaceKind {
  return PLACE_KIND_SET.has(kind) ? (kind as PlaceKind) : "other";
}

function normalizeOrgKind(kind: string): OrgKind {
  return ORG_KIND_SET.has(kind) ? (kind as OrgKind) : "external";
}

function toIso(ts: Date): string {
  return ts.toISOString();
}

/** "HH:MM:SS" (Postgres time) or "HH:MM" → "HH:MM" per MeetingOut. */
function toHhMm(time: string): string {
  return time.slice(0, 5);
}

export function mapEvent(row: EventApiRow): EventOut {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    start: toIso(row.start_ts),
    end: row.end_ts === null ? null : toIso(row.end_ts),
    allDay: row.is_all_day,
    lat: row.lat,
    lng: row.lng,
    placeId: row.place_id,
    placeName: row.place_name,
    locationRaw: row.location_raw,
    orgId: row.org_id,
    orgName: row.org_name,
    category: normalizeCategory(row.category),
    tags: row.tags ?? [],
    url: row.url,
    cost: row.cost,
    source: row.source,
    confidence: row.confidence,
    isCanceled: row.is_canceled,
    mergedSources: row.merged_sources ?? [],
  };
}

export function mapPlace(row: PlaceRow): PlaceOut {
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases ?? [],
    kind: normalizePlaceKind(row.kind),
    lat: row.lat,
    lng: row.lng,
    address: row.address,
  };
}

export function mapOrg(row: OrgRow): OrgOut {
  return {
    id: row.id,
    name: row.name,
    kind: normalizeOrgKind(row.kind),
    category:
      row.category !== null && CATEGORY_SET.has(row.category) ? (row.category as Category) : null,
    description: row.description,
    url: row.url,
    instagram: row.instagram,
    defaultPlaceId: row.default_place_id,
  };
}

export function mapMeeting(row: MeetingRow): MeetingOut {
  return {
    id: row.id,
    courseCode: row.course_code,
    title: row.title,
    instructor: row.instructor,
    days: row.days,
    startTime: toHhMm(row.start_time),
    endTime: toHhMm(row.end_time),
    locationRaw: row.location_raw,
    placeId: row.place_id,
    placeName: row.place_name,
    room: row.room,
    lat: row.lat,
    lng: row.lng,
  };
}

/**
 * NowOut.countsByCategory is an exhaustive record (all 10 taxonomy keys,
 * zeros included — Zod v4 enum-keyed records require every key). Course
 * meetings count into "class" per contract §4.
 */
export function buildCountsByCategory(
  events: readonly EventOut[],
  meetingCount: number,
): Record<Category, number> {
  const counts = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])) as Record<Category, number>;
  for (const event of events) counts[event.category] += 1;
  counts.class += meetingCount;
  return counts;
}

const HEALTH_STATUSES = new Set(["ok", "error", "partial"]);

/**
 * api_health() rows (sources that have run at least once) + the known-source
 * roster → HealthOut. Sources with history keep their latest status; known
 * sources with no history become `status: "never"`. Unknown statuses coming
 * out of source_runs degrade to "error" rather than failing response
 * validation.
 */
export function aggregateHealth(
  rows: readonly SourceHealthRow[],
  knownSources: readonly string[] = KNOWN_SOURCES,
): HealthOut {
  const bySource = new Map(rows.map((r) => [r.source, r]));
  const allSources = [...new Set([...knownSources, ...bySource.keys()])].sort();
  return {
    sources: allSources.map((source) => {
      const row = bySource.get(source);
      if (row === undefined) {
        return {
          source,
          status: "never" as const,
          lastRunAt: null,
          lastOkAt: null,
          itemsUpserted: null,
          error: null,
        };
      }
      return {
        source,
        status: HEALTH_STATUSES.has(row.status)
          ? (row.status as "ok" | "error" | "partial")
          : ("error" as const),
        lastRunAt: row.last_run_at === null ? null : toIso(row.last_run_at),
        lastOkAt: row.last_ok_at === null ? null : toIso(row.last_ok_at),
        itemsUpserted: row.items_upserted,
        error: row.error,
      };
    }),
  };
}
