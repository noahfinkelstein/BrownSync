import type {
  ArticleOut,
  Category,
  EventDetailOut,
  EventOut,
  HealthOut,
  MeetingOut,
  NowOut,
} from "@brownsync/contract";
import {
  ArticleOutSchema,
  EventDetailOutSchema,
  EventOutSchema,
  HealthOutSchema,
  MeetingOutSchema,
  NowOutSchema,
} from "@brownsync/contract";
import { z } from "zod";
import {
  getDefaultFixtureData,
  getEventDetail,
  healthSnapshot,
  meetingsAt,
  nowSnapshot,
  queryEvents,
} from "../mocks/fixtureApi";

/**
 * Typed fetchers for the read API (DATA_CONTRACT.md §3). Every response is
 * Zod-validated at the boundary; the rest of the app trusts contract types.
 *
 * - `VITE_API_URL` prefixes requests (empty → same-origin `/api/…`).
 * - `VITE_USE_FIXTURES=1` serves the in-memory fixture dataset instead of
 *   fetching — zero-backend dev/preview. Statically false in normal builds,
 *   so the fixture module tree-shakes out of production bundles.
 */

const EventsResponseSchema = z.object({ events: z.array(EventOutSchema) });
const MeetingsResponseSchema = z.object({ meetings: z.array(MeetingOutSchema) });
const ArticlesResponseSchema = z.object({ articles: z.array(ArticleOutSchema) });

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function apiBase(): string {
  return import.meta.env.VITE_API_URL ?? "";
}

function fixturesEnabled(): boolean {
  return import.meta.env.VITE_USE_FIXTURES === "1";
}

export type EventsParams = {
  /** ISO-8601. Contract defaults: from=now, to=from+7 d. */
  from?: string;
  to?: string;
  /** "w,s,e,n" lng/lat. */
  bbox?: string;
  category?: Category;
  q?: string;
};

async function getJson<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  params?: Record<string, string | undefined>,
): Promise<T> {
  const search = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, value);
    }
  }
  const qs = search.size > 0 ? `?${search.toString()}` : "";
  const res = await fetch(`${apiBase()}${path}${qs}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new ApiError(res.status, `GET ${path} → HTTP ${res.status}`);
  return schema.parse(await res.json());
}

export async function fetchEvents(params: EventsParams = {}): Promise<EventOut[]> {
  if (fixturesEnabled()) return queryEvents(getDefaultFixtureData(), params);
  const body = await getJson("/api/events", EventsResponseSchema, { ...params });
  return body.events;
}

export async function fetchEventDetail(id: string): Promise<EventDetailOut> {
  if (fixturesEnabled()) {
    const detail = getEventDetail(getDefaultFixtureData(), id);
    if (!detail) throw new ApiError(404, `GET /api/events/${id} → HTTP 404`);
    return detail;
  }
  return getJson(`/api/events/${encodeURIComponent(id)}`, EventDetailOutSchema);
}

/**
 * Articles (contract v1.9): headline+URL+date rows from the `articles` table,
 * newest first. The fixture dataset carries no articles — an empty list is
 * the honest zero-backend answer, and the feed degrades gracefully.
 */
export async function fetchArticles(params: { from?: string; to?: string } = {}): Promise<
  ArticleOut[]
> {
  if (fixturesEnabled()) return [];
  const body = await getJson("/api/articles", ArticlesResponseSchema, { ...params });
  return body.articles;
}

export async function fetchMeetings(at?: string): Promise<MeetingOut[]> {
  if (fixturesEnabled()) return meetingsAt(getDefaultFixtureData(), at);
  const body = await getJson("/api/meetings", MeetingsResponseSchema, at ? { at } : undefined);
  return body.meetings;
}

export async function fetchNow(at?: string): Promise<NowOut> {
  if (fixturesEnabled()) return nowSnapshot(getDefaultFixtureData(), at);
  return getJson("/api/now", NowOutSchema, at ? { at } : undefined);
}

export async function fetchHealth(): Promise<HealthOut> {
  if (fixturesEnabled()) return healthSnapshot(getDefaultFixtureData());
  return getJson("/api/health", HealthOutSchema);
}
