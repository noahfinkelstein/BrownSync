import { CATEGORIES, CATEGORY_BY_ID, type Category } from "@brownsync/contract";
import { CATEGORY_ICON_PATHS, ICON_STROKE_WIDTH, ICON_VIEWBOX } from "./paths";

const PATH_ATTRS = `fill="none" stroke="currentColor" stroke-width="${ICON_STROKE_WIDTH}" stroke-linecap="butt" stroke-linejoin="miter"`;

/**
 * DOM sprite sheet: one hidden `<svg>` of `<symbol>`s, id'd by the contract
 * icon slugs (`icon-academic` …). Inject once near the document root, then
 * reference anywhere with `<svg><use href="#icon-club"/></svg>`.
 */
export function buildSpriteSheet(): string {
  const symbols = CATEGORIES.map(
    (c) =>
      `<symbol id="${c.icon}" viewBox="0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}"><path d="${CATEGORY_ICON_PATHS[c.id]}" ${PATH_ATTRS}/></symbol>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">${symbols}</svg>`;
}

/** The image id to register/reference on the map for a category (`icon-club`). */
export function mapIconId(category: Category): string {
  return CATEGORY_BY_ID[category].icon;
}

/**
 * MapLibre variant: rasterizes every glyph to `ImageData` via OffscreenCanvas
 * — white (default) glyph on transparent, so the style can tint and halo it.
 *
 * Usage:
 * ```ts
 * for (const [id, image] of Object.entries(buildMapImages(64))) {
 *   map.addImage(mapIconId(id as Category), image, { sdf: true, pixelRatio: 4 });
 * }
 * ```
 * Render at 2–4× display size and pass `pixelRatio` accordingly; `sdf: true`
 * lets `icon-color`/`icon-halo-*` recolor the white alpha mask.
 */
export function buildMapImages(size = 32, colorHex = "#ffffff"): Record<Category, ImageData> {
  if (typeof OffscreenCanvas === "undefined") {
    throw new Error(
      "buildMapImages requires OffscreenCanvas (browser or worker). For DOM use, see buildSpriteSheet().",
    );
  }
  const out = {} as Record<Category, ImageData>;
  for (const c of CATEGORIES) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    ctx.scale(size / ICON_VIEWBOX, size / ICON_VIEWBOX);
    ctx.lineWidth = ICON_STROKE_WIDTH;
    ctx.strokeStyle = colorHex;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.stroke(new Path2D(CATEGORY_ICON_PATHS[c.id]));
    out[c.id] = ctx.getImageData(0, 0, size, size);
  }
  return out;
}
