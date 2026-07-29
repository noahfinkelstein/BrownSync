import { HttpResponse, http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  fetchEventDetail,
  fetchEvents,
  fetchHealth,
  fetchMeetings,
  fetchNow,
} from "../src/data/api";
import { buildHandlers, FIXTURE_IDS, makeFixtureData } from "../src/mocks";
import { mockServer } from "../src/mocks/server";

/**
 * The fetch layer against MSW — tests NEVER hit live servers. Handlers are
 * host-agnostic; VITE_API_URL is stubbed so node fetch gets absolute URLs.
 */

const BASE = new Date("2026-10-01T22:38:00Z");

beforeAll(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test");
  mockServer.listen({ onUnhandledRequest: "error" });
  mockServer.use(...buildHandlers(makeFixtureData(BASE)));
});
afterEach(() => {
  mockServer.resetHandlers();
  mockServer.use(...buildHandlers(makeFixtureData(BASE)));
});
afterAll(() => {
  mockServer.close();
  vi.unstubAllEnvs();
});

describe("fetchers parse contract shapes end-to-end", () => {
  it("fetchEvents forwards query params and validates", async () => {
    const events = await fetchEvents({
      from: BASE.toISOString(),
      to: new Date(BASE.getTime() + 2 * 3_600_000).toISOString(),
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events.map((e) => e.id)).toContain(FIXTURE_IDS.startingSoonGbm);
  });

  it("fetchEvents category filter round-trips", async () => {
    const events = await fetchEvents({ category: "athletics" });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.category === "athletics")).toBe(true);
  });

  it("fetchEventDetail expands org + place", async () => {
    const detail = await fetchEventDetail(FIXTURE_IDS.startingSoonGbm);
    expect(detail.org?.id).toBe("brown-outing-club");
    expect(detail.place?.name).toBe("Stephen Robert '62 Campus Center");
  });

  it("fetchMeetings at an instant", async () => {
    const meetings = await fetchMeetings(BASE.toISOString());
    expect(meetings).toHaveLength(3);
  });

  it("fetchNow returns the live snapshot", async () => {
    const now = await fetchNow(BASE.toISOString());
    expect(now.events.length).toBeGreaterThan(0);
    expect(now.countsByCategory.class).toBe(now.meetings.length);
  });

  it("fetchHealth reports per-source status", async () => {
    const health = await fetchHealth();
    const bySource = new Map(health.sources.map((s) => [s.source, s]));
    expect(bySource.get("livewhale")?.status).toBe("ok");
    expect(bySource.get("bdh")?.status).toBe("error");
  });
});

describe("failure modes", () => {
  it("HTTP errors surface as ApiError with status", async () => {
    mockServer.use(
      http.get("*/api/events", () => HttpResponse.json({ nope: true }, { status: 503 })),
    );
    await expect(fetchEvents()).rejects.toMatchObject({ name: "ApiError", status: 503 });
  });

  it("404 detail is an ApiError", async () => {
    await expect(fetchEventDetail("00000000-0000-4000-8000-999999999999")).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("contract-violating payloads are rejected at the boundary (Zod)", async () => {
    mockServer.use(
      http.get("*/api/events", () => HttpResponse.json({ events: [{ id: 1, bogus: true }] })),
    );
    await expect(fetchEvents()).rejects.toThrowError(/invalid|expected/i);
  });
});
