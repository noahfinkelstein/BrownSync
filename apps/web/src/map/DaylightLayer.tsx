import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import { useTimeCursor } from "../time/useTimeCursor";
import { CAMPUS_LAYER_IDS, campusActivityColorExpression } from "./campusBuildings";
import { ageRampExpression, type DaylightPalette, paletteForDate } from "./daylight";

/**
 * Applies the time-of-day palette whenever the cursor moves.
 *
 * Renders nothing. Input-driven, never a loop — no rAF, no interval — so the
 * app keeps exactly one ambient animation (the ≤30-min pulse). `style.json`
 * carries `"transition": { "duration": 150 }`, so each change crossfades at the
 * §6.4 motion bound for free.
 *
 * ── TWO WIRING HAZARDS, both hit in the browser ─────────────────────────────
 *
 * 1. **Do not gate on `map.isStyleLoaded()`.** It returns false while glyphs,
 *    sprites or any source are still pending, and `styledata` fires *during*
 *    that window. Once everything settles `styledata` stops firing, so a
 *    `styledata` + `isStyleLoaded()` pair never lands a successful apply at
 *    all — observed as the palette computing correctly (`earth=#080b0f` at
 *    02:00) while the map sat at its day colours. `idle` is the event that
 *    actually means "the style is settled".
 *
 * 2. **Re-applying on every `idle` risks a feedback loop**: a paint change
 *    triggers a repaint, which triggers `idle`, which triggers another paint
 *    change. The applied-signature ref breaks it — an unchanged palette is a
 *    no-op, so the map settles.
 *
 * `sky` goes through a feature-detected `setSky`: it is an EXPERIMENTAL root
 * property in MapLibre v6 and is **not implemented on MapLibre Native
 * iOS/Android**, so the Swift client skips it while everything else ports.
 */
export function DaylightLayer() {
  const { current: mapRef } = useMap();
  const cursor = useTimeCursor();
  const at = cursor.now().getTime();
  const appliedRef = useRef<string | null>(null);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const apply = (): void => {
      const palette = paletteForDate(new Date(at));
      const signature = paletteSignature(palette);
      // Idempotence guard — also what stops idle -> paint -> idle looping.
      if (appliedRef.current === signature) return;
      // Style not in yet; `idle` will retry.
      if (!map.getLayer("earth")) return;
      applyPalette(map, palette);
      appliedRef.current = signature;
    };

    apply();
    // `idle` is the only reliable "style is fully settled" signal; `styledata`
    // additionally catches a style swap that would drop the paint overrides.
    map.on("idle", apply);
    map.on("styledata", apply);
    return () => {
      map.off("idle", apply);
      map.off("styledata", apply);
    };
  }, [mapRef, at]);

  return null;
}

function paletteSignature(palette: DaylightPalette): string {
  return [
    palette.ageDark,
    // ageMid belongs here too: it is an independent ramp stop, and omitting it
    // means a palette whose only change is the midpoint compares equal and is
    // never applied.
    palette.ageMid,
    palette.ageLight,
    palette.road,
    palette.earth,
    palette.skyColor,
    palette.lightIntensity.toFixed(3),
  ].join("|");
}

// setPaintProperty is typed against a union of every paint key; these targets
// are validated at runtime by getLayer() plus a try/catch, so the cast is honest.
type PaintTarget = { layer: string; property: string; value: unknown };

function applyPalette(
  map: ReturnType<NonNullable<ReturnType<typeof useMap>["current"]>["getMap"]>,
  palette: DaylightPalette,
): void {
  const targets: PaintTarget[] = [
    // The extrusion MUST keep its class-activity feature-state wrapper — the
    // age ramp is only the level-0 stop. Replacing the whole expression with a
    // bare ramp would silently disable the classes-in-session tint, which is
    // why the palette is threaded through campusActivityColorExpression rather
    // than rebuilt here.
    {
      layer: CAMPUS_LAYER_IDS.extrusion,
      property: "fill-extrusion-color",
      value: campusActivityColorExpression(palette.ageDark, palette.ageMid, palette.ageLight),
    },
    { layer: CAMPUS_LAYER_IDS.flat, property: "fill-color", value: ageRampExpression(palette) },
    { layer: "earth", property: "fill-color", value: palette.earth },
    { layer: "roads-minor", property: "line-color", value: palette.road },
    { layer: "roads-medium", property: "line-color", value: palette.road },
    { layer: "roads-major", property: "line-color", value: palette.road },
  ];

  for (const target of targets) {
    // A layer can legitimately be absent — the campus layers mount after the
    // style, and roads-* could be renamed by a future style edit.
    if (!map.getLayer(target.layer)) continue;
    try {
      (map.setPaintProperty as (l: string, p: string, v: unknown) => void)(
        target.layer,
        target.property,
        target.value,
      );
    } catch (error) {
      console.warn("[daylight] paint failed", target.layer, target.property, error);
    }
  }

  try {
    map.setLight({
      anchor: "viewport",
      color: "#ffffff",
      intensity: palette.lightIntensity,
      position: palette.lightPosition,
    });
  } catch {
    /* light is optional */
  }

  const withSky = map as unknown as { setSky?: (spec: Record<string, unknown>) => void };
  if (typeof withSky.setSky === "function") {
    try {
      withSky.setSky({
        "sky-color": palette.skyColor,
        "horizon-color": palette.horizonColor,
        "sky-horizon-blend": 0.6,
        // fog-* requires 3D terrain, which this map deliberately does not use.
        "atmosphere-blend": 0,
      });
    } catch {
      /* sky is experimental — never fatal */
    }
  }
}
