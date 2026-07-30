/**
 * manifest.ts — the shared seed-bundle integrity gate.
 *
 * `db/seeds/manifest.json` is published LAST by ingestion and ties one drop's
 * artifacts together with an opaque `generation` id plus a byte length and
 * sha256 per file. Verifying it is therefore the only way to tell a coherent
 * bundle from a half-finished publish or a hand-edited artifact — a "mixed
 * generation", where places.ndjson comes from one run and events.ndjson from
 * the next, is otherwise completely silent: every line still validates.
 *
 * This module exists because that check used to live inside seed-check.ts,
 * which meant the OFFLINE QA sweep enforced it and the LOADER (seed.ts) — the
 * thing that actually writes to a database — did not. Both now call
 * `verifyManifest()`, so a bundle the sweep rejects is by construction a
 * bundle the loader refuses to touch.
 *
 * Callers decide the policy; this module only reports facts:
 * - seed-check.ts fails on a missing manifest (a published seed set must
 *   carry one, unconditionally);
 * - seed.ts fails on a missing manifest ONLY when artifacts are present —
 *   an empty db/seeds/ is a legitimate "ingestion hasn't run yet" state and
 *   must stay a green no-op.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SeedManifestSchema } from "@brownsync/contract";

/**
 * Artifacts that MUST be covered by manifest.json when they exist on disk.
 * Membership here is the claim "this file is part of the all-or-nothing
 * bundle generation"; an uncovered one is a real publish defect and warns.
 */
export const MANIFEST_ARTIFACTS = [
  "places.ndjson",
  "organizations.ndjson",
  "events.ndjson",
  "course_meetings.ndjson",
  "athletics_venues.json",
  "organization_livewhale_groups.json",
  "brown_owned_buildings.json",
  "campus_buildings.geojson",
  // Added with contract v1.2. These were publishing and hashing correctly but
  // were absent from this list, so the TS side verified 8 of 13 artifacts and
  // said nothing about the rest — a silently-truncated bundle would have read
  // as a clean PASS.
  "campus_landmarks.geojson",
  "campus_amenities.geojson",
  "dining_menus.json",
  "publications.json",
  "library_hours.json",
] as const;

/**
 * Artifacts deliberately OUTSIDE the manifest. `source_runs.ndjson` is
 * append-only run observability, not bundle content: it is written by whoever
 * ran a poll, has no fixed generation, and a hash over it would change on
 * every run. Warning about it forever (which the previous single `known[]`
 * list did, by construction) trains readers to ignore the warnings that do
 * matter, so it gets an explanatory line instead.
 */
export const UNMANAGED_ARTIFACTS = ["source_runs.ndjson"] as const;

export const UNMANAGED_REASON =
  "append-only run history, written per poll — no fixed generation to hash";

export type ManifestVerification = {
  /** A manifest exists, parses, and every artifact it lists matched bytes+sha256. */
  ok: boolean;
  /** manifest.json exists and is contract-valid. */
  present: boolean;
  /** Opaque generation id of the verified bundle; null when absent/invalid. */
  generation: string | null;
  /** How many listed artifacts matched. */
  verified: number;
  /** Managed artifacts found on disk (whether or not the manifest lists them). */
  managedPresent: string[];
  /** Deliberately-unmanaged artifacts found on disk. */
  unmanagedPresent: string[];
  /** Hard integrity violations — a bundle carrying any of these is unusable. */
  failures: string[];
  /** Coverage gaps: a managed artifact on disk that the manifest does not list. */
  warnings: string[];
};

/**
 * Where to read the bundle from. Defaults to the checked-in `db/seeds/`;
 * `BROWNSYNC_SEEDS_DIR` points both the loader and the QA sweep at another
 * directory. This exists so db/test/ can drive the REAL scripts against a
 * fixture bundle (including a deliberately tampered one) instead of testing a
 * re-implementation of their gate.
 */
export function resolveSeedsDir(defaultDir: string): string {
  const override = process.env.BROWNSYNC_SEEDS_DIR;
  return override !== undefined && override !== "" ? path.resolve(override) : defaultDir;
}

async function readIfPresent(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Verify `<seedsDir>/manifest.json` against the files next to it.
 *
 * Never throws for the expected states (absent manifest, absent artifact,
 * corrupt JSON); everything is reported through the returned record so both
 * callers can apply their own policy and print in their own style.
 */
export async function verifyManifest(seedsDir: string): Promise<ManifestVerification> {
  const failures: string[] = [];
  const warnings: string[] = [];

  const managedPresent: string[] = [];
  for (const file of MANIFEST_ARTIFACTS) {
    if ((await readIfPresent(path.join(seedsDir, file))) !== null) managedPresent.push(file);
  }
  const unmanagedPresent: string[] = [];
  for (const file of UNMANAGED_ARTIFACTS) {
    if ((await readIfPresent(path.join(seedsDir, file))) !== null) unmanagedPresent.push(file);
  }

  let rawText: Buffer | null;
  try {
    rawText = await readIfPresent(path.join(seedsDir, "manifest.json"));
  } catch (e) {
    failures.push(`manifest.json: unreadable — ${(e as Error).message}`);
    return {
      ok: false,
      present: false,
      generation: null,
      verified: 0,
      managedPresent,
      unmanagedPresent,
      failures,
      warnings,
    };
  }
  if (rawText === null) {
    return {
      ok: false,
      present: false,
      generation: null,
      verified: 0,
      managedPresent,
      unmanagedPresent,
      failures,
      warnings,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawText.toString("utf8"));
  } catch (e) {
    failures.push(`manifest.json: not valid JSON — ${(e as Error).message}`);
    return {
      ok: false,
      present: false,
      generation: null,
      verified: 0,
      managedPresent,
      unmanagedPresent,
      failures,
      warnings,
    };
  }

  const parsed = SeedManifestSchema.safeParse(raw);
  if (!parsed.success) {
    failures.push(`manifest.json: contract violation — ${parsed.error.message}`);
    return {
      ok: false,
      present: false,
      generation: null,
      verified: 0,
      managedPresent,
      unmanagedPresent,
      failures,
      warnings,
    };
  }

  let verified = 0;
  for (const [file, meta] of Object.entries(parsed.data.artifacts)) {
    let buf: Buffer | null;
    try {
      buf = await readIfPresent(path.join(seedsDir, file));
    } catch (e) {
      failures.push(`${file}: unreadable — ${(e as Error).message}`);
      continue;
    }
    if (buf === null) {
      failures.push(`manifest.json: lists ${file}, but the file is missing from db/seeds/`);
      continue;
    }
    if (buf.byteLength !== meta.bytes) {
      failures.push(`${file}: manifest says ${meta.bytes} bytes, file has ${buf.byteLength}`);
      continue;
    }
    const digest = createHash("sha256").update(buf).digest("hex");
    if (digest !== meta.sha256) {
      failures.push(`${file}: sha256 mismatch — manifest ${meta.sha256}, file ${digest}`);
      continue;
    }
    verified++;
  }

  for (const file of managedPresent) {
    if (parsed.data.artifacts[file] === undefined) {
      warnings.push(
        `manifest.json: ${file} exists in db/seeds/ but is not covered by the manifest`,
      );
    }
  }

  return {
    ok: failures.length === 0,
    present: true,
    generation: parsed.data.generation,
    verified,
    managedPresent,
    unmanagedPresent,
    failures,
    warnings,
  };
}
