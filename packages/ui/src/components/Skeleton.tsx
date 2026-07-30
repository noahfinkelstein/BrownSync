import type { CSSProperties } from "react";
import { cn } from "../cn";

/**
 * Loading placeholder: shimmerless opacity pulse (§6.4). Size with h- and w-
 * classes.
 *
 * `bg-line`, not `bg-bg-overlay`. The pulse runs 0.45 → 0.85 opacity, so the
 * fill is never fully itself — and `--bg-overlay` at 0.45 over white is
 * #F7F5F3, a 1.03:1 rectangle. The skeleton was invisible for most of its own
 * animation, and completely invisible inside a `bg-raised` panel. `--line` is
 * the darkest non-text surface token and survives the fade at both ends.
 */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div aria-hidden className={cn("bs-skeleton rounded-2 bg-line", className)} style={style} />
  );
}

/** Convenience: n timeline-shaped placeholder rows with staggered pulses. */
export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-2.5", className)}>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows, never reordered
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-3 w-12" style={{ animationDelay: `${i * 120}ms` }} />
          <Skeleton className="h-3 grow" style={{ animationDelay: `${i * 120}ms` }} />
        </div>
      ))}
    </div>
  );
}
