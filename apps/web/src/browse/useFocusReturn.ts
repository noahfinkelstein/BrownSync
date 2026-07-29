import { useEffect, useRef } from "react";

/**
 * Focus restore for STATE-DRIVEN dialogs (§6.4 full keyboard support).
 *
 * The ⌘K palette and the event detail panel open from state, not from a
 * Radix `Dialog.Trigger` — and Radix's close-autofocus prevents the default
 * focus restore and targets its (nonexistent) trigger ref, so on close the
 * focus lands on <body> and a keyboard user is teleported to the top of the
 * page. This hook captures the invoker while `open` flips true and hands
 * focus back when it flips false.
 *
 * The capture happens during render (a ref write, idempotent under
 * StrictMode's double render): by effect time Radix has already moved focus
 * into the dialog, so an effect would capture the wrong element.
 */
export function useFocusReturn(open: boolean): void {
  const invokerRef = useRef<HTMLElement | null>(null);
  const prevOpenRef = useRef(false);

  if (open && !prevOpenRef.current) {
    const active = typeof document === "undefined" ? null : document.activeElement;
    invokerRef.current = active instanceof HTMLElement ? active : null;
  }
  prevOpenRef.current = open;

  useEffect(() => {
    if (open) return;
    const invoker = invokerRef.current;
    if (!invoker) return;
    invokerRef.current = null;
    let done = false;
    const tryRestore = (): void => {
      if (done || !invoker.isConnected) return;
      // Only reclaim focus that was actually lost to <body> — if the close
      // moved focus somewhere intentional (row-to-row panel switch, a click
      // elsewhere), leave it alone.
      const active = document.activeElement;
      if (active === null || active === document.body) {
        done = true;
        invoker.focus();
      }
    };
    // Radix tears the dialog down across a follow-up commit (Presence) and a
    // deferred autofocus pass (setTimeout in FocusScope) — at THIS effect's
    // time focus usually still sits inside the closing dialog and only falls
    // to <body> after the teardown. Retry on a short bounded schedule.
    const timers = [0, 50, 150, 300].map((ms) => setTimeout(tryRestore, ms));
    return () => {
      done = true;
      for (const t of timers) clearTimeout(t);
    };
  }, [open]);
}
