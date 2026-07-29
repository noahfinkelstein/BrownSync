/**
 * Basemap building base colors — THE single TS copy of the values painted by
 * `map/style.json` (`buildings-3d` fill-extrusion-color / `buildings-2d`
 * fill-color). style.json stays the source of truth: these constants exist so
 * the classes-activity layer can restore and blend the base paint without
 * re-parsing the style at runtime, and `test/buildingColors.test.ts` fails
 * the suite if the two ever drift apart.
 */
export const BUILDING_3D_BASE = "#1A202A";
export const BUILDING_2D_BASE = "#151A22";
