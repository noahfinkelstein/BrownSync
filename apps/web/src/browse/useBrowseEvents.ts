import { type Category, type EventOut, EventOutSchema } from "@brownsync/contract";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import { eventsWindowFor } from "../data/queries";
import { getJson, retryUnlessNotFound } from "../data/search";
import { type Bbox, bboxParam } from "./viewport";

const EventsEnvelope = z.object({ events: z.array(EventOutSchema) });

export type BrowseEvents = {
  /** Viewport events, category-filtered, in the shared cursor window. */
  events: EventOut[];
  pending: boolean;
  error: boolean;
  refetch: () => void;
};

/**
 * Events for the list view: bbox-filtered on the server (contract §3),
 * category-filtered client-side — /events takes a single `category` param
 * but the chips allow multi-select, and ≤500 rows filter instantly.
 */
export function useBrowseEvents(
  bbox: Bbox,
  categories: readonly Category[],
  cursor: Date,
): BrowseEvents {
  const bboxStr = bboxParam(bbox);
  const window = eventsWindowFor(cursor);
  const query = useQuery({
    queryKey: ["browse-events", bboxStr, window.from],
    queryFn: () =>
      getJson("/api/events", EventsEnvelope, {
        bbox: bboxStr,
        from: window.from,
        to: window.to,
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: retryUnlessNotFound,
    placeholderData: keepPreviousData,
  });

  const events = useMemo(() => {
    const all = query.data?.events ?? [];
    if (categories.length === 0) return all;
    return all.filter((e) => categories.includes(e.category));
  }, [query.data, categories]);

  return {
    events,
    pending: query.isLoading,
    error: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}
