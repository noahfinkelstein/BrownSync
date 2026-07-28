import { CATEGORY_BY_ID, type Category } from "@brownsync/contract";
import type { ReactNode } from "react";
import { cn, FOCUS_RING } from "../cn";
import type { Density } from "../types";

export type TimelineRowProps = {
  /** Mono time gutter, e.g. "19:04". */
  time: string;
  /** Mono second line in the gutter, e.g. "in 26 min". */
  sub?: string;
  title: ReactNode;
  meta?: ReactNode;
  category?: Category;
  /** Starting ≤30 min: accent dot + the one ambient pulse (§6.4). */
  live?: boolean;
  /** Right-aligned slot (badge, chevron). */
  end?: ReactNode;
  density?: Density;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
};

/** Time gutter + rail node + title/meta. Rows stack into the day timeline. */
export function TimelineRow({
  time,
  sub,
  title,
  meta,
  category,
  live = false,
  end,
  density = "dense",
  selected = false,
  onClick,
  className,
}: TimelineRowProps) {
  const dotColor = live
    ? "var(--accent)"
    : category
      ? `var(${CATEGORY_BY_ID[category].colorToken})`
      : "var(--text-faint)";

  const inner = (
    <>
      <div className="w-16 shrink-0 text-right">
        <div className={cn("font-mono text-12", live ? "text-accent" : "text-text-secondary")}>
          {time}
        </div>
        {sub && <div className="font-mono text-12 text-text-faint">{sub}</div>}
      </div>
      <div className="relative flex w-4 shrink-0 justify-center self-stretch">
        <span aria-hidden className="absolute inset-y-0 w-px bg-line" />
        <span
          aria-hidden
          className={cn("relative mt-[5px] h-1.5 w-1.5 rounded-full", live && "bs-live-dot")}
          style={{ background: dotColor }}
        />
      </div>
      <div className="min-w-0 grow">
        <div className="truncate text-13 text-text-primary">{title}</div>
        {meta && <div className="truncate pt-0.5 text-12 text-text-secondary">{meta}</div>}
      </div>
      {end && <div className="shrink-0 pl-2">{end}</div>}
    </>
  );

  const layout = cn(
    "flex w-full items-start gap-2 px-2 text-left",
    density === "comfortable" ? "py-2.5" : "py-1.5",
    selected && "bg-bg-overlay",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          layout,
          "transition-colors duration-150 ease-out hover:bg-bg-overlay/60",
          FOCUS_RING,
        )}
      >
        {inner}
      </button>
    );
  }
  return <div className={layout}>{inner}</div>;
}
