import { CATEGORIES, type Category } from "@brownsync/contract";
import { Chip, cn, FOCUS_RING } from "@brownsync/ui";
import { useCategoryFilter } from "./filter";
import { useRovingFocus } from "./rovingFocus";

export type CategoryChipsProps = {
  /** Optional per-category counts rendered in mono after the label. */
  counts?: Partial<Record<Category, number>>;
  className?: string;
};

/**
 * The 10 taxonomy chips (contract §4) bound to the URL filter state
 * (`?cats=`) — drop into lane F's header slot; map layers read the same
 * state via `useCategoryFilter()` / `parseCats`.
 *
 * §6.4 keyboard support: the chip row is ONE tab stop; ←/→ + Home/End rove
 * between chips, Enter/Space toggles (native button).
 */
export function CategoryChips({ counts, className }: CategoryChipsProps) {
  const { selected, toggle, clear } = useCategoryFilter();
  const roving = useRovingFocus<HTMLFieldSetElement>("button", "horizontal");
  return (
    // fieldset = implicit `group` role; min-w-0 defuses its min-content quirk.
    <fieldset
      ref={roving.containerRef}
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
      aria-label="Filter by category"
      className={cn(
        "flex min-w-0 items-center gap-1.5 overflow-x-auto border-0 py-0 [scrollbar-width:none]",
        // §6.4 overflow affordance (the scrollbar is hidden): clipped chips
        // fade out at either edge — the fade IS the "more here" cue — and
        // chips snap to the row start. The row bleeds into the pane's px-3
        // inset (IndexPage slot) so at a scroll extreme the fade covers
        // padding, never the first/last chip.
        "-mx-3 snap-x snap-proximity scroll-px-3 px-3",
        "[mask-image:linear-gradient(to_right,transparent,#000_12px,#000_calc(100%_-_12px),transparent)]",
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
          className="snap-start"
        />
      ))}
      {selected.length > 0 && (
        <button
          type="button"
          onClick={clear}
          className={cn(
            "shrink-0 snap-start px-1 font-mono text-12 text-text-secondary transition-colors duration-150 ease-out hover:text-text-primary",
            FOCUS_RING,
          )}
        >
          clear
        </button>
      )}
    </fieldset>
  );
}
