import { cn, FOCUS_RING } from "@brownsync/ui";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Shared shell for the place/org profile pages: centered column, own scroll
 * (the App root is overflow-hidden for the map), mono back-link to the map.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-3">
        <Link
          to="/"
          className={cn(
            "inline-block font-mono text-12 text-text-secondary transition-colors duration-150 ease-out hover:text-text-primary",
            FOCUS_RING,
          )}
        >
          ← map
        </Link>
        {children}
      </div>
    </div>
  );
}

/** Mono section heading — table-style, §6.4 density. */
export function SectionHeading({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="mt-6 flex items-baseline justify-between border-b border-line pb-1 font-mono text-12 uppercase tracking-[0.08em] text-text-secondary">
      <span>{children}</span>
      {count != null && <span>{count}</span>}
    </h2>
  );
}
