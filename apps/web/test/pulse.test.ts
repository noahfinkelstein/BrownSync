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

describe("pulse (the one ambient animation, §6.4)", () => {
  it("pulses in accent — straight from the token", () => {
    expect(hexToRgb(tokens.accent)).toEqual([217, 108, 61]);
    expect(ACCENT_RGB).toEqual([217, 108, 61]);
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
    expect((layer.props.getLineColor as unknown as number[]).slice(0, 3)).toEqual([217, 108, 61]);
  });
});
