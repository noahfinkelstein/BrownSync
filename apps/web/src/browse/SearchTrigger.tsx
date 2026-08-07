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
      {/* Below md the trigger collapses to the glyph alone (UI audit: the
          56-w field ran the 375 px header off-edge). aria-label keeps the
          accessible name stable across both forms. */}
      <button
        type="button"
        aria-label="Search"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center gap-1.5 rounded-4 border border-line bg-bg-overlay px-0 text-14 text-text-secondary transition-colors duration-150 ease-out hover:border-text-faint hover:text-text-primary md:w-56 md:justify-start md:px-2",
          FOCUS_RING,
          className,
        )}
      >
        <SearchGlyph className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden grow text-left md:inline">Search</span>
        <span className="hidden md:inline">
          <Kbd>⌘K</Kbd>
        </span>
      </button>
      <SearchPalette open={open} onOpenChange={setOpen} onSelectEvent={onSelectEvent} />
    </>
  );
}
