import { Button, cn, StatusDot } from "@brownsync/ui";

export type ErrorStateProps = {
  /** What failed to load — "events", "the event", "course meetings"… */
  what?: string;
  /** Wire-level detail ("GET /api/events 503") — rendered mono, truncated. */
  detail?: string | null;
  onRetry?: () => void;
  /** True when stale data is still on screen behind this state. */
  keptLastGood?: boolean;
  /** Adds the 1px-line box treatment for use floating over the map. */
  bordered?: boolean;
  className?: string;
};

/**
 * §6.4 designed error region — status dot from the semantic ramp (never the
 * accent), real copy, and a way forward. `role="alert"` so screen readers
 * hear about it without a focus move.
 */
export function ErrorState({
  what = "this view",
  detail,
  onRetry,
  keptLastGood = false,
  bordered = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-1 px-6 py-8 text-center",
        bordered && "rounded-6 border border-line bg-bg-raised",
        className,
      )}
    >
      <StatusDot status="error" className="mb-1" />
      <div className="text-15 font-medium tracking-tight text-text-primary">
        Couldn’t load {what}
      </div>
      <div className="max-w-[40ch] text-13 text-text-secondary">
        {keptLastGood
          ? "The read API didn’t respond — showing the last good data until it’s back."
          : "The read API didn’t respond. It usually recovers on its own within a minute."}
      </div>
      {detail && (
        <div
          className="mt-1 max-w-full truncate font-mono text-12 text-text-secondary"
          title={detail}
        >
          {detail}
        </div>
      )}
      {onRetry && (
        <div className="mt-3">
          <Button onClick={onRetry}>Retry</Button>
        </div>
      )}
    </div>
  );
}
