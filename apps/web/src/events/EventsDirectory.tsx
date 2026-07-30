import { CATEGORY_BY_ID, type Category, type EventOut } from "@brownsync/contract";
import {
  Badge,
  Button,
  CategoryIcon,
  cn,
  EmptyState,
  FOCUS_RING,
  SearchInput,
  SourceBadge,
} from "@brownsync/ui";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { CategoryChips } from "../browse/CategoryChips";
import { useCategoryFilter } from "../browse/filter";
import { fmtDay, fmtRange, isSameCampusDay, relLabel } from "../data/format";
import { useEventsWindow } from "../data/queries";
import { normalizeQuery } from "../data/search";
import { DEFAULT_DURATION_MS } from "../map/eventsLayer";
import { ListSkeleton } from "../ops/states/skeletons";
import { calendarLinks, campusDayKey, downloadEventsIcs, exportableEvents } from "./calendar";
import { absoluteHttpUrl } from "./url";

/**
 * The events directory: every event in the cursor window, without the map.
 *
 * The map answers "what is happening around me right now"; this answers
 * "what is happening at all, and can I put it in my calendar". So the unit
 * here is a LARGE card — big title, category colour, prominent time — not
 * the dense timeline row `browse/ListView` uses beside the map.
 *
 * Filter state lives in the URL (`?q=`, `?cats=`, `?org=`) so a filtered
 * directory is a shareable link. Every write is a FUNCTIONAL search update,
 * which is what preserves sibling params — the time cursor's `?at=` is on
 * the same route, and an object-form update would silently delete it.
 */

export const QUERY_PARAM = "q";
export const ORG_PARAM = "org";

const DAY_MS = 86_400_000;

/* ---------------------------------------------------------------- url state */

function useStringParam(key: string): [string, (next: string) => void] {
  const search = useLocation({ select: (loc) => loc.search }) as Record<string, unknown>;
  const navigate = useNavigate();
  const raw = search[key];
  // The router JSON-parses search values, so `?q=2026` arrives as a number.
  const value = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : "";
  const set = useCallback(
    (next: string) => {
      void navigate({
        to: ".",
        replace: true,
        resetScroll: false,
        // Functional form, matching browse/filter.ts — see the file header.
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          [key]: next === "" ? undefined : next,
        }),
      } as never);
    },
    [navigate, key],
  );
  return [value, set];
}

/* ------------------------------------------------------------ pure filters */

/**
 * Free-text match across everything a student would type: title, organizer,
 * place (resolved and raw), blurb, tags.
 *
 * Terms are ANDed rather than matched as one string, so "orchestra sayles"
 * finds the concert — a single-substring match would find nothing, because
 * no one field contains both words.
 */
export function eventMatchesQuery(event: EventOut, query: string): boolean {
  const q = normalizeQuery(query);
  if (q === "") return true;
  const haystack = normalizeQuery(
    [
      event.title,
      event.orgName,
      event.placeName,
      event.locationRaw,
      event.description,
      event.tags.join(" "),
    ]
      .filter(Boolean)
      .join(" "),
  );
  return q.split(" ").every((term) => haystack.includes(term));
}

export type DirectoryFilters = {
  query: string;
  categories: readonly Category[];
  orgId: string;
};

export function filterEvents(
  events: readonly EventOut[],
  { query, categories, orgId }: DirectoryFilters,
): EventOut[] {
  return events.filter((event) => {
    if (categories.length > 0 && !categories.includes(event.category)) return false;
    if (orgId !== "" && event.orgId !== orgId) return false;
    return eventMatchesQuery(event, query);
  });
}

export type DayGroup = { key: string; label: string; date: Date; events: EventOut[] };

/**
 * Campus-day heading. "Today"/"Tomorrow" are resolved in campus time like
 * every other timestamp on the card — deciding "today" in the viewer's local
 * timezone while printing campus clock times puts a 22:00 ET event under
 * "Tomorrow" for anyone west of Providence.
 */
function dayHeading(date: Date, now: Date): string {
  if (isSameCampusDay(date, now)) return "Today";
  if (isSameCampusDay(date, new Date(now.getTime() + DAY_MS))) return "Tomorrow";
  return fmtDay(date);
}

