import {
  type EventOut,
  EventOutSchema,
  type MeetingOut,
  MeetingOutSchema,
  type OrgOut,
  OrgOutSchema,
  type PlaceOut,
  PlaceOutSchema,
} from "@brownsync/contract";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";

/**
 * Palette search — handoff §2 H. The contract has NO dedicated /search route,
 * so the query fans out across what exists (contract §3):
 *   events  → GET /api/events?q=        (server ranks substring > trigram)
 *   places  → GET /api/places           (small gazetteer; ranked client-side)
 *   orgs    → GET /api/orgs             (~400 rows; ranked client-side)
 *   courses → GET /api/meetings         (in-session at `now` — the only
 *                                        course surface the read API exposes)
 * This file also hosts the lane's shared fetch helper (`getJson`), reused by
 * ./places and ./orgs.
 */

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message?: string) {
    super(message ?? `API request failed with ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Absolute API URL: VITE_API_URL override, else same-origin (dev proxy/prod). */
export function apiUrl(path: string, params?: Record<string, string | undefined>): string {
  const envBase: unknown = import.meta.env.VITE_API_URL;
  const base = typeof envBase === "string" && envBase !== "" ? envBase : window.location.origin;
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value != null && value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

/** fetch + status check + Zod parse at the boundary (handoff §1). */
export async function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const res = await fetch(apiUrl(path, params));
  if (!res.ok) throw new ApiError(res.status);
  return schema.parse(await res.json());
}

/** Shared retry policy: never retry 404s, otherwise up to 2 attempts. */
export function retryUnlessNotFound(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status === 404) return false;
  return failureCount < 2;
}

const EventsEnvelope = z.object({ events: z.array(EventOutSchema) });
const PlacesEnvelope = z.object({ places: z.array(PlaceOutSchema) });
const OrgsEnvelope = z.object({ orgs: z.array(OrgOutSchema) });
const MeetingsEnvelope = z.object({ meetings: z.array(MeetingOutSchema) });

// ---------------------------------------------------------------------------
// Client-side ranking (places/orgs/courses have no server q param)

/** Case-, punctuation- and diacritic-insensitive fold. */
export function normalizeQuery(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Best score of `query` against any candidate string.
 * 100 exact · 80 prefix · 70 word prefix · 60 substring · 0 no match.
 */
export function matchScore(query: string, candidates: readonly string[]): number {
  const q = normalizeQuery(query);
  if (q === "") return 0;
  let best = 0;
  for (const candidate of candidates) {
    const n = normalizeQuery(candidate);
    if (n === "") continue;
    let score = 0;
    if (n === q) score = 100;
    else if (n.startsWith(q)) score = 80;
    else if (n.includes(` ${q}`)) score = 70;
    else if (n.includes(q)) score = 60;
    if (score > best) best = score;
  }
  return best;
}

/** Rank `items` by matchScore over their key strings; drop misses, cap at `limit`. */
export function rankByMatch<T>(
  query: string,
  items: readonly T[],
  keysOf: (item: T) => readonly string[],
  limit: number,
): T[] {
  return items
    .map((item) => ({ item, score: matchScore(query, keysOf(item)), name: keysOf(item)[0] ?? "" }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((r) => r.item);
}

// ---------------------------------------------------------------------------

export const MIN_QUERY_LENGTH = 2;

const LIMITS = { events: 8, places: 6, orgs: 6, courses: 6 } as const;

export type SearchGroups = {
  events: EventOut[];
  places: PlaceOut[];
  orgs: OrgOut[];
  courses: MeetingOut[];
};

export type SearchState = {
  groups: SearchGroups;
  /** Total hits across all groups. */
  total: number;
  /** Query long enough to search. */
  active: boolean;
  /** First fetch for this query still in flight. */
  pending: boolean;
  /** At least one source failed — results may be partial. */
  degraded: boolean;
};

const EMPTY_GROUPS: SearchGroups = { events: [], places: [], orgs: [], courses: [] };

export function useSearch(query: string): SearchState {
  const q = query.trim();
  const active = q.length >= MIN_QUERY_LENGTH;

  const events = useQuery({
    queryKey: ["search", "events", q],
    queryFn: () => getJson("/api/events", EventsEnvelope, { q }),
    enabled: active,
    staleTime: 30_000,
    retry: retryUnlessNotFound,
    placeholderData: keepPreviousData,
  });
  const places = useQuery({
    queryKey: ["places"],
    queryFn: () => getJson("/api/places", PlacesEnvelope),
    enabled: active,
    staleTime: 5 * 60_000,
    retry: retryUnlessNotFound,
  });
  const orgs = useQuery({
    queryKey: ["orgs"],
    queryFn: () => getJson("/api/orgs", OrgsEnvelope),
    enabled: active,
    staleTime: 5 * 60_000,
    retry: retryUnlessNotFound,
  });
  const meetings = useQuery({
    queryKey: ["meetings", "now"],
    queryFn: () => getJson("/api/meetings", MeetingsEnvelope),
    enabled: active,
    staleTime: 60_000,
    retry: retryUnlessNotFound,
  });

  const groups = useMemo<SearchGroups>(() => {
    if (!active) return EMPTY_GROUPS;
    const courseRows = meetings.data?.meetings ?? [];
    // Meetings arrive one row per weekly pattern; collapse to one per course.
    const seen = new Set<string>();
    const courses = courseRows.filter((m) => {
      if (seen.has(m.courseCode)) return false;
      seen.add(m.courseCode);
      return true;
    });
    return {
      events: (events.data?.events ?? []).slice(0, LIMITS.events),
      places: rankByMatch(
        q,
        places.data?.places ?? [],
        (p) => [p.name, ...p.aliases],
        LIMITS.places,
      ),
      orgs: rankByMatch(q, orgs.data?.orgs ?? [], (o) => [o.name], LIMITS.orgs),
      courses: rankByMatch(q, courses, (m) => [m.courseCode, m.title], LIMITS.courses),
    };
  }, [active, q, events.data, places.data, orgs.data, meetings.data]);

  return {
    groups,
    total: groups.events.length + groups.places.length + groups.orgs.length + groups.courses.length,
    active,
    pending:
      active && (events.isLoading || places.isLoading || orgs.isLoading || meetings.isLoading),
    degraded: active && (events.isError || places.isError || orgs.isError || meetings.isError),
  };
}
