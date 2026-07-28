import path from "node:path";
import { fileURLToPath } from "node:url";

/** services/poller/ — resolved from this module, not cwd, so the CLI works from anywhere. */
export const POLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Repo root (two levels above services/poller). */
export const REPO_ROOT = path.resolve(POLLER_ROOT, "../..");

/** Recorded real responses used by tests and `--fixture` replay. */
export const FIXTURES_DIR = path.join(POLLER_ROOT, "fixtures");

/**
 * Codex-owned NDJSON/JSON seed drop zone (DATA_CONTRACT §6). This package only
 * ever READS sidecar files from here (org→LiveWhale-group map, athletics venue
 * map) — it never writes.
 */
export const SEEDS_DIR = path.join(REPO_ROOT, "db", "seeds");
