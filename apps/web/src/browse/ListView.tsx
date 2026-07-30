import type { EventOut } from "@brownsync/contract";
import { Badge, Button, cn, EmptyState, SourceBadge, TimelineRow } from "@brownsync/ui";
import { useNavigate } from "@tanstack/react-router";
import { ListSkeleton } from "../ops/states/skeletons";
import { useCategoryFilter } from "./filter";
import { formatClock, formatRelative } from "./format";
import { groupEventsByTime, isLive } from "./grouping";
import { useRovingFocus } from "./rovingFocus";
import { useBrowseEvents } from "./useBrowseEvents";
import { fullCampusViewport, useViewportBbox, type ViewportSource } from "./viewport";

/**
 * Viewport-synced list — handoff §3.2: split-pane sibling of the map,
 * grouped by time bucket, timeline rows NOT card grids (§6.4). The map
 * dependency is the ViewportSource seam only.
 */

export type ListViewProps = {
  /** Map viewport; defaults to the full campus until the integrator wires it. */
  viewport?: ViewportSource;
  /** Row click override — integrator opens the detail panel + flyTo. */
  onSelectEvent?: (event: EventOut) => void;
  /** Clock injection for tests; defaults to wall clock. */
  now?: () => Date;
  className?: string;
};

export function ListView({
  viewport = fullCampusViewport,
  onSelectEvent,
  now,
  className,
}: ListViewProps) {
  const bbox = useViewportBbox(viewport);
  const { selected, clear } = useCategoryFilter();
  const at = now ? now() : new Date();
  const { events, pending, error, refetch } = useBrowseEvents(bbox, selected, at);
  const navigate = useNavigate();
  // §6.4 keyboard support: the list is ONE tab stop; ↑/↓ + Home/End rove
  // between rows and Enter opens the row's detail panel (native button).
  const roving = useRovingFocus<HTMLDivElement>(
    '[data-testid="event-list-item"] button',
    "vertical",
  );

  const buckets = groupEventsByTime(events, at);
  const visibleEventCount = buckets.reduce((total, bucket) => total + bucket.events.length, 0);

  const openEvent = (event: EventOut) => {
    if (onSelectEvent) {
      onSelectEvent(event);
      return;
    }
    if (event.placeId) {
      void navigate({ to: "/p/$id", params: { id: event.placeId } });
    }
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-bg-raised", className)}>
      <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
        <span className="font-mono text-12 text-text-secondary">
          {visibleEventCount} event{visibleEventCount === 1 ? "" : "s"} in view
        </span>
        <span className="font-mono text-12 text-text-secondary">next 7 days</span>
      </div>

      {pending ? (
        <ListSkeleton className="px-3 py-3" />
      ) : error ? (
        <EmptyState
          title="Events unavailable"
          body="The read API is unreachable. The map still works — try again in a minute."
          action={<Button onClick={refetch}>Retry</Button>}
        />
      ) : buckets.length === 0 ? (
        <EmptyState
          title="No events in view"
          body={
            selected.length > 0
              ? "Nothing here matches these category filters — clear them or widen the time window."
              : "Widen the time window or zoom the map out."
          }
          action={selected.length > 0 ? <Button onClick={clear}>Clear filters</Button> : undefined}
        />
      ) : (
        // The handlers only delegate roving focus for the interactive row
        // buttons inside — the container itself is never a target.
        // biome-ignore lint/a11y/noStaticElementInteractions: focus delegation container
        <div
          ref={roving.containerRef}
          onKeyDown={roving.onKeyDown}
          onFocus={roving.onFocus}
          className="min-h-0 grow overflow-y-auto pb-4"
        >
          {buckets.map((bucket) => (
            <section key={bucket.id} aria-label={bucket.label}>
              <h3 className="sticky top-0 z-10 flex items-baseline justify-between border-b border-line bg-bg-raised px-3 pb-1 pt-2 font-mono text-12 uppercase tracking-[0.08em] text-text-secondary">
                <span>{bucket.label}</span>
                <span>{bucket.events.length}</span>
              </h3>
              <div className="px-1 py-1">
                {bucket.events.map((event) => (
                  <div key={event.id} data-testid="event-list-item">
                    <EventRow event={event} now={at} onOpen={openEvent} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({
  event,
  now,
  onOpen,
}: {
  event: EventOut;
  now: Date;
  onOpen: (event: EventOut) => void;
}) {
  const start = new Date(event.start);
  const meta = [event.placeName ?? event.locationRaw, event.orgName].filter(Boolean).join(" · ");
  return (
    <TimelineRow
      time={event.allDay ? "all day" : formatClock(start)}
      sub={event.allDay ? undefined : formatRelative(now, start)}
      title={
        event.isCanceled ? (
          <span className="text-text-secondary line-through">{event.title}</span>
        ) : (
          event.title
        )
      }
      meta={meta === "" ? undefined : meta}
      category={event.category}
      live={isLive(event, now)}
      end={
        event.isCanceled ? (
          <Badge>canceled</Badge>
        ) : (
          <SourceBadge source={event.source} confidence={event.confidence} />
        )
      }
      onClick={() => onOpen(event)}
    />
  );
}
