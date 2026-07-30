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
    const closingFocus = document.activeElement;
    const deadline = Date.now() + 2_000;
    let done = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    const finish = (): void => {
      done = true;
      if (interval !== null) clearInterval(interval);
    };
    const tryRestore = (): void => {
      if (done) return;
      // Only reclaim focus that was actually lost to <body> — if the close
      // moved focus somewhere intentional (row-to-row panel switch, a click
      // elsewhere), leave it alone.
      const active = document.activeElement;
      if ((active === null || active === document.body) && invoker.isConnected) {
        invoker.focus();
        finish();
        return;
      }
      if (active !== closingFocus && active !== null && active !== document.body) {
        finish();
        return;
      }
      if (Date.now() >= deadline) finish();
    };
    // Radix tears the dialog down across a follow-up commit (Presence) and a
    // deferred autofocus pass (setTimeout in FocusScope). Under a loaded
    // event loop, several one-shot timers can all fire before that pass, so
    // keep polling through the bounded close window instead.
    tryRestore();
    if (!done) interval = setInterval(tryRestore, 50);
    return () => {
      finish();
    };
  }, [open]);
}
