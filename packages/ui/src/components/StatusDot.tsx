import { cn } from "../cn";

export type SourceStatus = "ok" | "stale" | "error";

const STATUS_COLOR: Record<SourceStatus, string> = {
  ok: "var(--status-ok)",
  stale: "var(--status-stale)",
  error: "var(--status-error)",
};

export type StatusDotProps = {
  status: SourceStatus;
  /** Source name, mono — "livewhale". */
  label?: string;
  /** Staleness readout, mono faint — "4 min ago". */
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
      {detail && <span className="font-mono text-12 text-text-faint">{detail}</span>}
      <span className="sr-only">{status}</span>
    </span>
  );
}
