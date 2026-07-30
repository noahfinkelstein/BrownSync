/**
 * seed-check.ts — offline QA sweep over the published db/seeds artifacts.
 *
 *   pnpm db:seed-check
 *
 * No DATABASE_URL, no network: every artifact is loaded through the SAME
 * contract schemas the seed loader (seed.ts) uses, then cross-checked:
 *
 * - manifest.json: schema-valid; every listed artifact exists with matching
 *   byte length and sha256 (a partial or tampered publish fails here) — the
 *   verification itself lives in db/manifest.ts and is shared with the
 *   LOADER (seed.ts), so a bundle this sweep rejects is by construction a
 *   bundle the loader refuses to write;
 * - places.ndjson: schema-valid, unique ids, centroid sanity;
 * - course_meetings.ndjson: schema-valid, unique ids, start < end, every
 *   non-null place_id resolves to a place with a usable centroid
 *   (renderable on the map), and no meeting still carries the retired
 *   202710 term code (0003 reconciled Fall 2026 to 202610);
 * - athletics_venues.json sidecar: schema-valid, unique venue keys, every
 *   place_id resolves to a renderable place;
 * - organizations.ndjson: loader org schema, unique ids, default_place_id
 *   FK'd into the gazetteer (dangling refs warn — the loader nulls them);
 * - events.ndjson: schema-valid; place_id/org_id FKs, where present, MUST
 *   resolve; rows with coords are counted against the >=300 DoD gate;
 * - organization_livewhale_groups.json sidecar: schema-valid, org FKs; an
 *   EMPTY mappings array passes with a note (the events-bootstrap drop
 *   proved the LiveWhale publisher groups are departments, not student
 *   orgs — empty is the expected steady state, not a producer bug);
 * - brown_owned_buildings.json sidecar (register §5 consumer pin):
 *   schema-valid incl. the ODbL attribution key, unique way ids/slugs,
 *   every place_id resolves into places.ndjson;
 * - source_runs.ndjson: validated when present (optional per contract §6).
 *
 * Prints a place-resolution/renderability summary; exits 1 on any failure.
 * Run by CI's offline `ci` job — and safe to run any time seeds change.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AthleticsVenuesSchema,
  BrownOwnedBuildingsSchema,
  OrgLivewhaleGroupsSchema,
  type SeedCourseMeeting,
  SeedCourseMeetingSchema,
  SeedEventSchema,
  SeedOrganizationSchema,
  type SeedPlace,
  SeedPlaceSchema,
  SeedSourceRunSchema,
} from "@brownsync/contract";
import { resolveSeedsDir, UNMANAGED_REASON, verifyManifest } from "./manifest";
import { readNdjsonFile } from "./ndjson";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedsDir = resolveSeedsDir(path.join(here, "seeds"));

/** Retired Fall 2026 guess code — reconciled to 202610 by migration 0003. */
const RETIRED_SRCDB = "202710";

