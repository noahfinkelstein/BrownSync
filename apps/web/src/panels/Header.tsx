import { SearchTrigger } from "../browse/SearchTrigger";
import { HealthStrip } from "../ops/HealthStrip";
import { TimeMachineBar } from "../time/TimeMachineBar";

/**
 * Shell header (§3.1) with the Phase 2 lane slots filled at integration:
 * ⌘K search (H) docks left of center, the time machine (G) owns the center,
 * source health (I) docks right. The standalone cursor clock this header
 * carried pre-integration is gone — the scrubber's mono readout and NOW
 * button supersede it (lane F integration note). The SLOT:chips plan moved:
 * ten taxonomy chips plus the full time machine cannot share one 1280px row
 * without starving the scrubber, so the chips mount atop the list pane they
 * filter (IndexPage) — same URL state (?cats=), same map effect.
 */
export function AppHeader() {
  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-4 border-b border-line bg-bg-base px-4">
      <div className="flex shrink-0 items-baseline gap-2.5">
        <span className="text-15 font-semibold tracking-[-0.02em] text-text-primary">
          BrownSync
        </span>
        <span className="hidden font-mono text-12 text-text-faint 2xl:inline">
          COLLEGE HILL · 41.827°N 71.403°W
        </span>
      </div>

      <div className="flex min-w-0 shrink-0 items-center justify-start">
        {/* SLOT:search — lane H's ⌘K trigger (opens the palette, owns the hotkey). */}
        <SearchTrigger />
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center">
        {/* SLOT:scrubber — lane G's time machine: NOW ● + scrubber + readout + presets. */}
        <TimeMachineBar className="w-full max-w-xl" />
      </div>

      <div className="flex shrink-0 items-center">
        {/* SLOT:health — lane I's source-health aggregate; popover has the per-source detail. */}
        <HealthStrip compact />
      </div>
    </header>
  );
}
