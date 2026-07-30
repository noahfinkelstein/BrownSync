import type { EventOut } from "@brownsync/contract";
import { cn, FOCUS_RING, Kbd, SearchGlyph } from "@brownsync/ui";
import { useEffect, useState } from "react";
import { SearchPalette } from "./SearchPalette";

export type SearchTriggerProps = {
  /** Forwarded to the palette — integrator wires this to the detail panel. */
  onSelectEvent?: (event: EventOut) => void;
  className?: string;
};

/**
 * Header search affordance for lane F's header slot: a search-shaped button
 * that opens the ⌘K palette. Self-contained — mounts the palette and the
 * global ⌘K / ctrl-K listener, so integration is `<SearchTrigger />`.
 */
export function SearchTrigger({ onSelectEvent, className }: SearchTriggerProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-7 w-56 shrink-0 items-center gap-1.5 rounded-4 border border-line bg-bg-overlay px-2 text-14 text-text-secondary transition-colors duration-150 ease-out hover:border-text-faint hover:text-text-primary",
          FOCUS_RING,
          className,
        )}
      >
        <SearchGlyph className="h-3.5 w-3.5 shrink-0" />
        <span className="grow text-left">Search</span>
        <Kbd>⌘K</Kbd>
      </button>
      <SearchPalette open={open} onOpenChange={setOpen} onSelectEvent={onSelectEvent} />
    </>
  );
}
