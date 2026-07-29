# @brownsync/contract

Single responsibility: the TypeScript rendering of `DATA_CONTRACT.md` — Zod schemas for the
read-API shapes (§3) and NDJSON seed rows (§1/§6), the fixed category taxonomy (§4), and the
design tokens (handoff §6.1). Everything that crosses a boundary validates against this
package. Changing anything here that mirrors the contract requires a contract version bump
in the same PR.

Also here: schemas for the ingestion-lane sidecar files that ride alongside the §6 seeds
(`organization_livewhale_groups.json`, `athletics_venues.json`) and for the artifact
manifest ingestion publishes at `db/seeds/manifest.json` (`SeedManifestSchema` — bytes +
sha256 per artifact, verified offline by `pnpm db:seed-check`). These mirror files the
ingestion workstream already emits; shape changes are coordinated with that lane, not made
unilaterally.
