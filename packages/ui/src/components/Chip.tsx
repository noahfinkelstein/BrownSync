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
          ? { borderColor: `color-mix(in oklab, var(${meta.colorToken}) 45%, var(--line))` }
          : undefined
      }
      className={cn(
        "inline-flex h-6 shrink-0 select-none items-center gap-1.5 rounded-4 border px-2 text-12 transition-colors duration-150 ease-out",
        selected
          ? "bg-bg-overlay text-text-primary"
          : "border-line text-text-secondary hover:border-text-faint hover:text-text-primary",
        FOCUS_RING,
        className,
      )}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: `var(${meta.colorToken})`, opacity: selected ? 1 : 0.55 }}
      />
      {meta.label}
      {count != null && <span className="font-mono text-12 text-text-faint">{count}</span>}
    </button>
  );
}
