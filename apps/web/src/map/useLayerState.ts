import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import {
  DEFAULT_LAYER_STATE,
  LAYER_BY_ID,
  LAYERS_PARAM,
  type LayerId,
  type LayerState,
  parseLayers,
  serializeLayers,
} from "./layerRegistry";

/**
 * Layer visibility, owned by the URL (`?layers=-classes,aed`).
 *
 * Mirrors `browse/filter.ts` deliberately, including the functional `search`
 * update — a plain object would drop the sibling params (`?at=` from the time
 * machine, `?cats=` from the chips) that the same link has to carry.
 */
export type LayerToggleApi = {
  readonly state: LayerState;
  readonly toggle: (id: LayerId) => void;
  readonly reset: () => void;
  /** True when anything deviates from the defaults — drives "Reset". */
  readonly isModified: boolean;
};

export function useLayerState(): LayerToggleApi {
  const search = useLocation({ select: (loc) => loc.search }) as Record<string, unknown>;
  const navigate = useNavigate();
  const raw = search[LAYERS_PARAM];
  const state = useMemo(() => parseLayers(raw), [raw]);

  const set = useCallback(
    (next: LayerState) => {
      void navigate({
        to: ".",
        replace: true,
        resetScroll: false,
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          [LAYERS_PARAM]: serializeLayers(next),
        }),
      } as never);
    },
    [navigate],
  );

  const toggle = useCallback(
    (id: LayerId) => {
      // Pending layers have no data behind them; the panel renders them
      // disabled, and this is the second gate so a keyboard or programmatic
      // toggle cannot get past it either.
      if (LAYER_BY_ID[id]?.pending) return;
      set({ ...state, [id]: !state[id] });
    },
    [state, set],
  );

  const reset = useCallback(() => set(DEFAULT_LAYER_STATE), [set]);

  const isModified = useMemo(() => serializeLayers(state) !== undefined, [state]);

  return { state, toggle, reset, isModified };
}
