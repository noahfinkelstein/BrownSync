/**
 * Single integration gate for specs that need sibling-lane UI (F: pins/panel,
 * G: scrubber, H: list/search).
 *
 * In-lane today: false — those specs skip with a clear reason. At integration
 * flip DEFAULT_INTEGRATED to true (or run `INTEGRATED=true pnpm e2e`).
 */
const DEFAULT_INTEGRATED = false;

export const INTEGRATED = process.env.INTEGRATED
  ? process.env.INTEGRATED === "true"
  : DEFAULT_INTEGRATED;
