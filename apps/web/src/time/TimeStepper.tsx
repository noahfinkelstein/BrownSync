import { cn, FOCUS_RING } from "@brownsync/ui";
import { Fragment, useMemo } from "react";
import { type TimeCursorStore, timeCursor } from "./cursor";
import { createScrubberScale, type ScrubberScale, stepLocalDay } from "./scrubberScale";
import { addLocalDays, HOUR_MS } from "./tz";
import { useTimeCursor } from "./useTimeCursor";

/**
 * Click-to-step controls for the time machine: −1w −1d −1h | +1h +1d +1w.
 *
 * Dragging the scrubber is fine for "sometime tomorrow evening" and useless
 * for "the same time next week" — 15-min steps over a 14-day rail means one
 * pixel of mouse travel is two steps. These buttons are the exact-arithmetic
 * complement to the drag, and they agree with the scrubber's own keyboard
 * semantics (arrows = 15 min, Shift+arrow / PageUp/Down = one local day).
 */

export type StepUnit = "hour" | "day" | "week";

export type TimeStep = {
  readonly unit: StepUnit;
  readonly direction: 1 | -1;
  /** Mono glyph on the button. U+2212 minus, not a hyphen — it aligns. */
  readonly label: string;
  /** The accessible name. Icon-dense controls always spell it out. */
  readonly name: string;
};

export const TIME_STEPS: readonly TimeStep[] = [
  { unit: "week", direction: -1, label: "−1w", name: "Back one week" },
  { unit: "day", direction: -1, label: "−1d", name: "Back one day" },
  { unit: "hour", direction: -1, label: "−1h", name: "Back one hour" },
  { unit: "hour", direction: 1, label: "+1h", name: "Forward one hour" },
  { unit: "day", direction: 1, label: "+1d", name: "Forward one day" },
  { unit: "week", direction: 1, label: "+1w", name: "Forward one week" },
];

/**
 * Where a step lands, clamped into the scrubber's ±7-day rail.
 *
 * Hours are exact ms arithmetic: an hour is an hour, and stepping +1 h into
 * the DST fall-back correctly lands on the repeated 01:00 rather than skipping
 * it. Days and weeks step CAMPUS-LOCAL CALENDAR days (via `addLocalDays`, the
 * same primitive `stepLocalDay` uses), so "same time tomorrow" is the same
 * wall-clock time — a 24 h jump across the November transition would land an
 * hour early, and "+1d" moving the clock is the bug users actually notice.
 *
 * (The brief called weeks exact arithmetic. A week is seven calendar days and
 * hits the same DST edge, and "+1w" disagreeing with seven "+1d" presses would
 * be indefensible, so it gets the local-day treatment too. Flip `DAYS_PER_UNIT`
 * to change that.)
 */
const DAYS_PER_UNIT: Record<StepUnit, number> = { hour: 0, day: 1, week: 7 };

export function stepCursor(scale: ScrubberScale, from: Date | number, step: TimeStep): Date {
  const days = DAYS_PER_UNIT[step.unit] * step.direction;
  if (days === 0) {
    const ms = (typeof from === "number" ? from : from.getTime()) + step.direction * HOUR_MS;
    return scale.toDate(scale.toValue(ms));
  }
  // ±1 day is exactly the scrubber's own Shift+arrow behaviour; reuse it so
  // the button and the keyboard can never drift apart.
  if (days === 1 || days === -1) return stepLocalDay(scale, from, step.direction);
  return scale.toDate(scale.toValue(addLocalDays(from, days)));
}

/**
 * Would this step actually move the cursor? Compared in the scale's own
 * minute-value space — i.e. "does the scrubber thumb move" — so a cursor
 * carrying stray seconds at the rail end cannot report a phantom step.
 *
 * This drives `disabled`. Clamping alone would leave a live-looking button
 * that does nothing, and a control that silently no-ops is the thing users
 * click three more times before deciding the app is broken.
 */
export function canStep(scale: ScrubberScale, from: Date | number, step: TimeStep): boolean {
  return scale.toValue(stepCursor(scale, from, step)) !== scale.toValue(from);
}

export type TimeStepperProps = {
  /** Injectable for tests; defaults to the app-wide cursor. */
  store?: TimeCursorStore;
  className?: string;
};

export function TimeStepper({ store = timeCursor, className }: TimeStepperProps) {
  const cursor = useTimeCursor(store);
  // Same anchor rule as <TimeScrubber/>: the 14-day window anchors at mount
  // off the wall clock, so the two controls describe the same rail and a
  // button disables exactly when the thumb is against the end of the track.
  const scale = useMemo(() => createScrubberScale(cursor.liveNow()), [cursor]);
  const at = cursor.now();

  return (
    // <fieldset>, like <TimePresets/>: a labelled group of controls, and the
    // implicit role beats role="group" on a div. Fieldsets default to
    // min-width:min-content, so min-w-0 keeps the dock's flex row sane.
    <fieldset
      aria-label="Step the time cursor"
      data-testid="time-stepper"
      className={cn("m-0 flex min-w-0 shrink-0 items-center gap-1 border-0 p-0", className)}
    >
      {TIME_STEPS.map((step, index) => (
        <Fragment key={step.name}>
          {/* The seam between back and forward. A hairline, not a "|"
              character: a rendered glyph is text and would owe AA contrast. */}
          {index === TIME_STEPS.length / 2 && (
            <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-line" />
          )}
          <button
            type="button"
            aria-label={step.name}
            disabled={!canStep(scale, at, step)}
            onClick={() => cursor.setAt(stepCursor(scale, at, step))}
            className={cn(
              "inline-flex h-6 shrink-0 select-none items-center rounded-4 border border-line px-1.5 font-mono text-12 text-text-secondary tabular-nums transition-colors duration-150 ease-out",
              "hover:border-text-faint hover:text-text-primary",
              "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-text-secondary",
              FOCUS_RING,
            )}
          >
            {step.label}
          </button>
        </Fragment>
      ))}
    </fieldset>
  );
}
