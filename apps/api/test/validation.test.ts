import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../src/app";
import { fakeQueries } from "./fixtures";

const ErrorEnvelope = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/**
 * Query/path parameter validation via the contract schemas
 * (EventsQuerySchema, AtQuerySchema). Every rejection is a 400 with the
 * standard error envelope.
 */
describe("query-param validation", () => {
  const app = createApp(fakeQueries());

  it.each([
    ["malformed bbox (3 parts)", "/api/events?bbox=1,2,3"],
    ["malformed bbox (text)", "/api/events?bbox=w,s,e,n"],
    ["off-taxonomy category", "/api/events?category=party"],
    ["non-ISO from", "/api/events?from=yesterday"],
    ["non-ISO to", "/api/events?to=2026-13-45"],
    ["empty q", "/api/events?q="],
    ["non-ISO at on /api/meetings", "/api/meetings?at=noonish"],
    ["non-ISO at on activity", "/api/places/salomon-center/activity?at=later"],
    ["non-uuid event id", "/api/events/not-a-uuid"],
  ])("rejects %s with a 400 envelope", async (_label, url) => {
    const res = await app.request(url);
    expect(res.status).toBe(400);
    const body = ErrorEnvelope.parse(await res.json());
    expect(body.error.code).toBe("bad_request");
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it.each([
    ["no params", "/api/events"],
    [
      "full valid filter set",
      "/api/events?from=2026-09-01T00:00:00Z&to=2026-09-08T00:00:00Z&bbox=-71.41,41.82,-71.393,41.834&category=club&q=chess",
    ],
    ["offset ISO timestamps", "/api/events?from=2026-09-01T00:00:00-04:00"],
    ["meetings with valid at", "/api/meetings?at=2026-09-15T14:30:00Z"],
    ["meetings without at", "/api/meetings"],
  ])("accepts %s", async (_label, url) => {
    const res = await app.request(url);
    expect(res.status).toBe(200);
  });
});
