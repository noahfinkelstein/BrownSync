import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchArticles, fetchEventDetail, fetchEvents, fetchMeetings, fetchNow } from "./api";
import { useCursorDate } from "./cursor";

/**
 * TanStack Query hooks over the read API, keyed off the time cursor.
 *
 * Perf rule (handoff §5): layers re-filter CLIENT-SIDE while the cursor
 * scrubs — fetches are bucketed so cache keys only rotate when the cursor
 * leaves a bucket, and `keepPreviousData` means the map never blanks.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Events window: [cursor−12 h, +8 d], keyed on the hour bucket. */
export function eventsWindowFor(cursor: Date): { from: string; to: string } {
  const fromMs = Math.floor((cursor.getTime() - 12 * HOUR) / HOUR) * HOUR;
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(fromMs + 8 * DAY).toISOString(),
  };
}

/** Meetings instant, floored to a 5-minute bucket. */
export function meetingsBucketFor(cursor: Date): string {
  return new Date(Math.floor(cursor.getTime() / (5 * MIN)) * (5 * MIN)).toISOString();
}

/**
 * Articles window: [cursor−14 d, cursor], keyed on the hour bucket. 14 days
 * is the feed's ARTICLE_MAX_AGE_MS cutoff (feed/rank.ts) — fetching further
 * back would download rows the feed is contractually going to drop. `to`
 * rounds UP to the next hour so a story published "just now" is never
 * excluded by bucketing.
 */
export function articlesWindowFor(cursor: Date): { from: string; to: string } {
  const toMs = Math.ceil(cursor.getTime() / HOUR) * HOUR;
  return {
    from: new Date(toMs - 14 * DAY).toISOString(),
    to: new Date(toMs).toISOString(),
  };
}

export const queryKeys = {
  events: (from: string) => ["events", from] as const,
  eventDetail: (id: string) => ["event", id] as const,
  meetings: (at: string) => ["meetings", at] as const,
  articles: (from: string) => ["articles", from] as const,
  now: () => ["now"] as const,
};

/** All events in the cursor window (client-side filtering happens per-layer). */
export function useEventsWindow() {
  const { cursor, isLive } = useCursorDate();
  const window = eventsWindowFor(cursor);
  const query = useQuery({
    queryKey: queryKeys.events(window.from),
    queryFn: () => fetchEvents({ from: window.from, to: window.to }),
    staleTime: 60_000,
    refetchInterval: isLive ? 60_000 : false,
    placeholderData: keepPreviousData,
  });
  return { ...query, cursor, isLive };
}

/**
 * News articles in the feed's 14-day window ending at the cursor
 * (contract v1.9, GET /api/articles — currently the brown_news producer).
 */
export function useArticlesWindow() {
  const { cursor, isLive } = useCursorDate();
  const window = articlesWindowFor(cursor);
  return useQuery({
    queryKey: queryKeys.articles(window.from),
    queryFn: () => fetchArticles(window),
    // The producer's cadence is 30 min; refetching faster buys nothing.
    staleTime: 5 * MIN,
    refetchInterval: isLive ? 5 * MIN : false,
    placeholderData: keepPreviousData,
  });
}

/** Course meetings in session at the (5-min bucketed) cursor. */
export function useMeetingsInSession() {
  const { cursor, isLive } = useCursorDate();
  const at = meetingsBucketFor(cursor);
  const query = useQuery({
    queryKey: queryKeys.meetings(at),
    queryFn: () => fetchMeetings(at),
    // The term schedule is static — cache buckets forever, collect quickly.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 15 * MIN,
    placeholderData: keepPreviousData,
  });
  return { ...query, cursor, isLive };
}

/** One event with org + place expanded, for the detail panel. */
export function useEventDetail(id: string | null) {
  return useQuery({
    queryKey: queryKeys.eventDetail(id ?? "none"),
    queryFn: () => {
      if (id === null) throw new Error("useEventDetail: no id");
      return fetchEventDetail(id);
    },
    enabled: id !== null,
    staleTime: 5 * MIN,
  });
}

/** `/api/now` convenience snapshot (counts drive chips/rails elsewhere). */
export function useNowSnapshot() {
  const { isLive } = useCursorDate();
  return useQuery({
    queryKey: queryKeys.now(),
    queryFn: () => fetchNow(),
    staleTime: 60_000,
    refetchInterval: isLive ? 60_000 : false,
  });
}
