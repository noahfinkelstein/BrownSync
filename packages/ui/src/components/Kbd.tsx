import type { ReactNode } from "react";
import { cn } from "../cn";

/**
 * Keyboard hint: mono, hairline box, no shadow.
 *
 * `bg-bg-base` (white), not `bg-bg-raised`. A keycap has to sit ABOVE its
 * surroundings, and on paper "above" means lighter — the reverse of the dark
 * theme. `bg-raised` also made the key vanish inside a raised Panel, and its
 * most common home is SearchInput, whose field is `bg-overlay`; white against
 * both, with the hairline drawing the cap.
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] items-center rounded-2 border border-line bg-bg-base px-1 font-mono text-12 leading-none text-text-secondary",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
