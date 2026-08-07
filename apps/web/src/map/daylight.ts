import { tokens } from "@brownsync/contract";
import {
  CAMPUS_AGE_DARK,
  CAMPUS_AGE_LIGHT,
  CAMPUS_AGE_MAX,
  CAMPUS_AGE_MID,
  CAMPUS_AGE_MID_YEAR,
  CAMPUS_AGE_MIN,
} from "./campusBuildings";

/**
 * Time-of-day cartography, driven by the existing time cursor.
 *
 * Scrub to 02:00 and campus goes deep blue-black under a black sky; scrub to
 * 13:00 and the brick core lifts and the sky reads pale slate. The sun's real
 * position for Providence drives it, so the transition lands where it actually
 * lands — early in June, before 17:00 in December.
 *
 * THIS IS NOT A SECOND AMBIENT ANIMATION. It is input-driven: it changes only
 * when the cursor moves (by scrub, or by the existing 30 s live tick), and it
 * is a transition rather than a loop. `map/style.json` already declares
 * `"transition": { "duration": 150 }`, so every change crossfades for free at
 * exactly the §6.4 motion bound. `daylight.test.ts` asserts this module creates
 * no `requestAnimationFrame` and no interval.
 *
 * ── THE CONTRAST CEILING, measured ──────────────────────────────────────────
 * Building surfaces carry labels, so lifting them spends the WCAG budget
 * directly. Measured against `--text-secondary` (#8B94A3), the weaker of the
 * two label colours:
 *
 *   max surface luminance for 4.5:1 .......... 0.026251
 *   current CAMPUS_AGE_LIGHT (#252D3A) ....... 0.025756   → 4.53:1
 *
 * That is **1.9% of headroom**. The newest buildings are already at the
 * ceiling, so a uniform "brighten everything at noon" would fail AA outright.
 *
 * The ramp therefore compresses upward: dark surfaces lift a lot, light ones
 * barely move, and the day endpoint IS the current palette rather than
 * something brighter. Which is also how daylight really behaves — dark
 * surfaces change apparent brightness far more than bright ones.
 */

/** Providence, RI — the campus the cursor is describing. */
export const CAMPUS_LAT = 41.8268;
export const CAMPUS_LNG = -71.4025;

export type DaylightPhase = "night" | "twilight" | "day";

export type DaylightState = {
  phase: DaylightPhase;
  /** 0 at the darkest end of the phase, 1 at the brightest. */
  t: number;
  /** Sun altitude in degrees; negative is below the horizon. */
  altitudeDeg: number;
};

export type DaylightPalette = {
  /** Stops of the building age ramp: brick → stone → glass. */
  ageDark: string;
  ageMid: string;
  ageLight: string;
  road: string;
  earth: string;
  skyColor: string;
  horizonColor: string;
  /** `light.intensity` — extrusion face shading. */
  lightIntensity: number;
  /** `light.position` as [radial, azimuth, polar]. */
  lightPosition: [number, number, number];
};

/**
 * Sun altitude for a given instant, NOAA's low-precision algorithm.
 *
 * Written out rather than pulled from `suncalc` deliberately: this is ~30 lines
 * of arithmetic and the app runs a hard 450 kB budget.
 *
 * Measured against published Providence times: sunrise/sunset land within 8
 * minutes at both solstices and are exact at the September equinox; winter
 * solar-noon altitude is 24.6° against an actual 24.7°. Far finer than a
 * colour ramp can express, which is all this needs to be.
 */
export function sunAltitude(date: Date, lat = CAMPUS_LAT, lng = CAMPUS_LNG): number {
  const rad = Math.PI / 180;

  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start) / 86_400_000);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  // Fractional year (radians).
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);

  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  // Everything is computed in UTC, so the timezone term is zero.
  const trueSolarTime = utcHours * 60 + eqTime + 4 * lng;
  const hourAngle = trueSolarTime / 4 - 180;

  const cosZenith =
    Math.sin(lat * rad) * Math.sin(decl) +
    Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle * rad);

  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / rad;
}

/** Civil twilight bounds. Below −6° is night; above +6° is unambiguous day. */
export const NIGHT_BELOW_DEG = -6;
export const DAY_ABOVE_DEG = 6;

