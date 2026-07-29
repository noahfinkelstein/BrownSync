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
import { useFocusReturn } from "../browse/useFocusReturn";
import { eventTimeLabel, fmtDay, fmtRange, minutesUntil } from "../data/format";
import { useEventDetail } from "../data/queries";
import { DEFAULT_DURATION_MS, isStartingSoon } from "../map/eventsLayer";
import { ErrorState } from "../ops/states/error";
import { PanelSkeleton } from "../ops/states/skeletons";

/** ICS builder loads on demand (Phase 3 perf) — never in the boot bundle. */
function addToCalendar(event: EventOut): void {
  void import("./ics").then(({ downloadIcs }) => downloadIcs(event));
}

export type EventDetailPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string | null;
  /** The already-loaded list row — renders instantly while detail loads. */
  seed: EventOut | null;
  cursor: Date;
};

/**
 * WHERE dedupe: feeds usually echo the resolved place name verbatim in
 * `location_raw` — print the raw line only when it adds information beyond
 * the resolved name (whitespace- and case-insensitive comparison).
 */
export function locationRawAddsInfo(locationRaw: string, resolvedName: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return normalize(locationRaw) !== normalize(resolvedName);
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="border-b border-line py-3 first:pt-1 last:border-b-0">
      <h3 className="pb-1.5 font-mono text-12 uppercase tracking-[0.08em] text-text-secondary">
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
  // State-driven dialog (no Radix Trigger): Escape must return focus to the
  // invoking list row / pin (§6.4) — Radix alone would drop it on <body>.
  useFocusReturn(open);
  const detailQuery = useEventDetail(open ? eventId : null);
  const detail = detailQuery.data ?? null;
  const event: EventOut | null = detail ?? seed;

  // Seedless opens (deep link / ⌘K hit outside the loaded window): designed
  // §6.4 states while the detail fetch is the only source of truth.
  if (!event) {
    if (!open || !eventId) return null;
    const failed = detailQuery.isError;
    return (
      <Panel
        open={open}
        onOpenChange={onOpenChange}
        testId="detail-panel"
        title="Event detail"
        sub={failed ? undefined : "loading…"}
      >
        {failed ? (
          <ErrorState what="the event" onRetry={() => void detailQuery.refetch()} />
        ) : (
          <PanelSkeleton />
        )}
      </Panel>
    );
  }

  const soonMin = minutesUntil(event.start, cursor);
  const cursorMs = cursor.getTime();
  const start = new Date(event.start);
  const end = event.end ? new Date(event.end) : null;
  // Accent only for genuinely live/now states (§6.1): in progress means the
  // cursor sits inside [start, end] (90-min fallback) — never after the end.
  const inProgress =
    start.getTime() <= cursorMs &&
    cursorMs <= (end ? end.getTime() : start.getTime() + DEFAULT_DURATION_MS);
  const startingSoon = isStartingSoon(event, cursorMs);
  const meta = CATEGORY_BY_ID[event.category];
  const place = detail?.place ?? null;
  const org = detail?.org ?? null;
  const resolvedPlaceName = place?.name ?? event.placeName ?? null;
  const showLocationRaw =
    event.locationRaw != null &&
    resolvedPlaceName != null &&
    locationRawAddsInfo(event.locationRaw, resolvedPlaceName);

  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      testId="detail-panel"
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
            <Button variant="primary" onClick={() => addToCalendar(event)}>
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
        {!event.isCanceled && (inProgress || startingSoon) && (
          <Badge variant="accent">{inProgress ? "live" : `in ${soonMin} min`}</Badge>
        )}
        {event.cost && <Badge>{event.cost}</Badge>}
      </div>

      <Section label="When">
        <div className="font-mono text-13">
          {fmtDay(start)} · {event.allDay ? "all day" : fmtRange(start, end)}
          <span className="text-text-secondary"> ET</span>
        </div>
      </Section>

      <Section label="Where">
        {place || event.placeName || event.locationRaw ? (
          <>
            <div>{resolvedPlaceName ?? event.locationRaw}</div>
            {showLocationRaw && (
              <div className="pt-0.5 text-12 text-text-secondary">{event.locationRaw}</div>
            )}
            {place?.address && (
              <div className="pt-0.5 font-mono text-12 text-text-secondary">{place.address}</div>
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
