import type { EventOut, MeetingOut, PlaceOut } from "@brownsync/contract";
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Skeleton,
  SkeletonRows,
  SourceBadge,
  TimelineRow,
} from "@brownsync/ui";
import type { ReactNode } from "react";
import { formatClock, formatDayLabel, formatRelative, isSameDay } from "../browse/format";
import { isLive } from "../browse/grouping";
import { usePlaceActivity, usePlaceWeekEvents } from "../data/places";
import { ApiError } from "../data/search";
import { PageShell, SectionHeading } from "./PageShell";
import { PlaceMiniMap } from "./PlaceMiniMap";

/**
 * Place page /p/:id — handoff §3.3: name/kind/aliases header, "everything
 * happening here" timeline (today via /places/:id/activity, rest of the week
 * via the campus week feed), real basemap mini-map (Phase 3).
 */

export type PlacePageProps = {
  id: string;
  /** Integration seam; default is the real basemap mini-map (PlaceMiniMap). */
  renderMiniMap?: (place: PlaceOut) => ReactNode;
  /** Row click override — integrator opens the detail panel. */
  onSelectEvent?: (event: EventOut) => void;
};

const MEETING_COLUMNS: readonly DataTableColumn<MeetingOut>[] = [
  {
    key: "time",
    header: "time",
    mono: true,
    width: "12ch",
    cell: (m) => `${m.startTime}–${m.endTime}`,
  },
  { key: "course", header: "course", mono: true, width: "11ch", cell: (m) => m.courseCode },
  { key: "title", header: "title", cell: (m) => m.title },
  {
    key: "room",
    header: "room",
    mono: true,
    width: "7ch",
    align: "right",
    cell: (m) => m.room ?? "—",
  },
];

export function PlacePage({ id, renderMiniMap, onSelectEvent }: PlacePageProps) {
  const activity = usePlaceActivity(id);
  const week = usePlaceWeekEvents(id);
  const now = new Date();

  if (activity.isPending) {
    return (
      <PageShell>
        <Skeleton className="mt-4 h-7 w-64" />
        <Skeleton className="mt-2 h-4 w-40" />
        <Skeleton className="mt-4 h-36 w-full" />
        <SkeletonRows rows={4} className="mt-6" />
      </PageShell>
    );
  }

  if (activity.isError) {
    const notFound = activity.error instanceof ApiError && activity.error.status === 404;
    return (
      <PageShell>
        {notFound ? (
          <EmptyState
            title="No such place"
            body={`Nothing in the gazetteer is called "${id}" — it may have been renamed or removed.`}
          />
        ) : (
          <EmptyState
            title="Place unavailable"
            body="The read API is unreachable — try again in a minute."
            action={<Button onClick={() => void activity.refetch()}>Retry</Button>}
          />
        )}
      </PageShell>
    );
  }

  const { place, events: todayEvents, meetings } = activity.data;
  const todayIds = new Set(todayEvents.map((e) => e.id));
  const laterThisWeek = (week.data ?? []).filter(
    (e) => !todayIds.has(e.id) && !isSameDay(new Date(e.start), now),
  );

  return (
    <PageShell>
      <header className="mt-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-24 font-medium tracking-tight text-text-primary">{place.name}</h1>
          <Badge className="translate-y-[-2px]">{place.kind}</Badge>
        </div>
        <div className="pt-1 font-mono text-12 text-text-secondary">
          {place.aliases.length > 0 ? place.aliases.join(" · ") : place.id}
        </div>
        {place.address && <div className="pt-0.5 text-13 text-text-secondary">{place.address}</div>}
      </header>

      <div className="mt-4">
        {renderMiniMap ? renderMiniMap(place) : <PlaceMiniMap place={place} />}
      </div>

      <SectionHeading count={meetings.length + todayEvents.length}>Today</SectionHeading>
      {meetings.length > 0 && (
        <div className="mt-2">
          <DataTable
            aria-label="Courses in session"
            columns={MEETING_COLUMNS}
            rows={meetings}
            rowKey={(m) => m.id}
          />
        </div>
      )}
      {todayEvents.length > 0 && (
        <div className="mt-1">
          {todayEvents.map((event) => (
            <PlaceEventRow key={event.id} event={event} now={now} onSelect={onSelectEvent} />
          ))}
        </div>
      )}
      {meetings.length === 0 && todayEvents.length === 0 && (
        <EmptyState
          title="Nothing here right now"
          body="No events or classes in the next 24 hours — check the rest of the week below."
        />
      )}

      <SectionHeading count={laterThisWeek.length}>This week</SectionHeading>
      {week.isPending ? (
        <SkeletonRows rows={3} className="mt-2" />
      ) : laterThisWeek.length === 0 ? (
        <EmptyState
          title="Quiet week here"
          body="Nothing scheduled at this building in the next 7 days."
        />
      ) : (
        <WeekTimeline events={laterThisWeek} now={now} onSelect={onSelectEvent} />
      )}
    </PageShell>
  );
}

function WeekTimeline({
  events,
  now,
  onSelect,
}: {
  events: readonly EventOut[];
  now: Date;
  onSelect?: (event: EventOut) => void;
}) {
  const byDay = new Map<string, EventOut[]>();
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  for (const event of sorted) {
    const label = formatDayLabel(new Date(event.start), now);
    const list = byDay.get(label);
    if (list) list.push(event);
    else byDay.set(label, [event]);
  }
  return (
    <div className="mt-1">
      {[...byDay.entries()].map(([label, dayEvents]) => (
        <section key={label} aria-label={label}>
          <h3 className="px-2 pb-0.5 pt-2 font-mono text-12 text-text-secondary">{label}</h3>
          {dayEvents.map((event) => (
            <PlaceEventRow key={event.id} event={event} now={now} onSelect={onSelect} />
          ))}
        </section>
      ))}
    </div>
  );
}

function PlaceEventRow({
  event,
  now,
  onSelect,
}: {
  event: EventOut;
  now: Date;
  onSelect?: (event: EventOut) => void;
}) {
  const start = new Date(event.start);
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
      meta={event.orgName ?? undefined}
      category={event.category}
      live={isLive(event, now)}
      end={
        event.isCanceled ? (
          <Badge>canceled</Badge>
        ) : (
          <SourceBadge source={event.source} confidence={event.confidence} />
        )
      }
      onClick={onSelect ? () => onSelect(event) : undefined}
    />
  );
}
