/**
 * seed-check.ts — offline QA sweep over the published db/seeds artifacts.
 *
 *   pnpm db:seed-check
 *
 * No DATABASE_URL, no network: every artifact is loaded through the SAME
 * contract schemas the seed loader (seed.ts) uses, then cross-checked:
 *
 * - manifest.json: schema-valid; every listed artifact exists with matching
 *   byte length and sha256 (a partial or tampered publish fails here);
 * - places.ndjson: schema-valid, unique ids, centroid sanity;
 * - course_meetings.ndjson: schema-valid, unique ids, start < end, every
 *   non-null place_id resolves to a place with a usable centroid
 *   (renderable on the map), and no meeting still carries the retired
 *   202710 term code (0003 reconciled Fall 2026 to 202610);
 * - athletics_venues.json sidecar: schema-valid, unique venue keys, every
 *   place_id resolves to a renderable place;
 * - events/organizations/source_runs/org-groups artifacts: validated when
 *   present (they are optional per contract §6), FK'd where possible.
 *
 * Prints a place-resolution/renderability summary; exits 1 on any failure.
 * Run by CI's offline `ci` job — and safe to run any time seeds change.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AthleticsVenuesSchema,
  OrgLivewhaleGroupsSchema,
  type SeedCourseMeeting,
  SeedCourseMeetingSchema,
  SeedEventSchema,
  SeedManifestSchema,
  SeedOrganizationSchema,
  type SeedPlace,
  SeedPlaceSchema,
  SeedSourceRunSchema,
} from "@brownsync/contract";
import { readNdjsonFile } from "./ndjson";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedsDir = path.join(here, "seeds");

/** Retired Fall 2026 guess code — reconciled to 202610 by migration 0003. */
const RETIRED_SRCDB = "202710";

/** Centroids should sit in greater Providence; outliers are almost surely bugs. */
const SANITY_BBOX = { latMin: 41.7, latMax: 41.95, lngMin: -71.6, lngMax: -71.2 };

const failures: string[] = [];
const warnings: string[] = [];
const summary: string[] = [];

const fail = (msg: string): void => {
  failures.push(msg);
};
const warn = (msg: string): void => {
  warnings.push(msg);
};

const pct = (n: number, of: number): string =>
  of === 0 ? "n/a" : `${((100 * n) / of).toFixed(1)}%`;

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path.join(seedsDir, file), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    fail(`${file}: unreadable — ${(e as Error).message}`);
    return null;
  }
}

async function checkManifest(): Promise<void> {
  const raw = await readJson("manifest.json");
  if (raw === null) {
    fail("manifest.json: missing — the published seed set must carry its manifest");
    return;
  }
  const parsed = SeedManifestSchema.safeParse(raw);
  if (!parsed.success) {
    fail(`manifest.json: contract violation — ${parsed.error.message}`);
    return;
  }
  let verified = 0;
  for (const [file, meta] of Object.entries(parsed.data.artifacts)) {
    let buf: Buffer;
    try {
      buf = await readFile(path.join(seedsDir, file));
    } catch {
      fail(`manifest.json: lists ${file}, but the file is missing from db/seeds/`);
      continue;
    }
    if (buf.byteLength !== meta.bytes) {
      fail(`${file}: manifest says ${meta.bytes} bytes, file has ${buf.byteLength}`);
      continue;
    }
    const digest = createHash("sha256").update(buf).digest("hex");
    if (digest !== meta.sha256) {
      fail(`${file}: sha256 mismatch — manifest ${meta.sha256}, file ${digest}`);
      continue;
    }
    verified++;
  }
  const known = [
    "places.ndjson",
    "organizations.ndjson",
    "events.ndjson",
    "course_meetings.ndjson",
    "source_runs.ndjson",
    "athletics_venues.json",
    "organization_livewhale_groups.json",
  ];
  for (const file of known) {
    if (parsed.data.artifacts[file] !== undefined) continue;
    if ((await readJsonExists(file)) === true) {
      warn(`manifest.json: ${file} exists in db/seeds/ but is not covered by the manifest`);
    }
  }
  summary.push(`manifest          ${verified} artifact(s) verified (bytes + sha256)`);
}

async function readJsonExists(file: string): Promise<boolean> {
  try {
    await readFile(path.join(seedsDir, file));
    return true;
  } catch {
    return false;
  }
}

function checkDuplicateIds(label: string, ids: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) fail(`${label}: duplicate id "${id}"`);
    seen.add(id);
  }
}

