import { tokens } from "@brownsync/contract";
import type { LayersList } from "@deck.gl/core";
import { ScatterplotLayer } from "@deck.gl/layers";
import { useEffect } from "react";
import { setOverlayLayers } from "./overlay";

/**
 * The ≤30-min "starting soon" pulse — THE one ambient animation (§6.4),
 * rendered through the Phase 1 deck.gl overlay seam. Accent #D96C3D comes
 * from the token, alpha-animated rings expand over a 2 s period.
 * `prefers-reduced-motion` gets a static ring instead.
 */

export const PULSE_PERIOD_MS = 2000;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

export const ACCENT_RGB: [number, number, number] = hexToRgb(tokens.accent);

/** 0..1 phase within the pulse period. */
export function pulsePhase(tMs: number): number {
  return (tMs % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/** Expanding, fading accent ring at each soon-starting event. */
export function buildPulseLayers(
  positions: readonly [number, number][],
  phase: number,
): LayersList {
  if (positions.length === 0) return [];
  const eased = easeOut(phase);
  return [
    new ScatterplotLayer<[number, number]>({
      id: "bs-pulse-ring",
      data: positions as [number, number][],
      getPosition: (d) => d,
      radiusUnits: "pixels",
      lineWidthUnits: "pixels",
      stroked: true,
      filled: false,
      getRadius: 6 + 18 * eased,
      getLineWidth: 1.5,
      getLineColor: [...ACCENT_RGB, Math.round(210 * (1 - eased))],
      updateTriggers: { getRadius: eased, getLineColor: eased },
    }),
  ];
}

/** Reduced-motion variant: one static accent ring, no animation. */
export function buildStaticSoonLayers(positions: readonly [number, number][]): LayersList {
  if (positions.length === 0) return [];
  return [
    new ScatterplotLayer<[number, number]>({
      id: "bs-pulse-ring",
      data: positions as [number, number][],
      getPosition: (d) => d,
      radiusUnits: "pixels",
      lineWidthUnits: "pixels",
      stroked: true,
      filled: false,
      getRadius: 9,
      getLineWidth: 1.5,
      getLineColor: [...ACCENT_RGB, 170],
    }),
  ];
}

const FRAME_MS = 33; // ~30 fps is plenty for a 2 s ring

/** Drive the overlay seam with the pulse for the given positions. */
export function usePulseOverlay(positions: readonly [number, number][]): void {
  useEffect(() => {
    if (positions.length === 0) {
      setOverlayLayers([]);
      return () => setOverlayLayers([]);
    }
    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setOverlayLayers(buildStaticSoonLayers(positions));
      return () => setOverlayLayers([]);
    }
    let raf = 0;
    let last = 0;
    const tick = (t: number): void => {
      if (t - last >= FRAME_MS) {
        last = t;
        setOverlayLayers(buildPulseLayers(positions, pulsePhase(t)));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setOverlayLayers([]);
    };
  }, [positions]);
}
