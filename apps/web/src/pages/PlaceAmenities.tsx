import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { AMENITY_DATA_URL, AMENITY_LABELS, type AmenityKind } from "../map/campusAmenities";

/**
 * "What's inside this building" — the amenity points that resolved to this
 * place, on its own page.
 *
 * The join is by `placeId`, which exists because the Python `amenities` job
 * either read Brown's own `Property_Code` (blue-light, restrooms) or snapped
 * the point to the nearest building footprint within 60 m. So a place page can
 * answer "is there an all-gender restroom in here" without any spatial work in
 * the browser.
 *
 * Shares the artifact and the query key with the map layer, so opening a place
 * page after using the layer panel is a cache hit, not a second 226 KB fetch.
 */

type AmenityFeature = {
  properties: {
    id: string;
    kind: AmenityKind;
    label: string;
    detail?: string;
    propertyCode?: string;
    placeIds?: string[];
  };
};

type AmenityIndex = Map<string, AmenityFeature["properties"][]>;

export function useAmenityIndex() {
  return useQuery({
    queryKey: ["amenities", "by-place"] as const,
    queryFn: async (): Promise<AmenityIndex> => {
      const response = await fetch(AMENITY_DATA_URL);
      if (!response.ok) throw new Error(`amenities: ${response.status}`);
      const document = (await response.json()) as { features?: AmenityFeature[] };
      const index: AmenityIndex = new Map();
      for (const feature of document.features ?? []) {
        // Keyed on PLACE id, not property code. The Python job already did the
        // code → places join against the buildings artifact, which is why the
        // place page does not have to fetch 327 kB of footprints to learn that
        // Andrews Hall contains Andrews Commons.
        for (const placeId of feature.properties?.placeIds ?? []) {
          const bucket = index.get(placeId);
          if (bucket) bucket.push(feature.properties);
          else index.set(placeId, [feature.properties]);
        }
      }
      return index;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60_000,
  });
}

/** Amenities inside the building this place sits in. */
export function PlaceAmenities({ placeId }: { placeId: string }) {
  const { data, isError } = useAmenityIndex();

  const grouped = useMemo(() => {
    if (!data) return [];
    const rows = data.get(placeId) ?? [];
    const byKind = new Map<AmenityKind, typeof rows>();
    for (const row of rows) {
      const bucket = byKind.get(row.kind);
      if (bucket) bucket.push(row);
      else byKind.set(row.kind, [row]);
    }
    return [...byKind.entries()].sort(([a], [b]) =>
      AMENITY_LABELS[a].localeCompare(AMENITY_LABELS[b]),
    );
  }, [data, placeId]);

  if (isError) {
    return (
      <p role="alert" className="text-14 text-text-secondary">
        Building amenities are unavailable right now.
      </p>
    );
  }

  if (grouped.length === 0) return null;

  return (
    <ul className="space-y-2" data-testid="place-amenities">
      {grouped.map(([kind, rows]) => (
        <li key={kind} className="flex gap-3">
          <span className="w-44 shrink-0 font-mono text-12 uppercase tracking-[0.08em] text-text-secondary">
            {AMENITY_LABELS[kind]}
          </span>
          <span className="text-14 text-text-primary">
            {rows
              .map((row) => row.detail)
              .filter(Boolean)
              .join(" · ") || `${rows.length} location${rows.length === 1 ? "" : "s"}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
