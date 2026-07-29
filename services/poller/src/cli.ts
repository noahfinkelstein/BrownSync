import path from "node:path";
import { runDedupJob } from "./dedup";
import { createHttpClient } from "./http";
import { FIXTURES_DIR } from "./paths";
import { MODULES, type RunResult, runSource } from "./runner";
import { isSource, SOURCES, type Source } from "./sources";
import type { SourceModule } from "./types";

/**
 * pnpm poll <livewhale|athletics|bdh|all|dedup> [--dry-run] [--fixture[=path]]
 *
 * --dry-run   fetch (or replay a fixture), print normalized rows as NDJSON on
 *             stdout + a summary on stderr; never touches the database.
 *             (For `dedup` the candidates live in the DB, so --dry-run still
 *             reads DATABASE_URL — but writes nothing.)
 * --fixture   replay the recorded response in fixtures/ instead of fetching;
 *             pass a path (--fixture=path/to/file) to replay something else.
 *
 * Default mode connects to DATABASE_URL and upserts per contract §2. `dedup`
 * is the cross-source duplicate-marking job (src/dedup/) — not a feed.
 */

function usage(): never {
  console.error(`usage: pnpm poll <${SOURCES.join("|")}|all|dedup> [--dry-run] [--fixture[=path]]`);
  process.exit(2);
}

const args = process.argv.slice(2);
let target: Source | "all" | "dedup" | null = null;
let dryRun = false;
/** undefined = fetch live; null = default fixture; string = explicit path. */
let fixture: string | null | undefined;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === undefined) continue;
  if (arg === "--dry-run") {
    dryRun = true;
  } else if (arg === "--fixture") {
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--") && !isSource(next) && next !== "all") {
      fixture = next;
      i++;
    } else {
      fixture = null;
    }
  } else if (arg.startsWith("--fixture=")) {
    fixture = arg.slice("--fixture=".length);
  } else if (arg === "all" || arg === "dedup" || isSource(arg)) {
    if (target !== null) usage();
    target = arg;
  } else {
    usage();
  }
}

if (target === null) usage();
if (typeof fixture === "string" && target === "all") {
  console.error("--fixture=<path> only makes sense with a single source");
  process.exit(2);
}

if (target === "dedup") {
  if (fixture !== undefined) {
    console.error("dedup has no fixture mode — it reads candidates from the database");
    process.exit(2);
  }
  const result = await runDedupJob({ dryRun });
  process.exit(result.status === "error" ? 1 : 0);
}

function fixturePath(mod: SourceModule): string | null {
  if (fixture === undefined) return null;
  if (fixture === null) return path.join(FIXTURES_DIR, mod.defaultFixture);
  return path.resolve(fixture);
}

const sources: Source[] = target === "all" ? [...SOURCES] : [target];
const client = createHttpClient();
const results: RunResult[] = [];

for (const source of sources) {
  const mod = MODULES[source];
  results.push(await runSource(mod, { dryRun, fixturePath: fixturePath(mod) }, client));
}

for (const r of results) {
  const tag = r.status === "error" ? "ERR " : r.status === "partial" ? "PART" : "ok  ";
  console.error(`${tag} ${r.source}: ${r.items} items`);
}
process.exit(results.some((r) => r.status === "error") ? 1 : 0);
