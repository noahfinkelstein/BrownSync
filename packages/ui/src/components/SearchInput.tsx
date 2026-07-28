import type { InputHTMLAttributes } from "react";
import { cn } from "../cn";
import { CloseGlyph, SearchGlyph } from "../icons/glyphs";
import type { Density } from "../types";
import { Kbd } from "./Kbd";

export type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type"> & {
  density?: Density;
  /** Shortcut hint rendered as a <Kbd>, e.g. "⌘K". Hidden while there is a value. */
  kbdHint?: string;
  /** When provided (and there is a value), shows a clear affordance. */
  onClear?: () => void;
};

export function SearchInput({
  density = "dense",
  kbdHint,
  onClear,
  className,
  value,
  ...props
}: SearchInputProps) {
  const hasValue = value != null && value !== "";
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-4 border border-line bg-bg-overlay px-2 transition-colors duration-150 ease-out focus-within:border-text-faint",
        density === "comfortable" ? "h-8" : "h-7",
        className,
      )}
    >
      <SearchGlyph className="h-3.5 w-3.5 shrink-0 text-text-faint" />
      <input
        type="search"
        value={value}
        className="w-full min-w-0 grow bg-transparent text-13 text-text-primary outline-none placeholder:text-text-faint [&::-webkit-search-cancel-button]:hidden"
        {...props}
      />
      {hasValue && onClear ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={onClear}
          className="shrink-0 text-text-faint transition-colors duration-150 ease-out hover:text-text-primary"
        >
          <CloseGlyph className="h-3 w-3" />
        </button>
      ) : kbdHint ? (
        <Kbd className="shrink-0">{kbdHint}</Kbd>
      ) : null}
    </div>
  );
}
