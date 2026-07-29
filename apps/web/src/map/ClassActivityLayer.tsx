import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import {
  activityLevel,
  BUILDING_2D_BASE,
  BUILDING_3D_BASE,
  classActivityColorExpression,
  type PlaceActivity,
} from "./classesLayer";

export type ClassActivityLayerProps = {
  activities: readonly PlaceActivity[];
  enabled: boolean;
};

const BUILDINGS = { source: "protomaps", sourceLayer: "buildings" } as const;

/**
 * Applies classes-in-session activity to basemap buildings via feature-state:
 * each active place's point is hit-tested against the rendered building
 * footprints, and the matched features get `classActivity` ∈ [0,1], which the
 * (re-pointed) building paint reads as a fill-saturation ramp. Places whose
 * point misses a rendered building (or whose tile features carry no id)
 * degrade to no tint — documented MVP behavior, revisit when the API serves
 * gazetteer polygons.
 */
export function ClassActivityLayer({ activities, enabled }: ClassActivityLayerProps) {
  const { current: mapRef } = useMap();
  const appliedLevels = useRef<Map<string | number, number>>(new Map());

  // Re-point building fills at the feature-state ramp. Retried on every
  // `styledata` until both layers exist — `load` may predate this effect and
  // the layers may not be queryable yet the first time through.
  useEffect(() => {
    if (!mapRef) return;
    const map = mapRef.getMap();
    let painted3d = false;
    let painted2d = false;
    const applyPaint = (): void => {
      if (!painted3d && map.getLayer("buildings-3d")) {
        map.setPaintProperty(
          "buildings-3d",
          "fill-extrusion-color",
          classActivityColorExpression(BUILDING_3D_BASE),
        );
        painted3d = true;
      }
      if (!painted2d && map.getLayer("buildings-2d")) {
        map.setPaintProperty(
          "buildings-2d",
          "fill-color",
          classActivityColorExpression(BUILDING_2D_BASE),
        );
        painted2d = true;
      }
      if (painted3d && painted2d) map.off("styledata", applyPaint);
    };
    applyPaint();
    map.on("styledata", applyPaint);
    return () => {
      map.off("styledata", applyPaint);
      if (painted3d && map.getLayer("buildings-3d")) {
        map.setPaintProperty("buildings-3d", "fill-extrusion-color", BUILDING_3D_BASE);
      }
      if (painted2d && map.getLayer("buildings-2d")) {
        map.setPaintProperty("buildings-2d", "fill-color", BUILDING_2D_BASE);
      }
    };
  }, [mapRef]);

  useEffect(() => {
    if (!mapRef) return;
    const map = mapRef.getMap();

    const clearAll = (): void => {
      for (const id of appliedLevels.current.keys()) {
        map.removeFeatureState({ ...BUILDINGS, id });
      }
      appliedLevels.current.clear();
    };

    /**
     * Recompute target feature states and write only the diff — `apply` runs
     * on every `idle`, and unconditional writes would re-dirty the map and
     * idle-loop forever.
     */
    const apply = (): void => {
      const next = new Map<string | number, number>();
      if (enabled) {
        for (const activity of activities) {
          const point = map.project([activity.lng, activity.lat]);
          const box: [[number, number], [number, number]] = [
            [point.x - 6, point.y - 6],
            [point.x + 6, point.y + 6],
          ];
          const layers = ["buildings-3d", "buildings-2d"].filter((l) => map.getLayer(l));
          if (layers.length === 0) continue;
          const feature = map.queryRenderedFeatures(box, { layers })[0];
          if (!feature || feature.id === undefined) continue;
          next.set(feature.id, activityLevel(activity.count));
        }
      }
      const prev = appliedLevels.current;
      let changed = next.size !== prev.size;
      if (!changed) {
        for (const [id, level] of next) {
          if (prev.get(id) !== level) {
            changed = true;
            break;
          }
        }
      }
      if (!changed) return;
      for (const id of prev.keys()) {
        if (!next.has(id)) map.removeFeatureState({ ...BUILDINGS, id });
      }
      for (const [id, level] of next) {
        if (prev.get(id) !== level) {
          map.setFeatureState({ ...BUILDINGS, id }, { classActivity: level });
        }
      }
      appliedLevels.current = next;
    };

    // Coverage: if the map already settled, the immediate call sees rendered
    // buildings; if it is still loading, every tile arrival ("sourcedata")
    // and settle ("idle") re-runs the (diff-guarded, cheap) apply.
    apply();
    map.on("idle", apply);
    map.on("sourcedata", apply);
    return () => {
      map.off("idle", apply);
      map.off("sourcedata", apply);
      clearAll();
    };
  }, [mapRef, activities, enabled]);

  return null;
}
