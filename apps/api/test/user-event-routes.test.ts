import {
  MyUserEventsSchema,
  UserEventCreateResultSchema,
  UserEventManagementSchema,
  UserEventMutationResultSchema,
} from "@brownsync/contract";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { Authenticator, RateLimiterBinding } from "../src/auth";
import type { Queries } from "../src/queries";
import { fakeQueries } from "./fixtures";

const ACTOR_ID = "30000000-0000-4000-8000-000000000001";
const EVENT_ID = "40000000-0000-4000-8000-000000000001";

const authenticated: Authenticator = async (c, next) => {
  c.set("user", { id: ACTOR_ID, email: "member@brown.edu" });
  c.set("authentication", { oauthAuthenticatedAt: Math.floor(Date.now() / 1000) });
  await next();
};

function blocked(status: 401 | 403): Authenticator {
  return async (c) =>
    c.json(
      {
        error: {
          code: status === 401 ? "unauthorized" : "brown_membership_required",
          message: "blocked",
        },
      },
      status,
    );
}

function limiter(success = true): RateLimiterBinding & { limit: ReturnType<typeof vi.fn> } {
  return { limit: vi.fn(async () => ({ success })) };
}

function queries(overrides: Record<string, unknown> = {}): Queries {
  return Object.assign(fakeQueries(), overrides) as Queries;
}

const validCreate = {
  clientRequestId: "50000000-0000-4000-8000-000000000001",
  organizationId: null,
  title: "Campus software study break",
  description: null,
  start: "2026-09-15T22:00:00Z",
  end: null,
  category: "social",
  url: null,
  placeId: "salomon-center",
};

const management = {
  id: EVENT_ID,
  organizationId: null,
  organizationName: null,
  title: "Campus software study break",
  description: null,
  start: "2026-09-15T22:00:00.000Z",
  end: null,
  placeId: "salomon-center",
  placeName: "Salomon Center",
  locationRaw: null,
  category: "social" as const,
  url: null,
  status: "published" as const,
  moderationState: "active" as const,
  revision: 2,
  deletedAt: null,
  createdAt: "2026-07-30T16:00:00.000Z",
  updatedAt: "2026-07-30T16:01:00.000Z",
};

