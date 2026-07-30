import { CATEGORY_BY_ID, type Category } from "@brownsync/contract";
import { cn, FOCUS_RING } from "../cn";

export type ChipProps = {
  category: Category;
  /** Toggled-on state (aria-pressed). */
  selected?: boolean;
  /** Optional count rendered in mono after the label. */
  count?: number;
  onToggle?: (category: Category) => void;
  className?: string;
};

/** Category filter chip: category dot + label. */
export function Chip({ category, selected = false, count, onToggle, className }: ChipProps) {
  const meta = CATEGORY_BY_ID[category];
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onToggle?.(category)}
      style={
        selected
          ? /* 65%, not 45%: on a near-black page `--line` was darker than every
               category colour, so a light mix still read as "tinted". On paper
               `--line` is the LIGHTER end, and a 45% mix washed the category
               out of its own chip. */
            { borderColor: `color-mix(in oklab, var(${meta.colorToken}) 65%, var(--line))` }
          : undefined
      }
      className={cn(
        "inline-flex h-6 shrink-0 select-none items-center gap-1.5 rounded-4 border px-2 text-12 transition-colors duration-150 ease-out",
        selected
          ? "bg-bg-overlay text-text-primary"
          : "border-line text-text-secondary hover:border-text-faint hover:bg-bg-overlay hover:text-text-primary",
        FOCUS_RING,
        className,
      )}
    >
      {/*
        Ring when off, filled disc when on — NOT a dimmed disc. Fading the dot
        was how the dark theme said "off"; on white, `opacity: 0.55` composites
        the category toward the page and the worst case (cat-food) lands at
        2.1:1, under the 3:1 non-text floor, so the dot stopped identifying its
        own category. A ring keeps the hue at full strength (every category is
        ≥3.8:1 on every surface) and reads as empty/filled instead.
      */}
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full border"
        style={{
          borderColor: `var(${meta.colorToken})`,
          background: selected ? `var(${meta.colorToken})` : "transparent",
        }}
      />
      {meta.label}
      {count != null && <span className="font-mono text-12 text-text-secondary">{count}</span>}
    </button>
  );
}
