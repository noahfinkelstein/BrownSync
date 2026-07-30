import { readFileSync } from "node:fs";
import path from "node:path";
import { tokens } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import { CAMPUS_AGE_DARK, CAMPUS_AGE_LIGHT, CAMPUS_AGE_MID } from "../src/map/campusBuildings";
import {
  CAMPUS_LAT,
  CAMPUS_LNG,
  contrastRatio,
  DAY_ABOVE_DEG,
  daylightLevel,
  daylightPhase,
  MAX_SURFACE_LUMINANCE,
  NIGHT_BELOW_DEG,
  paletteAt,
  paletteForDate,
  relativeLuminance,
  sunAltitude,
} from "../src/map/daylight";

/** Minutes past UTC midnight where the sun crosses the horizon on `dayUtc`. */
function horizonCrossings(dayUtc: number): { minute: number; rising: boolean }[] {
  const out: { minute: number; rising: boolean }[] = [];
  let previous: number | null = null;
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const altitude = sunAltitude(new Date(dayUtc + minute * 60_000));
    if (previous !== null && previous < 0 !== altitude < 0) {
      out.push({ minute, rising: previous < 0 });
    }
    previous = altitude;
  }
  return out;
}

const toEastern = (minute: number, offset: number): string => {
  const local = (((minute - offset) % 1440) + 1440) % 1440;
  return `${String(Math.floor(local / 60)).padStart(2, "0")}:${String(local % 60).padStart(2, "0")}`;
};

describe("solar position", () => {
  // Published Providence times. The algorithm is NOAA's low-precision form, so
  // these assert "within ~10 minutes", which is far finer than a colour ramp.
  it("puts summer-solstice sunrise and sunset where they actually fall", () => {
    const crossings = horizonCrossings(Date.UTC(2026, 5, 21));
    const sunrise = crossings.find((c) => c.rising);
    const sunset = crossings.find((c) => !c.rising);
    expect(toEastern(sunrise?.minute ?? 0, 240)).toBe("05:16"); // actual 05:11 EDT
    expect(toEastern(sunset?.minute ?? 0, 240)).toBe("20:19"); // actual 20:24 EDT
  });

  it("puts winter-solstice sunrise and sunset where they actually fall", () => {
    const crossings = horizonCrossings(Date.UTC(2026, 11, 21));
    const sunrise = crossings.find((c) => c.rising);
    const sunset = crossings.find((c) => !c.rising);
    expect(toEastern(sunrise?.minute ?? 0, 300)).toBe("07:15"); // actual 07:07 EST
    expect(toEastern(sunset?.minute ?? 0, 300)).toBe("16:13"); // actual 16:16 EST
  });

  it("gives a ~12 hour day at the equinox", () => {
    const crossings = horizonCrossings(Date.UTC(2026, 8, 23));
    const sunrise = crossings.find((c) => c.rising)?.minute ?? 0;
    const sunset = crossings.find((c) => !c.rising)?.minute ?? 0;
    expect(Math.abs(sunset - sunrise - 720)).toBeLessThan(15);
  });

  it("matches the winter solar-noon altitude", () => {
    // 90 - latitude - 23.44 = 24.7 degrees at Providence.
    const noon = Math.max(
      ...Array.from({ length: 96 }, (_, i) =>
        sunAltitude(new Date(Date.UTC(2026, 11, 21) + i * 15 * 60_000)),
      ),
    );
    expect(noon).toBeGreaterThan(24);
    expect(noon).toBeLessThan(25.5);
  });

  it("is far below the horizon in the middle of the night", () => {
    expect(sunAltitude(new Date("2026-07-29T06:00:00Z"))).toBeLessThan(-15);
  });

  it("defaults to the campus, and accepts an explicit location", () => {
    const when = new Date("2026-06-21T16:00:00Z");
    expect(sunAltitude(when)).toBeCloseTo(sunAltitude(when, CAMPUS_LAT, CAMPUS_LNG), 6);
    // Far south in June the sun is much lower — proves lat/lng are really used.
    expect(sunAltitude(when, -41.8, CAMPUS_LNG)).toBeLessThan(sunAltitude(when));
  });
});

