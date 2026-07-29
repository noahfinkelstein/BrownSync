import type { EventOut } from "@brownsync/contract";
import { CATEGORY_BY_ID } from "@brownsync/contract";
import {
  Badge,
  Button,
  CategoryIcon,
  cn,
  FOCUS_RING,
  Panel,
  SkeletonRows,
  SourceBadge,
} from "@brownsync/ui";
import type { ReactNode } from "react";
import { eventTimeLabel, fmtDay, fmtRange, minutesUntil } from "../data/format";
import { useEventDetail } from "../data/queries";
import { downloadIcs } from "./ics";

export type EventDetailPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string | null;
  /** The already-loaded list row — renders instantly while detail loads. */
  seed: EventOut | null;
  cursor: Date;
};

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="border-b border-line py-3 first:pt-1 last:border-b-0">
      <h3 className="pb-1.5 font-mono text-12 uppercase tracking-[0.08em] text-text-faint">
        {label}
      </h3>
      <div className="text-13 leading-relaxed text-text-primary">{children}</div>
    </section>
  );
}

/**
 * Right slide-over event detail (state-driven, no route): what / when /
 * where / who, provenance (source badge + confidence dot), "open source ↗",
 * add-to-calendar ICS download. Composes the ui Panel shell.
 */
export function EventDetailPanel({
  open,
  onOpenChange,
  eventId,
  seed,
  cursor,
}: EventDetailPanelProps) {
  const detailQuery = useEventDetail(open ? eventId : null);
  const detail = detailQuery.data ?? null;
  const event: EventOut | null = detail ?? seed;
  if (!event) return null;

  const soonMin = minutesUntil(event.start, cursor);
  const live = soonMin <= 0 || soonMin <= 30;
  const start = new Date(event.start);
  const end = event.end ? new Date(event.end) : null;
  const meta = CATEGORY_BY_ID[event.category];
  const place = detail?.place ?? null;
  const org = detail?.org ?? null;

  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      title={event.title}
      sub={eventTimeLabel(event.start, event.end, cursor)}
      footer={
        <div className="flex items-center justify-between gap-2">
          <SourceBadge source={event.source} confidence={event.confidence} />
          <div className="flex items-center gap-2">
            {event.url && (
              <a
                href={event.url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-4 border border-line px-2.5 text-13 font-medium text-text-primary transition-colors duration-150 ease-out hover:bg-bg-overlay",
                  FOCUS_RING,
                )}
              >
                open source ↗
              </a>
            )}
            <Button variant="primary" onClick={() => downloadIcs(event)}>
              Add to calendar
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex items-center gap-2 pb-2">
        <Badge>
          <CategoryIcon
            category={event.category}
            size={12}
            style={{ color: `var(${meta.colorToken})` }}
          />
          {meta.label}
        </Badge>
        {event.isCanceled && <Badge className="text-status-error">canceled</Badge>}
        {!event.isCanceled && live && (
          <Badge variant="accent">{soonMin <= 0 ? "live" : `in ${soonMin} min`}</Badge>
        )}
        {event.cost && <Badge>{event.cost}</Badge>}
      </div>

      <Section label="When">
        <div className="font-mono text-13">
          {fmtDay(start)} · {event.allDay ? "all day" : fmtRange(start, end)}
          <span className="text-text-faint"> ET</span>
        </div>
      </Section>

      <Section label="Where">
        {place || event.placeName || event.locationRaw ? (
          <>
            <div>{place?.name ?? event.placeName ?? event.locationRaw}</div>
            {event.locationRaw && (place?.name ?? event.placeName) && (
              <div className="pt-0.5 text-12 text-text-secondary">{event.locationRaw}</div>
            )}
            {place?.address && (
              <div className="pt-0.5 font-mono text-12 text-text-faint">{place.address}</div>
            )}
          </>
        ) : (
          <span className="text-text-secondary">No location listed</span>
        )}
      </Section>

      <Section label="Who">
        {detailQuery.isPending && !event.orgName ? (
          <SkeletonRows rows={1} />
        ) : org || event.orgName ? (
          <>
            <div>{org?.name ?? event.orgName}</div>
            {org?.url && (
              <a
                href={org.url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "font-mono text-12 text-text-secondary underline decoration-line underline-offset-2 transition-colors duration-150 ease-out hover:text-text-primary",
                  FOCUS_RING,
                )}
              >
                {org.url.replace(/^https?:\/\//, "")}
              </a>
            )}
          </>
        ) : (
          <span className="text-text-secondary">No organizer listed</span>
        )}
      </Section>

      {event.description && (
        <Section label="About">
          <p className="whitespace-pre-line text-text-secondary">{event.description}</p>
        </Section>
      )}

      {event.tags.length > 0 && (
        <Section label="Tags">
          <div className="flex flex-wrap gap-1.5">
            {event.tags.map((tag) => (
              <Badge key={tag} className="font-mono lowercase">
                {tag}
              </Badge>
            ))}
          </div>
        </Section>
      )}
    </Panel>
  );
}
