import { Button, cn, FOCUS_RING, Skeleton, StatusDot } from "@brownsync/ui";
import { useEffect, useId, useRef, useState } from "react";
import { track } from "./analytics";
import {
  aggregateStatus,
  effectiveStatus,
  latestOkAt,
  type SourceHealth,
  sourceLabel,
  statusWord,
} from "./health-model";
import { formatAgo } from "./time";
import { HEALTH_REFRESH_MS, useHealth } from "./useHealth";

export type HealthStripProps = {
  className?: string;
  /**
   * One aggregate dot ("5 sources · 4 min ago") instead of the full
   * per-source readout — for narrow headers. Popover detail is identical.
   */
  compact?: boolean;
  /** Refresh cadence override (tests). */
  refreshMs?: number;
};

/**
 * Per-source ingestion health from GET /api/health — "LiveWhale · 4 min ago"
 * in mono, dot colors from the ui status ramp (--status-ok/-stale/-error).
 * Per §6.1 the accent stays out of this entirely: status is semantic, not a
 * primary action. Click (or Enter) opens a compact per-source detail popover.
 *
 * Integration: mount in the header at the SLOT:health seam — no provider
 * needed, it polls on its own.
 */
export function HealthStrip({ className, compact = false, refreshMs }: HealthStripProps) {
  const cadence = refreshMs ?? HEALTH_REFRESH_MS;
  const { phase, sources, checkedAt, refetch } = useHealth(cadence);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const nowMs = Date.now();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const hasData = sources.length > 0;

  return (
    <div ref={rootRef} data-testid="health-strip" className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label="Source health"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() =>
          setOpen((wasOpen) => {
            if (!wasOpen) track("health_opened");
            return !wasOpen;
          })
        }
        className={cn(
          "inline-flex h-7 shrink-0 select-none items-center gap-3 rounded-4 border border-line bg-bg-raised px-2.5",
          "transition-colors duration-150 ease-out hover:bg-bg-overlay",
          FOCUS_RING,
        )}
      >
        {phase === "loading" && !hasData ? (
          <Skeleton className="h-2.5 w-36" />
        ) : !hasData ? (
          <StatusDot
            status={phase === "error" ? "error" : "stale"}
            label="sources"
            detail={phase === "error" ? "unreachable" : "no runs yet"}
          />
        ) : compact ? (
          <StatusDot
            status={aggregateStatus(sources, nowMs)}
            label={`${sources.length} sources`}
            detail={formatAgo(latestOkAt(sources), nowMs)}
          />
        ) : (
          sources.map((source) => (
            <StatusDot
              key={source.source}
              status={effectiveStatus(source, nowMs)}
              label={sourceLabel(source.source)}
              detail={formatAgo(source.lastOkAt, nowMs)}
            />
          ))
        )}
      </button>

      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Source health detail"
          data-testid="health-popover"
          className="absolute top-full right-0 z-50 mt-1.5 w-80 rounded-6 border border-line bg-bg-raised"
        >
          {hasData ? (
            <ul className="flex flex-col divide-y divide-line/60 py-0.5">
              {sources.map((source) => (
                <HealthRow key={source.source} source={source} nowMs={nowMs} />
              ))}
            </ul>
          ) : (
            <p className="px-3 py-4 text-13 text-text-secondary">
              {phase === "error"
                ? "The read API didn't answer the health check — it usually recovers within a minute."
                : "No source runs recorded yet — each poller writes one run row per fetch."}
            </p>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
            <span className="font-mono text-12 text-text-secondary">
              checked {checkedAt ? formatAgo(new Date(checkedAt).toISOString(), nowMs) : "—"} · auto{" "}
              {Math.round(cadence / 1000)}s
            </span>
            <Button variant="subtle" density="dense" onClick={refetch}>
              Refresh
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HealthRow({ source, nowMs }: { source: SourceHealth; nowMs: number }) {
  return (
    <li data-testid={`health-row-${source.source}`} className="flex flex-col gap-0.5 px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <StatusDot status={effectiveStatus(source, nowMs)} label={sourceLabel(source.source)} />
        <span className="font-mono text-12 text-text-secondary">{statusWord(source, nowMs)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-3 pl-3">
        <span className="font-mono text-12 text-text-secondary">
          {source.itemsUpserted != null ? `${source.itemsUpserted} items · ` : ""}
          ok {formatAgo(source.lastOkAt, nowMs)}
        </span>
        <span className="font-mono text-12 text-text-secondary">
          run {formatAgo(source.lastRunAt, nowMs)}
        </span>
      </div>
      {source.error && (
        <p className="truncate pl-3 font-mono text-12 text-status-error" title={source.error}>
          {source.error}
        </p>
      )}
    </li>
  );
}
