import type { StyleSpecification } from "maplibre-gl";
import baseStyle from "../../../../map/style.json";

/**
 * The repo-root `map/style.json` is the canonical basemap style (see
 * `map/README.md`); it is bundled via direct JSON import. The only runtime
 * mutation is pointing the vector source at the configured PMTiles archive.
 */

/** Default matches the committed extract served from `apps/web/public/`. */
export const DEFAULT_PMTILES_PATH = "/tiles/providence.pmtiles";

export function pmtilesUrl(): string {
  const configured = import.meta.env.VITE_PMTILES_URL as string | undefined;
  return configured && configured.length > 0 ? configured : DEFAULT_PMTILES_PATH;
}

export function buildMapStyle(): StyleSpecification {
  const style = structuredClone(baseStyle) as unknown as StyleSpecification;
  const source = style.sources.protomaps;
  if (source?.type === "vector") {
    source.url = `pmtiles://${pmtilesUrl()}`;
  }
  return style;
}
