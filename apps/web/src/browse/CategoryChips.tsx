import { CATEGORIES, type Category } from "@brownsync/contract";
import { Chip, cn, FOCUS_RING } from "@brownsync/ui";
import { useCategoryFilter } from "./filter";

export type CategoryChipsProps = {
  /** Optional per-category counts rendered in mono after the label. */
  counts?: Partial<Record<Category, number>>;
  className?: string;
};

/**
 * The 10 taxonomy chips (contract §4) bound to the URL filter state
 * (`?cats=`) — drop into lane F's header slot; map layers read the same
 * state via `useCategoryFilter()` / `parseCats`.
 */
export function CategoryChips({ counts, className }: CategoryChipsProps) {
  const { selected, toggle, clear } = useCategoryFilter();
  return (
    // fieldset = implicit `group` role; min-w-0 defuses its min-content quirk.
    <fieldset
      aria-label="Filter by category"
      className={cn(
        "flex min-w-0 items-center gap-1.5 overflow-x-auto border-0 p-0 [scrollbar-width:none]",
        className,
      )}
    >
      {CATEGORIES.map((meta) => (
        <Chip
          key={meta.id}
          category={meta.id}
          selected={selected.includes(meta.id)}
          count={counts?.[meta.id]}
          onToggle={toggle}
        />
      ))}
      {selected.length > 0 && (
        <button
          type="button"
          onClick={clear}
          className={cn(
            "shrink-0 px-1 font-mono text-12 text-text-faint transition-colors duration-150 ease-out hover:text-text-primary",
            FOCUS_RING,
          )}
        >
          clear
        </button>
      )}
    </fieldset>
  );
}
