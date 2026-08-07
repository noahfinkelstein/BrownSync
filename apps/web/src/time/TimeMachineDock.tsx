import { cn } from "@brownsync/ui";
import { type TimeCursorStore, timeCursor } from "./cursor";
import { TimePresets } from "./TimePresets";
import { TimeScrubber } from "./TimeScrubber";
import { TimeStepper } from "./TimeStepper";

export type TimeMachineDockProps = {
  /** Injectable for tests; defaults to the app-wide cursor. */
  store?: TimeCursorStore;
  className?: string;
};

/**
 * The time machine as a full-width bottom dock.
 *
 * It used to live in the header's centre slot capped at `max-w-xl` (576 px),
 * sharing a 48 px row with the brand, ⌘K and source health. A ±7-day scrub
 * in 15-minute steps is ~1,344 positions; at 576 px that is 0.43 px per step,
 * so a single pixel of mouse travel moved the cursor over two steps and the
 * day ticks collided into a grey band.
 *
 * Docked at the bottom it spans the viewport — the same scrub across ~1,100
 * px of track, with the day ticks legible. This is also where a scrubber
 * belongs spatially: it is a timeline under the thing it scrubs.
 */
export function TimeMachineDock({ store = timeCursor, className }: TimeMachineDockProps) {
  return (
    <div
      className={cn(
        "z-30 flex shrink-0 items-center gap-4 border-t border-line bg-bg-base px-4 py-2.5",
        className,
      )}
    >
      <TimeScrubber store={store} className="min-w-0 grow" />
      {/* Ordered by precision: continuous drag, then exact steps, then jumps.
          The stepper costs the rail ~230 px, which is a trade worth naming —
          it exists precisely so nobody has to hit a 0.5 px/step target by
          hand, so the track it shortens is the track it makes less load-
          bearing. Anything that shrinks the rail FURTHER belongs elsewhere.
          Below md the stepper and presets are gone entirely (UI audit: at
          375 px the full row collapsed into an unusable pile) — mobile keeps
          NOW + rail + readout, and exact steps stay a keyboard affordance. */}
      <div className="hidden shrink-0 items-center gap-4 md:flex">
        <TimeStepper store={store} className="shrink-0" />
        <TimePresets store={store} className="shrink-0" />
      </div>
    </div>
  );
}
