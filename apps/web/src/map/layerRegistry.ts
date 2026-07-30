import { CATEGORY_BY_ID } from "@brownsync/contract";

/**
 * The map's layer catalogue, as data.
 *
 * The old LayerRail hardcoded three rows and three booleans. Layers are now
 * grouped data, groups collapse, and the whole selection round-trips through
 * the URL.
 *
 * SCOPE, deliberately narrowed 2026-07-29. An earlier pass surfaced the full
 * Facilities amenity estate here — blue-light phones, AEDs, Narcan, restrooms,
 * hydration, lactation, printers, bike racks. That is wayfinding, and this map
 * is about what is HAPPENING on campus; sixteen toggles buried the three that
 * matter. The `campus_amenities.geojson` artifact is still built, gated and
 * published — dining still reads from it, and place pages still list a
 * building's amenities — but the map panel no longer offers them as layers.
 *
 * WHY THE URL ENCODING IS A DIFF. `?layers=` records only what deviates from
 * the defaults below — `-classes` for a default-on layer switched off,
 * `aed` for a default-off layer switched on. Encoding the full enabled set
 * instead would freeze the catalogue: every shared link would silently
 * disable every layer added after it was copied.
 */

export type LayerId = "events" | "classes" | "athletics" | "buildings" | "greens" | "dining";

export type LayerGroupId = "activity" | "campus";

export type LayerSpec = {
  readonly id: LayerId;
  readonly group: LayerGroupId;
  readonly label: string;
  readonly on: boolean;
  /** Dot colour when enabled. A CSS value, so tokens stay the source of truth. */
  readonly color: string;
  /** Category icon to render, when the layer maps onto the taxonomy. */
  readonly icon?: string;
  /** Set when the data for this layer is not wired up yet. */
  readonly pending?: true;
  /**
   * Amenity kind in `campus_amenities.geojson`. Present exactly when this
   * layer is driven by that artifact, which is what `amenityKindsFor` uses to
   * turn layer state into a MapLibre filter.
   */
  readonly amenityKind?: string;
};

export type LayerGroup = {
  readonly id: LayerGroupId;
  readonly label: string;
  /** Collapsed on first paint. Activity is the default screen, so it is open. */
  readonly collapsed?: true;
};

export const LAYER_GROUPS: readonly LayerGroup[] = [
  { id: "activity", label: "Activity" },
  { id: "campus", label: "Campus" },
];

export const LAYERS: readonly LayerSpec[] = [
  {
    id: "events",
    group: "activity",
    label: "Events",
    on: true,
    color: "var(--text-primary)",
    icon: "social",
  },
  {
    id: "classes",
    group: "activity",
    label: "Classes",
    on: true,
    color: `var(${CATEGORY_BY_ID.class.colorToken})`,
    icon: "class",
  },
  {
    id: "athletics",
    group: "activity",
    label: "Athletics",
    on: true,
    color: `var(${CATEGORY_BY_ID.athletics.colorToken})`,
    icon: "athletics",
  },
  {
    id: "buildings",
    group: "campus",
    label: "Buildings",
    on: true,
    color: "var(--text-secondary)",
  },
  { id: "greens", group: "campus", label: "Greens & fields", on: true, color: "var(--map-green)" },
  {
    id: "dining",
    group: "campus",
    label: "Dining",
    on: false,
    color: `var(${CATEGORY_BY_ID.food.colorToken})`,
    icon: "food",
    amenityKind: "dining",
  },
];

export const LAYER_BY_ID: Readonly<Record<LayerId, LayerSpec>> = Object.fromEntries(
  LAYERS.map((layer) => [layer.id, layer]),
) as Record<LayerId, LayerSpec>;

/** Layers a user can actually turn on today. */
export const LIVE_LAYERS: readonly LayerSpec[] = LAYERS.filter((l) => !l.pending);

export type LayerState = Readonly<Record<LayerId, boolean>>;

export const DEFAULT_LAYER_STATE: LayerState = Object.fromEntries(
  LAYERS.map((layer) => [layer.id, layer.on]),
) as LayerState;

export const LAYERS_PARAM = "layers";

/**
 * `?layers=-classes,aed` → defaults with `classes` off and `aed` on.
 *
 * Unknown ids are dropped rather than rejected: a link from a newer build
 * naming a layer this one has not shipped yet must still open, showing the
 * layers it does understand.
 */
export function parseLayers(value: unknown): LayerState {
  if (typeof value !== "string" || value === "") return DEFAULT_LAYER_STATE;
  const next: Record<string, boolean> = { ...DEFAULT_LAYER_STATE };
  for (const token of value.split(",")) {
    const off = token.startsWith("-");
    const id = off ? token.slice(1) : token;
    if (!(id in DEFAULT_LAYER_STATE)) continue;
    // A pending layer has no data; honouring `?layers=…` would show an
    // enabled toggle over an empty map.
    if (LAYER_BY_ID[id as LayerId]?.pending) continue;
    next[id] = !off;
  }
  return next as LayerState;
}

/** Diff against the defaults; undefined when nothing deviates (clean URL). */
export function serializeLayers(state: LayerState): string | undefined {
  const diff = LAYERS.filter((layer) => state[layer.id] !== layer.on).map((layer) =>
    layer.on ? `-${layer.id}` : layer.id,
  );
  return diff.length > 0 ? diff.join(",") : undefined;
}

/** Amenity kinds to draw, given the current layer state. */
export function amenityKindsFor(state: LayerState): string[] {
  return LAYERS.filter((layer) => layer.amenityKind && state[layer.id]).map(
    (layer) => layer.amenityKind as string,
  );
}
