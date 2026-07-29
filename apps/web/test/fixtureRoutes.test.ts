import {
  EventOutSchema,
  HealthOutSchema,
  MeetingOutSchema,
  NowOutSchema,
  OrgDetailOutSchema,
  OrgOutSchema,
  PlaceActivityOutSchema,
  PlaceOutSchema,
} from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FIXTURE_IDS, makeFixtureData } from "../src/mocks";
import { fixtureRoute } from "../src/mocks/fixtureRoutes";

/**
 * The in-process fixture ROUTER — the read-API surface served when
 * VITE_USE_FIXTURES=1 (README "Zero-backend (fixture mode)"): every path the
 * app's fetch layers request must resolve against the fixture dataset, with
 * apps/api semantics (name sort, activity window, upcoming/past split, bbox).
 */

const BASE = new Date("2026-10-01T22:38:00Z");
const data = makeFixtureData(BASE);

function okBody(path: string, params?: Record<string, string | undefined>): unknown {
  const res = fixtureRoute(data, path, params);
  expect(res.status).toBe(200);
  return res.body;
}

describe("fixtureRoute serves every read-API path the app fetches", () => {
  it("GET /api/events (default window)", () => {
    const body = z.object({ events: z.array(EventOutSchema) }).parse(okBody("/api/events"));
    expect(body.events.length).toBeGreaterThan(0);
  });

  it("GET /api/events?bbox= filters to located events inside the envelope", () => {
    // Envelope tightly around Barus & Holley (41.8267, -71.3999).
    const body = z
      .object({ events: z.array(EventOutSchema) })
      .parse(okBody("/api/events", { bbox: "-71.40050,41.82620,-71.39900,41.82720" }));
    expect(body.events.length).toBeGreaterThan(0);
    for (const e of body.events) {
      expect(e.lat).not.toBeNull();
      expect(e.lng).not.toBeNull();
      expect(e.placeId).toBe("barus-holley");
    }
  });

  it("GET /api/events?q= substring-matches title/description", () => {
    const body = z
      .object({ events: z.array(EventOutSchema) })
      .parse(okBody("/api/events", { q: "trivia" }));
    expect(body.events.map((e) => e.title)).toEqual(["Graduate Student Trivia Night"]);
  });

  it("GET /api/events/:id + 404 for unknown", () => {
    const detail = okBody(`/api/events/${FIXTURE_IDS.startingSoonGbm}`) as { id: string };
    expect(detail.id).toBe(FIXTURE_IDS.startingSoonGbm);
    expect(fixtureRoute(data, "/api/events/00000000-0000-4000-8000-999999999999").status).toBe(404);
  });

  it("GET /api/places — whole gazetteer, name-sorted", () => {
    const body = z.object({ places: z.array(PlaceOutSchema) }).parse(okBody("/api/places"));
    const names = body.places.map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names).toContain("Sayles Hall");
  });

  it("GET /api/places/:id/activity — place + 24 h events + in-session meetings there", () => {
    const body = PlaceActivityOutSchema.parse(okBody("/api/places/faunce-house/activity"));
    expect(body.place.id).toBe("faunce-house");
    // GBM (+18 min) and Trivia (+3 h) are within [at, at+24 h]; soonest first.
    expect(body.events.map((e) => e.id)).toEqual([
      FIXTURE_IDS.startingSoonGbm,
      "00000000-0000-4000-8000-000000000005",
    ]);
    // Meetings are filtered to the place: the in-session synthetics sit in
    // Salomon/Barus, not Faunce.
    expect(body.meetings).toEqual([]);
    const salomon = PlaceActivityOutSchema.parse(okBody("/api/places/salomon-center/activity"));
    expect(salomon.meetings.length).toBeGreaterThan(0);
    for (const m of salomon.meetings) expect(m.placeId).toBe("salomon-center");
    expect(fixtureRoute(data, "/api/places/nope/activity").status).toBe(404);
  });

  it("GET /api/orgs — name-sorted", () => {
    const body = z.object({ orgs: z.array(OrgOutSchema) }).parse(okBody("/api/orgs"));
    const names = body.orgs.map((o) => o.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("GET /api/orgs/:id — upcoming/past split around now", () => {
    const body = OrgDetailOutSchema.parse(okBody("/api/orgs/cs-department"));
    expect(body.id).toBe("cs-department");
    // The colloquium started 40 min ago but runs until +50 min — still
    // "upcoming" under the API's coalesce(end,start) >= pivot semantics.
    expect(body.upcoming.map((e) => e.id)).toContain(FIXTURE_IDS.inProgressColloquium);
    expect(body.past).toEqual([]);
    expect(fixtureRoute(data, "/api/orgs/nope").status).toBe(404);
  });

  it("GET /api/meetings — in-session sections at `at`", () => {
    const body = z
      .object({ meetings: z.array(MeetingOutSchema) })
      .parse(okBody("/api/meetings", { at: BASE.toISOString() }));
    expect(body.meetings).toHaveLength(3);
  });

  it("GET /api/now and /api/health parse their contract shapes", () => {
    NowOutSchema.parse(okBody("/api/now"));
    HealthOutSchema.parse(okBody("/api/health"));
  });

  it("throws on a path outside the read API (programmer error, not a 404)", () => {
    expect(() => fixtureRoute(data, "/api/nope")).toThrow(/unhandled fixture path/i);
  });
});