/** DoD gate: the published events seed must carry at least this many mappable rows. */
const EVENTS_COORDS_DOD_MIN = 300;

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
  const result = await verifyManifest(seedsDir);
  if (!result.present && result.failures.length === 0) {
    fail("manifest.json: missing — the published seed set must carry its manifest");
    return;
  }
  for (const f of result.failures) fail(f);
  // Coverage gaps are warnings, never failures: a managed artifact the
  // manifest does not list is a publish defect worth surfacing, but the rows
  // themselves are still contract-checked below.
  for (const w of result.warnings) warn(w);
  if (!result.present) return;
  summary.push(`manifest          ${result.verified} artifact(s) verified (bytes + sha256)`);
  // Unmanaged artifacts get an explanatory line rather than a warning. See
  // db/manifest.ts UNMANAGED_ARTIFACTS: warning about a file that can never
  // be in the manifest is noise by construction, and noise is how real
  // warnings get ignored.
  for (const file of result.unmanagedPresent) {
    summary.push(`                  ${file} present, unmanaged by design — ${UNMANAGED_REASON}`);
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
        // FKs are hard requirements: org_id/place_id may be null, but a
        // non-null ref that resolves nowhere is a broken publish, not noise.
        if (e.place_id != null && !places.has(e.place_id)) {
          danglingPlace++;
          fail(
            `events.ndjson: "${e.source}:${e.source_id}" place_id "${e.place_id}" ` +
              "not in places.ndjson",
          );
        }
        if (orgIds !== null && e.org_id != null && !orgIds.has(e.org_id)) {
          danglingOrg++;
          fail(
            `events.ndjson: "${e.source}:${e.source_id}" org_id "${e.org_id}" ` +
              "not in organizations.ndjson",
          );
        }
      }
      if (withCoords < EVENTS_COORDS_DOD_MIN) {
        fail(
          `events.ndjson: only ${withCoords} row(s) carry coords — ` +
            `below the >=${EVENTS_COORDS_DOD_MIN} mappable-events DoD gate`,
        );
      }
      summary.push(
        `events            ${events.length} rows · ${withCoords} with coords ` +
          `(${pct(withCoords, events.length)}) · DoD gate >=${EVENTS_COORDS_DOD_MIN}: ` +
          `${withCoords >= EVENTS_COORDS_DOD_MIN ? "pass" : "FAIL"}` +
          (danglingPlace + danglingOrg > 0
            ? ` · ${danglingPlace + danglingOrg} dangling ref(s)`
            : ""),
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
  if (groupsRaw === null) {
    summary.push("org_lw_groups     absent — skipped (optional)");
  } else {
    const parsed = OrgLivewhaleGroupsSchema.safeParse(groupsRaw);
    if (!parsed.success) {
      fail(`organization_livewhale_groups.json: contract violation — ${parsed.error.message}`);
    } else if (parsed.data.mappings.length === 0) {
      // Legitimately empty: the events-bootstrap drop proved the LiveWhale
      // publisher groups are departments, not student orgs — nothing to map.
      summary.push(
        "org_lw_groups     0 mappings — empty is expected (LiveWhale groups are departments)",
      );
    } else {
      if (orgIds !== null) {
        for (const m of parsed.data.mappings) {
          if (!orgIds.has(m.organization_id)) {
            fail(
              `organization_livewhale_groups.json: organization_id "${m.organization_id}" ` +
                "not in organizations.ndjson",
            );
          }
        }
      }
      summary.push(`org_lw_groups     ${parsed.data.mappings.length} mapping(s) validated`);
    }
  }

  // --- Brown-owned buildings sidecar: the register §5 consumer pin -------
  const buildingsRaw = await readJson("brown_owned_buildings.json");
  if (buildingsRaw === null) {
    warn("brown_owned_buildings.json: absent (tolerated per contract; map tint stays off)");
  } else {
    const parsed = BrownOwnedBuildingsSchema.safeParse(buildingsRaw);
    if (!parsed.success) {
      fail(`brown_owned_buildings.json: contract violation — ${parsed.error.message}`);
    } else {
      checkDuplicateIds("brown_owned_buildings.json place_ids", parsed.data.place_ids);
      const seenWays = new Set<number>();
      for (const w of parsed.data.osm_way_ids) {
        if (seenWays.has(w)) fail(`brown_owned_buildings.json: duplicate osm_way_id ${w}`);
        seenWays.add(w);
      }
      let renderable = 0;
      for (const pid of parsed.data.place_ids) {
        if (!places.has(pid)) {
          fail(`brown_owned_buildings.json: place_id "${pid}" not in places.ndjson`);
        } else if (renderablePlace(places, pid)) {
          renderable++;
        }
      }
      summary.push(
        `brown_owned_bldgs ${parsed.data.osm_way_ids.length} way id(s) · ` +
          `${parsed.data.place_ids.length} place slug(s) (${renderable} renderable)`,
      );
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
