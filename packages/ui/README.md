# @brownsync/ui

Single responsibility: the BrownSync design system — the §6 design law as code.
Tokens as CSS + Tailwind v4 theme, re-themed Radix primitives, the 10 hand-drawn
category glyphs (DOM sprite + MapLibre `addImage` variants), and the `/dev/ui`
gallery. Canonical token *values* live in `@brownsync/contract`; this package
renders them and `src/tokens.test.ts` fails if the two drift.

## Usage

```ts
// once, as the app stylesheet (pulls in Tailwind v4 + both fonts):
import "@brownsync/ui/styles.css";

import { Button, Chip, Panel, Scrubber, TimelineRow, CategoryIcon,
         buildMapImages, mapIconId } from "@brownsync/ui";
```

`styles.css` registers every token twice:

- **Plain custom properties** on `:root` for non-Tailwind consumers (map
  `style.json` build, deck.gl layers): `--bg-base`, `--line`, `--accent`,
  `--cat-academic` … `--cat-admin`, `--map-road/-water/-green`,
  `--motion-fast/-slow`, `--radius-max`.
- **Tailwind theme values**, so the web app gets utilities: `bg-bg-base`,
  `bg-bg-raised`, `bg-bg-overlay`, `border-line`, `text-text-primary`,
  `text-accent`, `bg-cat-club`, `font-display`, `font-mono`, `text-12…text-24`,
  `rounded-2/4/6`.

The stock Tailwind palette, font sizes, fonts, and radii are **deleted**
(`--color-*: initial` etc.) — if a class like `text-slate-400`, `text-sm`, or
`rounded-xl` compiles to nothing, that is the design law working.

## §6 rules each piece enforces

| Piece | Enforced law |
|---|---|
| `styles.css` | One dark theme; type scale 12/13/15/18/24 only; radius utilities capped at 6px; no gradients; accent exists once |
| `Button` | `primary` is the **only** accent surface; ghost/subtle for everything else; no `cursor: not-allowed` |
| `Chip` | Category dot uses the contract color token; toggle state via `aria-pressed` |
| `Badge` / `SourceBadge` / `ConfidenceDot` | Provenance visible: mono source name + dot opacity = confidence (§6.4) |
| `Panel` | Carries the app's **only** shadow (1px line + ambient); 120–160 ms ease-out slide; non-modal so the map stays live |
| `DataTable` / `TimelineRow` | Tables and timelines over cards; dense by default, `density="comfortable"` opt-out; mono timestamps |
| `Scrubber` | Thin track, precise thumb, tick marks; the NOW marker is the only accent element |
| `Skeleton` | Shimmerless opacity pulse; `SkeletonRows` for timeline placeholders |
| `EmptyState` | Designed empty/error states with real copy + action — never a bare spinner |
| `StatusDot` | `/health` strip: ok/stale/error with mono staleness readout |
| `SegmentedControl` / `SearchInput` / `Kbd` / `IconButton` | Full keyboard support; every interactive element shares the 1px accent `:focus-visible` ring (`FOCUS_RING`) |

## Icons

10 bespoke glyphs (`src/icons/paths.ts`): 16px grid, 1.5px stroke, squared
terminals, miter joins, `currentColor` — one geometric family, not lucide.

- `<CategoryIcon category="club" size={16|24|32} />` — inline React.
- `buildSpriteSheet()` — hidden `<svg>` of `<symbol id="icon-club">…`; inject once,
  reference with `<use href="#icon-club"/>`.
- `buildMapImages(size, colorHex?)` — OffscreenCanvas → `ImageData` per category,
  white-on-transparent. Register with
  `map.addImage(mapIconId(cat), img, { sdf: true, pixelRatio })` so the style can
  tint/halo; render at 2–4× display size.

## Gallery

```bash
pnpm --filter @brownsync/ui dev     # standalone vite app on the bg stack
pnpm --filter @brownsync/ui build   # static build → dist/gallery (CI artifact)
```

Every component in every state and density, the icon set at 16/24/32, and the
full token sheet — grouped under mono section labels. Mounted as `/dev/ui` in
Phase 2.

## Tests

`vitest run`: token CSS ↔ contract sync (parses `styles.css`), icon-family
invariants (taxonomy coverage, grid bounds, sprite output).
