/**
 * Single integration gate for specs that need sibling-lane UI (F: pins/panel,
 * G: scrubber, H: list/search).
 *
 * Phase 2 integration landed: the composed app is the default. `INTEGRATED=false
 * pnpm e2e` still runs the in-lane subset alone.
 */
const DEFAULT_INTEGRATED = true;

export const INTEGRATED = process.env.INTEGRATED
  ? process.env.INTEGRATED === "true"
  : DEFAULT_INTEGRATED;
