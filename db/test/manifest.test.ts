import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { MANIFEST_ARTIFACTS, UNMANAGED_ARTIFACTS, verifyManifest } from "../manifest";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(here, "..");

/**
 * A DATABASE_URL that cannot resolve. It is the instrument of the central
 * assertion: if the loader ever reaches the database it fails with a
 * connection error, so "the run died on the manifest gate and never mentioned
 * the database" is positive proof that zero writes were attempted.
 */
const UNREACHABLE_DB = "postgresql://postgres:postgres@127.0.0.1:1/brownsync_never";

const tempDirs: string[] = [];

function makeBundleDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "brownsync-seeds-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const PLACES_NDJSON = `${[
  {
    id: "chk-sayles-hall",
    name: "Chk Sayles Hall",
    aliases: ["Sayles"],
    kind: "academic",
    lat: 41.8262,
    lng: -71.4032,
    source: "osm",
  },
  {
    id: "chk-sharpe-refectory",
    name: "Chk Sharpe Refectory",
    aliases: ["The Ratty"],
    kind: "dining",
    lat: 41.8272,
    lng: -71.4021,
    source: "osm",
  },
]
  .map((row) => JSON.stringify(row))
  .join("\n")}\n`;

/** Write a coherent bundle: artifacts first, manifest (hashed over them) last. */
function writeBundle(
  dir: string,
  files: Record<string, string>,
  opts: { generation?: string; omitFromManifest?: readonly string[] } = {},
): void {
  const artifacts: Record<string, { bytes: number; sha256: string }> = {};
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), body);
    if (opts.omitFromManifest?.includes(name)) continue;
    const buf = Buffer.from(body);
    artifacts[name] = {
      bytes: buf.byteLength,
      sha256: createHash("sha256").update(buf).digest("hex"),
    };
  }
  writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(
      {
        schema_version: 1,
        generated_at: "2026-07-29T00:00:00Z",
        generation: opts.generation ?? "0123456789abcdef0123456789abcdef",
        artifacts,
      },
      null,
      2,
    ),
  );
}

/** Flip one byte of an already-manifested artifact — the mixed-generation shape. */
function tamper(dir: string, file: string): void {
  const body = readFileSync(path.join(dir, file), "utf8");
  writeFileSync(path.join(dir, file), body.replace("Sayles", "Saylez"));
}

type Run = { code: number; stdout: string; stderr: string };

/** The workspace-local tsx, never `npx` — CI must not reach the network here. */
const TSX = path.join(dbDir, "node_modules", ".bin", "tsx");

async function runSeedLoader(seedsDir: string): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileAsync(TSX, ["seed.ts"], {
      cwd: dbDir,
      env: {
        ...process.env,
        BROWNSYNC_SEEDS_DIR: seedsDir,
        DATABASE_URL: UNREACHABLE_DB,
      },
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

/**
 * Any sign the loader got as far as opening a connection. Matches only
 * connection-failure signatures from `postgres`/libuv — deliberately not the
 * word "database", which the gate's own refusal message contains.
 */
function touchedTheDatabase(run: Run): boolean {
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|connect ECONN|Connection|write CONNECTION/i.test(
    `${run.stdout}${run.stderr}`,
  );
}

describe("verifyManifest — bundle integrity (db/manifest.ts)", () => {
  it("verifies a coherent bundle", async () => {
    const dir = makeBundleDir();
    writeBundle(dir, { "places.ndjson": PLACES_NDJSON });

    const result = await verifyManifest(dir);
    expect(result.ok).toBe(true);
    expect(result.present).toBe(true);
    expect(result.verified).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.generation).toBe("0123456789abcdef0123456789abcdef");
  });

  it("refuses a bundle whose artifact was edited after publication", async () => {
    const dir = makeBundleDir();
    writeBundle(dir, { "places.ndjson": PLACES_NDJSON });
    tamper(dir, "places.ndjson");

    const result = await verifyManifest(dir);
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatch(/places\.ndjson: sha256 mismatch/);
  });

  it("catches a truncated artifact by byte length before hashing", async () => {
    const dir = makeBundleDir();
    writeBundle(dir, { "places.ndjson": PLACES_NDJSON });
    writeFileSync(path.join(dir, "places.ndjson"), PLACES_NDJSON.slice(0, 40));

    const result = await verifyManifest(dir);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatch(/manifest says \d+ bytes, file has 40/);
  });

  it("fails when the manifest lists an artifact that was never published", async () => {
    const dir = makeBundleDir();
    writeBundle(dir, { "places.ndjson": PLACES_NDJSON });
    rmSync(path.join(dir, "places.ndjson"));

    const result = await verifyManifest(dir);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatch(/lists places\.ndjson, but the file is missing/);
  });

  it("reports an absent manifest as not-present rather than failing", async () => {
    const result = await verifyManifest(makeBundleDir());
    expect(result.present).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([]);
    expect(result.managedPresent).toEqual([]);
  });

  it("reports which managed artifacts exist when the manifest is absent", async () => {
    const dir = makeBundleDir();
    writeFileSync(path.join(dir, "places.ndjson"), PLACES_NDJSON);

    const result = await verifyManifest(dir);
    expect(result.present).toBe(false);
    expect(result.managedPresent).toEqual(["places.ndjson"]);
  });

  it("warns — but does not fail — on a managed artifact the manifest omits", async () => {
    const dir = makeBundleDir();
    writeBundle(
      dir,
      { "places.ndjson": PLACES_NDJSON, "organizations.ndjson": "" },
      { omitFromManifest: ["organizations.ndjson"] },
    );

    const result = await verifyManifest(dir);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      "manifest.json: organizations.ndjson exists in db/seeds/ but is not covered by the manifest",
    ]);
  });

  it("never warns about source_runs.ndjson — it is unmanaged by design", async () => {
    const dir = makeBundleDir();
    writeBundle(
      dir,
      { "places.ndjson": PLACES_NDJSON, "source_runs.ndjson": "" },
      { omitFromManifest: ["source_runs.ndjson"] },
    );

    const result = await verifyManifest(dir);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.unmanagedPresent).toEqual(["source_runs.ndjson"]);
  });

  it("keeps the managed and unmanaged artifact lists disjoint", () => {
    const managed = new Set<string>(MANIFEST_ARTIFACTS);
    expect(UNMANAGED_ARTIFACTS.filter((f) => managed.has(f))).toEqual([]);
  });

  it("rejects a manifest that is not contract-shaped", async () => {
    const dir = makeBundleDir();
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ schema_version: 2 }));

    const result = await verifyManifest(dir);
    expect(result.ok).toBe(false);
    expect(result.present).toBe(false);
    expect(result.failures[0]).toMatch(/contract violation/);
  });
});

describe("seed.ts — the loader refuses a tampered bundle with zero writes", () => {
  it("stops at the gate and never opens a connection", async () => {
    const dir = makeBundleDir();
    writeBundle(dir, { "places.ndjson": PLACES_NDJSON });
    tamper(dir, "places.ndjson");

    const run = await runSeedLoader(dir);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/sha256 mismatch/);
    expect(run.stderr).toMatch(/nothing was written to the database/);
    // The database URL is unreachable on purpose: had the loader gotten past
    // the gate it would have died on the connection instead.
    expect(touchedTheDatabase(run)).toBe(false);
  }, 60_000);

  it("passes the gate on a coherent bundle and proceeds to the database", async () => {
    const dir = makeBundleDir();
    writeBundle(dir, { "places.ndjson": PLACES_NDJSON });

    const run = await runSeedLoader(dir);
    expect(run.stdout).toMatch(/manifest 0123456789abcdef0123456789abcdef: 1 artifact/);
    // Same unreachable URL — this time it IS reached, which is what proves
    // the gate let a good bundle through rather than silently no-opping.
    expect(touchedTheDatabase(run)).toBe(true);
  }, 60_000);

  it("refuses artifacts published without a manifest at all", async () => {
    const dir = makeBundleDir();
    writeFileSync(path.join(dir, "places.ndjson"), PLACES_NDJSON);

    const run = await runSeedLoader(dir);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/refusing to load an unverifiable bundle/);
    expect(touchedTheDatabase(run)).toBe(false);
  }, 60_000);

  it("does not treat an empty seeds directory as an integrity failure", async () => {
    // "ingestion hasn't published a drop yet" must stay a pass-through, not a
    // hard stop — the gate has nothing to verify and says nothing.
    const run = await runSeedLoader(makeBundleDir());
    expect(run.stderr).not.toMatch(/refusing to load an unverifiable bundle/);
    expect(run.stderr).not.toMatch(/nothing was written to the database/);
    expect(touchedTheDatabase(run)).toBe(true);
  }, 60_000);
});