describe("student-event route protection and validation", () => {
  it.each([401, 403] as const)(
    "rejects create with %s before the write limiter or database query",
    async (status) => {
      const create = vi.fn();
      const writeLimiter = limiter();
      const app = createApp(queries({ createUserEvent: create }), {
        authenticator: blocked(status),
        userReadLimiter: limiter(),
        userWriteLimiter: writeLimiter,
      });

      const response = await app.request("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validCreate),
      });

      expect(response.status).toBe(status);
      expect(writeLimiter.limit).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed create JSON before the database query", async () => {
    const create = vi.fn();
    const app = createApp(queries({ createUserEvent: create }), {
      authenticator: authenticated,
      userWriteLimiter: limiter(),
    });

    const response = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    "actorId",
    "createdBy",
    "source",
    "lat",
    "lng",
    "coordinates",
    "status",
    "moderationState",
    "revision",
  ])("rejects forged create field %s before the database query", async (field) => {
    const create = vi.fn();
    const app = createApp(queries({ createUserEvent: create }), {
      authenticator: authenticated,
      userWriteLimiter: limiter(),
    });

    const response = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validCreate, [field]: "forged" }),
    });

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("requires exactly one location input before the database query", async () => {
    const create = vi.fn();
    const app = createApp(queries({ createUserEvent: create }), {
      authenticator: authenticated,
      userWriteLimiter: limiter(),
    });

    const [neither, both] = await Promise.all([
      app.request("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validCreate, placeId: undefined }),
      }),
      app.request("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validCreate, locationRaw: "Salomon Center" }),
      }),
    ]);

    expect(neither.status).toBe(400);
    expect(both.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["edit", "PATCH", JSON.stringify({ expectedRevision: 2, patch: { source: "forged" } })],
    ["empty edit", "PATCH", JSON.stringify({ expectedRevision: 2, patch: {} })],
  ])("rejects invalid %s before the database query", async (_label, method, body) => {
    const edit = vi.fn();
    const app = createApp(queries({ editUserEvent: edit }), {
      authenticator: authenticated,
      userWriteLimiter: limiter(),
    });

    const response = await app.request(`/api/events/${EVENT_ID}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body,
    });

    expect(response.status).toBe(400);
    expect(edit).not.toHaveBeenCalled();
  });

  it("does not apply protected middleware to the legacy public event GET", async () => {
    const auth = vi.fn<Authenticator>(async (_c, next) => {
      await next();
    });
    const readLimiter = limiter(false);
    const writeLimiter = limiter(false);
    const app = createApp(fakeQueries(), {
      authenticator: auth,
      userReadLimiter: readLimiter,
      userWriteLimiter: writeLimiter,
    });

    const response = await app.request(`/api/events/${EVENT_ID}`);

    expect(response.status).toBe(404);
    expect(auth).not.toHaveBeenCalled();
    expect(readLimiter.limit).not.toHaveBeenCalled();
    expect(writeLimiter.limit).not.toHaveBeenCalled();
  });

  it("creates as the verified actor after write limiting and returns a named 201 result", async () => {
    const order: string[] = [];
    const auth: Authenticator = async (c, next) => {
      order.push("auth");
      c.set("user", { id: ACTOR_ID, email: "member@brown.edu" });
      c.set("authentication", { oauthAuthenticatedAt: null });
      await next();
    };
    const writeLimiter = {
      limit: vi.fn(async () => {
        order.push("limit");
        return { success: true };
      }),
    };
    const create = vi.fn(async () => {
      order.push("query");
      return {
        kind: "ok" as const,
        value: { eventId: EVENT_ID, revision: 0, replayed: false },
      };
    });
    const app = createApp(queries({ createUserEvent: create }), {
      authenticator: auth,
      userWriteLimiter: writeLimiter,
    });

    const response = await app.request("/api/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({ ...validCreate, title: "  Campus software study break  " }),
    });

    expect(response.status).toBe(201);
    expect(UserEventCreateResultSchema.parse(await response.json())).toEqual({
      eventId: EVENT_ID,
      revision: 0,
      replayed: false,
    });
    expect(order).toEqual(["auth", "limit", "query"]);
    expect(create).toHaveBeenCalledWith(ACTOR_ID, validCreate);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("edits as the verified actor with optimistic revision and a translated strict patch", async () => {
    const edit = vi.fn(async () => ({
      kind: "ok" as const,
      value: { eventId: EVENT_ID, revision: 3, changed: true },
    }));
    const app = createApp(queries({ editUserEvent: edit }), {
      authenticator: authenticated,
      userWriteLimiter: limiter(),
    });

    const response = await app.request(`/api/events/${EVENT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 2,
        patch: { title: "  Updated study break  ", end: null },
      }),
    });

    expect(response.status).toBe(200);
    expect(UserEventMutationResultSchema.parse(await response.json())).toEqual({
      eventId: EVENT_ID,
      revision: 3,
      changed: true,
    });
    expect(edit).toHaveBeenCalledWith(ACTOR_ID, EVENT_ID, 2, {
      title: "Updated study break",
      end: null,
    });
  });

  it("deletes idempotently without a body or revision", async () => {
    const remove = vi.fn(async () => ({
      kind: "ok" as const,
      value: { eventId: EVENT_ID, revision: 4, changed: false },
    }));
    const app = createApp(queries({ deleteUserEvent: remove }), {
      authenticator: authenticated,
      userWriteLimiter: limiter(),
    });

    const response = await app.request(`/api/events/${EVENT_ID}`, { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(UserEventMutationResultSchema.parse(await response.json())).toEqual({
      eventId: EVENT_ID,
      revision: 4,
      changed: false,
    });
    expect(remove).toHaveBeenCalledWith(ACTOR_ID, EVENT_ID);
  });

  it("lists a bounded default management page after authenticated read limiting", async () => {
    const list = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        events: [management],
        next: {
          beforeUpdatedAt: management.updatedAt,
          beforeEventId: EVENT_ID,
        },
      },
    }));
    const readLimiter = limiter();
    const writeLimiter = limiter();
    const app = createApp(queries({ myUserEvents: list }), {
      authenticator: authenticated,
      userReadLimiter: readLimiter,
      userWriteLimiter: writeLimiter,
    });

    const response = await app.request("/api/me/events");
    const body = MyUserEventsSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.events).toEqual([management]);
    expect(list).toHaveBeenCalledWith(ACTOR_ID, {
      beforeUpdatedAt: null,
      beforeEventId: null,
      limit: 50,
    });
    expect(readLimiter.limit).toHaveBeenCalledWith({ key: `read:${ACTOR_ID}` });
    expect(writeLimiter.limit).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("createdBy");
  });

  it("passes a complete descending management cursor and bounded limit", async () => {
    const list = vi.fn(async () => ({
      kind: "ok" as const,
      value: { events: [], next: null },
    }));
    const app = createApp(queries({ myUserEvents: list }), {
      authenticator: authenticated,
      userReadLimiter: limiter(),
    });
    const timestamp = "2026-07-30T16:01:00.000Z";

    const response = await app.request(
      `/api/me/events?beforeUpdatedAt=${encodeURIComponent(timestamp)}&beforeEventId=${EVENT_ID}&limit=100`,
    );

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(ACTOR_ID, {
      beforeUpdatedAt: timestamp,
      beforeEventId: EVENT_ID,
      limit: 100,
    });
  });

  it.each([
    ["missing timestamp", `?beforeEventId=${EVENT_ID}`],
    ["missing id", "?beforeUpdatedAt=2026-07-30T16%3A01%3A00.000Z"],
    ["invalid id", "?beforeUpdatedAt=2026-07-30T16%3A01%3A00.000Z&beforeEventId=not-a-uuid"],
    ["zero limit", "?limit=0"],
    ["oversized limit", "?limit=101"],
    ["fractional limit", "?limit=1.5"],
  ])("rejects a %s management cursor before querying", async (_label, suffix) => {
    const list = vi.fn();
    const app = createApp(queries({ myUserEvents: list }), {
      authenticator: authenticated,
      userReadLimiter: limiter(),
    });

    const response = await app.request(`/api/me/events${suffix}`);

    expect(response.status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });

  it("returns authority-scoped management detail without creator identity", async () => {
    const detail = vi.fn(async () => ({ kind: "ok" as const, value: management }));
    const app = createApp(queries({ myUserEvent: detail }), {
      authenticator: authenticated,
      userReadLimiter: limiter(),
    });

    const response = await app.request(`/api/me/events/${EVENT_ID}`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(UserEventManagementSchema.parse(JSON.parse(text))).toEqual(management);
    expect(detail).toHaveBeenCalledWith(ACTOR_ID, EVENT_ID);
    expect(text).not.toContain("createdBy");
    expect(text).not.toContain("clientRequestId");
  });

  it.each([
    ["list", "/api/me/events"],
    ["detail", `/api/me/events/${EVENT_ID}`],
  ])("authenticates management %s before the read limiter or query", async (label, path) => {
    const list = vi.fn();
    const detail = vi.fn();
    const readLimiter = limiter();
    const app = createApp(queries({ myUserEvents: list, myUserEvent: detail }), {
      authenticator: blocked(401),
      userReadLimiter: readLimiter,
    });

    const response = await app.request(path);

    expect(response.status, label).toBe(401);
    expect(readLimiter.limit).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
  });

  it("rate-limits a protected read after auth and before its database query", async () => {
    const list = vi.fn();
    const readLimiter = limiter(false);
    const app = createApp(queries({ myUserEvents: list }), {
      authenticator: authenticated,
      userReadLimiter: readLimiter,
    });

    const response = await app.request("/api/me/events", {
      headers: { Origin: "http://localhost:5173" },
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("access-control-expose-headers")).toBe("Retry-After");
    expect(list).not.toHaveBeenCalled();
  });

  it("rate-limits a mutation after auth and before its database query", async () => {
    const remove = vi.fn();
    const writeLimiter = limiter(false);
    const app = createApp(queries({ deleteUserEvent: remove }), {
      authenticator: authenticated,
      userWriteLimiter: writeLimiter,
    });

    const response = await app.request(`/api/events/${EVENT_ID}`, { method: "DELETE" });

    expect(response.status).toBe(429);
    expect(writeLimiter.limit).toHaveBeenCalledWith({ key: `write:${ACTOR_ID}` });
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    ["bad input", "bad_request", 400, "bad_request"],
    ["authority", "forbidden", 403, "forbidden"],
    ["missing", "not_found", 404, "not_found"],
    ["revision", "conflict", 409, "conflict"],
    ["location resolution", "unprocessable", 422, "unprocessable"],
    ["durable creation cap", "rate_limited", 429, "rate_limited"],
    ["posting disabled", "unavailable", 503, "user_event_service_unavailable"],
  ] as const)("maps %s failures to sanitized %s responses", async (_label, kind, status, code) => {
    const create = vi.fn(async () => ({ kind }));
    const app = createApp(queries({ createUserEvent: create }), {
      authenticator: authenticated,
      userWriteLimiter: limiter(),
    });

    const response = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validCreate),
    });
    const text = await response.text();

    expect(response.status).toBe(status);
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain("BROWNSYNC_USER_EVENT");
    expect(text).not.toContain("database");
    expect(text).not.toContain("postgres");
    if (status === 429) expect(response.headers.get("retry-after")).toBe("60");
  });

  it.each([
    ["create", "/api/events", "POST"],
    ["edit", `/api/events/${EVENT_ID}`, "PATCH"],
    ["delete", `/api/events/${EVENT_ID}`, "DELETE"],
    ["list", "/api/me/events", "GET"],
    ["detail", `/api/me/events/${EVENT_ID}`, "GET"],
  ])("fails closed when the %s database seam is unavailable", async (_label, path, method) => {
    const app = createApp(fakeQueries(), {
      authenticator: authenticated,
      userReadLimiter: limiter(),
      userWriteLimiter: limiter(),
    });
    const body =
      method === "POST"
        ? JSON.stringify(validCreate)
        : method === "PATCH"
          ? JSON.stringify({ expectedRevision: 2, patch: { title: "Updated" } })
          : undefined;

    const response = await app.request(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body,
    });

    expect(response.status).toBe(503);
    expect((await response.json()) as unknown).toMatchObject({
      error: { code: "user_event_service_unavailable" },
    });
  });
});