/** Renderable = the id resolves and the place carries a finite centroid. */
function renderablePlace(places: Map<string, SeedPlace>, placeId: string): boolean {
  const p = places.get(placeId);
  return p !== undefined && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

async function main(): Promise<void> {
  await checkManifest();

  // --- places: the gazetteer everything else FKs into --------------------
  let placeRows: SeedPlace[] | null = null;
  let placesUnreadable = false;
  try {
    placeRows = await readNdjsonFile(path.join(seedsDir, "places.ndjson"), SeedPlaceSchema);
  } catch (e) {
    fail((e as Error).message);
    placesUnreadable = true;
  }
  const places = new Map<string, SeedPlace>();
  if (placeRows === null) {
    if (!placesUnreadable) fail("places.ndjson: missing");
  } else {
    checkDuplicateIds(
      "places.ndjson",
      placeRows.map((p) => p.id),
    );
    for (const p of placeRows) places.set(p.id, p);
    let withPolygon = 0;
    let outliers = 0;
    for (const p of placeRows) {
      if (p.polygon != null) withPolygon++;
      const inBox =
        p.lat >= SANITY_BBOX.latMin &&
        p.lat <= SANITY_BBOX.latMax &&
        p.lng >= SANITY_BBOX.lngMin &&
        p.lng <= SANITY_BBOX.lngMax;
      if (!inBox) {
        outliers++;
        warn(`places.ndjson: "${p.id}" centroid (${p.lat}, ${p.lng}) outside greater Providence`);
      }
    }
    summary.push(
      `places            ${placeRows.length} rows · all with centroid · ` +
        `${withPolygon} with polygon` +
        (outliers > 0 ? ` · ${outliers} centroid outlier(s)` : ""),
    );
  }

  // --- course meetings: FKs + renderability + term-code guard ------------
  let meetings: SeedCourseMeeting[] | null = null;
  let meetingsUnreadable = false;
  try {
    meetings = await readNdjsonFile(
      path.join(seedsDir, "course_meetings.ndjson"),
      SeedCourseMeetingSchema,
    );
  } catch (e) {
    fail((e as Error).message);
    meetingsUnreadable = true;
  }
  if (meetings === null) {
    if (!meetingsUnreadable) fail("course_meetings.ndjson: missing");
  } else {
    checkDuplicateIds(
      "course_meetings.ndjson",
      meetings.map((m) => m.id),
    );
    const srcdbs = new Map<string, number>();
    const unresolved = new Map<string, number>();
    let resolved = 0;
    let renderable = 0;
    for (const m of meetings) {
      srcdbs.set(m.srcdb, (srcdbs.get(m.srcdb) ?? 0) + 1);
      if (m.start_time >= m.end_time) {
        fail(
          `course_meetings.ndjson: "${m.id}" start_time ${m.start_time} >= end_time ${m.end_time}`,
        );
      }
      if (m.place_id != null) {
        resolved++;
        if (!places.has(m.place_id)) {
          fail(`course_meetings.ndjson: "${m.id}" place_id "${m.place_id}" not in places.ndjson`);
        } else if (renderablePlace(places, m.place_id)) {
          renderable++;
        } else {
          fail(`course_meetings.ndjson: "${m.id}" place "${m.place_id}" has no usable centroid`);
        }
      } else {
        const key = m.location_raw ?? "(no location_raw)";
        unresolved.set(key, (unresolved.get(key) ?? 0) + 1);
      }
    }
    if (srcdbs.has(RETIRED_SRCDB)) {
      fail(
        `course_meetings.ndjson: ${srcdbs.get(RETIRED_SRCDB)} row(s) still carry retired ` +
          `srcdb ${RETIRED_SRCDB} — Fall 2026 is 202610 (migration 0003)`,
      );
    }
    const total = meetings.length;
    summary.push(
      `course_meetings   ${total} rows · srcdb {${[...srcdbs.keys()].sort().join(", ")}} · ` +
        `place_id resolved ${resolved} (${pct(resolved, total)}) · ` +
        `renderable ${renderable} (${pct(renderable, total)})`,
    );
    const top = [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top.length > 0) {
      summary.push(
        `                  unresolved location_raw top: ${top
          .map(([loc, n]) => `${JSON.stringify(loc)} ×${n}`)
          .join(", ")}`,
      );
    }
  }

  // --- athletics venue sidecar: FKs into the gazetteer -------------------
  const venuesRaw = await readJson("athletics_venues.json");
  if (venuesRaw === null) {
    warn("athletics_venues.json: absent (tolerated per contract, athletics stays unresolved)");
  } else {
    const parsed = AthleticsVenuesSchema.safeParse(venuesRaw);
    if (!parsed.success) {
      fail(`athletics_venues.json: contract violation — ${parsed.error.message}`);
    } else {
      checkDuplicateIds(
        "athletics_venues.json",
        parsed.data.mappings.map((m) => m.source_name.toLowerCase()),
      );
      let ok = 0;
      for (const m of parsed.data.mappings) {
        if (!places.has(m.place_id)) {
          fail(
            `athletics_venues.json: "${m.source_name}" -> place_id "${m.place_id}" ` +
              "not in places.ndjson",
          );
        } else if (renderablePlace(places, m.place_id)) {
          ok++;
        } else {
          fail(`athletics_venues.json: place "${m.place_id}" has no usable centroid`);
        }
      }
      summary.push(
        `athletics_venues  ${parsed.data.mappings.length} mapping(s) · ${ok} resolved to renderable places`,
      );
    }
  }

  // --- optional artifacts: validate when present -------------------------
  let orgIds: Set<string> | null = null;
  try {
    const orgs = await readNdjsonFile(
      path.join(seedsDir, "organizations.ndjson"),
      SeedOrganizationSchema,
    );
    if (orgs === null) {
      summary.push("organizations     absent — skipped (optional)");
    } else {
      checkDuplicateIds(
        "organizations.ndjson",
        orgs.map((o) => o.id),
      );
      orgIds = new Set(orgs.map((o) => o.id));
      let dangling = 0;
      for (const o of orgs) {
        if (o.default_place_id != null && !places.has(o.default_place_id)) {
          dangling++;
          warn(
            `organizations.ndjson: "${o.id}" default_place_id "${o.default_place_id}" ` +
              "not in places.ndjson (loader nulls it)",
          );
        }
      }
      summary.push(
        `organizations     ${orgs.length} rows` +
          (dangling > 0 ? ` · ${dangling} dangling place ref(s)` : ""),
      );
    }
  } catch (e) {
    fail((e as Error).message);
  }

  try {
    const events = await readNdjsonFile(path.join(seedsDir, "events.ndjson"), SeedEventSchema);
    if (events === null) {
      summary.push("events            absent — skipped (optional)");
    } else {
      let withCoords = 0;
      let danglingPlace = 0;
      let danglingOrg = 0;
      for (const e of events) {
        if (e.lat != null && e.lng != null) withCoords++;
        if (e.place_id != null && !places.has(e.place_id)) danglingPlace++;
        if (orgIds !== null && e.org_id != null && !orgIds.has(e.org_id)) danglingOrg++;
      }
      if (danglingPlace > 0)
        warn(`events.ndjson: ${danglingPlace} dangling place ref(s) (loader nulls them)`);
      if (danglingOrg > 0)
        warn(`events.ndjson: ${danglingOrg} dangling org ref(s) (loader nulls them)`);
      summary.push(
        `events            ${events.length} rows · ${withCoords} with coords (${pct(withCoords, events.length)})`,
      );
    }
  } catch (e) {
    fail((e as Error).message);
  }

  try {
    const runs = await readNdjsonFile(
      path.join(seedsDir, "source_runs.ndjson"),
      SeedSourceRunSchema,
    );
    summary.push(
      runs === null
        ? "source_runs       absent — skipped (optional)"
        : `source_runs       ${runs.length} rows valid`,
    );
  } catch (e) {
    fail((e as Error).message);
  }

  const groupsRaw = await readJson("organization_livewhale_groups.json");
  if (groupsRaw !== null) {
    const parsed = OrgLivewhaleGroupsSchema.safeParse(groupsRaw);
    if (!parsed.success) {
      fail(`organization_livewhale_groups.json: contract violation — ${parsed.error.message}`);
    } else if (orgIds !== null) {
      for (const m of parsed.data.mappings) {
        if (!orgIds.has(m.organization_id)) {
          fail(
            `organization_livewhale_groups.json: organization_id "${m.organization_id}" ` +
              "not in organizations.ndjson",
          );
        }
      }
    }
  }

  // --- report ------------------------------------------------------------
  console.log("seed-check: db/seeds QA (offline)\n");
  for (const line of summary) console.log(line);
  if (warnings.length > 0) {
    console.log("");
    for (const w of warnings) console.warn(`warn: ${w}`);
  }
  if (failures.length > 0) {
    console.log("");
    for (const f of failures) console.error(`FAIL: ${f}`);
    console.error(`\nFAIL — ${failures.length} failure(s), ${warnings.length} warning(s)`);
    process.exit(1);
  }
  console.log(`\nPASS — 0 failures, ${warnings.length} warning(s)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