export function daylightPhase(altitudeDeg: number): DaylightState {
  if (altitudeDeg <= NIGHT_BELOW_DEG) return { phase: "night", t: 0, altitudeDeg };
  if (altitudeDeg >= DAY_ABOVE_DEG) return { phase: "day", t: 1, altitudeDeg };
  const t = (altitudeDeg - NIGHT_BELOW_DEG) / (DAY_ABOVE_DEG - NIGHT_BELOW_DEG);
  return { phase: "twilight", t, altitudeDeg };
}

/** Global 0..1 brightness, monotonic in altitude across every phase. */
export function daylightLevel(state: DaylightState): number {
  if (state.phase === "night") return 0;
  if (state.phase === "day") return 1;
  return state.t;
}

// ── Palette endpoints ───────────────────────────────────────────────────────
// DAY is the app's existing palette, NOT something brighter — see the ceiling
// note above. NIGHT goes darker, which only ever improves contrast.

const NIGHT: DaylightPalette = {
  ageDark: "#1D1310",
  ageMid: "#1A1917",
  ageLight: "#182029",
  road: "#161B23",
  earth: "#080B0F",
  skyColor: "#05070A",
  horizonColor: "#0B0E12",
  lightIntensity: 0.15,
  lightPosition: [1.15, 210, 60],
};

const DAY: DaylightPalette = {
  ageDark: CAMPUS_AGE_DARK,
  ageMid: CAMPUS_AGE_MID,
  ageLight: CAMPUS_AGE_LIGHT,
  road: tokens.map.road,
  // The static style.json `earth` fill — the map's own ground, NOT the page
  // background. This briefly read `tokens.bg.base`, which was fine while the
  // chrome was dark and became a pure-white landmass at noon the moment the
  // chrome flipped light (same failure class as the label-halo bug documented
  // in tokens.ts). The map is its own surface; its ground pins to the basemap.
  earth: "#0B0E12",
  skyColor: "#2A3648",
  horizonColor: "#3A465A",
  lightIntensity: 0.45,
  lightPosition: [1.15, 210, 20],
};

/**
 * Hard ceiling on any surface a label sits on. Below the measured 0.026251 so
 * a future palette edit cannot quietly cross it; `daylight.test.ts` asserts
 * every reachable colour respects it.
 */
export const MAX_SURFACE_LUMINANCE = 0.0258;

export function relativeLuminance(hex: string): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mixHex(from: string, to: string, t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const channels = [1, 3, 5].map((i) => {
    const a = Number.parseInt(from.slice(i, i + 2), 16);
    const b = Number.parseInt(to.slice(i, i + 2), 16);
    return Math.round(a + (b - a) * clamped);
  });
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** The palette at a given brightness level. */
export function paletteAt(level: number): DaylightPalette {
  const t = Math.min(1, Math.max(0, level));
  return {
    ageDark: mixHex(NIGHT.ageDark, DAY.ageDark, t),
    ageMid: mixHex(NIGHT.ageMid, DAY.ageMid, t),
    ageLight: mixHex(NIGHT.ageLight, DAY.ageLight, t),
    road: mixHex(NIGHT.road, DAY.road, t),
    earth: mixHex(NIGHT.earth, DAY.earth, t),
    skyColor: mixHex(NIGHT.skyColor, DAY.skyColor, t),
    horizonColor: mixHex(NIGHT.horizonColor, DAY.horizonColor, t),
    lightIntensity: NIGHT.lightIntensity + (DAY.lightIntensity - NIGHT.lightIntensity) * t,
    lightPosition: [
      1.15,
      // Azimuth sweeps east→west across the day; parked at night.
      NIGHT.lightPosition[1] + (DAY.lightPosition[1] - NIGHT.lightPosition[1]) * t,
      NIGHT.lightPosition[2] + (DAY.lightPosition[2] - NIGHT.lightPosition[2]) * t,
    ],
  };
}

/** Convenience: instant → palette. */
export function paletteForDate(date: Date): DaylightPalette {
  return paletteAt(daylightLevel(daylightPhase(sunAltitude(date))));
}

/** The building age ramp at a given palette — mirrors campusBuildings.ts. */
export function ageRampExpression(palette: DaylightPalette) {
  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["get", "year"], CAMPUS_AGE_MID_YEAR],
    CAMPUS_AGE_MIN,
    palette.ageDark,
    CAMPUS_AGE_MID_YEAR,
    palette.ageMid,
    CAMPUS_AGE_MAX,
    palette.ageLight,
  ] as const;
}
