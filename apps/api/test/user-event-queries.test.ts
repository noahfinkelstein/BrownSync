import { describe, expect, it, vi } from "vitest";
import type { Sql } from "../src/db";
import { createQueries } from "../src/queries";

const ACTOR_ID = "30000000-0000-4000-8000-000000000001";
const EVENT_ID = "40000000-0000-4000-8000-000000000001";

function queryText(call: unknown[] | undefined): string {
  const strings = call?.[0] as TemplateStringsArray | undefined;
  return strings === undefined ? "" : strings.join("?").replaceAll(/\s+/g, " ").trim();
}

function sqlMock(rows: unknown[]) {
  const sql = vi.fn(async () => rows);
  return Object.assign(sql, {
    json: vi.fn((value: unknown) => ({ encoded: value })),
  });
}

const createInput = {
  clientRequestId: "50000000-0000-4000-8000-000000000001",
  organizationId: null,
  title: "Campus software study break",
  description: null,
  start: "2026-09-15T22:00:00Z",
  end: null,
  category: "social" as const,
  url: null,
  placeId: "salomon-center",
};

const managementRow = {
  event_id: EVENT_ID,
  organization_id: null,
  organization_name: null,
  title: "Campus software study break",
  description: null,
  start_ts: new Date("2026-09-15T22:00:00Z"),
  end_ts: null,
  place_id: "salomon-center",
  place_name: "Salomon Center",
  location_raw: null,
  category: "social",
  url: null,
  status: "published",
  moderation_state: "active",
  revision: 2,
  deleted_at: null,
  created_at: new Date("2026-07-30T16:00:00Z"),
  updated_at: new Date("2026-07-30T16:01:00Z"),
};

