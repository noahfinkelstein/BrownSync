#!/usr/bin/env node
/**
 * Bundle budget gate (handoff §2 Phase 3): the APP bundle — everything
 * except the map libs — must total ≤ 450 KB gzipped. Map libs (maplibre-gl
 * + its worker, deck.gl, react-map-gl, pmtiles) are split into `maplib-*`
 * chunks by apps/web/vite.config.ts and exempted here.
 *
 * Runs after `vite build` (wired into @brownsync/web's build script, so
 * `pnpm turbo build` and CI both enforce it). Exits 1 when the app group is
 * over budget.
 *
 * Accounting rules:
 * - JS only. CSS/fonts/tiles are reported informationally, never budgeted.
 * - All app-group JS counts — including route-lazy chunks. Budgets that only
 *   meter the entry chunk go stale the moment code moves behind an import().
 * - Sizes are gzip level 9 (what a CDN serves), reported in 1000-byte kB to
 *   match Vite's build output.
 *
 * Usage: node scripts/bundle-budget.mjs [distDir]  (default: apps/web/dist)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET_APP_GZ_BYTES = 450_000; // 450 KB gz, app group only

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
const distDir = resolve(repoRoot, process.argv[2] ?? "apps/web/dist");
const assetsDir = join(distDir, "assets");

/** maplibre-gl emits its worker as a plain asset, not a named chunk. */
const MAPLIB_FILE = /^(maplib-|maplibre-gl-worker)/;

let entries;
try {
  entries = readdirSync(assetsDir);
} catch {
  console.error(`bundle-budget: no build output at ${assetsDir} — run vite build first`);
  process.exit(1);
}

const kb = (bytes) => (bytes / 1000).toFixed(2).padStart(9);

const rows = [];
for (const name of entries.sort()) {
  if (!name.endsWith(".js") && !name.endsWith(".css")) continue;
  const path = join(assetsDir, name);
  if (!statSync(path).isFile()) continue;
  const raw = readFileSync(path);
  const gz = gzipSync(raw, { level: 9 }).length;
  const group = !name.endsWith(".js") ? "css" : MAPLIB_FILE.test(name) ? "maplib" : "app";
  rows.push({ name, raw: raw.length, gz, group });
}

if (rows.length === 0) {
  console.error(`bundle-budget: no .js chunks found in ${assetsDir}`);
  process.exit(1);
}

const total = (group) => rows.filter((r) => r.group === group).reduce((s, r) => s + r.gz, 0);

console.log("\nbundle-budget — gzip (level 9) per emitted asset\n");
console.log("  group    raw kB     gz kB  file");
for (const r of rows) {
  console.log(`  ${r.group.padEnd(6)}${kb(r.raw)}${kb(r.gz)}  ${r.name}`);
}

const appGz = total("app");
const maplibGz = total("maplib");
console.log(`\n  app JS total    ${kb(appGz)} kB gz  (budget ${kb(BUDGET_APP_GZ_BYTES)} kB)`);
console.log(`  maplib JS total ${kb(maplibGz)} kB gz  (exempt: maplibre-gl/deck.gl/react-map-gl)`);
console.log(`  css total       ${kb(total("css"))} kB gz  (informational)\n`);

if (appGz > BUDGET_APP_GZ_BYTES) {
  console.error(
    `bundle-budget: FAIL — app JS ${(appGz / 1000).toFixed(2)} kB gz exceeds the ` +
      `${BUDGET_APP_GZ_BYTES / 1000} kB budget (handoff §2 Phase 3). Split or shed weight; ` +
      "do NOT reclassify chunks as maplib unless they are actually map libraries.",
  );
  process.exit(1);
}
console.log("bundle-budget: OK");
