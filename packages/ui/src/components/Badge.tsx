import type { ReactNode } from "react";
import { cn } from "../cn";

export type BadgeProps = {
  variant?: "outline" | "accent";
  className?: string;
  children: ReactNode;
};

export function Badge({ variant = "outline", className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-2 border px-1.5 py-px text-12",
        variant === "accent" ? "border-accent/50 text-accent" : "border-line text-text-secondary",
        className,
      )}
    >
      {children}
    </span>
  );
}

export type ConfidenceDotProps = {
  /** 0–1 per contract §1; dot opacity scales with it. */
  confidence: number;
  className?: string;
};

export function ConfidenceDot({ confidence, className }: ConfidenceDotProps) {
  const c = Math.min(1, Math.max(0, confidence));
  const pct = Math.round(c * 100);
  return (
    <span
      role="img"
      aria-label={`confidence ${pct}%`}
      title={`confidence ${pct}%`}
      className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-text-primary", className)}
      style={{ opacity: 0.2 + 0.8 * c }}
    />
  );
}

export type SourceBadgeProps = {
  /** Source slug as stored (`livewhale`, `cab`, `athletics_ics` …). */
  source: string;
  confidence: number;
  className?: string;
};

/** Provenance: source name in mono + confidence dot (§6.4). */
export function SourceBadge({ source, confidence, className }: SourceBadgeProps) {
  return (
    <Badge className={cn("font-mono lowercase tracking-[0.04em]", className)}>
      {source}
      <ConfidenceDot confidence={confidence} />
    </Badge>
  );
}
