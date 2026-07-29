# `src/ops/states` — designed async states (§6.4)

Every async region gets a designed skeleton / empty / error state with real
copy — never a bare spinner, never "no data". This directory is the shared
library; lanes adopt it instead of hand-rolling.

## Adoption map (integration)

| Lane / region | Loading | Empty | Error |
|---|---|---|---|
| F — map event layer refetch | keep last GeoJSON (no skeleton over the map) | `<EmptyEvents onWidenWindow={…}/>` floated bottom-center when 0 pins in viewport | `<ErrorState what="events" bordered keptLastGood onRetry={…}/>` floated |
| F — detail panel | `<PanelSkeleton/>` as panel body | — | `<ErrorState what="the event" onRetry={…}/>` |
| G — time scrubber | scrubber renders immediately; layers keep last data while refiltering | — | — |
| H — viewport-synced list | `<ListSkeleton/>` | `<EmptyEvents onWidenWindow={…}/>` | `<ErrorState what="events" onRetry={…}/>` |
| H — ⌘K palette results | `<ListSkeleton groups={1} rowsPerGroup={3}/>` | `<EmptySearch query={q} onClear={…}/>` | `<ErrorState what="search" onRetry={…}/>` |
| H — place page timeline | `<ListSkeleton/>` | `<EmptyPlaceDay placeName={…} onShowWeek={…}/>` | `<ErrorState what="this place" onRetry={…}/>` |
| I — health strip | built in | built in | built in |

## Rules

- Import from `../states` (or `src/ops` barrel) — do not copy the JSX.
- Action buttons appear only when you pass a handler; never render a dead
  button. No `cursor: not-allowed` dead ends (§6.4).
- `ErrorState` gets `keptLastGood` when stale data is still visible behind
  it, and `bordered` only when it floats over the map.
- These components use ui-package tokens exclusively. If a state needs a new
  color/size, that's a `packages/ui` change, not a local override.

## Tailwind note

The class names in `src/ops/**` compile only if the app stylesheet scans this
directory. The integrated `apps/web` stylesheet must import the ui tokens and
add a source scan, e.g.:

```css
@import "@brownsync/ui/styles.css";
@source "../";
```

(The e2e harness at `e2e/harness/harness.css` already does exactly this and
is the reference.)
