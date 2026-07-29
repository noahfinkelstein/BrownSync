import type { ReactNode } from "react";
import { cn } from "../cn";

/** Keyboard hint: mono, hairline box, no shadow. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] items-center rounded-2 border border-line bg-bg-raised px-1 font-mono text-12 leading-none text-text-secondary",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
