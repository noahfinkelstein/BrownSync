import { CategoryIcon, cn, FOCUS_RING } from "@brownsync/ui";
import { useCallback, useState } from "react";
import {
  LAYER_GROUPS,
  LAYERS,
  type LayerGroupId,
  type LayerId,
  type LayerSpec,
  type LayerState,
} from "../map/layerRegistry";

export type LayerPanelProps = {
  state: LayerState;
  onToggle: (id: LayerId) => void;
  onReset: () => void;
  isModified: boolean;
  /** Live feature counts, keyed by layer id. Absent = no count shown. */
  counts?: Partial<Record<LayerId, number>>;
};

const INITIAL_COLLAPSED = new Set<LayerGroupId>(
  LAYER_GROUPS.filter((g) => g.collapsed).map((g) => g.id),
);

/**
 * Grouped, collapsible map-layer control (replaces the fixed three-row rail).
 *
 * Groups collapse because the catalogue is heading for ~28 entries once the
 * Facilities amenity services land; a flat list that long is a scroll, not a
 * control. Safety and Amenities start collapsed — Activity is the default
 * screen and is what the app is for.
 */
export function LayerPanel({ state, onToggle, onReset, isModified, counts }: LayerPanelProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<LayerGroupId>>(INITIAL_COLLAPSED);

  const toggleGroup = useCallback((id: LayerGroupId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  return (
    <nav
      aria-label="Map layers"
      data-testid="layer-panel"
      className="absolute top-3 left-3 z-20 max-h-[calc(100%-1.5rem)] w-52 overflow-y-auto rounded-6 border border-line bg-bg-raised"
    >
      <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-line bg-bg-raised px-2.5 py-1.5">
        <h2 className="font-mono text-12 uppercase tracking-[0.08em] text-text-secondary">
          Layers
        </h2>
        {isModified && (
          <button
            type="button"
            onClick={onReset}
            className={cn(
              "rounded-2 px-1 font-mono text-12 text-text-secondary transition-colors duration-150 ease-out hover:text-text-primary",
              FOCUS_RING,
            )}
          >
            reset
          </button>
        )}
      </div>

      {LAYER_GROUPS.map((group) => {
        const rows = LAYERS.filter((layer) => layer.group === group.id);
        if (rows.length === 0) return null;
        const isCollapsed = collapsed.has(group.id);
        const onCount = rows.filter((r) => state[r.id]).length;
        return (
          <section key={group.id} className="border-b border-line last:border-b-0">
            <h3>
              <button
                type="button"
                aria-expanded={!isCollapsed}
                onClick={() => toggleGroup(group.id)}
                className={cn(
                  "flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left font-mono text-12 uppercase tracking-[0.08em] text-text-secondary transition-colors duration-150 ease-out hover:text-text-primary",
                  FOCUS_RING,
                )}
              >
                <Chevron open={!isCollapsed} />
                <span className="grow">{group.label}</span>
                {isCollapsed && onCount > 0 && <span className="tabular-nums">{onCount}</span>}
              </button>
            </h3>
            {!isCollapsed && (
              <ul className="pb-1">
                {rows.map((layer) => (
                  <li key={layer.id}>
                    <LayerRow
                      layer={layer}
                      on={state[layer.id]}
                      count={counts?.[layer.id]}
                      onToggle={onToggle}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </nav>
  );
}

function LayerRow({
  layer,
  on,
  count,
  onToggle,
}: {
  layer: LayerSpec;
  on: boolean;
  count: number | undefined;
  onToggle: (id: LayerId) => void;
}) {
  const pending = layer.pending === true;
  return (
    <button
      type="button"
      aria-pressed={pending ? undefined : on}
      disabled={pending}
      title={pending ? "Not wired up yet" : undefined}
      onClick={() => onToggle(layer.id)}
      className={cn(
        "flex h-8 w-full items-center gap-2 px-2.5 text-14 transition-colors duration-150 ease-out",
        pending
          ? "cursor-not-allowed text-text-secondary opacity-45"
          : `hover:bg-bg-overlay/60 ${on ? "text-text-primary" : "text-text-secondary"}`,
        FOCUS_RING,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full border",
          on && !pending ? "border-transparent" : "border-text-faint bg-transparent",
        )}
        style={on && !pending ? { background: layer.color } : undefined}
      />
      {layer.icon && (
        <span aria-hidden className={cn("shrink-0", on ? "opacity-100" : "opacity-50")}>
          {/* The registry stores the taxonomy id; CategoryIcon owns the glyph. */}
          <CategoryIcon category={layer.icon as never} size={14} />
        </span>
      )}
      <span className="grow truncate text-left">{layer.label}</span>
      {pending ? (
        <span className="shrink-0 font-mono text-12 text-text-secondary">soon</span>
      ) : (
        count !== undefined && (
          <span className="shrink-0 font-mono text-12 tabular-nums text-text-secondary">
            {count}
          </span>
        )
      )}
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      role="presentation"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      className={cn("shrink-0 transition-transform duration-150 ease-out", open && "rotate-90")}
    >
      <path d="M3.5 2 L6.5 5 L3.5 8" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}
