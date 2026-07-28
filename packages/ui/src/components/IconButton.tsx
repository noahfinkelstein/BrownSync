import type { ButtonHTMLAttributes } from "react";
import { cn, FOCUS_RING } from "../cn";
import type { Density } from "../types";

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Required — icon-only controls always get an accessible name. */
  "aria-label": string;
  density?: Density;
};

export function IconButton({
  className,
  density = "dense",
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-4 text-text-secondary transition-colors duration-150 ease-out hover:bg-bg-overlay hover:text-text-primary disabled:opacity-40",
        density === "comfortable" ? "h-8 w-8" : "h-7 w-7",
        FOCUS_RING,
        className,
      )}
      {...props}
    />
  );
}