describe("phases", () => {
  it("splits on civil twilight", () => {
    expect(daylightPhase(-20).phase).toBe("night");
    expect(daylightPhase(NIGHT_BELOW_DEG).phase).toBe("night");
    expect(daylightPhase(0).phase).toBe("twilight");
    expect(daylightPhase(DAY_ABOVE_DEG).phase).toBe("day");
    expect(daylightPhase(60).phase).toBe("day");
  });

  it("is monotonic in altitude", () => {
    let previous = -1;
    for (let altitude = -30; altitude <= 60; altitude += 0.5) {
      const level = daylightLevel(daylightPhase(altitude));
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });
});

describe("palette", () => {
  it("interpolates between the two endpoints", () => {
    expect(paletteAt(0).ageDark).toBe("#1d1310");
    expect(paletteAt(1).ageDark).toBe(CAMPUS_AGE_DARK.toLowerCase());
    expect(paletteAt(1).ageMid).toBe(CAMPUS_AGE_MID.toLowerCase());
    expect(paletteAt(1).ageLight).toBe(CAMPUS_AGE_LIGHT.toLowerCase());
    expect(paletteAt(1).earth).toBe(tokens.bg.base.toLowerCase());
    expect(paletteAt(1).road).toBe(tokens.map.road.toLowerCase());
  });

  it("clamps out-of-range levels", () => {
    expect(paletteAt(-5)).toEqual(paletteAt(0));
    expect(paletteAt(9)).toEqual(paletteAt(1));
  });

  it("brightens monotonically", () => {
    let previous = -1;
    for (let level = 0; level <= 1; level += 0.05) {
      const luminance = relativeLuminance(paletteAt(level).ageDark);
      expect(luminance).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = luminance;
    }
  });

  it("never lifts a label-bearing surface past the WCAG ceiling", () => {
    // THE constraint, and the reason the age ramp moves through HUE rather
    // than brightness. Measured against `tokens.map.labelMuted` — the MAP's
    // own type colour, not the page's: those were the same token until the
    // chrome went light, at which point this suite correctly went red because
    // the map would have drawn near-black labels on a near-black basemap.
    // 4.5:1 against that label colour caps a surface at
    // 0.026251 relative luminance; the brightest ramp stop is already within
    // 6% of it. There is no brightness left to spend, so a uniform "brighten
    // at noon" would fail AA outright — the day endpoint IS the palette and
    // only dark surfaces lift. Hue rotation is free: contrast is a luminance
    // ratio, so brick vs glass costs nothing here.
    for (let level = 0; level <= 1; level += 0.02) {
      const palette = paletteAt(level);
      for (const surface of [palette.ageDark, palette.ageMid, palette.ageLight]) {
        expect(relativeLuminance(surface), `${surface} at level ${level}`).toBeLessThanOrEqual(
          MAX_SURFACE_LUMINANCE,
        );
        expect(contrastRatio(tokens.map.labelMuted, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(tokens.map.label, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps road labels legible at every phase", () => {
    for (let level = 0; level <= 1; level += 0.05) {
      expect(contrastRatio(tokens.map.labelMuted, paletteAt(level).road)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("separates the three material stops by hue, not just brightness", () => {
    // The regression this ramp exists for: the first version ran between two
    // blue-greys and the whole campus rendered as one flat grey mass. Hue
    // distance is the thing that makes brick, stone and glass distinguishable
    // once brightness is spent.
    const day = paletteAt(1);
    const h = (hex: string): number => {
      const [r = 0, g = 0, b = 0] = [1, 3, 5].map(
        (i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255,
      );
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d === 0) return 0;
      const raw = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (raw * 60 + 360) % 360;
    };
    const brick = h(day.ageDark);
    const glass = h(day.ageLight);
    // Warm end really is warm (red/orange), cool end really is cool (blue).
    expect(brick).toBeLessThan(60);
    expect(glass).toBeGreaterThan(180);
    expect(glass).toBeLessThan(260);
    // ...and brightness still rises across the ramp, so the old low core
    // reads dark exactly as it did before.
    expect(relativeLuminance(day.ageDark)).toBeLessThan(relativeLuminance(day.ageMid));
    expect(relativeLuminance(day.ageMid)).toBeLessThan(relativeLuminance(day.ageLight));
  });

  it("actually looks different at 2am and 1pm", () => {
    // Guards against the palette being wired up but inert.
    const night = paletteForDate(new Date("2026-07-29T06:00:00Z")); // 02:00 EDT
    const noon = paletteForDate(new Date("2026-07-29T17:00:00Z")); // 13:00 EDT
    expect(night.ageDark).not.toBe(noon.ageDark);
    expect(relativeLuminance(noon.skyColor)).toBeGreaterThan(relativeLuminance(night.skyColor) * 3);
    expect(noon.lightIntensity).toBeGreaterThan(night.lightIntensity);
  });
});

describe("contrast helpers", () => {
  it("is symmetric and matches known values", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#8B94A3", "#252D3A")).toBeCloseTo(4.53, 1);
  });
});

/** Source with comments removed — the rules below are about CODE, not prose. */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the one-ambient-animation rule", () => {
  it("creates no rAF and no interval", () => {
    // Daylight is INPUT-driven: it changes on a scrub or the existing 30 s live
    // tick and crossfades via style.json's 150 ms transition. If it ever starts
    // a loop, the app has two ambient animations and this fails.
    const source = readFileSync(path.resolve(__dirname, "../src/map/daylight.ts"), "utf8");
    const layer = readFileSync(path.resolve(__dirname, "../src/map/DaylightLayer.tsx"), "utf8");
    for (const [name, text] of [
      ["daylight.ts", codeOnly(source)],
      ["DaylightLayer.tsx", codeOnly(layer)],
    ] as const) {
      expect(text, name).not.toMatch(/requestAnimationFrame/);
      expect(text, name).not.toMatch(/setInterval/);
      expect(text, name).not.toMatch(/setTimeout/);
    }
  });

  it("feature-detects setSky rather than assuming it exists", () => {
    // `sky` is experimental in MapLibre v6 and is NOT implemented on MapLibre
    // Native iOS/Android — the Swift client must degrade, not throw.
    const layer = readFileSync(path.resolve(__dirname, "../src/map/DaylightLayer.tsx"), "utf8");
    expect(codeOnly(layer)).toMatch(/typeof withSky\.setSky === "function"/);
  });
});
