# Cursor — convert the basemap to a light Brown-palette cartography

**Date:** 2026-07-29
**Scope:** the map surface only. The app chrome is already light and landed.
**Why Cursor:** this is tight, visual, iterative work against a running dev
server with a hard measurable pass/fail. It is the single best remaining fit
for edit-and-look.

---

## Where things stand

The whole UI flipped from dark to a light Brown-palette theme today. The
**map did not** — it is still a dark basemap sitting inside white chrome.

That pairing is defensible and is what ships right now (Citymapper and Uber
both do it; a dark map makes the category pins the brightest thing on screen,
which is the point). But the product owner asked for "the whole platform"
lighter, and this is the piece left.

It was not done in-session because inverting the map is not a palette swap: it
inverts a **measured contrast constraint** that four modules are built around.

---

## The constraint you are inverting — read this before touching anything

`apps/web/src/map/daylight.ts` defines:

```ts
export const MAX_SURFACE_LUMINANCE = 0.0258;
```

Every campus building is a surface with a **label drawn on top of it**. On the
dark map those labels are `--text-secondary` and 4.5:1 against them caps a
surface at `0.026251` relative luminance. That is where the number comes from,
and `daylight.test.ts` asserts it across every daylight level.

**On a light basemap the inequality flips.** Labels become dark text, and a
surface now needs a *minimum* luminance to keep 4.5:1 against them. So:

- `MAX_SURFACE_LUMINANCE` becomes `MIN_SURFACE_LUMINANCE` (or the module grows
  a light/dark pair).
- The three-stop material ramp in `apps/web/src/map/campusBuildings.ts` —
  brick `#301F17` → stone `#2A2724` → glass `#202C3C` — must be re-derived as
  *light* materials while keeping the same idea: **hue does the work, not
  brightness.** That was the whole insight. The first version of that ramp ran
  between two blue-greys 0.0096 and 0.0258 apart in luminance and the campus
  rendered as one flat grey mass. Read the comment block in `campusBuildings.ts`
  before you re-pick colours; it explains why hue is free and brightness is not.
- The `NIGHT`/`DAY` palettes in `daylight.ts` need a light-mode equivalent. Night
  on a light basemap should go *cool and dim*, not black.

There is a working search script for exactly this kind of derivation at
`/private/tmp/.../scratchpad/cats.mjs` (hue-preserving, walks lightness until a
contrast target is met). Steal the approach: preserve hue, move lightness,
verify numerically. **Do not eyeball colours** — every value in this codebase is
measured, and the tests check.

---

## Files you own

| File | What changes |
|---|---|
| `map/style.json` | Every paint colour. 19 layers. |
| `apps/web/src/map/daylight.ts` | The luminance ceiling → floor; `NIGHT`/`DAY` palettes. |
| `apps/web/src/map/campusBuildings.ts` | The brick/stone/glass ramp; outline colour. |
| `apps/web/src/map/campusLandmarks.ts` | Green/field fills. |
| `apps/web/src/map/campusAmenities.ts` | Dot halo (currently `#0B0E12`). |
| `apps/web/src/map/eventsLayer.ts` | Cluster/dot halos, if any assume dark. |
| `apps/web/test/daylight.test.ts` | The ceiling assertions invert. |
| `apps/web/test/campusBuildings.test.ts` | The chroma-bend bounds. |
| `apps/web/test/style.test.ts` | Layer/tier accounting. |

**Do not touch** `packages/contract/src/tokens.ts` (chrome tokens are settled),
`apps/web/src/feed/**`, `orgs/**`, `events/**`, `panels/**`, `dining/**`, or
anything under `apps/api/**` or `ingest/**`.

---

## Rules that do not bend

1. **Every label-bearing surface keeps 4.5:1** against the text drawn on it,
   at every daylight level. `daylight.test.ts` iterates `level` 0→1 in 0.02
   steps for exactly this reason. Keep that loop; change the direction of the
   comparison.
2. **≤3 visible label tiers at any zoom**, counted across `style.json` *and*
   `campusBuildings.ts` together. `campusBuildings.test.ts` does that
   accounting because each file alone can pass while the union violates it.
3. **Category colours stay the brightest thing on the map.** The chroma-bend
   test asserts every building stop is less saturated than the *least*
   saturated category colour. Those colours changed today (re-derived for
   white, each ≥4.5:1) — re-read them from `packages/contract/src/taxonomy.ts`,
   do not assume the old values.
4. **`["zoom"]` inside a `filter` evaluates at INTEGER tile zoom.** Layer
   `minzoom` and paint expressions are fractional-aware; filters are not. This
   cost a whole label tier once. Tiers must stay integers.
5. **Only 6 type sizes exist app-wide** (12/14/16/19/24/30) — irrelevant to
   `style.json` (map text is `text-size` in the style), but relevant if you
   touch any React file.

---

## How to work

```bash
pnpm --filter @brownsync/web dev --port 5199 --mode fixtures
```

Fixture mode serves the in-memory dataset — no Postgres, no Worker. The map
artifacts are static symlinks in `apps/web/public/data/`.

A dev-only handle is published as soon as the map instance exists:

```js
window.__brownsyncMap.jumpTo({ center: [-71.4030, 41.8262], zoom: 16.4, pitch: 55 })
```

Useful camera positions: the Main Green at z16.4/pitch 55 shows the material
ramp and the label tiers together; z14.5 shows the flat/extrusion crossover.

Verify continuously:

```bash
pnpm --filter @brownsync/web exec vitest run test/daylight.test.ts test/campusBuildings.test.ts test/style.test.ts
pnpm --filter @brownsync/web exec tsc --noEmit
pnpm --filter @brownsync/web e2e   # includes a perf tripwire
```

---

## Definition of done

- Light basemap, Brown-palette warm neutrals, sitting flush with the white
  chrome rather than reading as a hole in the page.
- Buildings still distinguishable by construction era, still by **hue**.
- Every contrast test green with the inequality inverted — and the *reason*
  updated in the comments, not just the numbers.
- `pnpm --filter @brownsync/web e2e` green, including the perf tripwire.
- A before/after screenshot pair at the Main Green camera above.

If you find the light basemap genuinely worse — it is a real possibility, dark
maps carry coloured pins better — **say so and stop.** Reverting is one commit
and the pairing we have now is deliberate, not accidental.
