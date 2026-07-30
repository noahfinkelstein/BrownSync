import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { cn, FOCUS_RING } from "../cn";
import type { Density } from "../types";

export type SegmentedOption<V extends string> = { value: V; label: ReactNode };

export type SegmentedControlProps<V extends string> = {
  options: readonly SegmentedOption<V>[];
  value: V;
  onValueChange: (value: V) => void;
  density?: Density;
  "aria-label": string;
  className?: string;
};

/** Mode switch (map / list / split): mono labels, radiogroup + arrow keys. */
export function SegmentedControl<V extends string>({
  options,
  value,
  onValueChange,
  density = "dense",
  "aria-label": ariaLabel,
  className,
}: SegmentedControlProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const idx = options.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (idx - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const opt = options[next];
    if (opt) {
      onValueChange(opt.value);
      refs.current[next]?.focus();
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex shrink-0 items-center gap-px rounded-4 border border-line bg-bg-base p-px",
        className,
      )}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: styled radiogroup of buttons is the standard ARIA segmented-control pattern (matches Radix); a native input can't render this control
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            ref={(el) => {
              refs.current[i] = el;
            }}
            onClick={() => onValueChange(opt.value)}
            onKeyDown={onKeyDown}
            className={cn(
              "rounded-2 px-2 font-mono text-12 uppercase tracking-[0.08em] transition-colors duration-150 ease-out",
              density === "comfortable" ? "h-7" : "h-6",
              /*
                Filled seal brown, not a tinted surface. `bg-bg-overlay` marked
                the active segment by being one step off the track; that step
                was 8% of the range on a near-black page and is 4% on paper —
                #F0ECE6 inside a #FFFFFF track is not a state, it is a smudge,
                and this control is how you know whether you are looking at the
                map or the list. Brown is structure (11.2:1 with a white label),
                which keeps the accent reserved for live/now + primary action.
              */
              selected
                ? "bg-brand-brown text-bg-base"
                : "text-text-secondary hover:bg-bg-overlay hover:text-text-primary",
              FOCUS_RING,
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
