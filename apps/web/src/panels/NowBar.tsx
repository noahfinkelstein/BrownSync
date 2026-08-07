import { cn } from "@brownsync/ui";
import { useMemo } from "react";
import { useCategoryFilter } from "../browse/filter";
import { useEventsWindow, useMeetingsInSession } from "../data/queries";
import { aggregateMeetingActivity, totalMeetingCount } from "../map/classesLayer";
import { eventsInWindow } from "../map/eventsLayer";
import { summarizeNow } from "./nowSummary";

/**
 * The header's live readout — what the campus is doing at the cursor.
 *
 * It reads the SAME query hooks as <LiveMap/>, so TanStack serves both from
 * one cache entry and no extra request is made. It also applies the same
 * `?cats=` filter, because a bar that says "47 events" while the map draws
 * four is worse than no bar.
 *
 * Not an ambient animation: every value here changes only when the cursor
 * moves or the 60 s live refetch lands (§6.4).
 */
export function NowBar({ className }: { className?: string }) {
  const eventsQuery = useEventsWindow();
  const meetingsQuery = useMeetingsInSession();
  const { selected } = useCategoryFilter();
  const cursor = eventsQuery.cursor;

  const summary = useMemo(() => {
    const windowed = eventsInWindow(eventsQuery.data ?? [], cursor);
    const filtered =
      selected.length === 0 ? windowed : windowed.filter((e) => selected.includes(e.category));
    const classes = totalMeetingCount(aggregateMeetingActivity(meetingsQuery.data ?? []));
    return summarizeNow(filtered, classes, cursor);
  }, [eventsQuery.data, meetingsQuery.data, selected, cursor]);

  const pending = eventsQuery.isPending && !eventsQuery.data;

  return (
    <output
      // polite would re-announce on every 60 s refetch. The underlying data
      // is reachable in the list and the scrubber's own aria-valuetext.
      aria-live="off"
      data-testid="now-bar"
      className={cn(
        "flex min-w-0 items-center gap-3 font-mono text-12 tabular-nums text-text-secondary",
        className,
      )}
    >
      {pending ? (
        <span className="text-text-secondary">…</span>
      ) : (
        <>
          <span className="flex shrink-0 items-center gap-1.5 text-text-primary">
            {/* Inactive state is a hairline ring, not a --text-faint fill:
                the token lands ≈3.0:1 on bg-base, right on the WCAG 1.4.11
                boundary. Same treatment as the layer panel's off dots. */}
            <span
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 rounded-full border",
                summary.soon > 0
                  ? "bs-live-dot border-transparent bg-accent"
                  : "border-text-faint bg-transparent",
              )}
            />
            {summary.live} now
          </span>
          {/* Separators inherit --text-secondary. --text-faint fails AA and
              a rendered `·` is text, aria-hidden or not (a11y-contrast.test).
              The classes count hides below sm (UI audit: at 375 px it pushed
              the health dot off-edge; "N now" is the count a phone acts on). */}
          <span aria-hidden className="hidden sm:inline">
            ·
          </span>
          <span className="hidden shrink-0 sm:inline">{summary.classes} in class</span>
          {/* No next-event teaser (UI audit): it was a non-interactive
              duplicate of the HappeningNow panel's first row. The counts
              are the readout; the panel is where events are named. */}
        </>
      )}
    </output>
  );
}
