import type { EventOut } from "@brownsync/contract";
import { cn } from "@brownsync/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useCategoryFilter } from "../browse/filter";
import { DAILY_ARTIFACT_QUERY_OPTIONS } from "../data/artifacts";
import { useEventsWindow } from "../data/queries";
import { useDining } from "../dining";
import { eventsInWindow } from "../map/eventsLayer";
import type { FeedItem, PublicationsDocument } from "./model";
import { buildFeed } from "./rank";

export const PUBLICATIONS_DATA_URL = "/data/publications.json";

function usePublications() {
  return useQuery({
    queryKey: ["publications"] as const,
    queryFn: async (): Promise<PublicationsDocument> => {
      const response = await fetch(PUBLICATIONS_DATA_URL);
      if (!response.ok) throw new Error(`publications: ${response.status}`);
      return (await response.json()) as PublicationsDocument;
    },
    ...DAILY_ARTIFACT_QUERY_OPTIONS,
  });
}

/**
 * The unified feed: what's happening on campus, what the student press just
 * published, and which dining halls are serving — one ranked list.
 *
 * Events are passed in PRE-WINDOWED. `eventsToFeed` deliberately does no time
 * filtering: reusing the map's `isEventLive` would silently cap the feed at
 * the map's 2 h drawing horizon, so the feed would never mention tomorrow.
 * Filtering here, with the same window and the same `?cats=` selection the map
 * uses, is what keeps the two surfaces from disagreeing.
 */
export function FeedPanel({
  className,
  onSelectEvent,
}: {
  className?: string;
  onSelectEvent?: (event: EventOut) => void;
}) {
  const eventsQuery = useEventsWindow();
  const publications = usePublications();
  const dining = useDining();
  const { selected } = useCategoryFilter();
  const cursor = eventsQuery.cursor;
  const at = cursor.getTime();

  const feed = useMemo(() => {
    const windowed = eventsInWindow(eventsQuery.data ?? [], cursor);
    const events =
      selected.length === 0 ? windowed : windowed.filter((e) => selected.includes(e.category));
    return buildFeed(
      { events, publications: publications.data, dining: dining.data },
      { at, pageSize: 40 },
    );
  }, [eventsQuery.data, publications.data, dining.data, selected, cursor, at]);

  const degraded = eventsQuery.isError || publications.isError || dining.isError;
  const pending = eventsQuery.isPending || publications.isPending || dining.isPending;

  return (
    <div className={cn("flex flex-col", className)} data-testid="feed-panel">
      {degraded ? (
        <p
          role="alert"
          className="border-b border-line bg-bg-overlay/40 px-3 py-2 text-12 text-text-secondary"
        >
          Some feed sources unavailable; results may be partial.
        </p>
      ) : null}
      {feed.items.length > 0 ? (
        <ul className="divide-y divide-line">
          {feed.items.map(({ item }) => (
            <li key={item.id}>
              <FeedRow item={item} at={at} onSelectEvent={onSelectEvent} />
            </li>
          ))}
        </ul>
      ) : pending ? (
        <p role="status" className="px-3 py-4 text-14 text-text-secondary">
          Loading feed…
        </p>
      ) : degraded ? (
        <p className="px-3 py-4 text-14 text-text-secondary">No feed items could be loaded.</p>
      ) : (
        <p className="px-3 py-4 text-14 text-text-secondary">Nothing to show at this time.</p>
      )}
    </div>
  );
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Relative time that degrades to days and weeks.
 *
 * NOT `browse/format.ts`'s `formatRelative`, for two reasons. Its signature is
 * `(now, target)` — the reverse of what reads naturally at a call site, and
 * passing them the intuitive way around renders every past article as a future
 * one ("in 917 h" for a piece published five weeks ago). And it only ever
 * speaks minutes and hours, which is right for an event list spanning eight
 * days and wrong for a news feed spanning months.
 */
function feedTime(timestamp: number, at: number): string {
  const delta = timestamp - at;
  const ahead = delta > 0;
  const abs = Math.abs(delta);
  if (abs < 60_000) return "now";
  if (abs < HOUR) {
    const minutes = Math.round(abs / 60_000);
    return ahead ? `in ${minutes} min` : `${minutes} min ago`;
  }
  if (abs < DAY) {
    const hours = Math.round(abs / HOUR);
    return ahead ? `in ${hours} h` : `${hours} h ago`;
  }
  const days = Math.round(abs / DAY);
  if (days < 14) return ahead ? `in ${days} d` : `${days} d ago`;
  const weeks = Math.round(days / 7);
  return ahead ? `in ${weeks} w` : `${weeks} w ago`;
}

const KIND_LABEL: Record<FeedItem["kind"], string> = {
  event: "event",
  article: "news",
  dining: "dining",
};

function FeedRow({
  item,
  at,
  onSelectEvent,
}: {
  item: FeedItem;
  at: number;
  onSelectEvent?: (event: EventOut) => void;
}) {
  const when = feedTime(item.timestamp, at);
  const rowClassName =
    "block w-full px-3 py-2.5 text-left transition-colors duration-150 ease-out hover:bg-bg-overlay/60";
  const body = (
    <>
      <span className="flex items-baseline gap-2">
        <span className="shrink-0 font-mono text-12 uppercase tracking-[0.08em] text-text-secondary">
          {KIND_LABEL[item.kind]}
        </span>
        <span className="grow text-14 text-text-primary">{item.title}</span>
        <span className="shrink-0 font-mono text-12 tabular-nums text-text-secondary">{when}</span>
      </span>
      <span className="mt-0.5 block font-mono text-12 text-text-secondary">{item.sourceId}</span>
    </>
  );

  if (item.kind === "event" && onSelectEvent) {
    return (
      <button type="button" onClick={() => onSelectEvent(item.event)} className={rowClassName}>
        {body}
      </button>
    );
  }

  if (item.kind === "dining" && item.placeId) {
    return (
      <Link to="/p/$id" params={{ id: item.placeId }} className={rowClassName}>
        {body}
      </Link>
    );
  }

  // An article's canonical URL is off-site, so it opens in a new tab with the
  // referrer stripped — the student press should not be able to see which
  // BrownSync surface sent a reader.
  if (item.kind === "article" && item.url) {
    return (
      <a href={item.url} target="_blank" rel="noreferrer noopener" className={rowClassName}>
        {body}
      </a>
    );
  }

  return <div className="px-3 py-2.5">{body}</div>;
}
