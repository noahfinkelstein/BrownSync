import * as Contract from "@brownsync/contract";
import { describe, expect, it } from "vitest";

type RuntimeSchema = {
  parse(input: unknown): unknown;
  safeParse(input: unknown): { success: boolean };
};

function schema(name: string): RuntimeSchema {
  const candidate = (Contract as unknown as Record<string, unknown>)[name];
  expect(candidate, `missing contract export ${name}`).toBeDefined();
  return candidate as RuntimeSchema;
}

const clientRequestId = "40000000-0000-4000-8000-000000000001";

const validCreate = {
  clientRequestId,
  organizationId: null,
  title: "  Campus software study break  ",
  description: null,
  start: "2026-09-15T22:00:00Z",
  end: "2026-09-15T23:30:00Z",
  category: "social",
  url: "https://example.edu/study-break",
  placeId: "salomon-center",
};

describe("student-event request contracts", () => {
  it("exports strict named request schemas", () => {
    for (const name of [
      "UserEventCreateRequestSchema",
      "UserEventEditPatchSchema",
      "UserEventEditRequestSchema",
      "UserEventCreateResultSchema",
      "UserEventMutationResultSchema",
      "UserEventManagementSchema",
      "UserEventManagementCursorSchema",
      "MyUserEventsQuerySchema",
      "MyUserEventsSchema",
    ]) {
      expect((Contract as unknown as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it("accepts safe creation fields and trims user-authored text", () => {
    const create = schema("UserEventCreateRequestSchema");

    expect(create.parse(validCreate)).toEqual({
      ...validCreate,
      title: "Campus software study break",
    });
    expect(
      create.parse({
        ...validCreate,
        placeId: undefined,
        locationRaw: "  Salomon Center 101  ",
      }),
    ).toEqual({
      ...validCreate,
      title: "Campus software study break",
      placeId: undefined,
      locationRaw: "Salomon Center 101",
    });
  });

  it("requires exactly one canonical-place or resolvable-location input", () => {
    const create = schema("UserEventCreateRequestSchema");

    expect(
      create.safeParse({ ...validCreate, placeId: undefined, locationRaw: undefined }).success,
    ).toBe(false);
    expect(create.safeParse({ ...validCreate, locationRaw: "Salomon Center" }).success).toBe(false);
    expect(create.safeParse({ ...validCreate, placeId: "" }).success).toBe(false);
    expect(
      create.safeParse({ ...validCreate, placeId: undefined, locationRaw: "  " }).success,
    ).toBe(false);
  });

  it("rejects forged identity, source, coordinate, moderation, and status fields", () => {
    const create = schema("UserEventCreateRequestSchema");

    for (const field of [
      "actorId",
      "createdBy",
      "updatedBy",
      "source",
      "lat",
      "lng",
      "latitude",
      "longitude",
      "coordinates",
      "status",
      "moderationState",
      "revision",
      "deletedAt",
    ]) {
      expect(create.safeParse({ ...validCreate, [field]: "forged" }).success, field).toBe(false);
    }
  });

  it("enforces title, description, time, category, and HTTPS URL bounds", () => {
    const create = schema("UserEventCreateRequestSchema");

    expect(create.safeParse({ ...validCreate, title: "" }).success).toBe(false);
    expect(create.safeParse({ ...validCreate, title: "a".repeat(201) }).success).toBe(false);
    expect(create.safeParse({ ...validCreate, description: "a".repeat(10_001) }).success).toBe(
      false,
    );
    expect(
      create.safeParse({
        ...validCreate,
        start: "2026-09-15T23:30:00Z",
        end: "2026-09-15T23:30:00Z",
      }).success,
    ).toBe(false);
    expect(create.safeParse({ ...validCreate, category: "party" }).success).toBe(false);
    expect(create.safeParse({ ...validCreate, url: "http://example.edu/event" }).success).toBe(
      false,
    );
    expect(
      create.safeParse({ ...validCreate, url: `https://example.edu/${"a".repeat(2_030)}` }).success,
    ).toBe(false);
  });

  it("requires a nonempty strict edit patch without authority or idempotency changes", () => {
    const edit = schema("UserEventEditRequestSchema");
    const valid = {
      expectedRevision: 3,
      patch: {
        title: "  Updated study break  ",
        description: null,
        end: null,
        placeId: "sayles-hall",
      },
    };

    expect(edit.parse(valid)).toEqual({
      ...valid,
      patch: { ...valid.patch, title: "Updated study break" },
    });
    expect(edit.safeParse({ expectedRevision: 3, patch: {} }).success).toBe(false);
    expect(edit.safeParse({ expectedRevision: -1, patch: { title: "Updated" } }).success).toBe(
      false,
    );
    expect(
      edit.safeParse({
        expectedRevision: 3,
        patch: { placeId: "sayles-hall", locationRaw: "Sayles Hall" },
      }).success,
    ).toBe(false);
    for (const field of [
      "organizationId",
      "clientRequestId",
      "actorId",
      "createdBy",
      "source",
      "lat",
      "lng",
      "status",
      "moderationState",
      "revision",
    ]) {
      expect(
        edit.safeParse({
          expectedRevision: 3,
          patch: { title: "Updated", [field]: "forged" },
        }).success,
        field,
      ).toBe(false);
    }
  });

  it("names strict create and mutation dispositions", () => {
    const createResult = schema("UserEventCreateResultSchema");
    const mutationResult = schema("UserEventMutationResultSchema");
    const base = {
      eventId: "40000000-0000-4000-8000-000000000001",
      revision: 2,
    };

    expect(createResult.parse({ ...base, replayed: false })).toEqual({
      ...base,
      replayed: false,
    });
    expect(mutationResult.parse({ ...base, changed: true })).toEqual({
      ...base,
      changed: true,
    });
    expect(createResult.safeParse({ ...base, replayed: false, changed: true }).success).toBe(false);
    expect(mutationResult.safeParse({ ...base, changed: true, createdBy: "private" }).success).toBe(
      false,
    );
  });

  it("keeps management output strict and creator-private", () => {
    const management = schema("UserEventManagementSchema");
    const body = {
      id: "40000000-0000-4000-8000-000000000001",
      organizationId: null,
      organizationName: null,
      title: "Campus software study break",
      description: null,
      start: "2026-09-15T22:00:00.000Z",
      end: null,
      placeId: "salomon-center",
      placeName: "Salomon Center",
      locationRaw: null,
      category: "social",
      url: null,
      status: "published",
      moderationState: "active",
      revision: 2,
      deletedAt: null,
      createdAt: "2026-07-30T16:00:00.000Z",
      updatedAt: "2026-07-30T16:01:00.000Z",
    };

    expect(management.parse(body)).toEqual(body);
    for (const forbidden of [
      "createdBy",
      "updatedBy",
      "deletedBy",
      "clientRequestId",
      "payloadFingerprint",
      "lat",
      "lng",
      "source",
    ]) {
      expect(management.safeParse({ ...body, [forbidden]: "private" }).success, forbidden).toBe(
        false,
      );
    }
  });

  it("requires a paired descending management cursor and a bounded page size", () => {
    const query = schema("MyUserEventsQuerySchema");
    const page = schema("MyUserEventsSchema");
    const cursor = {
      beforeUpdatedAt: "2026-07-30T16:01:00.000Z",
      beforeEventId: "40000000-0000-4000-8000-000000000001",
    };

    expect(query.parse({})).toEqual({ limit: 50 });
    expect(query.parse({ ...cursor, limit: "100" })).toEqual({ ...cursor, limit: 100 });
    expect(query.safeParse({ beforeUpdatedAt: cursor.beforeUpdatedAt }).success).toBe(false);
    expect(query.safeParse({ beforeEventId: cursor.beforeEventId }).success).toBe(false);
    expect(query.safeParse({ ...cursor, limit: "0" }).success).toBe(false);
    expect(query.safeParse({ ...cursor, limit: "101" }).success).toBe(false);
    expect(query.safeParse({ ...cursor, limit: "1.5" }).success).toBe(false);

    expect(page.parse({ events: [], next: cursor })).toEqual({ events: [], next: cursor });
    expect(page.parse({ events: [], next: null })).toEqual({ events: [], next: null });
    expect(page.safeParse({ events: [], next: cursor, createdBy: "private" }).success).toBe(false);
  });
});
