import { Button, cn, Scrubber } from "@brownsync/ui";
import { type KeyboardEvent, useMemo } from "react";
import { type TimeCursorStore, timeCursor } from "./cursor";
import { formatCursor } from "./format";
import { createScrubberScale, stepLocalDay } from "./scrubberScale";
import { useTimeCursor } from "./useTimeCursor";

export type TimeScrubberProps = {
  /** Injectable for tests; defaults to the app-wide cursor. */
  store?: TimeCursorStore;
  className?: string;
};

const DAY_STEP_ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
const DAY_STEP_PAGES = new Set(["PageUp", "PageDown"]);
const FORWARD_KEYS = new Set(["ArrowRight", "ArrowUp", "PageUp"]);

/**
 * The time machine control (handoff §2G): NOW ● live button, ±7-day scrub
 * with day-boundary ticks, mono `19:04 · in 26 min` readout. Built on the
 * design-system Scrubber (re-themed Radix slider, §6) — arrows step 15 min
 * via the slider's step; Shift+arrows and PageUp/Down step one local day.
 *
 * Scrubbing only moves the cursor store — layers re-filter client-side,
 * nothing refetches (handoff §5).
 */
export function TimeScrubber({ store = timeCursor, className }: TimeScrubberProps) {
  const cursor = useTimeCursor(store);
  // The 14-day window anchors at mount; the NOW marker drifts inside it.
  const scale = useMemo(() => createScrubberScale(cursor.liveNow()), [cursor]);

  const at = cursor.now();
  const liveNow = cursor.liveNow();
  const value = scale.toValue(at);
  const nowValue = scale.toValue(liveNow);

  // Radix's own big-step handling (Shift+arrow = 10×step, PageUp/Down) is
  // intercepted here so a "big step" is one campus-local calendar day.
  function onKeyDownCapture(e: KeyboardEvent<HTMLDivElement>) {
    const isDayStep = (e.shiftKey && DAY_STEP_ARROWS.has(e.key)) || DAY_STEP_PAGES.has(e.key);
    if (!isDayStep) return;
    e.preventDefault();
    e.stopPropagation();
    cursor.setAt(stepLocalDay(scale, at, FORWARD_KEYS.has(e.key) ? 1 : -1));
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <Button
        variant={cursor.isLive ? "primary" : "ghost"}
        aria-pressed={cursor.isLive}
        onClick={() => cursor.setLive()}
        className="gap-1.5 tracking-tight"
      >
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 rounded-full", cursor.isLive ? "bg-bg-base" : "bg-accent")}
        />
        NOW
      </Button>
      <div className="min-w-0 grow" onKeyDownCapture={onKeyDownCapture}>
        <Scrubber
          value={value}
          onValueChange={(v) => {
            if (v !== value) cursor.setAt(scale.toDate(v));
          }}
          min={scale.min}
          max={scale.max}
          step={scale.step}
          ticks={scale.ticks}
          now={nowValue}
          aria-label="Time cursor"
          getValueText={(v) => formatCursor(scale.toDate(v), liveNow)}
        />
      </div>
      {/* aria-live off: <output> defaults to polite, which would announce
          every 30 s live tick. The slider's aria-valuetext covers AT. */}
      <output
        aria-live="off"
        className="min-w-[10.5rem] shrink-0 whitespace-nowrap text-right font-mono text-13 text-text-secondary tabular-nums"
      >
        {formatCursor(at, liveNow)}
      </output>
    </div>
  );
}
