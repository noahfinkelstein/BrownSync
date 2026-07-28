import type { Category } from "@brownsync/contract";
import type { CSSProperties } from "react";
import { CATEGORY_ICON_PATHS, ICON_STROKE_WIDTH, ICON_VIEWBOX } from "./paths";

export type CategoryIconProps = {
  category: Category;
  /** Rendered square size in px. The glyph grid is 16; multiples read crispest. */
  size?: number;
  /** Accessible name. Omit for decorative use (icon next to its label). */
  title?: string;
  className?: string;
  style?: CSSProperties;
};

/** One of the 10 hand-drawn category glyphs, inherits `currentColor`. */
export function CategoryIcon({ category, size = 16, title, className, style }: CategoryIconProps) {
  const viewBox = `0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`;
  const path = (
    <path
      d={CATEGORY_ICON_PATHS[category]}
      stroke="currentColor"
      strokeWidth={ICON_STROKE_WIDTH}
      strokeLinecap="butt"
      strokeLinejoin="miter"
    />
  );
  if (title) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        className={className}
        style={style}
        role="img"
        aria-label={title}
      >
        <title>{title}</title>
        {path}
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}
