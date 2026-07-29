import { CATEGORY_BY_ID, type EventOut } from "@brownsync/contract";
import {
  Badge,
  Button,
  CategoryIcon,
  cn,
  EmptyState,
  FOCUS_RING,
  Skeleton,
  SkeletonRows,
  SourceBadge,
  TimelineRow,
} from "@brownsync/ui";
import type { ReactNode } from "react";
import { formatClock, formatDayLabel, formatRelative } from "../browse/format";
import { isLive } from "../browse/grouping";
import { useOrg } from "../data/orgs";
import { ApiError } from "../data/search";
import { PageShell, SectionHeading } from "./PageShell";

/**
 * Org page /o/:id — handoff §3.4: club info, category glyph, links,
 * upcoming + past events as timelines (no card grids, §6.4).
 */

export type OrgPageProps = {
  id: string;
  /** Row click override — integrator opens the detail panel. */
  onSelectEvent?: (event: EventOut) => void;
};

const PAST_LIMIT = 20;

export function OrgPage({ id, onSelectEvent }: OrgPageProps) {
  const org = useOrg(id);
  const now = new Date();

  if (org.isPending) {
    return (
      <PageShell>
        <Skeleton className="mt-4 h-7 w-64" />
        <Skeleton className="mt-2 h-4 w-40" />
        <SkeletonRows rows={4} className="mt-6" />
      </PageShell>
    );
  }

  if (org.isError) {
    const notFound = org.error instanceof ApiError && org.error.status === 404;
    return (
      <PageShell>
        {notFound ? (
          <EmptyState
            title="No such organization"
            body={`Nothing in the directory is called "${id}" — it may have been renamed or removed.`}
          />
        ) : (
          <EmptyState
            title="Organization unavailable"
            body="The read API is unreachable — try again in a minute."
            action={<Button onClick={() => void org.refetch()}>Retry</Button>}
          />
        )}
      </PageShell>
    );
  }

  const detail = org.data;
  const upcoming = [...detail.upcoming].sort((a, b) => a.start.localeCompare(b.start));
  const past = [...detail.past].sort((a, b) => b.start.localeCompare(a.start)).slice(0, PAST_LIMIT);
  const instagramHandle = detail.instagram?.replace(/^@/, "") ?? null;

  return (
    <PageShell>
      <header className="mt-4">
        <div className="flex items-center gap-2.5">
          {detail.category && (
            <CategoryIcon
              category={detail.category}
              size={20}
              title={CATEGORY_BY_ID[detail.category].label}
              style={{ color: `var(${CATEGORY_BY_ID[detail.category].colorToken})` }}
            />
          )}
          <h1 className="text-24 font-medium tracking-tight text-text-primary">{detail.name}</h1>
          <Badge className="translate-y-[1px]">{detail.kind}</Badge>
        </div>
        {detail.description && (
          <p className="max-w-[64ch] pt-2 text-13 text-text-secondary">{detail.description}</p>
        )}
        <div className="flex items-center gap-4 pt-2">
          {detail.url && <ExternalLink href={detail.url}>website ↗</ExternalLink>}
          {instagramHandle && (
            <ExternalLink
              href={
                instagramHandle.startsWith("http")
                  ? instagramHandle
                  : `https://instagram.com/${instagramHandle}`
              }
            >
              @{instagramHandle.replace(/^https?:\/\/(www\.)?instagram\.com\//, "")} ↗
            </ExternalLink>
          )}
        </div>
      </header>

      <SectionHeading count={upcoming.length}>Upcoming</SectionHeading>
      {upcoming.length === 0 ? (
        <EmptyState
          title="No upcoming events"
          body="Nothing on the calendar yet — check their site or Instagram for announcements."
        />
      ) : (
        <div className="mt-1">
          {upcoming.map((event) => (
            <OrgEventRow key={event.id} event={event} now={now} onSelect={onSelectEvent} />
          ))}
        </div>
      )}

      <SectionHeading count={past.length}>Past</SectionHeading>
      {past.length === 0 ? (
        <div className="px-2 py-3 font-mono text-12 text-text-faint">no recorded past events</div>
      ) : (
        <div className="mt-1 opacity-70">
          {past.map((event) => (
            <TimelineRow
              key={event.id}
              time={formatClock(new Date(event.start))}
              sub={formatDayLabel(new Date(event.start), now)}
              title={event.title}
              meta={event.placeName ?? event.locationRaw ?? undefined}
              category={event.category}
              onClick={onSelectEvent ? () => onSelectEvent(event) : undefined}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function OrgEventRow({
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
      sub={event.allDay ? formatDayLabel(start, now) : formatRelative(now, start)}
      title={
        event.isCanceled ? (
          <span className="text-text-faint line-through">{event.title}</span>
        ) : (
          event.title
        )
      }
      meta={event.placeName ?? event.locationRaw ?? undefined}
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

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "font-mono text-12 text-text-secondary transition-colors duration-150 ease-out hover:text-text-primary",
        FOCUS_RING,
      )}
    >
      {children}
    </a>
  );
}
