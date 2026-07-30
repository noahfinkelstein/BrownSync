import {
  EventDetailOutSchema,
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
import { createApp } from "../src/app";
import type { EventsFilter } from "../src/queries";
import { eventRow, fakeQueries, meetingRow, orgRow, placeRow } from "./fixtures";

const ErrorEnvelope = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

describe("GET /api/events", () => {
  it("returns contract-shaped events with mergedSources", async () => {
    const app = createApp(fakeQueries());
    const res = await app.request("/api/events");
    expect(res.status).toBe(200);
    const body = z.object({ events: z.array(EventOutSchema) }).parse(await res.json());
    expect(body.events).toHaveLength(1);
    expect(body.events[0]?.mergedSources).toEqual(["cab"]);
    expect(body.events[0]?.start).toBe("2026-09-15T22:00:00.000Z");
  });

  it("defaults the window to [now, now + 7 days]", async () => {
    let captured: EventsFilter | undefined;
    const app = createApp(
      fakeQueries({
        events: async (f) => {
          captured = f;
          return [];
        },
      }),
    );
    const before = Date.now();
    await app.request("/api/events");
    expect(captured?.from).toBeInstanceOf(Date);
    expect(captured?.to).toBeInstanceOf(Date);
    const from = captured?.from?.getTime() ?? 0;
    const to = captured?.to?.getTime() ?? 0;
    expect(from).toBeGreaterThanOrEqual(before - 1000);
    expect(to - from).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("passes explicit filters through, with bbox parsed to {w,s,e,n}", async () => {
    let captured: EventsFilter | undefined;
    const app = createApp(
      fakeQueries({
        events: async (f) => {
          captured = f;
          return [];
        },
      }),
    );
    const res = await app.request(
      "/api/events?from=2026-09-01T00:00:00Z&to=2026-09-02T00:00:00Z" +
        "&bbox=-71.41,41.82,-71.393,41.834&category=arts&q=orchestra",
    );
    expect(res.status).toBe(200);
    expect(captured?.from?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(captured?.to?.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(captured?.bbox).toEqual({ w: -71.41, s: 41.82, e: -71.393, n: 41.834 });
    expect(captured?.category).toBe("arts");
    expect(captured?.q).toBe("orchestra");
  });
});

describe("GET /api/events/:id", () => {
  it("expands org and place into EventDetailOut", async () => {
    const app = createApp(fakeQueries());
    const res = await app.request(`/api/events/${eventRow.id}`);
    expect(res.status).toBe(200);
    const body = EventDetailOutSchema.parse(await res.json());
    expect(body.place?.name).toBe("Salomon Center");
    expect(body.org?.name).toBe("Brown Lecture Board");
  });

  it("returns null org/place when the event has none resolved", async () => {
    const bare = { ...eventRow, place_id: null, place_name: null, org_id: null, org_name: null };
    const app = createApp(fakeQueries({ eventById: async () => bare }));
    const res = await app.request(`/api/events/${eventRow.id}`);
    const body = EventDetailOutSchema.parse(await res.json());
    expect(body.place).toBeNull();
    expect(body.org).toBeNull();
  });

  it("404s with an envelope for an unknown id", async () => {
    const app = createApp(fakeQueries());
    const res = await app.request("/api/events/00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.parse(await res.json()).error.code).toBe("not_found");
  });
});

describe("GET /api/places and /api/places/:id/activity", () => {
  it("lists the gazetteer", async () => {
    const app = createApp(fakeQueries());
    const res = await app.request("/api/places");
    expect(res.status).toBe(200);
    const body = z.object({ places: z.array(PlaceOutSchema) }).parse(await res.json());
    expect(body.places[0]?.id).toBe("salomon-center");
  });

  it("returns place + events + meetings for activity", async () => {
    const app = createApp(fakeQueries());
    const res = await app.request(
      `/api/places/${placeRow.id}/activity?at=2026-09-15T18:30:00-04:00`,
    );
    expect(res.status).toBe(200);
    const body = PlaceActivityOutSchema.parse(await res.json());
    expect(body.place.id).toBe("salomon-center");
    expect(body.events).toHaveLength(1);
    expect(body.meetings[0]?.startTime).toBe("14:00");
  });

  it("windows activity events to [at, at + 24h] at that place", async () => {
    let captured: { placeId: string; from: Date; to: Date } | undefined;
    const app = createApp(
      fakeQueries({
        eventsByPlace: async (placeId, from, to) => {
          captured = { placeId, from, to };
          return [];
        },
      }),
    );
    await app.request(`/api/places/${placeRow.id}/activity?at=2026-09-15T12:00:00Z`);
    expect(captured?.placeId).toBe("salomon-center");
    expect(captured?.from.toISOString()).toBe("2026-09-15T12:00:00.000Z");
    expect(captured?.to.toISOString()).toBe("2026-09-16T12:00:00.000Z");
  });

  it("404s for an unknown place", async () => {
    const app = createApp(fakeQueries());
    const res = await app.request("/api/places/atlantis/activity");
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.parse(await res.json()).error.code).toBe("not_found");
  });
});

describe("GET /api/orgs and /api/orgs/:id", () => {
  it("lists organizations", async () => {
    const app = createApp(fakeQueries());
    const res = await app.request("/api/orgs");
    const body = z.object({ orgs: z.array(OrgOutSchema) }).parse(await res.json());
    expect(body.orgs[0]?.id).toBe("brown-lecture-board");
  });

  it("returns OrgDetailOut with upcoming and past", async () => {
    const app = createApp(fakeQueries());
    const res = await app.request(`/api/orgs/${orgRow.id}`);
    expect(res.status).toBe(200);
    const body = OrgDetailOutSchema.parse(await res.json());
    expect(body.upcoming).toHaveLength(1);
    expect(body.past).toEqual([]);
  });

  it("splits organization events at the requested cursor", async () => {
    let captured: Date | undefined;
    const app = createApp(
      fakeQueries({
        eventsByOrg: async (_id, pivot) => {
          captured = pivot;
          return { upcoming: [], past: [] };
        },
      }),
    );
    const res = await app.request(`/api/orgs/${orgRow.id}?at=2026-09-20T12:30:00-04:00`);
    expect(res.status).toBe(200);
    expect(captured?.toISOString()).toBe("2026-09-20T16:30:00.000Z");
  });

  it("404s for an unknown org", async () => {
    const app = createApp(fakeQueries());
    const res = await app.request("/api/orgs/illuminati");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/meetings", () => {
  it("returns meetings in session at `at`", async () => {
    let captured: Date | undefined;
    const app = createApp(
      fakeQueries({
        meetingsAt: async (at) => {
          captured = at;
          return [meetingRow];
        },
      }),
    );
    const res = await app.request("/api/meetings?at=2026-09-15T14:30:00-04:00");
    expect(res.status).toBe(200);
    const body = z.object({ meetings: z.array(MeetingOutSchema) }).parse(await res.json());
    expect(body.meetings[0]?.courseCode).toBe("CSCI 0150");
    expect(captured?.toISOString()).toBe("2026-09-15T18:30:00.000Z");
  });
});

describe("GET /api/now", () => {
  it("returns events + meetings + exhaustive countsByCategory", async () => {
    const app = createApp(fakeQueries());
    const res = await app.request("/api/now");
    expect(res.status).toBe(200);
    const body = NowOutSchema.parse(await res.json());
    expect(body.events).toHaveLength(1);
    expect(body.meetings).toHaveLength(1);
    expect(Object.keys(body.countsByCategory)).toHaveLength(10);
    expect(body.countsByCategory.academic).toBe(1);
    expect(body.countsByCategory.class).toBe(1); // one meeting counts into 'class'
    expect(body.countsByCategory.social).toBe(0);
  });
});

describe("GET /api/health", () => {
  it("rolls up source_runs and reports never-run sources", async () => {
    const app = createApp(fakeQueries());
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = HealthOutSchema.parse(await res.json());
    const statusBySource = Object.fromEntries(body.sources.map((s) => [s.source, s.status]));
    expect(statusBySource.livewhale).toBe("ok");
    expect(statusBySource.cab).toBe("error");
    expect(statusBySource.bdh).toBe("never");
  });
});

describe("misc", () => {
  it("404s unknown routes with an envelope", async () => {
    const app = createApp(fakeQueries());
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.parse(await res.json()).error.code).toBe("not_found");
  });

  it("serves the OpenAPI 3.1 document", async () => {
    const app = createApp(fakeQueries());
    const res = await app.request("/api/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    for (const path of [
      "/api/events",
      "/api/events/{id}",
      "/api/places",
      "/api/places/{id}/activity",
      "/api/orgs",
      "/api/orgs/{id}",
      "/api/meetings",
      "/api/now",
      "/api/health",
    ]) {
      expect(doc.paths).toHaveProperty(path);
    }
  });

  it("answers CORS preflight for localhost dev origins", async () => {
    const app = createApp(fakeQueries());
    const res = await app.request("/api/events", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("does not allow arbitrary origins", async () => {
    const app = createApp(fakeQueries());
    const res = await app.request("/api/events", {
      headers: { Origin: "https://evil.example" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