describe("student-event query adapter", () => {
  it("calls the exact actor-first create routine and maps replay disposition", async () => {
    const sql = sqlMock([{ event_id: EVENT_ID, revision: 2, replayed: true }]);

    const result = await createQueries(sql as unknown as Sql).createUserEvent?.(
      ACTOR_ID,
      createInput,
    );

    expect(queryText(sql.mock.calls[0])).toContain("brownsync_create_user_event(");
    expect(sql.mock.calls[0]?.slice(1)).toEqual([
      ACTOR_ID,
      createInput.clientRequestId,
      null,
      createInput.title,
      null,
      createInput.start,
      null,
      createInput.category,
      null,
      createInput.placeId,
      null,
    ]);
    expect(result).toEqual({
      kind: "ok",
      value: { eventId: EVENT_ID, revision: 2, replayed: true },
    });
  });

  it("translates only allowed camel-case edit keys into the exact JSONB patch routine", async () => {
    const sql = sqlMock([{ event_id: EVENT_ID, revision: 3, changed: true }]);
    const queries = createQueries(sql as unknown as Sql);

    const result = await queries.editUserEvent?.(ACTOR_ID, EVENT_ID, 2, {
      title: "Updated title",
      start: "2026-09-15T23:00:00Z",
      end: null,
      placeId: "sayles-hall",
    });

    expect(queryText(sql.mock.calls[0])).toContain("brownsync_edit_user_event(");
    expect(sql.mock.calls[0]?.slice(1, -1)).toEqual([ACTOR_ID, EVENT_ID, 2]);
    expect(sql.json).toHaveBeenCalledWith({
      title: "Updated title",
      start_ts: "2026-09-15T23:00:00Z",
      end_ts: null,
      place_id: "sayles-hall",
    });
    expect(result).toEqual({
      kind: "ok",
      value: { eventId: EVENT_ID, revision: 3, changed: true },
    });
  });

  it("keeps safety-reducing delete bodyless, revision-free, and actor-first", async () => {
    const sql = sqlMock([{ event_id: EVENT_ID, revision: 4, changed: false }]);

    const result = await createQueries(sql as unknown as Sql).deleteUserEvent?.(ACTOR_ID, EVENT_ID);

    expect(queryText(sql.mock.calls[0])).toContain("brownsync_delete_user_event(");
    expect(sql.mock.calls[0]?.slice(1)).toEqual([ACTOR_ID, EVENT_ID]);
    expect(result).toEqual({
      kind: "ok",
      value: { eventId: EVENT_ID, revision: 4, changed: false },
    });
  });

  it("maps a bounded descending management page and derives only its paired next cursor", async () => {
    const sql = sqlMock([{ ...managementRow, has_more: true, created_by: "must-not-leak" }]);
    const beforeUpdatedAt = "2026-07-31T00:00:00.000Z";
    const beforeEventId = "40000000-0000-4000-8000-000000000002";

    const result = await createQueries(sql as unknown as Sql).myUserEvents?.(ACTOR_ID, {
      beforeUpdatedAt,
      beforeEventId,
      limit: 25,
    });

    expect(queryText(sql.mock.calls[0])).toContain("brownsync_list_user_events(");
    expect(queryText(sql.mock.calls[0])).toContain("order by updated_at desc, event_id desc");
    expect(sql.mock.calls[0]?.slice(1)).toEqual([ACTOR_ID, beforeUpdatedAt, beforeEventId, 25]);
    expect(result).toEqual({
      kind: "ok",
      value: {
        events: [
          {
            id: EVENT_ID,
            organizationId: null,
            organizationName: null,
            title: managementRow.title,
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
          },
        ],
        next: {
          beforeUpdatedAt: "2026-07-30T16:01:00.000Z",
          beforeEventId: EVENT_ID,
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
    expect(JSON.stringify(result)).not.toContain("createdBy");
  });

  it("uses null cursor parts and returns a null cursor on the final management page", async () => {
    const sql = sqlMock([{ ...managementRow, has_more: false }]);

    const result = await createQueries(sql as unknown as Sql).myUserEvents?.(ACTOR_ID, {
      beforeUpdatedAt: null,
      beforeEventId: null,
      limit: 50,
    });

    expect(sql.mock.calls[0]?.slice(1)).toEqual([ACTOR_ID, null, null, 50]);
    expect(result).toMatchObject({ kind: "ok", value: { next: null } });
  });

  it("maps management detail without creator, idempotency, or coordinate internals", async () => {
    const sql = sqlMock([
      {
        ...managementRow,
        created_by: "must-not-leak",
        client_request_id: "must-not-leak",
        payload_fingerprint: "must-not-leak",
        lat: 41.8,
        lng: -71.4,
      },
    ]);

    const result = await createQueries(sql as unknown as Sql).myUserEvent?.(ACTOR_ID, EVENT_ID);
    const serialized = JSON.stringify(result);

    expect(queryText(sql.mock.calls[0])).toContain("brownsync_get_user_event(");
    expect(sql.mock.calls[0]?.slice(1)).toEqual([ACTOR_ID, EVENT_ID]);
    expect(result).toMatchObject({
      kind: "ok",
      value: {
        id: EVENT_ID,
        placeId: "salomon-center",
        revision: 2,
      },
    });
    for (const secret of [
      "created_by",
      "must-not-leak",
      "client_request_id",
      "payload_fingerprint",
      '"lat"',
      '"lng"',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it.each([
    ["INPUT_INVALID", "bad_request"],
    ["PATCH_INVALID", "bad_request"],
    ["QUEUE_INVALID", "bad_request"],
    ["UNAUTHORIZED", "forbidden"],
    ["FORBIDDEN", "forbidden"],
    ["ACCOUNT_TOO_NEW", "forbidden"],
    ["NOT_FOUND", "not_found"],
    ["ORGANIZATION_NOT_FOUND", "not_found"],
    ["REQUEST_CONFLICT", "conflict"],
    ["REVISION_CONFLICT", "conflict"],
    ["PLACE_NOT_FOUND", "unprocessable"],
    ["LOCATION_UNRESOLVED", "unprocessable"],
    ["RATE_LIMITED", "rate_limited"],
    ["POSTING_DISABLED", "unavailable"],
  ] as const)("maps stable database error %s to %s", async (suffix, kind) => {
    const sql = vi.fn(async () => {
      throw new Error(`BROWNSYNC_USER_EVENT_${suffix}`);
    });
    Object.assign(sql, { json: vi.fn() });

    const result = await createQueries(sql as unknown as Sql).createUserEvent?.(
      ACTOR_ID,
      createInput,
    );

    expect(result).toEqual({ kind });
  });

  it("maps unknown and structurally empty database results to unavailable", async () => {
    const sql = vi
      .fn()
      .mockRejectedValueOnce(new Error("sensitive driver failure"))
      .mockResolvedValueOnce([]);
    Object.assign(sql, { json: vi.fn() });
    const queries = createQueries(sql as unknown as Sql);

    const unknown = await queries.createUserEvent?.(ACTOR_ID, createInput);
    const empty = await queries.deleteUserEvent?.(ACTOR_ID, EVENT_ID);

    expect(unknown).toEqual({ kind: "unavailable" });
    expect(empty).toEqual({ kind: "unavailable" });
  });
});
