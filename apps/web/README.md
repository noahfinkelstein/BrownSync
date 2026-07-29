# @brownsync/web

Single responsibility: the map client — MapLibre 2.5D campus map, time machine, browse/search,
place and org pages. Talks ONLY to the read API (`DATA_CONTRACT.md` §3); never to Brown's
servers directly.

## Canonical origin (`VITE_CANONICAL_ORIGIN`)

Social scrapers require **absolute** `og:image` / `twitter:image` URLs. Production builds must
set `VITE_CANONICAL_ORIGIN` to the public origin — scheme + host only, no trailing slash:

```
VITE_CANONICAL_ORIGIN=https://brownsync.pages.dev
```

A build-time HTML transform in `vite.config.ts` (`brownsync:canonical-og`, exercised by
`test/og-canonical.test.ts`) prefixes the root-relative image tags in `index.html` at
`vite build`. Unset, the tags stay site-relative — fine for dev/preview, wrong for prod.

## Accessibility

- `test/a11y-contrast.test.ts` pins every §6.1 token pairing used for text to WCAG AA
  (4.5:1 — the 12 px mono tier counts as normal-size text). `--text-faint` fails AA on every
  background (≈3:1 on `--bg-base`) and is therefore **banned for text** in this app: borders,
  tick marks, and aria-hidden ornaments only. The same test scans `src/` for regressions.
- `e2e/a11y.e2e.ts` walks the whole journey keyboard-only: ⌘K palette (focus trap + restore),
  chip and list roving focus (`src/browse/rovingFocus.ts`), Escape-to-close on the detail
  panel with focus return, scrubber arrow keys, and the place mini-map click-through.
