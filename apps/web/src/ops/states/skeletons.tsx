import { cn, Skeleton, SkeletonRows } from "@brownsync/ui";

/**
 * §6.4 loading placeholders — shimmerless opacity pulses shaped like the
 * content they stand in for, never bare spinners. All are aria-hidden;
 * pair them with a live-region label upstream if the load is long.
 */

/** Detail-panel body (event / place / org) while its fetch is in flight. */
export function PanelSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden data-testid="panel-skeleton" className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <SkeletonRows rows={5} />
    </div>
  );
}

/** Viewport-synced list: time-group heading + timeline rows, per group. */
export function ListSkeleton({
  groups = 2,
  rowsPerGroup = 4,
  className,
}: {
  groups?: number;
  rowsPerGroup?: number;
  className?: string;
}) {
  return (
    <div aria-hidden data-testid="list-skeleton" className={cn("flex flex-col gap-4", className)}>
      {Array.from({ length: groups }, (_, group) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders, never reordered
        <div key={group} className="flex flex-col gap-2.5">
          <Skeleton className="h-3 w-24" style={{ animationDelay: `${group * 90}ms` }} />
          <SkeletonRows rows={rowsPerGroup} />
        </div>
      ))}
    </div>
  );
}
