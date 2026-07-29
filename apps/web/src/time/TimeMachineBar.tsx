import { cn } from "@brownsync/ui";
import { type TimeCursorStore, timeCursor } from "./cursor";
import { TimePresets } from "./TimePresets";
import { TimeScrubber } from "./TimeScrubber";

export type TimeMachineBarProps = {
  /** Injectable for tests; defaults to the app-wide cursor. */
  store?: TimeCursorStore;
  className?: string;
};

/**
 * Single-mount composition for the header's {SLOT:scrubber}: NOW ● button +
 * scrubber + mono readout + preset jumps, one row. Integrators who need a
 * different arrangement mount TimeScrubber / TimePresets individually.
 */
export function TimeMachineBar({ store = timeCursor, className }: TimeMachineBarProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <TimeScrubber store={store} className="min-w-0 grow" />
      <TimePresets store={store} className="shrink-0" />
    </div>
  );
}
