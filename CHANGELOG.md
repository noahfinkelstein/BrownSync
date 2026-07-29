# Changelog

All notable changes to BrownSync are documented here, one entry per merged PR
(date = merge date). The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Everything below is staged for the `v0.1.0` tag once Phase 3 hardening lands.

### Added

- **Phase 0 — monorepo foundation** ([#1], 2026-07-28): pnpm + Turborepo + Biome
  workspace, `db/migrations/0001_init.sql` mirroring contract §1 verbatim, local
  Supabase config, the NDJSON seed loader, `@brownsync/contract` (Zod schemas,
  category taxonomy, design-token values), CI skeleton, and empty web/api/poller
  packages that build green.
- **Phase 1D — design system** ([#2], 2026-07-28): the §6 design law as code —
  tokens as CSS + Tailwind v4 theme (stock palette/sizes/radii deleted), ten bespoke
  16 px category glyphs (DOM sprite + MapLibre `addImage` builds), re-themed Radix
  primitives, and the `/dev/ui` gallery.
- **Phase 1A — basemap & map shell** ([#3], 2026-07-28): committed 4.7 MB Providence
  PMTiles extract with its reproduction script (`scripts/basemap-extract.sh`), the
  near-monochrome dark `map/style.json` (§6.3 cartography), and the 2.5D
  `fill-extrusion` campus map bounds-locked to College Hill.
- **Phase 1C — read API** ([#4], 2026-07-28): Hono + zod-openapi routes for every
  contract §3 endpoint over the additive SQL layer in `db/migrations/0002_api.sql`
  (`term_calendar`, canonical-events view, `api_*` functions), the
  `{ error: { code, message } }` envelope, and the committed
  `packages/contract/openapi.json` for future Swift codegen.
- **Phase 1B — pollers** ([#5], 2026-07-28): one-shot TS pollers for LiveWhale JSON,
  athletics ICS, and BDH RSS — polite HTTP (declared UA, ≥ 1 s/host, ETags, backoff),
  contract §2 upserts, the cancellation sweep with truncated-fetch guard,
  `source_runs` logging, and recorded real-response fixtures so tests never touch the
  network.
- **Phase 2 — the product** ([#6], 2026-07-29): live map view (GPU event layers with
  clustering, class-activity building fill, the ≤ 30-min deck.gl pulse, hover cards,
  detail panel), time machine (URL-synced `useTimeCursor` store, scrubber, presets),
  browse & search (⌘K palette, viewport-synced split-pane list, `/p/:id` and `/o/:id`
  profile pages, category chips), and ops polish (health status strip, designed
  skeleton/empty/error states, PWA manifest + OG metadata, gated PostHog analytics,
  hermetic Playwright e2e). Includes the MSW + fixture dataset powering
  `VITE_USE_FIXTURES=1` zero-backend mode.
- **Ingestion lane, tasks 1–10** ([#7], 2026-07-29): the Python 3.12 `ingest/`
  package — strict contract models, cached polite HTTP client + resumable
  checkpoints, Postgres repository, hash-pinned recorded fixtures with an integrity
  gate, the OSM/curated campus gazetteer and fail-closed place resolver, CAB Fall
  2026 course meetings parsed from the hash-pinned user-provided export (live CAB
  sits behind an AWS WAF challenge), the athletics venue sidecar, the Typer CLI, and
  the atomically-published seed bundle: 166 places, 1,755 course meetings (94%
  place-resolved), `manifest.json` with per-artifact SHA-256. Clubs/dining remain
  documented blocks (Pantheon edge 403 to the declared UA).

### Fixed

- **Athletics sidecar v1 consumption** ([#8], 2026-07-29): the poller parsed
  `db/seeds/athletics_venues.json` as an obsolete flat map and threw on the real
  ingestion-emitted v1 envelope. Now pins `AthleticsVenuesSchema`
  (`schema_version: z.literal(1)`) in `@brownsync/contract`, resolves venues over
  `mappings[]`, mirrors the real file as a poller fixture, and covers both sidecar
  worlds (absent / present) in consumer tests.

[Unreleased]: https://github.com/noahfinkelstein/BrownSync/commits/main
[#1]: https://github.com/noahfinkelstein/BrownSync/pull/1
[#2]: https://github.com/noahfinkelstein/BrownSync/pull/2
[#3]: https://github.com/noahfinkelstein/BrownSync/pull/3
[#4]: https://github.com/noahfinkelstein/BrownSync/pull/4
[#5]: https://github.com/noahfinkelstein/BrownSync/pull/5
[#6]: https://github.com/noahfinkelstein/BrownSync/pull/6
[#7]: https://github.com/noahfinkelstein/BrownSync/pull/7
[#8]: https://github.com/noahfinkelstein/BrownSync/pull/8
