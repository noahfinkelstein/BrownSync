import { isSource, SOURCES } from "./sources";

const source = process.argv[2];

if (!source || !isSource(source)) {
  console.error(`usage: pnpm poll <${SOURCES.join("|")}>`);
  process.exit(2);
}

// Phase 1 agent B replaces this with fetch → Zod-parse → normalize → upsert.
console.log(`poller "${source}" not implemented yet (lands in Phase 1)`);
process.exit(0);
