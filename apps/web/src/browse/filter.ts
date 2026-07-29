import { CATEGORY_IDS, type Category } from "@brownsync/contract";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

/**
 * Category filter state, shared via the URL (`?cats=club,arts`) so the map
 * layers (lane F) can consume the same selection at integration — read it
 * with `useCategoryFilter()` or `parseCats(location.search.cats)`.
 * Empty selection (no param) means "all categories".
 */

export const CATS_PARAM = "cats";

/** Parse the raw `cats` search value; drops junk, dedupes, taxonomy order. */
export function parseCats(value: unknown): Category[] {
  if (typeof value !== "string" || value === "") return [];
  const wanted = new Set(value.split(","));
  return CATEGORY_IDS.filter((c) => wanted.has(c));
}

/** Comma-joined in taxonomy order; undefined removes the param entirely. */
export function serializeCats(cats: readonly Category[]): string | undefined {
  const ordered = CATEGORY_IDS.filter((c) => cats.includes(c));
  return ordered.length > 0 ? ordered.join(",") : undefined;
}

export type CategoryFilter = {
  /** Selected categories in taxonomy order; empty = no filter. */
  selected: Category[];
  toggle: (category: Category) => void;
  set: (next: readonly Category[]) => void;
  clear: () => void;
};

export function useCategoryFilter(): CategoryFilter {
  const search = useLocation({ select: (loc) => loc.search }) as Record<string, unknown>;
  const navigate = useNavigate();
  const raw = search[CATS_PARAM];
  const selected = useMemo(() => parseCats(raw), [raw]);

  const set = useCallback(
    (next: readonly Category[]) => {
      void navigate({
        to: ".",
        replace: true,
        resetScroll: false,
        // Functional update preserves sibling params (?at= from lane G, …).
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          [CATS_PARAM]: serializeCats(next),
        }),
      } as never);
    },
    [navigate],
  );

  const toggle = useCallback(
    (category: Category) => {
      set(
        selected.includes(category)
          ? selected.filter((c) => c !== category)
          : [...selected, category],
      );
    },
    [selected, set],
  );

  const clear = useCallback(() => set([]), [set]);

  return { selected, toggle, set, clear };
}
