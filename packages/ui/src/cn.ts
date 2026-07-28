import { type ClassValue, clsx } from "clsx";

/** Class-name combiner. No tailwind-merge on purpose: the custom scale
 *  (text-13, rounded-4 …) would confuse its conflict resolution — callers
 *  compose, they don't override. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/** §6.4 — every interactive element gets the same visible focus treatment:
 *  1px accent outline at 1px offset, never the browser default. */
export const FOCUS_RING =
  "outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent";
