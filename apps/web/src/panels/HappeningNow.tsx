import type { EventOut } from "@brownsync/contract";
import { cn, FOCUS_RING, TimelineRow } from "@brownsync/ui";
import { useMemo, useState } from "react";
import { useCategoryFilter } from "../browse/filter";
import { useEventsWindow, useMeetingsInSession } from "../data/queries";
import { aggregateMeetingActivity, totalMeetingCount } from "../map/classesLayer";
import { eventsInWindow } from "../map/eventsLayer";
import { formatClock, formatRelative } from "../time/format";
import { panelStartsOpen } from "./defaultOpen";
import { happeningNow, placeLabel } from "./liveNow";

export type HappeningNowProps = {
  /**
   * Open an event's detail panel. LiveMap passes its own `handleSelect`, so a
   * row click behaves exactly like clicking the dot on the map (select, fly
   * to, open the slide-over). Required — a row that cannot be opened is a
   * readout, and the header's <NowBar/> is already that.
   */
  onSelect: (event: EventOut) => void;
  className?: string;
};

/**
 * The map's bottom-left "happening now" bar — what is IN PROGRESS at the
 * cursor, and what starts in the next half hour.
 *
 * Distinct from the header's <NowBar/>, which is a one-line readout with no
 * rows. This one is a short, clickable list pinned over the map, so a glance
 * at the corner answers "what can I walk into right now" without reading dots.
 *
 * AGREEMENT. It reads the SAME query hooks as <LiveMap/> and <NowBar/>, so
 * TanStack serves all three from one cache entry and no extra request is made,
 * and it applies the SAME `eventsInWindow` + `?cats=` narrowing — a bar that
 * says 12 while the map draws 4 is worse than no bar. It deliberately does NOT
 * apply the `?layers=` toggles: <NowBar/> does not either, and two "now"
 * readouts on screen at once disagreeing with EACH OTHER is the worse bug.
 *
 * §6.4: no ambient animation. Every value changes only when the cursor moves
 * or the existing 60 s live refetch lands. The one permitted pulse is
 * `.bs-live-dot` on the "starting soon" indicator.
 */
export function HappeningNow({ onSelect, className }: HappeningNowProps) {
  const eventsQuery = useEventsWindow();
  const meetingsQuery = useMeetingsInSession();
  const { selected } = useCategoryFilter();
  const cursor = eventsQuery.cursor;
  // Collapsed to the one-row summary on phones (UI audit: mounted expanded
  // it stacked with LayerPanel over most of a 375 px map).
  const [open, setOpen] = useState(panelStartsOpen);

  const model = useMemo(() => {
    const windowed = eventsInWindow(eventsQuery.data ?? [], cursor);
    const filtered =
      selected.length === 0 ? windowed : windowed.filter((e) => selected.includes(e.category));
    return happeningNow(filtered, cursor);
  }, [eventsQuery.data, selected, cursor]);

  const classes = useMemo(
    () => totalMeetingCount(aggregateMeetingActivity(meetingsQuery.data ?? [])),
    [meetingsQuery.data],
  );

  const pending = eventsQuery.isPending && !eventsQuery.data;
  const showFooter = model.soon > 0 || classes > 0;

  return (
    // The WRAPPER is pointer-events-none and only the card takes pointer
    // events back. Without that, this box's bounds would eat map drags in the
    // corner even when collapsed — the panel is over a map, and swallowing
    // pan/zoom is the one thing an overlay must never do.
    <div
      className={cn(
        "pointer-events-none absolute bottom-3 left-3 z-20 w-80 max-w-[calc(100%-1.5rem)]",
        className,
      )}
    >
      <section
        aria-label="Happening now"
        data-testid="happening-now"
        className="pointer-events-auto overflow-hidden rounded-6 border border-line bg-bg-raised"
      >
        <h2>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
            className={cn(
              // Solid overlay, not `/60`: on the light theme a 60% overlay
              // composites toward white and leaves no visible hover at all.
              "flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors duration-150 ease-out hover:bg-bg-overlay",
              FOCUS_RING,
            )}
          >
            <LiveDot live={model.live} soon={model.soon} />
            <span className="grow font-mono text-12 tabular-nums text-text-primary">
              {pending ? "…" : `${model.live} happening now`}
            </span>
            <Chevron open={open} />
          </button>
        </h2>

        {open && (
          <div className="border-t border-line">
            {pending ? (
              <p className="px-2.5 py-2 text-14 text-text-secondary">Loading events…</p>
            ) : model.rows.length === 0 ? (
              <p className="px-2.5 py-2 text-14 text-text-secondary">
                Nothing in progress at this time.
              </p>
            ) : (
              <ul className="max-h-[15rem] overflow-y-auto py-1">
                {model.rows.map((row) => {
                  const start = new Date(row.event.start);
                  return (
                    <li key={row.event.id} data-testid="happening-now-row">
                      <TimelineRow
                        time={row.event.allDay ? "all day" : formatClock(start)}
                        sub={row.event.allDay ? undefined : formatRelative(start, cursor)}
                        title={row.event.title}
                        meta={placeLabel(row.event) ?? undefined}
                        category={row.event.category}
                        // TimelineRow's `live` means "starting ≤30 min — pulse
                        // it" (§6.4), NOT "in progress". Rows already under way
                        // keep their category dot and stay still.
                        live={!row.inProgress}
                        onClick={() => onSelect(row.event)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}

            {!pending && showFooter && (
              <p className="border-t border-line px-2.5 py-1.5 font-mono text-12 tabular-nums text-text-secondary">
                {[
                  model.soon > 0 ? `${model.soon} starting soon` : null,
                  classes > 0 ? `${classes} in class` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Accent fill means live/now and nothing else (§6.1); the pulse is reserved
 * for the ≤30-min window (§6.4). Idle is a hairline ring rather than a
 * `--text-faint` fill — same treatment as <NowBar/> and the layer panel.
 */
function LiveDot({ live, soon }: { live: number; soon: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full border",
        soon > 0 && "bs-live-dot",
        live > 0 || soon > 0 ? "border-transparent bg-accent" : "border-text-faint bg-transparent",
      )}
    />
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      role="presentation"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      className={cn(
        "shrink-0 text-text-secondary transition-transform duration-150 ease-out",
        open && "rotate-90",
      )}
    >
      <path d="M3.5 2 L6.5 5 L3.5 8" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}
