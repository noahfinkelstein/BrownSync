import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchEventDetail, fetchEvents, fetchMeetings, fetchNow } from "./api";
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

export const queryKeys = {
  events: (from: string) => ["events", from] as const,
  eventDetail: (id: string) => ["event", id] as const,
  meetings: (at: string) => ["meetings", at] as const,
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
