/**
 * NDJSON seed loader — DATA_CONTRACT.md §6.
 *
 * Reads db/seeds/{places,organizations,events,course_meetings,source_runs}.ndjson
 * (each optional), validates EVERY line against @brownsync/contract seed
 * schemas, then upserts into Postgres with contract §2 semantics. Any invalid
 * line aborts before the DB is touched — half-valid seeds never load.
 *
 * BEFORE any of that, db/seeds/manifest.json is verified (db/manifest.ts):
 * every listed artifact must match its published byte length and sha256. A
 * mixed generation — places.ndjson from one ingestion run, events.ndjson from
 * the next — is otherwise completely silent, because every line still
 * validates; only the hashes disagree. Failing here means zero writes.
 *
 *   DATABASE_URL=postgres://... pnpm db:seed
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SeedCourseMeetingSchema,
  SeedEventSchema,
  SeedOrganizationSchema,
  SeedPlaceSchema,
  SeedSourceRunSchema,
} from "@brownsync/contract";
import postgres from "postgres";
import type { z } from "zod";
import { resolveSeedsDir, verifyManifest } from "./manifest";
import { readNdjsonFile } from "./ndjson";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedsDir = resolveSeedsDir(path.join(here, "seeds"));

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** Null when the seed is not produced yet — ingestion runs on its own clock. */
function readNdjson<S extends z.ZodType>(file: string, schema: S): Promise<z.infer<S>[] | null> {
  return readNdjsonFile(path.join(seedsDir, file), schema);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Bundle integrity gate — runs before a single NDJSON byte is read and long
 * before a connection is opened. Exits 1 on any integrity failure, so a
 * tampered or half-published bundle can never partially load.
 *
 * A missing manifest is fatal ONLY when artifacts are actually present: an
 * empty db/seeds/ is the legitimate "ingestion hasn't produced a drop yet"
 * state and must stay a green no-op, exactly as before.
 */
async function assertBundleIntegrity(): Promise<void> {
  const result = await verifyManifest(seedsDir);
  if (!result.present) {
    if (result.failures.length === 0 && result.managedPresent.length === 0) return;
    for (const f of result.failures) console.error(`FAIL: ${f}`);
    if (result.failures.length === 0) {
      console.error(
        `FAIL: manifest.json: missing from ${seedsDir}, but ` +
          `${result.managedPresent.length} seed artifact(s) are present ` +
          `(${result.managedPresent.join(", ")}) — refusing to load an unverifiable bundle`,
      );
    }
    console.error("nothing was written to the database");
    process.exit(1);
  }
  if (!result.ok) {
    for (const f of result.failures) console.error(`FAIL: ${f}`);
    console.error(
      `manifest generation ${result.generation} did not verify — ` +
        "nothing was written to the database",
    );
    process.exit(1);
  }
  for (const w of result.warnings) console.warn(`warn: ${w}`);
  console.log(
    `manifest ${result.generation}: ${result.verified} artifact(s) verified (bytes + sha256)`,
  );
}

async function main() {
  // Integrity first: a mixed generation must cost zero writes.
  await assertBundleIntegrity();

  // Validate everything up front, before any DB write.
  const [places, orgs, events, meetings, runs] = await Promise.all([
    readNdjson("places.ndjson", SeedPlaceSchema),
    readNdjson("organizations.ndjson", SeedOrganizationSchema),
    readNdjson("events.ndjson", SeedEventSchema),
    readNdjson("course_meetings.ndjson", SeedCourseMeetingSchema),
    readNdjson("source_runs.ndjson", SeedSourceRunSchema),
  ]);

  const sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
  const summary: [string, number][] = [];
  const warnings: string[] = [];

  try {
    if (places) {
      for (const batch of chunk(places, 200)) {
        await sql.begin(async (tx) => {
          for (const p of batch) {
            await tx`
              insert into places (id, name, aliases, kind, lat, lng, polygon, address, osm_id, source)
              values (${p.id}, ${p.name}, ${p.aliases}, ${p.kind}, ${p.lat}, ${p.lng},
                      ${p.polygon ? tx`ST_Multi(ST_GeomFromText(${p.polygon}, 4326))` : null},
                      ${p.address ?? null}, ${p.osm_id ?? null}, ${p.source})
              on conflict (id) do update set
                name = excluded.name, aliases = excluded.aliases, kind = excluded.kind,
                lat = excluded.lat, lng = excluded.lng, polygon = excluded.polygon,
                address = excluded.address, osm_id = excluded.osm_id, source = excluded.source`;
          }
        });
      }
      summary.push(["places", places.length]);
    }

    const knownPlaces = new Set((await sql`select id from places`).map((r) => r.id as string));
    const missingPlaceRefs = new Map<string, number>();
    const placeRef = (id: string | null | undefined): string | null => {
      if (!id) return null;
      if (knownPlaces.has(id)) return id;
      missingPlaceRefs.set(id, (missingPlaceRefs.get(id) ?? 0) + 1);
      return null; // keep the row, drop the dangling FK (location_raw survives)
    };

    if (orgs) {
      for (const batch of chunk(orgs, 200)) {
        await sql.begin(async (tx) => {
          for (const o of batch) {
            await tx`
              insert into organizations (id, name, kind, category, description, url, instagram, default_place_id, source)
              values (${o.id}, ${o.name}, ${o.kind}, ${o.category ?? null}, ${o.description ?? null},
                      ${o.url ?? null}, ${o.instagram ?? null}, ${placeRef(o.default_place_id)}, ${o.source})
              on conflict (id) do update set
                name = excluded.name, kind = excluded.kind, category = excluded.category,
                description = excluded.description, url = excluded.url, instagram = excluded.instagram,
                default_place_id = excluded.default_place_id, source = excluded.source`;
          }
        });
      }
      summary.push(["organizations", orgs.length]);
    }

    const knownOrgs = new Set((await sql`select id from organizations`).map((r) => r.id as string));
    const missingOrgRefs = new Map<string, number>();
    const orgRef = (id: string | null | undefined): string | null => {
      if (!id) return null;
      if (knownOrgs.has(id)) return id;
      missingOrgRefs.set(id, (missingOrgRefs.get(id) ?? 0) + 1);
      return null;
    };

    if (events) {
      for (const batch of chunk(events, 200)) {
        await sql.begin(async (tx) => {
          for (const e of batch) {
            await tx`
              insert into events (source, source_id, title, description, start_ts, end_ts, is_all_day,
                                  rrule, location_raw, place_id, lat, lng, org_id, category, tags,
                                  url, cost, confidence, is_canceled, raw)
              values (${e.source}, ${e.source_id}, ${e.title}, ${e.description ?? null}, ${e.start_ts},
                      ${e.end_ts ?? null}, ${e.is_all_day}, ${e.rrule ?? null}, ${e.location_raw ?? null},
                      ${placeRef(e.place_id)}, ${e.lat ?? null}, ${e.lng ?? null}, ${orgRef(e.org_id)},
                      ${e.category ?? null}, ${e.tags}, ${e.url ?? null}, ${e.cost ?? null},
                      ${e.confidence}, ${e.is_canceled}, ${e.raw == null ? null : sql.json(e.raw as never)})
              on conflict (source, source_id) do update set
                title = excluded.title, description = excluded.description, start_ts = excluded.start_ts,
                end_ts = excluded.end_ts, is_all_day = excluded.is_all_day, rrule = excluded.rrule,
                location_raw = excluded.location_raw, place_id = excluded.place_id, lat = excluded.lat,
                lng = excluded.lng, org_id = excluded.org_id, category = excluded.category,
                tags = excluded.tags, url = excluded.url, cost = excluded.cost,
                confidence = excluded.confidence, is_canceled = excluded.is_canceled,
                raw = excluded.raw, last_seen_at = now()`;
          }
        });
      }
      summary.push(["events", events.length]);
    }

    if (meetings) {
      for (const batch of chunk(meetings, 200)) {
        await sql.begin(async (tx) => {
          for (const m of batch) {
            await tx`
              insert into course_meetings (id, srcdb, crn, course_code, title, instructor, days,
                                           start_time, end_time, location_raw, place_id, room, enrollment, raw)
              values (${m.id}, ${m.srcdb}, ${m.crn}, ${m.course_code}, ${m.title}, ${m.instructor ?? null},
                      ${m.days}, ${m.start_time}, ${m.end_time}, ${m.location_raw ?? null},
                      ${placeRef(m.place_id)}, ${m.room ?? null}, ${m.enrollment ?? null},
                      ${m.raw == null ? null : sql.json(m.raw as never)})
              on conflict (id) do update set
                srcdb = excluded.srcdb, crn = excluded.crn, course_code = excluded.course_code,
                title = excluded.title, instructor = excluded.instructor, days = excluded.days,
                start_time = excluded.start_time, end_time = excluded.end_time,
                location_raw = excluded.location_raw, place_id = excluded.place_id,
                room = excluded.room, enrollment = excluded.enrollment, raw = excluded.raw`;
          }
        });
      }
      summary.push(["course_meetings", meetings.length]);
    }

    if (runs) {
      for (const r of runs) {
        await sql`
          insert into source_runs (source, started_at, finished_at, status, items_upserted, error)
          values (${r.source}, ${r.started_at}, ${r.finished_at ?? null}, ${r.status},
                  ${r.items_upserted ?? null}, ${r.error ?? null})`;
      }
      summary.push(["source_runs", runs.length]);
    }

    for (const [id, n] of missingPlaceRefs) {
      warnings.push(`unknown place_id "${id}" referenced ${n}× — set null, location_raw kept`);
    }
    for (const [id, n] of missingOrgRefs) {
      warnings.push(`unknown org_id "${id}" referenced ${n}× — set null`);
    }
  } finally {
    await sql.end();
  }

  if (summary.length === 0) {
    console.log("no seed files found in db/seeds/ — nothing to load");
    return;
  }
  for (const [table, n] of summary) console.log(`${table.padEnd(16)} ${n} rows upserted`);
  for (const w of warnings) console.warn(`warn: ${w}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
