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
        {sub && <div className="font-mono text-12 text-text-secondary">{sub}</div>}
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
        <div className="truncate text-14 text-text-primary">{title}</div>
        {meta && <div className="truncate pt-0.5 text-12 text-text-secondary">{meta}</div>}
      </div>
      {end && <div className="shrink-0 pl-2">{end}</div>}
    </>
  );

  /*
    Selection is a brown edge, not just a fill.
    `bg-bg-overlay` was an 8% lift on a near-black page; on paper it is a 4%
    warm tint, and the timeline's usual home is a `bg-raised` panel where the
    step shrinks to 3% — under a room light that is indistinguishable from
    hover, so "which row am I reading" had no answer. The 2px seal-brown rule
    is a border rather than a shadow (§6.1 allows exactly one shadow, and the
    Panel owns it). `border-l-2 pl-1.5` sums to the same 8px as the old `px-2`,
    so a selected row does not shove its own text sideways.
  */
  const layout = cn(
    "flex w-full items-start gap-2 border-l-2 pr-2 pl-1.5 text-left",
    density === "comfortable" ? "py-2.5" : "py-1.5",
    selected ? "border-brand-brown bg-bg-overlay" : "border-transparent",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          layout,
          /* Solid overlay: `/60` composited toward white and left no hover. */
          "transition-colors duration-150 ease-out hover:bg-bg-overlay",
          FOCUS_RING,
        )}
      >
        {inner}
      </button>
    );
  }
  return <div className={layout}>{inner}</div>;
}
