import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeAthletics } from "../src/athletics/normalize";
import { loadAthleticsVenues } from "../src/athletics/venues";
import { normalizeLivewhaleEvent } from "../src/livewhale/normalize";
import { loadOrgGroups } from "../src/livewhale/orgs";
import { LivewhaleEventSchema } from "../src/livewhale/schema";
import { FIXTURES_DIR } from "../src/paths";

const SIDECAR_FIXTURE = path.join(FIXTURES_DIR, "organization_livewhale_groups.json");
/** Byte-for-byte mirror of the real ingestion-emitted db/seeds/athletics_venues.json. */
const VENUES_FIXTURE = path.join(FIXTURES_DIR, "athletics_venues.json");

/** The ingestion-emitted db/seeds sidecars are read-only inputs; missing files are normal. */
describe("seed sidecar loaders", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "poller-seeds-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns an empty map when the file does not exist yet", () => {
    expect(loadOrgGroups(path.join(dir, "nope.json")).size).toBe(0);
    expect(loadAthleticsVenues(path.join(dir, "nope.json")).size).toBe(0);
  });

  it("builds a normalized group → org lookup from the fixture sidecar", () => {
    const map = loadOrgGroups(SIDECAR_FIXTURE);
    // Group names are entity-decoded + case-folded before lookup.
    expect(map.get("alumni & friends")).toBe("alumni-and-friends");
    // Two mappings claim "Athletics" — the higher score wins.
    expect(map.get("athletics")).toBe("brown-athletics");
    expect(map.size).toBe(2);
  });

  it("attributes a LiveWhale event to its org through the fixture sidecar", () => {
    const map = loadOrgGroups(SIDECAR_FIXTURE);
    const ev = LivewhaleEventSchema.parse({
      id: 1,
      title: "Reunion Weekend Kickoff",
      date_utc: "2026-09-01 22:00:00",
      date_ts: 1788386400,
      group: "Alumni &amp; Friends",
    });
    expect(normalizeLivewhaleEvent(ev, map).org_id).toBe("alumni-and-friends");
  });

  it("leaves org_id null when the sidecar is absent", () => {
    const map = loadOrgGroups(path.join(dir, "nope.json"));
    const ev = LivewhaleEventSchema.parse({
      id: 1,
      title: "Reunion Weekend Kickoff",
      date_utc: "2026-09-01 22:00:00",
      date_ts: 1788386400,
      group: "Alumni &amp; Friends",
    });
    expect(normalizeLivewhaleEvent(ev, map).org_id).toBeNull();
  });

  it("rejects a sidecar with an unknown schema_version — drift must fail loudly", () => {
    const file = path.join(dir, "organization_livewhale_groups.json");
    writeFileSync(
      file,
      JSON.stringify({ schema_version: 2, generated_at: "2026-07-28T12:00:00Z", mappings: [] }),
    );
    expect(() => loadOrgGroups(file)).toThrow();
  });

  it("builds a venue → place lookup from the real emitted v1 sidecar", () => {
    const map = loadAthleticsVenues(VENUES_FIXTURE);
    expect(map.size).toBe(11);
    // Venue keys are case-folded before lookup.
    expect(map.get("omac")).toBe("olney-margolies-athletic-center");
    expect(map.get("stevenson-pincince field")).toBe("stevenson-pincince-field");
    expect(map.get("richard gouse field at brown stadium")).toBe("brown-stadium");
  });

  it("normalizes venue keys case-insensitively", () => {
    const file = path.join(dir, "athletics_venues.json");
    writeFileSync(
      file,
      JSON.stringify({
        schema_version: 1,
        generated_at: "2026-07-29T05:19:12Z",
        mappings: [{ source_name: "Stevenson-Pincince Field", place_id: "stevenson-pincince" }],
      }),
    );
    const map = loadAthleticsVenues(file);
    expect(map.get("stevenson-pincince field")).toBe("stevenson-pincince");
  });

  it("rejects the obsolete flat venue map — pre-v1 drift must fail loudly", () => {
    const file = path.join(dir, "athletics_venues.json");
    writeFileSync(file, JSON.stringify({ "Stevenson-Pincince Field": "stevenson-pincince" }));
    expect(() => loadAthleticsVenues(file)).toThrow();
  });

  it("rejects an athletics sidecar with an unknown schema_version", () => {
    const file = path.join(dir, "athletics_venues.json");
    writeFileSync(
      file,
      JSON.stringify({ schema_version: 2, generated_at: "2026-07-29T05:19:12Z", mappings: [] }),
    );
    expect(() => loadAthleticsVenues(file)).toThrow();
  });

  it("resolves home venues end-to-end through the v1 sidecar", () => {
    const icsText = readFileSync(path.join(FIXTURES_DIR, "athletics-calendar.ics"), "utf8");
    const rows = normalizeAthletics(icsText, loadAthleticsVenues(VENUES_FIXTURE));
    const home = rows.find((r) => r.source_id === "vcal_20893-admin.brownbears.com");
    expect(home?.place_id).toBe("stevenson-pincince-field");
  });
});
