import { expect, test } from "@playwright/test";
import { blockExternal, mockApi, mockBasemapGlyphs } from "./support/mock-api";

/**
 * Map frame budget (handoff §5: ≤16 ms/frame with 1k points, 60 fps
 * desktop). Hermetic like every other spec — local PMTiles, glyphs answered
 * with empty PBFs, /api/* from fixtures — except /api/events, which serves a
 * 1,000-event synthetic dataset (registered after mockApi, so it wins).
 *
 * The spec drives a programmatic pan/zoom/pitch tour through the dev-only
 * `window.__brownsyncMap` handle (MapView exposes it under import.meta.env
 * .DEV) while a requestAnimationFrame loop records frame deltas, then
 * reports p50/p95/max.
 *
 * SOFT budget, hard numbers: `expect.soft(p95 ≤ 32 ms)` — two 60 Hz frames —
 * because CI-headless renders on SwiftShader (software GL): absolute numbers
 * there are NOT the 16 ms real-GPU target and vary with runner load. Treat
 * the printed p50/p95 as the report; chase real-GPU numbers on hardware.
 */

/** Contract §4 category slugs (fixed set — mirrored from the taxonomy). */
const CATEGORIES = [
  "academic",
  "class",
  "club",
  "arts",
  "athletics",
  "food",
  "social",
  "career",
  "wellness",
  "admin",
] as const;

/** Campus bbox (handoff §5 camera bounds). */
const BBOX = { west: -71.41, south: 41.82, east: -71.393, north: 41.834 };

const EVENT_COUNT = 1_000;
const MIN = 60_000;

/** Deterministic LCG so every run renders the identical 1k points. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** 1,000 contract-shaped events, all live at `now` (in-progress or ≤2 h out),
 *  ~10% inside the ≤30-min pulse window so the deck.gl overlay animates. */
function syntheticEvents(nowMs: number): unknown[] {
  const rng = makeRng(0xb0b);
  const events = [];
  for (let i = 0; i < EVENT_COUNT; i += 1) {
    const soon = i % 10 === 0;
    const startOffset = soon
      ? (5 + rng() * 24) * MIN // starting in 5–29 min → pulse set
      : (rng() * 170 - 60) * MIN; // started ≤60 min ago … starts ≤110 min out
    const start = nowMs + startOffset;
    const category = CATEGORIES[i % CATEGORIES.length];
    events.push({
      id: `perf-${i}`,
      title: `Perf event ${i}`,
      description: null,
      start: new Date(start).toISOString(),
      end: new Date(start + (60 + rng() * 30) * MIN).toISOString(),
      allDay: false,
      lat: BBOX.south + rng() * (BBOX.north - BBOX.south),
      lng: BBOX.west + rng() * (BBOX.east - BBOX.west),
      placeId: null,
      placeName: null,
      locationRaw: "Perf Hall",
      orgId: null,
      orgName: null,
      category,
      tags: [],
      url: null,
      cost: null,
      source: "manual",
      confidence: 1,
      isCanceled: false,
    });
  }
  return events;
}

type FrameStats = { frames: number; p50: number; p95: number; max: number };

