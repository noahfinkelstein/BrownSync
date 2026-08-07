import { cn } from "../cn";

export type SourceStatus = "ok" | "stale" | "error" | "paused";

/**
 * INDICATOR colours, not text colours.
 *
 * Re-derived for white, the ramp clears WCAG 1.4.11's 3:1 non-text bar on all
 * three surfaces (3.8 – 4.6:1) but only `--status-error` on `--bg-base` reaches
 * AA text at all, and only by 0.003. Anything that has to be READ — the reason
 * a source failed, a "canceled" label — takes `--text-primary` next to one of
 * these dots. `packages/ui/src/contrast.test.ts` scans for `text-status-*` to
 * keep that true.
 */
const STATUS_COLOR: Record<SourceStatus, string> = {
  ok: "var(--status-ok)",
  stale: "var(--status-stale)",
  error: "var(--status-error)",
  // Deliberately-disabled registry rows (legal/ToS refusals, pre-launch
  // producers). Neutral hairline grey: a paused source is a recorded state,
  // not a health problem, so it must never read as amber or red.
  paused: "var(--line)",
};

export type StatusDotProps = {
  status: SourceStatus;
  /** Source name, mono — "livewhale". */
  label?: string;
  /** Staleness readout, mono muted — "4 min ago". */
  detail?: string;
  className?: string;
};

/** Health indicator for the /health strip: dot + mono source + staleness. */
export function StatusDot({ status, label, detail, className }: StatusDotProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: STATUS_COLOR[status] }}
      />
      {label && <span className="font-mono text-12 text-text-secondary">{label}</span>}
      {detail && <span className="font-mono text-12 text-text-secondary">{detail}</span>}
      <span className="sr-only">{status}</span>
    </span>
  );
}
