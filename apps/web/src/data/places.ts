import {
  type EventOut,
  EventOutSchema,
  PlaceActivityOutSchema,
  PlaceOutSchema,
} from "@brownsync/contract";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import { eventsWindowFor } from "./queries";
import { getJson, retryUnlessNotFound } from "./search";

/**
 * Place data hooks (lane H). Events/now/meetings map hooks are lane F's —
 * this file only covers what the place page needs (contract §3).
 */

const PlacesEnvelope = z.object({ places: z.array(PlaceOutSchema) });
const EventsEnvelope = z.object({ events: z.array(EventOutSchema) });

/** GET /api/places — the whole gazetteer, name-sorted. */
export function usePlaces() {
  return useQuery({
    queryKey: ["places"],
    queryFn: () => getJson("/api/places", PlacesEnvelope),
    staleTime: 5 * 60_000,
    retry: retryUnlessNotFound,
    select: (d) => d.places,
  });
}

/**
 * GET /api/places/:id/activity?at= — the place plus events in [at, at+24h]
 * and course meetings in session at `at` (server default at=now).
 */
export function usePlaceActivity(id: string, at?: string) {
  return useQuery({
    queryKey: ["place-activity", id, at ?? "now"],
    queryFn: () =>
      getJson(
        `/api/places/${encodeURIComponent(id)}/activity`,
        PlaceActivityOutSchema,
        at ? { at } : undefined,
      ),
    enabled: id !== "",
    retry: retryUnlessNotFound,
  });
}

/**
 * Everything at a place over the cursor's shared campus window.
 * The contract has no place filter on /events, so this fetches the campus
 * week (≤500 rows, cached once per window) and filters client-side.
 */
export function usePlaceWeekEvents(id: string, cursor: Date) {
  const window = eventsWindowFor(cursor);
  const query = useQuery({
    queryKey: ["events", "week", window.from],
    queryFn: () =>
      getJson("/api/events", EventsEnvelope, {
        from: window.from,
        to: window.to,
      }),
    staleTime: 60_000,
    retry: retryUnlessNotFound,
  });
  const events = useMemo(
    (): EventOut[] => (query.data?.events ?? []).filter((event) => event.placeId === id),
    [query.data, id],
  );
  return { ...query, data: events };
}
