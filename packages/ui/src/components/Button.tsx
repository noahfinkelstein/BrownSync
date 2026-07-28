import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn, FOCUS_RING } from "../cn";

const buttonVariants = cva(
  cn(
    "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-4 font-medium transition-colors duration-150 ease-out disabled:opacity-40",
    FOCUS_RING,
  ),
  {
    variants: {
      variant: {
        /** Accent background — primary actions ONLY (§6.1). */
        primary: "bg-accent text-bg-base hover:bg-accent/85 active:bg-accent/75",
        ghost:
          "border border-line bg-transparent text-text-primary hover:bg-bg-overlay active:bg-bg-overlay/70",
        subtle: "bg-bg-overlay text-text-secondary hover:text-text-primary active:bg-bg-overlay/70",
      },
      density: {
        dense: "h-7 px-2.5 text-13",
        comfortable: "h-8 px-3 text-13",
      },
    },
    defaultVariants: { variant: "ghost", density: "dense" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, density, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, density }), className)}
      {...props}
    />
  );
}
