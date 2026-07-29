import { CATEGORY_BY_ID } from "@brownsync/contract";
import { CategoryIcon, cn, FOCUS_RING } from "@brownsync/ui";
import type { ReactNode } from "react";
import type { LayerToggles } from "../map/eventsLayer";

export type LayerRailProps = {
  toggles: LayerToggles;
  onToggle: (layer: keyof LayerToggles) => void;
  counts: { events: number; classes: number; athletics: number };
};

type RowSpec = {
  key: keyof LayerToggles;
  label: string;
  icon: ReactNode;
  /** Dot color when the layer is on. */
  color: string;
};

const ROWS: RowSpec[] = [
  {
    key: "events",
    label: "Events",
    icon: <CategoryIcon category="social" size={14} />,
    color: "var(--text-primary)",
  },
  {
    key: "classes",
    label: "Classes",
    icon: <CategoryIcon category="class" size={14} />,
    color: `var(${CATEGORY_BY_ID.class.colorToken})`,
  },
  {
    key: "athletics",
    label: "Athletics",
    icon: <CategoryIcon category="athletics" size={14} />,
    color: `var(${CATEGORY_BY_ID.athletics.colorToken})`,
  },
];

/** Left rail: the three map layer toggles with live counts (mono). */
export function LayerRail({ toggles, onToggle, counts }: LayerRailProps) {
  return (
    <nav
      aria-label="Map layers"
      className="absolute top-3 left-3 z-20 w-44 rounded-6 border border-line bg-bg-raised"
    >
      <h2 className="border-b border-line px-2.5 py-1.5 font-mono text-12 uppercase tracking-[0.08em] text-text-secondary">
        Layers
      </h2>
      <ul className="py-1">
        {ROWS.map((row) => {
          const on = toggles[row.key];
          return (
            <li key={row.key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(row.key)}
                className={cn(
                  "flex h-8 w-full items-center gap-2 px-2.5 text-13 transition-colors duration-150 ease-out hover:bg-bg-overlay/60",
                  on ? "text-text-primary" : "text-text-secondary",
                  FOCUS_RING,
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full border",
                    on ? "border-transparent" : "border-text-faint bg-transparent",
                  )}
                  style={on ? { background: row.color } : undefined}
                />
                <span className={cn("shrink-0", on ? "opacity-100" : "opacity-50")}>
                  {row.icon}
                </span>
                <span className="grow text-left">{row.label}</span>
                <span className="font-mono text-12 text-text-secondary">{counts[row.key]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
