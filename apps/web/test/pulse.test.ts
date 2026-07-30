import { tokens } from "@brownsync/contract";
import type { ScatterplotLayer } from "@deck.gl/layers";
import { describe, expect, it } from "vitest";
import {
  ACCENT_RGB,
  buildPulseLayers,
  buildStaticSoonLayers,
  hexToRgb,
  PULSE_PERIOD_MS,
  pulsePhase,
} from "../src/map/pulse";

/**
 * Derived, not hardcoded.
 *
 * This file used to pin the literal `[217, 108, 61]` — the pre-2026-07-29
 * accent — in two places. The light-theme flip to Brown red turned both red,
 * which is a false alarm: nothing about the *pulse* broke, the palette moved
 * underneath it. A copy of the palette in a behaviour test is a second source
 * of truth that has to be hand-edited every time the first one changes.
 *
 * The value of `tokens.accent` is pinned exactly once, in
 * `packages/contract/test/contract.test.ts`, which is where a palette change
 * should have to be deliberate. What *this* file is for is the wiring: that
 * the pulse reads the token rather than carrying a colour of its own.
 */
const EXPECTED_ACCENT_RGB = hexToRgb(tokens.accent);

describe("pulse (the one ambient animation, §6.4)", () => {
  it("takes its colour from the accent token rather than a literal", () => {
    // Not a tautology: it asserts `pulse.ts` derives ACCENT_RGB from the
    // token. A hardcoded triple in the source — the actual regression — fails
    // here whatever the palette happens to be.
    expect(ACCENT_RGB).toEqual(EXPECTED_ACCENT_RGB);
    expect(EXPECTED_ACCENT_RGB).toHaveLength(3);
    for (const channel of EXPECTED_ACCENT_RGB) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });

  it("parses hex correctly, so the derivation above cannot pass vacuously", () => {
    // If `hexToRgb` were broken (say it returned [0,0,0] for everything) the
    // derived assertion would still pass. Pin the parser against literals it
    // does not get from the palette.
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#FFFFFF")).toEqual([255, 255, 255]);
    expect(hexToRgb("#C00404")).toEqual([192, 4, 4]);
  });

  it("phase wraps over the period", () => {
    expect(pulsePhase(0)).toBe(0);
    expect(pulsePhase(PULSE_PERIOD_MS / 2)).toBe(0.5);
    expect(pulsePhase(PULSE_PERIOD_MS)).toBe(0);
    expect(pulsePhase(PULSE_PERIOD_MS * 3.25)).toBe(0.25);
  });

  it("emits no layers with no positions", () => {
    expect(buildPulseLayers([], 0.5)).toEqual([]);
    expect(buildStaticSoonLayers([])).toEqual([]);
  });

  it("ring expands and fades with phase", () => {
    const pos: [number, number][] = [[-71.4, 41.83]];
    const early = buildPulseLayers(pos, 0)[0] as ScatterplotLayer;
    const late = buildPulseLayers(pos, 0.95)[0] as ScatterplotLayer;
    expect(early.id).toBe("bs-pulse-ring");
    expect(early.props.getRadius).toBe(6);
    expect(late.props.getRadius as number).toBeGreaterThan(20);
    const earlyAlpha = (early.props.getLineColor as unknown as number[])[3] ?? 0;
    const lateAlpha = (late.props.getLineColor as unknown as number[])[3] ?? 0;
    expect(earlyAlpha).toBeGreaterThan(lateAlpha);
    expect(early.props.stroked).toBe(true);
    expect(early.props.filled).toBe(false);
  });

  it("reduced-motion variant is static", () => {
    const layer = buildStaticSoonLayers([[-71.4, 41.83]])[0] as ScatterplotLayer;
    expect(layer.props.getRadius).toBe(9);
    expect((layer.props.getLineColor as unknown as number[]).slice(0, 3)).toEqual(
      EXPECTED_ACCENT_RGB,
    );
  });
});
