import {
  CATEGORY_BY_ID,
  type EventOut,
  type MeetingOut,
  type OrgOut,
  type PlaceOut,
} from "@brownsync/contract";
import { CategoryIcon, cn, EmptyState, Kbd, SearchGlyph, SkeletonRows } from "@brownsync/ui";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { type ReactNode, useDeferredValue, useState } from "react";
import { MIN_QUERY_LENGTH, useSearch } from "../data/search";
import { formatDayTime } from "./format";
import { useFocusReturn } from "./useFocusReturn";

/**
 * ⌘K palette — handoff §2 H, re-themed per §6: dark, dense, mono metadata,
 * 1px hairlines, radius ≤6, no shadow. cmdk with `shouldFilter=false`; the
 * query fans across the read API (see data/search.ts).
 */

export type SearchPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Where event hits go. Default: `/?event=<id>` on the index route — the
   * integrator overrides this to open lane F's detail panel + flyTo.
   */
  onSelectEvent?: (event: EventOut) => void;
};

const ITEM_CLS = cn(
  "flex select-none items-center gap-2 rounded-4 px-2 py-1.5 text-13 text-text-primary",
  "data-[selected=true]:bg-bg-overlay",
);

const GROUP_CLS = cn(
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2",
  "[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-12",
  "[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em]",
  "[&_[cmdk-group-heading]]:text-text-secondary",
);

function MonoTag({ children }: { children: ReactNode }) {
  return <span className="shrink-0 font-mono text-12 text-text-secondary">{children}</span>;
}

/** Neutral geometric marker for rows without a category glyph. */
function SquareMark() {
  return <span aria-hidden className="h-1.5 w-1.5 shrink-0 border border-text-secondary" />;
}

export function SearchPalette({ open, onOpenChange, onSelectEvent }: SearchPaletteProps) {
  // State-driven dialog (no Radix Trigger): hand focus back to the invoker
  // (§6.4) — Radix alone would drop it on <body>.
  useFocusReturn(open);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const { groups, total, active, pending, degraded } = useSearch(deferredQuery);
  const navigate = useNavigate();
  const now = new Date();

  const handleOpenChange = (next: boolean) => {
    if (!next) setQuery("");
    onOpenChange(next);
  };
  const close = () => handleOpenChange(false);

  const goEvent = (event: EventOut) => {
    close();
    if (onSelectEvent) {
      onSelectEvent(event);
      return;
    }
    // Index route has no validateSearch yet; the param shape is integration's.
    void navigate({ to: "/", search: { event: event.id } } as never);
  };
  const goPlace = (place: PlaceOut) => {
    close();
    void navigate({ to: "/p/$id", params: { id: place.id } });
  };
  const goOrg = (org: OrgOut) => {
    close();
    void navigate({ to: "/o/$id", params: { id: org.id } });
  };
  const goCourse = (meeting: MeetingOut) => {
    close();
    if (meeting.placeId) void navigate({ to: "/p/$id", params: { id: meeting.placeId } });
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={handleOpenChange}
      shouldFilter={false}
      label="Search BrownSync"
      overlayClassName="fixed inset-0 z-50 bg-bg-base/60"
      contentClassName="fixed left-1/2 top-[14%] z-50 w-[560px] max-w-[92vw] -translate-x-1/2"
      className="overflow-hidden rounded-6 border border-line bg-bg-raised"
    >
      <div className="flex items-center gap-2 border-b border-line px-3">
        <SearchGlyph className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
        <Command.Input
          data-testid="search-input"
          value={query}
          onValueChange={setQuery}
          placeholder="Search events, places, clubs, courses…"
          className="h-9 w-full min-w-0 grow bg-transparent text-13 text-text-primary outline-none placeholder:text-text-secondary"
        />
        <Kbd>esc</Kbd>
      </div>

      <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
        {!active ? (
          <div className="px-2 py-4 font-mono text-12 text-text-secondary">
            Type {MIN_QUERY_LENGTH}+ characters — try "Salomon", "outing", or "CSCI 0150"
          </div>
        ) : (
          <>
            {degraded && (
              <div role="alert" className="px-2 py-1 font-mono text-12 text-text-secondary">
                some sources unavailable — results may be partial
              </div>
            )}
            {pending && total === 0 && <SkeletonRows rows={3} className="px-2 py-2" />}
            {!pending && total === 0 && (
              <EmptyState
                title="No matches"
                body={`Nothing named "${deferredQuery.trim()}" — try a building, a club, or a course code.`}
              />
            )}

            {groups.events.length > 0 && (
              <Command.Group heading="Events" className={GROUP_CLS}>
                {groups.events.map((event) => (
                  <Command.Item
                    key={event.id}
                    value={`event:${event.id}`}
                    onSelect={() => goEvent(event)}
                    className={ITEM_CLS}
                  >
                    <CategoryIcon
                      category={event.category}
                      size={14}
                      className="shrink-0"
                      style={{ color: `var(${CATEGORY_BY_ID[event.category].colorToken})` }}
                    />
                    <span className="min-w-0 grow truncate">{event.title}</span>
                    <MonoTag>{formatDayTime(event.start, now)}</MonoTag>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {groups.places.length > 0 && (
              <Command.Group heading="Places" className={GROUP_CLS}>
                {groups.places.map((place) => (
                  <Command.Item
                    key={place.id}
                    value={`place:${place.id}`}
                    onSelect={() => goPlace(place)}
                    className={ITEM_CLS}
                  >
                    <SquareMark />
                    <span className="min-w-0 grow truncate">{place.name}</span>
                    <MonoTag>{place.kind}</MonoTag>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {groups.orgs.length > 0 && (
              <Command.Group heading="Organizations" className={GROUP_CLS}>
                {groups.orgs.map((org) => (
                  <Command.Item
                    key={org.id}
                    value={`org:${org.id}`}
                    onSelect={() => goOrg(org)}
                    className={ITEM_CLS}
                  >
                    {org.category ? (
                      <CategoryIcon
                        category={org.category}
                        size={14}
                        className="shrink-0"
                        style={{ color: `var(${CATEGORY_BY_ID[org.category].colorToken})` }}
                      />
                    ) : (
                      <SquareMark />
                    )}
                    <span className="min-w-0 grow truncate">{org.name}</span>
                    <MonoTag>{org.kind}</MonoTag>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {groups.courses.length > 0 && (
              <Command.Group heading="Courses in session" className={GROUP_CLS}>
                {groups.courses.map((meeting) => (
                  <Command.Item
                    key={meeting.id}
                    value={`course:${meeting.id}`}
                    onSelect={() => goCourse(meeting)}
                    className={ITEM_CLS}
                  >
                    <CategoryIcon
                      category="class"
                      size={14}
                      className="shrink-0"
                      style={{ color: `var(${CATEGORY_BY_ID.class.colorToken})` }}
                    />
                    <span className="shrink-0 font-mono text-12 text-text-secondary">
                      {meeting.courseCode}
                    </span>
                    <span className="min-w-0 grow truncate">{meeting.title}</span>
                    <MonoTag>
                      {meeting.days} {meeting.startTime}
                    </MonoTag>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </>
        )}
      </Command.List>

      <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 font-mono text-12 text-text-secondary">
        <span>↑↓ navigate</span>
        <span>↵ open</span>
        <span>esc close</span>
        {active && !pending && (
          <span className="ml-auto">
            {total} hit{total === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </Command.Dialog>
  );
}
