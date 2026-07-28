import * as Slider from "@radix-ui/react-slider";
import { cn, FOCUS_RING } from "../cn";

export type ScrubberProps = {
  value: number;
  onValueChange: (value: number) => void;
  /** Fired when the drag ends. */
  onValueCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Tick positions in value space (e.g. one per hour). */
  ticks?: readonly number[];
  /** Accent NOW marker position in value space; null/undefined hides it. */
  now?: number | null;
  disabled?: boolean;
  "aria-label": string;
  /** Mono value readout for assistive tech, e.g. (v) => "Tue 19:00". */
  getValueText?: (value: number) => string;
  className?: string;
};

/**
 * Time scrubber — thin track, precise thumb, tick marks, accent NOW marker.
 * The NOW marker is the only accent element here (§6.1).
 */
export function Scrubber({
  value,
  onValueChange,
  onValueCommit,
  min = 0,
  max = 100,
  step = 1,
  ticks,
  now,
  disabled = false,
  "aria-label": ariaLabel,
  getValueText,
  className,
}: ScrubberProps) {
  const pct = (v: number) => ((v - min) / (max - min || 1)) * 100;

  return (
    <Slider.Root
      min={min}
      max={max}
      step={step}
      value={[value]}
      disabled={disabled}
      onValueChange={([v]) => {
        if (v !== undefined) onValueChange(v);
      }}
      onValueCommit={([v]) => {
        if (v !== undefined) onValueCommit?.(v);
      }}
      className={cn(
        "relative flex h-6 w-full touch-none select-none items-center data-[disabled]:opacity-40",
        className,
      )}
    >
      <Slider.Track className="relative h-[2px] grow bg-line">
        {ticks?.map((t) => (
          <span
            key={t}
            aria-hidden
            className="absolute top-[4px] h-[4px] w-px bg-line"
            style={{ left: `${pct(t)}%` }}
          />
        ))}
        <Slider.Range className="absolute h-full bg-text-faint" />
        {now != null && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pct(now)}%` }}
          >
            <span className="block h-3.5 w-[2px] bg-accent" />
            <span className="absolute -top-[6px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />
          </span>
        )}
      </Slider.Track>
      <Slider.Thumb
        aria-label={ariaLabel}
        aria-valuetext={getValueText?.(value)}
        className={cn(
          "relative z-20 block h-3.5 w-2 rounded-2 bg-text-primary transition-colors duration-150 ease-out",
          FOCUS_RING,
        )}
      />
    </Slider.Root>
  );
}
