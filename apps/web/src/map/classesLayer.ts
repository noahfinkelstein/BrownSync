import type { MeetingOut } from "@brownsync/contract";
import { CATEGORY_BY_ID } from "@brownsync/contract";
import type { ExpressionSpecification } from "maplibre-gl";

/**
 * Classes-in-session layer (handoff §5): building fill saturation scales with
 * the count of in-session meetings at the time cursor. Buildings come from
 * the basemap vector tiles, so activity is applied as MapLibre feature-state
 * on the `buildings` source-layer (see ClassesLayer.tsx) and the paint reads
 * `feature-state.classActivity` ∈ [0, 1].
 */

export type PlaceActivity = {
  placeId: string;
  placeName: string | null;
  lng: number;
  lat: number;
  count: number;
};

/** Group in-session meetings by resolved place (needs coords to render). */
export function aggregateMeetingActivity(meetings: readonly MeetingOut[]): PlaceActivity[] {
  const byPlace = new Map<string, PlaceActivity>();
  for (const m of meetings) {
    if (m.placeId === null || m.lat === null || m.lng === null) continue;
    const existing = byPlace.get(m.placeId);
    if (existing) {
      existing.count += 1;
    } else {
      byPlace.set(m.placeId, {
        placeId: m.placeId,
        placeName: m.placeName,
        lng: m.lng,
        lat: m.lat,
        count: 1,
      });
    }
  }
  return [...byPlace.values()].sort((a, b) => b.count - a.count);
}

/** Saturation reaches full at this many simultaneous meetings. */
export const ACTIVITY_FULL_COUNT = 5;

/** count → [0, 1] fill level. 0 meetings → 0. */
export function activityLevel(count: number): number {
  if (count <= 0) return 0;
  return Math.min(1, count / ACTIVITY_FULL_COUNT);
}

/** Total in-session meeting count (rail readout). */
export function totalMeetingCount(activities: readonly PlaceActivity[]): number {
  return activities.reduce((sum, a) => sum + a.count, 0);
}

/** Linear sRGB-hex blend, `t` toward `tint`. */
export function blendHex(base: string, tint: string, t: number): string {
  const parse = (hex: string): [number, number, number] => {
    const h = hex.replace("#", "");
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
  };
  const a = parse(base);
  const b = parse(tint);
  const mix = a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * Math.min(1, Math.max(0, t))));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Basemap building colors — keep in sync with map/style.json. */
export const BUILDING_3D_BASE = "#1A202A";
export const BUILDING_2D_BASE = "#151A22";

/** Fully-active building tint: the `class` category hue, kept dark. */
const CLASS_TINT = CATEGORY_BY_ID.class.colorHex;

export function activeBuildingColor(base: string): string {
  return blendHex(base, CLASS_TINT, 0.5);
}

/** Paint expression: base fill → class-tinted fill by feature-state. */
export function classActivityColorExpression(base: string): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["feature-state", "classActivity"], 0],
    0,
    base,
    1,
    activeBuildingColor(base),
  ] as unknown as ExpressionSpecification;
}
