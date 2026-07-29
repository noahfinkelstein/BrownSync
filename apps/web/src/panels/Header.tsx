import { cn } from "@brownsync/ui";
import { useCursorDate } from "../data/cursor";
import { fmtTime } from "../data/format";

/**
 * Shell header (§3.1): wordmark + reserved slots for the other Phase 2
 * lanes. The SLOT comments are the mount points — the flex containers around
 * them are sized so the bar reads correctly before AND after the slots fill
 * (§6 litmus): search docks left of center, the scrubber owns the center,
 * chips + health dock right.
 */
export function AppHeader() {
  const { cursor, isLive } = useCursorDate();

  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-4 border-b border-line bg-bg-base px-4">
      <div className="flex shrink-0 items-baseline gap-2.5">
        <span className="text-15 font-semibold tracking-[-0.02em] text-text-primary">
          BrownSync
        </span>
        <span className="hidden font-mono text-12 text-text-faint md:inline">
          COLLEGE HILL · 41.827°N 71.403°W
        </span>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-start">
        {/* SLOT:search — lane H mounts the ⌘K search input here (fixed ~w-64). */}
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center">
        {/* SLOT:scrubber — lane G mounts the time scrubber here (grows, max-w-xl). */}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {/* SLOT:chips — lane H mounts category filter chips here. */}
        <span className="flex items-center gap-1.5" aria-live="off">
          <span
            aria-hidden
            className={cn("h-1.5 w-1.5 rounded-full", isLive ? "bg-accent" : "bg-text-faint")}
          />
          <span className="font-mono text-12 text-text-secondary">
            {isLive ? "LIVE" : "CURSOR"} · {fmtTime(cursor)} ET
          </span>
        </span>
        {/* SLOT:health — lane I mounts the source-health strip here. */}
      </div>
    </header>
  );
}
