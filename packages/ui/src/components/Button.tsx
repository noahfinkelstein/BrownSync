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
        /**
         * Accent background — primary actions ONLY (§6.1).
         *
         * Hover/active mix toward `--text-primary` rather than fading opacity.
         * On the old near-black page `bg-accent/85` composited DOWN and read as
         * a press; on paper the same class composites UP toward white, so the
         * button got *lighter* when you pressed it and white-on-red fell from
         * 6.4:1 to 4.6:1 at `/75` — an inverted affordance sitting one rounding
         * error above AA. Mixing toward ink can only raise that ratio.
         */
        primary: cn(
          "bg-accent text-bg-base",
          "hover:bg-[color-mix(in_oklab,var(--accent)_88%,var(--text-primary))]",
          "active:bg-[color-mix(in_oklab,var(--accent)_78%,var(--text-primary))]",
        ),
        /* Rest → hover → active walks DOWN the surface stack (transparent →
           overlay → line). Same reason: alpha steps lighten on paper. */
        ghost:
          "border border-line bg-transparent text-text-primary hover:bg-bg-overlay active:bg-line",
        /* `border-transparent` is load-bearing, not decoration: without it the
           subtle button's content box is 2px taller than ghost's and the two
           misalign when they sit side by side in a footer. */
        subtle: cn(
          "border border-transparent bg-bg-overlay text-text-secondary",
          "hover:bg-line hover:text-text-primary",
          "active:bg-[color-mix(in_oklab,var(--line)_86%,var(--text-primary))] active:text-text-primary",
        ),
      },
      density: {
        dense: "h-7 px-2.5 text-14",
        comfortable: "h-8 px-3 text-14",
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