/** Chronological day groups; events inside a day sorted by start, then title. */
export function groupEventsByDay(events: readonly EventOut[], now: Date): DayGroup[] {
  const byDay = new Map<string, EventOut[]>();
  for (const event of events) {
    const key = campusDayKey(new Date(event.start));
    const list = byDay.get(key);
    if (list) list.push(event);
    else byDay.set(key, [event]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => {
      list.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
      const date = new Date(list[0]?.start ?? `${key}T12:00:00Z`);
      return { key, label: dayHeading(date, now), date, events: list };
    });
}

/** Organizers present in the current window, for the organizer filter. */
export function organizerOptions(
  events: readonly EventOut[],
): { id: string; name: string; count: number }[] {
  const byId = new Map<string, { id: string; name: string; count: number }>();
  for (const event of events) {
    if (!event.orgId || !event.orgName) continue;
    const existing = byId.get(event.orgId);
    if (existing) existing.count += 1;
    else byId.set(event.orgId, { id: event.orgId, name: event.orgName, count: 1 });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** In progress at `now`, using the map's open-ended-event assumption. */
function isInProgress(event: EventOut, now: Date): boolean {
  const start = new Date(event.start).getTime();
  const end = event.end ? new Date(event.end).getTime() : start + DEFAULT_DURATION_MS;
  return start <= now.getTime() && now.getTime() <= end;
}

/* ------------------------------------------------------------------ pieces */

const LINK_CLASS = cn(
  "rounded-2 underline decoration-line decoration-1 underline-offset-2 transition-colors duration-150 ease-out hover:decoration-text-primary",
  FOCUS_RING,
);

const ACTION_CLASS = cn(
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-4 border border-line bg-bg-base px-2.5 text-14 font-medium text-text-primary transition-colors duration-150 ease-out hover:bg-bg-overlay",
  FOCUS_RING,
);

function AddToCalendar({ event }: { event: EventOut }) {
  const links = calendarLinks(event);
  // Canceled events get no links at all (calendar.ts returns null), so the
  // affordance cannot be rendered by mistake.
  if (!links) return null;
  return (
    // Flat, not a disclosure: adding to a calendar is the whole point of the
    // card, and one hidden click between a student and their calendar is the
    // click where they give up and forget the event instead.
    // fieldset = implicit `group` role, the same idiom browse/CategoryChips
    // uses; min-w-0 defuses its min-content sizing quirk.
    <fieldset
      aria-label="Add to calendar"
      data-testid="add-to-calendar"
      className="flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
    >
      <span className="font-mono text-12 uppercase tracking-[0.08em] text-text-secondary">
        add to
      </span>
      <a href={links.google} target="_blank" rel="noreferrer noopener" className={ACTION_CLASS}>
        Google ↗
      </a>
      <a href={links.outlook} target="_blank" rel="noreferrer noopener" className={ACTION_CLASS}>
        Outlook ↗
      </a>
      <Button onClick={() => downloadEventsIcs([event])}>Download .ics</Button>
    </fieldset>
  );
}

function EventCard({ event, now }: { event: EventOut; now: Date }) {
  const meta = CATEGORY_BY_ID[event.category];
  const start = new Date(event.start);
  const end = event.end ? new Date(event.end) : null;
  const sourceUrl = absoluteHttpUrl(event.url);
  const live = !event.isCanceled && isInProgress(event, now);
  const upcoming = start.getTime() > now.getTime();

  return (
    <article
      data-testid="event-card"
      aria-label={event.title}
      className={cn(
        "relative overflow-hidden rounded-6 border bg-bg-base p-5 pl-6 transition-colors duration-150 ease-out",
        event.isCanceled
          ? "border-status-error/50 bg-bg-raised"
          : "border-line hover:border-text-secondary",
      )}
    >
      {/* The category accent bar — the fastest way to read a long list. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1.5"
        style={{
          background: `var(${meta.colorToken})`,
          opacity: event.isCanceled ? 0.3 : 1,
        }}
      />

      <div className="flex flex-wrap items-center gap-2 pb-2">
        <Badge>
          <CategoryIcon
            category={event.category}
            size={12}
            style={{ color: `var(${meta.colorToken})` }}
          />
          {meta.label}
        </Badge>
        {event.isCanceled ? (
          // Not a quiet outline badge: a canceled event that reads as normal
          // is the failure that sends someone across campus for nothing.
          <span className="inline-flex shrink-0 items-center rounded-2 bg-status-error px-1.5 py-px text-12 font-semibold uppercase tracking-[0.08em] text-bg-base">
            Canceled
          </span>
        ) : live ? (
          <Badge variant="accent">live now</Badge>
        ) : null}
        {event.cost && <Badge>{event.cost}</Badge>}
      </div>

      <p className="font-mono text-19 text-text-primary">
        {event.allDay ? "all day" : fmtRange(start, end)}
        {!event.allDay && <span className="text-text-secondary"> ET</span>}
        {!event.isCanceled && upcoming && (
          <span className="text-text-secondary"> · {relLabel(start, now)}</span>
        )}
      </p>

      {/* h4: the day group above owns h3, so cards nest under it. Size is
          set by the type scale, not by the heading level. */}
      <h4
        className={cn(
          "pt-1 text-24 font-semibold",
          event.isCanceled ? "text-text-secondary line-through" : "text-text-primary",
        )}
      >
        {event.title}
      </h4>

      <p className="pt-2 text-16 text-text-secondary">
        {event.placeId ? (
          <Link to="/p/$id" params={{ id: event.placeId }} className={LINK_CLASS}>
            {event.placeName ?? event.locationRaw ?? "Location"}
          </Link>
        ) : (
          (event.placeName ?? event.locationRaw ?? "Location TBA")
        )}
        {(event.orgId ?? event.orgName) && (
          <>
            <span aria-hidden> · </span>
            {event.orgId && event.orgName ? (
              <Link to="/o/$id" params={{ id: event.orgId }} className={LINK_CLASS}>
                {event.orgName}
              </Link>
            ) : (
              event.orgName
            )}
          </>
        )}
      </p>

      {event.description && (
        <p className="line-clamp-2 pt-2 text-14 text-text-secondary">{event.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-4">
        <AddToCalendar event={event} />
        {sourceUrl && (
          <a href={sourceUrl} target="_blank" rel="noreferrer noopener" className={ACTION_CLASS}>
            Source ↗
          </a>
        )}
        <span className="ml-auto">
          <SourceBadge source={event.source} confidence={event.confidence} />
        </span>
      </div>
    </article>
  );
}

/* --------------------------------------------------------------- component */

export type EventsDirectoryProps = {
  /**
   * Clock override for tests and for a caller that already owns a cursor.
   * Defaults to the time cursor `useEventsWindow` is keyed on, so the
   * directory and the map agree on "now" without a second seam.
   */
  now?: () => Date;
  className?: string;
};

export function EventsDirectory({ now, className }: EventsDirectoryProps) {
  const { data, isPending, isError, refetch, cursor } = useEventsWindow();
  const { selected, clear: clearCategories } = useCategoryFilter();
  const [urlQuery, setUrlQuery] = useStringParam(QUERY_PARAM);
  const [orgId, setOrgId] = useStringParam(ORG_PARAM);
  // Bulk export is a one-shot side effect; this only drives the confirmation.
  const [exported, setExported] = useState(0);

  /**
   * The text box is driven by local state, not straight off the URL.
   * `navigate` resolves asynchronously, so a URL-controlled input hands the
   * old value back to a fast typist and silently eats keystrokes. Local
   * state types instantly; the URL trails one navigation behind.
   */
  const [query, setQuery] = useState(urlQuery);
  const [syncedQuery, setSyncedQuery] = useState(urlQuery);
  if (urlQuery !== syncedQuery) {
    // The URL changed from outside (back/forward, a shared link) — adopt it.
    setSyncedQuery(urlQuery);
    setQuery(urlQuery);
  }
  const onQueryChange = (next: string) => {
    setQuery(next);
    setSyncedQuery(next);
    setUrlQuery(next);
  };

  const at = now ? now() : cursor;
  const events = useMemo(() => data ?? [], [data]);
  const organizers = useMemo(() => organizerOptions(events), [events]);
  const filtered = useMemo(
    () => filterEvents(events, { query, categories: selected, orgId }),
    [events, query, selected, orgId],
  );
  const groups = useMemo(() => groupEventsByDay(filtered, at), [filtered, at]);
  const exportable = useMemo(() => exportableEvents(filtered), [filtered]);

  // Retire the download confirmation once the filters move: "12 events
  // downloaded" left hanging over a different set of 3 events is a lie.
  const [exportedFrom, setExportedFrom] = useState(0);
  if (exported > 0 && exportedFrom !== exportable.length) setExported(0);

  const filtersActive = query !== "" || selected.length > 0 || orgId !== "";
  const clearAll = () => {
    onQueryChange("");
    setOrgId("");
    clearCategories();
  };

  // One string, one text node — split children would break a text query and,
  // worse, be announced piecemeal by a screen reader.
  const countLabel =
    `${filtered.length} event${filtered.length === 1 ? "" : "s"}` +
    (filtered.length === events.length ? "" : ` of ${events.length}`);

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-bg-raised", className)}>
      <header className="shrink-0 border-b border-line bg-bg-base px-4 py-3">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-24 font-semibold text-text-primary">Events</h2>
            <span className="font-mono text-12 text-text-secondary">{countLabel}</span>
          </div>

          <SearchInput
            density="comfortable"
            aria-label="Search events"
            placeholder="Search events, organizers, places…"
            value={query}
            onChange={(e) => onQueryChange(e.currentTarget.value)}
            onClear={() => onQueryChange("")}
          />

          <CategoryChips />

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by organizer"
              value={orgId}
              onChange={(e) => setOrgId(e.currentTarget.value)}
              className={cn(
                "h-7 max-w-full rounded-4 border border-line bg-bg-overlay px-2 text-14 text-text-primary",
                FOCUS_RING,
              )}
            >
              <option value="">All organizers</option>
              {organizers.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} ({org.count})
                </option>
              ))}
            </select>

            {exportable.length > 0 && (
              <Button
                onClick={() => {
                  if (!downloadEventsIcs(exportable)) return;
                  setExported(exportable.length);
                  setExportedFrom(exportable.length);
                }}
              >
                Add {exportable.length} to calendar (.ics)
              </Button>
            )}

            {filtersActive && (
              <button
                type="button"
                onClick={clearAll}
                className={cn(
                  "px-1 font-mono text-12 text-text-secondary transition-colors duration-150 ease-out hover:text-text-primary",
                  FOCUS_RING,
                )}
              >
                clear filters
              </button>
            )}

            <span aria-live="polite" className="font-mono text-12 text-text-secondary">
              {exported > 0 && `${exported} event${exported === 1 ? "" : "s"} downloaded`}
            </span>
          </div>
        </div>
      </header>

      <div className="min-h-0 grow overflow-y-auto px-4 pb-12 pt-4">
        <div className="mx-auto w-full max-w-3xl">
          {isPending ? (
            <ListSkeleton className="pt-2" />
          ) : isError ? (
            <EmptyState
              title="Events unavailable"
              body="The read API is unreachable. Try again in a minute."
              action={<Button onClick={() => void refetch()}>Retry</Button>}
            />
          ) : groups.length === 0 ? (
            <EmptyState
              title="No events match"
              body={
                filtersActive
                  ? "Nothing in this window matches these filters."
                  : "No events were published for this window."
              }
              action={filtersActive ? <Button onClick={clearAll}>Clear filters</Button> : undefined}
            />
          ) : (
            groups.map((group) => (
              <section key={group.key} aria-label={group.label} className="pb-6">
                <h3 className="sticky top-0 z-10 flex items-baseline justify-between gap-2 border-b border-line bg-bg-raised pb-1 pt-1 font-mono text-12 uppercase tracking-[0.08em] text-text-secondary">
                  <span>
                    {group.label}
                    {group.label !== fmtDay(group.date) && (
                      <span className="pl-2 normal-case tracking-normal">{fmtDay(group.date)}</span>
                    )}
                  </span>
                  <span>{group.events.length}</span>
                </h3>
                <div className="flex flex-col gap-3 pt-3">
                  {group.events.map((event) => (
                    <EventCard key={event.id} event={event} now={at} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
