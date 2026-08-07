import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { blockExternal, mockApi, mockBasemapGlyphs } from "./support/mock-api";

/**
 * Daytime cartography sweep (ops handoff §4: the "white splotches" regression
 * guard). Hermetic like every other spec — local PMTiles, empty glyph PBFs,
 * /api/* from fixtures.
 *
 * WHY PIXEL STATISTICS, NOT GOLDEN PNGs: Playwright golden screenshots are
 * per-platform; darwin-generated goldens would leave linux CI with nothing to
 * compare against (the same reason perf.e2e.ts soft-gates its frame budget
 * behind PERF_ENFORCE). Instead every camera × hour frame is screenshotted,
 * attached to the report as a reviewable artifact, and asserted against two
 * platform-independent invariants of the deliberately dark basemap:
 *
 *   1. mean relative luminance stays LOW — the 2026-08 bug (DAY.earth riding
 *      the light-flipped `tokens.bg.base`) painted the whole daytime landmass
 *      page-white, which multiplies mean luminance ~20×;
 *   2. the near-white pixel fraction stays tiny — labels are #E8ECF1 (peak
 *      channel 241) so a ≥245 threshold counts only genuinely white surface,
 *      never type.
 *
 * Bounds are generous (real frames measure well under half of either cap) so
 * SwiftShader/AA jitter can't flake them, while a landmass-scale anomaly
 * overshoots both by an order of magnitude.
 */

/** Handoff §4 cameras: material ramp + labels · flat/extrusion crossover · wide. */
const CAMERAS = [
  { name: "main-green", center: [-71.403, 41.8262], zoom: 16.4, pitch: 55 },
  { name: "crossover", center: [-71.4005, 41.8265], zoom: 14.5, pitch: 0 },
  { name: "wide", center: [-71.405, 41.824], zoom: 13, pitch: 0 },
] as const;

/**
 * Handoff §4 hours, campus-local (America/New_York, EDT = UTC−4 on the fixed
 * date). 02:00/21:00 exercise night, 09:00/17:00 the twilight ramps' day side,
 * 13:00 full noon — the hour the splotches shipped in.
 */
const HOURS = [
  { name: "02", at: "2026-08-07T06:00:00Z" },
  { name: "09", at: "2026-08-07T13:00:00Z" },
  { name: "13", at: "2026-08-07T17:00:00Z" },
  { name: "17", at: "2026-08-07T21:00:00Z" },
  { name: "21", at: "2026-08-08T01:00:00Z" },
] as const;

const MAX_MEAN_LUMINANCE = 0.15;
const MAX_NEAR_WHITE_FRACTION = 0.005;
const NEAR_WHITE_CHANNEL = 245;

type PixelStats = { meanLuminance: number; nearWhiteFraction: number };

async function pixelStats(png: Buffer): Promise<PixelStats> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  let luminanceSum = 0;
  let nearWhite = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    // sRGB-weighted, linear-approximate — a ranking statistic, not WCAG math.
    luminanceSum = luminanceSum + (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (r >= NEAR_WHITE_CHANNEL && g >= NEAR_WHITE_CHANNEL && b >= NEAR_WHITE_CHANNEL) {
      nearWhite += 1;
    }
  }
  return { meanLuminance: luminanceSum / pixels, nearWhiteFraction: nearWhite / pixels };
}

for (const hour of HOURS) {
  test(`basemap stays dark and splotch-free at ${hour.name}:00 campus time`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await blockExternal(page);
    await mockBasemapGlyphs(page);
    await mockApi(page);

    await page.goto(`/?at=${encodeURIComponent(hour.at)}`);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 20_000 });
    const bootOverlay = page.getByText("Loading basemap…").locator("..");
    await expect(bootOverlay).toHaveClass(/opacity-0/, { timeout: 30_000 });

    // Measure the BASEMAP, not the chrome: panels/cards/attribution overlap
    // the canvas bbox and are legitimately light-themed. visibility cascades,
    // so hiding everything and re-revealing the canvas leaves only map pixels.
    await page.addStyleTag({
      content:
        "body * { visibility: hidden !important; } " +
        "canvas.maplibregl-canvas { visibility: visible !important; }",
    });

    for (const camera of CAMERAS) {
      await page.evaluate(async (cam) => {
        type CameraMap = {
          jumpTo: (opts: Record<string, unknown>) => void;
          once: (event: string, cb: () => void) => void;
        };
        const map = (window as unknown as { __brownsyncMap: CameraMap }).__brownsyncMap;
        const settled = new Promise<void>((done) => {
          map.once("idle", done);
        });
        map.jumpTo({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch });
        await settled;
      }, camera);

      // POSITIVE CONTROL (round-2 review): the luminance/near-white bounds
      // are upper bounds only, and a tile-less canvas — bare earth fill, no
      // buildings — passes them vacuously. Rendered-feature count proves the
      // basemap actually drew content before we measure its darkness.
      const renderedFeatures = await page.evaluate(() => {
        const map = (
          window as unknown as { __brownsyncMap: { queryRenderedFeatures: () => unknown[] } }
        ).__brownsyncMap;
        return map.queryRenderedFeatures().length;
      });
      expect(
        renderedFeatures,
        `${camera.name} at ${hour.name}:00 — only ${renderedFeatures} rendered features; ` +
          "the basemap did not draw content, so the darkness bounds below would " +
          "pass vacuously",
      ).toBeGreaterThan(50);

      const png = await page.locator(".maplibregl-canvas").screenshot();
      await testInfo.attach(`${hour.name}h-${camera.name}`, {
        body: png,
        contentType: "image/png",
      });
      // CARTO_DUMP=/path dumps every frame to disk for eyeball review.
      if (process.env.CARTO_DUMP) {
        mkdirSync(process.env.CARTO_DUMP, { recursive: true });
        writeFileSync(join(process.env.CARTO_DUMP, `${hour.name}h-${camera.name}.png`), png);
      }

      const stats = await pixelStats(png);
      expect(
        stats.meanLuminance,
        `${camera.name} at ${hour.name}:00 — mean luminance ${stats.meanLuminance.toFixed(4)} ` +
          "exceeds the dark-basemap cap; a bright surface (white earth, cream " +
          "clusters, page-token leak) is covering the map",
      ).toBeLessThan(MAX_MEAN_LUMINANCE);
      expect(
        stats.nearWhiteFraction,
        `${camera.name} at ${hour.name}:00 — near-white fraction ` +
          `${(stats.nearWhiteFraction * 100).toFixed(2)}% exceeds the cap; ` +
          "something is painting genuinely white surface onto the basemap",
      ).toBeLessThan(MAX_NEAR_WHITE_FRACTION);
    }
  });
}
