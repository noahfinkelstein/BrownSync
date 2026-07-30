import { useEffect, useMemo, useRef, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import {
  CAMPUS_BEFORE_ID,
  CAMPUS_DATA_URL,
  CAMPUS_PROMOTE_ID,
  CAMPUS_SOURCE_ID,
  campusExtrusionLayer,
  campusFlatLayer,
  campusLabelLayer,
  campusOutlineLayer,
} from "./campusBuildings";
import { activityLevel, type PlaceActivity } from "./classesLayer";

export type CampusBuildingLayersProps = {
  /** Layer-panel toggle for Brown's owned building geometry and labels. */
  enabled?: boolean;
  /** In-session meeting activity per resolved place, from the time cursor. */
  activities?: readonly PlaceActivity[];
  /** Layer-rail toggle for the classes tint. */
  classesEnabled?: boolean;
};

/**
 * Brown's building footprints, labels, massing and class-activity tint.
 *
 * This replaces the centroid hit-testing the old `ClassActivityLayer` had to
 * do. That component projected every active place to screen pixels, ran
 * `queryRenderedFeatures` over a 12x12 box on every `idle`/`sourcedata` (rAF
 * coalesced to stop an idle loop), matched whichever *nameless* basemap
 * building happened to sit under the pin, and mutated the shared
 * `buildings-3d` paint — with a restore-on-unmount path. Places whose centroid
 * missed a rendered building (greens, quads) simply never tinted.
 *
 * Because we now own the polygons and they carry a stable `propertyCode`,
 * the whole thing collapses to `map.setFeatureState`. Feature state persists
 * on the source, so it works for off-screen and not-yet-rendered buildings and
 * cannot leak onto a non-Brown neighbour.
 */
export function CampusBuildingLayers({
  enabled = true,
  activities,
  classesEnabled = true,
}: CampusBuildingLayersProps) {
  const { current: mapRef } = useMap();
  // propertyCode -> the places inside it, built once when the data lands.
  const indexRef = useRef<Map<string, string[]> | null>(null);
  const appliedRef = useRef<Set<string>>(new Set());
  // Bumped when the index lands, so the feature-state effect re-runs with it.
  const [indexVersion, setIndexVersion] = useState(0);

  const layers = useMemo(
    () => ({
      flat: campusFlatLayer(enabled),
      extrusion: campusExtrusionLayer(enabled),
      outline: campusOutlineLayer(enabled),
      labels: campusLabelLayer(enabled),
    }),
    [enabled],
  );

  // Build the placeId index by FETCHING the GeoJSON, not by querying the map.
  //
  // `querySourceFeatures` only returns features from tiles currently loaded in
  // the viewport, and it returns the same feature once per tile it straddles.
  // Measured on first paint it returned **1 of 262** buildings; after panning
  // it returned 502 (duplicates). Either way the index was wrong, and because
  // setFeatureState no-ops silently on an unknown id, the classes-in-session
  // tint would simply never appear for most of campus with no error anywhere.
  //
  // The artifact is a static asset we already fetched for the source, so this
  // is a cache hit and gives a complete, viewport-independent index.
  useEffect(() => {
    let cancelled = false;
    fetch(CAMPUS_DATA_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((document: { features?: CampusFeature[] } | null) => {
        if (cancelled || !document?.features) return;
        const index = new Map<string, string[]>();
        for (const feature of document.features) {
          const code = feature.properties?.propertyCode;
          if (code) index.set(code, feature.properties?.placeIds ?? []);
        }
        indexRef.current = index;
        setIndexVersion((v) => v + 1);
        if (import.meta.env.DEV && index.size < 200) {
          console.warn(
            `[campus] indexed only ${index.size} buildings — expected ~262. ` +
              "Check that every feature carries a unique propertyCode.",
          );
        }
      })
      .catch(() => {
        // The map still renders from the source; only the tint is lost.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply / clear the class-activity feature state.
  //
  // `indexVersion` is a re-run TRIGGER, not a value. The building index lands
  // in a ref from an async fetch, so nothing in this body references it by
  // name — but without it the effect never re-runs once that fetch resolves,
  // and the first paint's class tint is silently dropped.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const map = mapRef?.getMap();
    const index = indexRef.current;
    if (!map || !index) return;

    // `setFeatureState` THROWS "Style is not done loading" if the style has
    // not finished — it is not a silent no-op like an unknown feature id. The
    // MapRef materializes well before `style.load`, so on a cold load this
    // effect can win the race and take the whole map down through the error
    // boundary. Bail and re-run on `idle`, which is the signal that actually
    // means "settled" (`styledata` fires mid-load and `isStyleLoaded` can
    // still be false behind pending glyphs).
    if (!map.isStyleLoaded()) {
      const retry = (): void => setIndexVersion((v) => v + 1);
      map.once("idle", retry);
      return () => {
        map.off("idle", retry);
      };
    }

    const next = new Set<string>();
    if (classesEnabled && activities?.length) {
      // A building tints if ANY place inside it has a class in session — the
      // Ratty, the Ivy Room and Sharpe Refectory share one footprint.
      const byPlace = new Map(activities.map((a) => [a.placeId, a]));
      for (const [code, placeIds] of index) {
        let count = 0;
        for (const placeId of placeIds) {
          count = Math.max(count, byPlace.get(placeId)?.count ?? 0);
        }
        const level = activityLevel(count);
        if (level > 0) {
          map.setFeatureState({ source: CAMPUS_SOURCE_ID, id: code }, { classActivity: level });
          next.add(code);
        }
      }
    }

    for (const code of appliedRef.current) {
      if (!next.has(code)) {
        map.setFeatureState({ source: CAMPUS_SOURCE_ID, id: code }, { classActivity: 0 });
      }
    }
    appliedRef.current = next;
  }, [mapRef, activities, classesEnabled, indexVersion]);

  return (
    <Source
      id={CAMPUS_SOURCE_ID}
      type="geojson"
      data={CAMPUS_DATA_URL}
      promoteId={CAMPUS_PROMOTE_ID}
    >
      <Layer {...layers.flat} beforeId={CAMPUS_BEFORE_ID} />
      <Layer {...layers.extrusion} beforeId={CAMPUS_BEFORE_ID} />
      <Layer {...layers.outline} beforeId={CAMPUS_BEFORE_ID} />
      <Layer {...layers.labels} beforeId={CAMPUS_BEFORE_ID} />
    </Source>
  );
}

type CampusFeature = {
  properties?: { propertyCode?: string; placeIds?: string[] };
};
