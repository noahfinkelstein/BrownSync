import { type FocusEvent, type KeyboardEvent, useCallback, useEffect, useRef } from "react";

/**
 * Roving tabindex (§6.4 full keyboard support): a group of focusable
 * children collapses to ONE tab stop; Arrow keys move focus within, Home/End
 * jump to the edges, and activation stays native (Enter/Space on <button>).
 *
 * DOM-driven on purpose — the children are design-system components
 * (@brownsync/ui TimelineRow, Chip) that don't take a tabIndex prop, so the
 * hook manages `tabindex` attributes directly on the rendered buttons. The
 * item list is re-read from the DOM on every keystroke, so rows that mount
 * or unmount with data never leave a stale index behind.
 */

export type RovingOrientation = "horizontal" | "vertical";

const NEXT_KEY: Record<RovingOrientation, string> = {
  horizontal: "ArrowRight",
  vertical: "ArrowDown",
};
const PREV_KEY: Record<RovingOrientation, string> = {
  horizontal: "ArrowLeft",
  vertical: "ArrowUp",
};

export type RovingFocus<E extends HTMLElement> = {
  /** Attach to the element that contains the group. */
  containerRef: (node: E | null) => void;
  /** Attach to the same element (React onKeyDown bubbles from children). */
  onKeyDown: (event: KeyboardEvent<E>) => void;
  /** Attach to the same element (React onFocus wraps focusin, so it bubbles). */
  onFocus: (event: FocusEvent<E>) => void;
};

export function useRovingFocus<E extends HTMLElement>(
  selector: string,
  orientation: RovingOrientation,
): RovingFocus<E> {
  const nodeRef = useRef<E | null>(null);
  const activeRef = useRef<HTMLElement | null>(null);

  const targets = useCallback((): HTMLElement[] => {
    const container = nodeRef.current;
    return container ? Array.from(container.querySelectorAll<HTMLElement>(selector)) : [];
  }, [selector]);

  const applyTabStops = useCallback(() => {
    const list = targets();
    if (list.length === 0) return;
    const remembered = activeRef.current;
    const active = remembered && list.includes(remembered) ? remembered : list[0];
    if (!active) return;
    activeRef.current = active;
    for (const el of list) {
      el.tabIndex = el === active ? 0 : -1;
    }
  }, [targets]);

  // Re-assert after every render (deliberately dep-less): data refetches
  // add/remove rows, and new buttons mount with the default tabindex of 0.
  useEffect(() => {
    applyTabStops();
  });

  const containerRef = useCallback(
    (node: E | null) => {
      nodeRef.current = node;
      if (node) applyTabStops();
    },
    [applyTabStops],
  );

  const onFocus = useCallback(
    (event: FocusEvent<E>) => {
      const list = targets();
      const target = event.target;
      if (target instanceof HTMLElement && list.includes(target)) {
        activeRef.current = target;
        for (const el of list) {
          el.tabIndex = el === target ? 0 : -1;
        }
      }
    },
    [targets],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<E>) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const list = targets();
      if (list.length === 0) return;
      const current =
        document.activeElement instanceof HTMLElement && list.includes(document.activeElement)
          ? document.activeElement
          : null;
      if (!current) return;
      const index = list.indexOf(current);
      let nextIndex: number;
      if (event.key === NEXT_KEY[orientation]) nextIndex = Math.min(index + 1, list.length - 1);
      else if (event.key === PREV_KEY[orientation]) nextIndex = Math.max(index - 1, 0);
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = list.length - 1;
      else return;
      event.preventDefault();
      const next = list[nextIndex];
      if (next && next !== current) {
        activeRef.current = next;
        for (const el of list) {
          el.tabIndex = el === next ? 0 : -1;
        }
        next.focus();
      }
    },
    [targets, orientation],
  );

  return { containerRef, onKeyDown, onFocus };
}