test.describe("map frame budget — 1k points", () => {
  test("pan/zoom tour keeps p95 frame time inside the soft budget", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await blockExternal(page);
    await mockBasemapGlyphs(page);
    await mockApi(page);
    // Registered after mockApi → takes precedence for the events list only
    // (predicate, not glob: the request carries ?from/&to query params).
    await page.route(
      (url) => url.pathname === "/api/events",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ events: syntheticEvents(Date.now()) }),
        });
      },
    );

    await page.goto("/");
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 20_000 });
    const bootOverlay = page.getByText("Loading basemap…").locator("..");
    await expect(bootOverlay).toHaveClass(/opacity-0/, { timeout: 30_000 });

    // The dev-only camera handle + the 1k-event source must both be live.
    await page.waitForFunction(() => {
      const map = (
        window as unknown as {
          __brownsyncMap?: {
            getSource: (id: string) => unknown;
            querySourceFeatures: (id: string) => unknown[];
          };
        }
      ).__brownsyncMap;
      if (!map?.getSource("bs-events")) return false;
      return map.querySourceFeatures("bs-events").length > 0;
    });

    const stats = (await page.evaluate(async () => {
      type CameraMap = {
        easeTo: (opts: Record<string, unknown>) => void;
        jumpTo: (opts: Record<string, unknown>) => void;
        once: (event: string, cb: () => void) => void;
      };
      const map = (window as unknown as { __brownsyncMap: CameraMap }).__brownsyncMap;

      // The §5 tour: cross-campus pans, cluster→glyph zoom (through the z16
      // icon handoff), pitched 3D rotation, zoom back out. Camera stays
      // inside the College Hill max bounds.
      const tour: Record<string, unknown>[] = [
        { center: [-71.408, 41.822], zoom: 14 },
        { center: [-71.3955, 41.831], zoom: 14.6 },
        { center: [-71.4032, 41.8262], zoom: 16.4, pitch: 55 },
        { center: [-71.399, 41.828], zoom: 17.2, bearing: -35 },
        { center: [-71.4005, 41.8265], zoom: 15.2, pitch: 45, bearing: -15 },
        { center: [-71.405, 41.824], zoom: 13.5, bearing: 0 },
      ];

      const settled = () =>
        new Promise<void>((done) => {
          map.once("idle", done);
        });

      // Warm-up pass: jump through every waypoint and wait for idle, so the
      // measured pass meters FRAME cost (§5), not cold tile fetch/parse.
      for (const waypoint of tour) {
        map.jumpTo(waypoint);
        await settled();
      }
      map.jumpTo({ center: [-71.4032, 41.8262], zoom: 15.5, pitch: 45, bearing: -15 });
      await settled();

      const samples: number[] = [];
      let last = performance.now();
      let raf = requestAnimationFrame(function tick(t) {
        samples.push(t - last);
        last = t;
        raf = requestAnimationFrame(tick);
      });

      const ease = (opts: Record<string, unknown>) =>
        new Promise<void>((done) => {
          map.once("moveend", done);
          map.easeTo({ duration: 900, ...opts });
        });

      for (const waypoint of tour) {
        await ease(waypoint);
      }

      cancelAnimationFrame(raf);
      // Drop the warm-up frame (delta measured against pre-loop `last`).
      const deltas = samples.slice(1).sort((a, b) => a - b);
      const q = (p: number) =>
        deltas[Math.min(deltas.length - 1, Math.floor(p * deltas.length))] ?? Number.NaN;
      return {
        frames: deltas.length,
        p50: Number(q(0.5).toFixed(2)),
        p95: Number(q(0.95).toFixed(2)),
        max: Number((deltas[deltas.length - 1] ?? Number.NaN).toFixed(2)),
      };
    })) as FrameStats;

    // The report — the hard numbers live here, not in the assertion.
    console.log(
      `[perf] 1k-point tour (warm): ${stats.frames} frames, ` +
        `p50 ${stats.p50} ms, p95 ${stats.p95} ms, max ${stats.max} ms`,
    );
    await testInfo.attach("frame-stats.json", {
      body: JSON.stringify(stats, null, 2),
      contentType: "application/json",
    });

    // ~5.4 s of animation must actually have animated. Floor is deliberately
    // low: headless software GL renders the tour at ~10 fps.
    expect(stats.frames).toBeGreaterThan(20);
    expect(Number.isFinite(stats.p95)).toBe(true);

    // Always-on tripwire: an order of magnitude above observed headless
    // numbers — catches catastrophic regressions (event-storm/crash-loop
    // class) without turning render-speed variance into flakes.
    expect(stats.p95, "p95 frame time tripwire").toBeLessThanOrEqual(1_500);

    // The §5 soft budget (16 ms real-GPU target, 2× allowance) is opt-in:
    // headless SwiftShader misses 32 ms by ~an order of magnitude (observed
    // p50 ≈ 40–70 ms cold), so a default-on soft assert would keep the suite
    // permanently red. Run PERF_ENFORCE=1 on GPU hardware for the real gate.
    if (process.env.PERF_ENFORCE === "1") {
      expect
        .soft(stats.p95, "p95 frame time (soft 32 ms budget; §5 target is 16 ms on real GPUs)")
        .toBeLessThanOrEqual(32);
    }
  });
});
