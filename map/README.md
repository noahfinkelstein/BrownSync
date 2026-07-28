# map/

Single responsibility: the canonical dark MapLibre basemap style (`style.json`) for the
BrownSync campus map, per handoff §6.3 cartography law.

- **`style.json` is canonical.** `apps/web` imports it directly
  (`apps/web/src/map/style.ts` does `import baseStyle from "../../../../map/style.json"`) —
  there is no copy step, so edits here are picked up by the next dev-server reload / build.
  At runtime the web app rewrites `sources.protomaps.url` to
  `pmtiles://<VITE_PMTILES_URL>` (default `/tiles/providence.pmtiles`, the committed
  extract in `apps/web/public/tiles/`).
- Tile schema: Protomaps basemaps v4 (source layers: `earth`, `landcover`, `landuse`,
  `water`, `roads`, `buildings`, `boundaries`, `places`, `pois`). Regenerate the extract
  with `scripts/basemap-extract.sh`.
- Design intent: near-monochrome — roads `#1C222B`, water `#0D1319`, greens `#131A16`,
  land `#0B0E12`; buildings as top-lit `fill-extrusion` (`height` attr, 12 m fallback);
  max 3 zoom-gated label tiers (neighbourhood > street > civic POI); all commercial POI
  clutter hidden. The data layers are the only color on screen.
- Glyphs: `https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf`
  (Noto Sans Regular / Medium). No sprite — the style renders no icons.
