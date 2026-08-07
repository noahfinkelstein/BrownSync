import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { Authenticator, RateLimiterBinding } from "../src/auth";
import type { BoardIdentity } from "../src/board-identity";
import type { BoardQueries } from "../src/board-queries";
import type { Queries } from "../src/queries";
import { fakeQueries } from "./fixtures";

const ACTOR_ID = "95000000-0000-4000-8000-000000000001";
const EVENT_ID = "95000000-0000-4000-8000-000000000002";
const POST_ID = "95000000-0000-4000-8000-000000000003";
const CLIENT_REQUEST_ID = "95000000-0000-4000-8000-000000000004";
const AUTHOR_TOKEN = "b".repeat(64);

const authenticated: Authenticator = async (c, next) => {
  c.set("user", { id: ACTOR_ID, email: "member@brown.edu" });
  c.set("authentication", { oauthAuthenticatedAt: null });
  await next();
};

function limiter(success = true): RateLimiterBinding & { limit: ReturnType<typeof vi.fn> } {
  return { limit: vi.fn(async () => ({ success })) };
}

const identityValue = {
  actorId: ACTOR_ID,
  authorToken: AUTHOR_TOKEN,
  tokenVersion: 1 as const,
  alias: "Anonymous Otter BBBB" as const,
};

function boardIdentity(): BoardIdentity {
  return {
    derive: vi.fn(async () => ({
      kind: "ok" as const,
      value: identityValue,
    })),
  };
}

function boardQueries(overrides: Partial<BoardQueries> = {}): BoardQueries {
  const unavailable = async () => ({ kind: "unavailable" as const });
  return new Proxy(overrides as BoardQueries, {
    get(target, property, receiver) {
      return Reflect.has(target, property) ? Reflect.get(target, property, receiver) : unavailable;
    },
  });
}

function app(queryOverrides: Partial<Queries> = {}, boardOverrides: Partial<BoardQueries> = {}) {
  return createApp(fakeQueries(queryOverrides), {
    authenticator: authenticated,
    userReadLimiter: limiter(),
    userWriteLimiter: limiter(),
    boardQueries: boardQueries(boardOverrides),
    boardIdentity: boardIdentity(),
    boardWriteLimiter: limiter(),
  });
}

function jsonRequest(method: "POST" | "PATCH", body: unknown) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

const userEventCreateRequired = {
  clientRequestId: CLIENT_REQUEST_ID,
  title: "Campus software study break",
  start: "2026-09-15T22:00:00Z",
  category: "social",
  placeId: "salomon-center",
};

describe("nullable request normalization RED", () => {
  it("normalizes omitted and explicit-null create fields identically before the query seam", async () => {
    const createUserEvent = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "ok" as const,
        value: { eventId: EVENT_ID, revision: 0, replayed: false },
      })
      .mockResolvedValueOnce({
        kind: "ok" as const,
        value: { eventId: EVENT_ID, revision: 0, replayed: true },
      });
    const worker = app({ createUserEvent });

    const omitted = await worker.request(
      "/api/events",
      jsonRequest("POST", userEventCreateRequired),
    );
    const explicitNull = await worker.request(
      "/api/events",
      jsonRequest("POST", {
        ...userEventCreateRequired,
        organizationId: null,
        description: null,
        end: null,
        url: null,
      }),
    );
    const normalized = {
      ...userEventCreateRequired,
      organizationId: null,
      description: null,
      end: null,
      url: null,
    };

    expect([omitted.status, explicitNull.status]).toEqual([201, 201]);
    expect(createUserEvent).toHaveBeenNthCalledWith(1, ACTOR_ID, normalized);
    expect(createUserEvent).toHaveBeenNthCalledWith(2, ACTOR_ID, normalized);
    expect(createUserEvent.mock.calls[0]?.[1]).toEqual(createUserEvent.mock.calls[1]?.[1]);
    expect(await omitted.json()).toEqual({
      eventId: EVENT_ID,
      revision: 0,
      replayed: false,
    });
    expect(await explicitNull.json()).toEqual({
      eventId: EVENT_ID,
      revision: 0,
      replayed: true,
    });
  });

  it("normalizes OrgEdit V2 commands into the existing legacy patch seam", async () => {
    const editOrganization = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        organizationId: "brown-band",
        revision: 4,
        changed: true,
      },
    }));
    const worker = app({ editOrganization });

    const response = await worker.request(
      "/api/orgs/brown-band",
      jsonRequest("PATCH", {
        version: 2,
        expectedRevision: 3,
        patch: {
          description: { action: "clear" },
          aboutMd: { action: "set", value: "Updated about text" },
          links: {
            action: "set",
            value: [{ platform: "website", url: "https://example.edu/org" }],
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(editOrganization).toHaveBeenCalledWith(ACTOR_ID, "brown-band", 3, {
      description: null,
      aboutMd: "Updated about text",
      links: [{ platform: "website", url: "https://example.edu/org" }],
    });
  });

  it("normalizes UserEventEdit V2 commands into the existing legacy patch seam", async () => {
    const editUserEvent = vi.fn(async () => ({
      kind: "ok" as const,
      value: { eventId: EVENT_ID, revision: 3, changed: true },
    }));
    const worker = app({ editUserEvent });

    const response = await worker.request(
      `/api/events/${EVENT_ID}`,
      jsonRequest("PATCH", {
        version: 2,
        expectedRevision: 2,
        patch: {
          title: "Updated study break",
          description: { action: "clear" },
          end: { action: "set", value: "2026-09-16T00:30:00Z" },
          url: { action: "clear" },
          placeId: "sayles-hall",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(editUserEvent).toHaveBeenCalledWith(ACTOR_ID, EVENT_ID, 2, {
      title: "Updated study break",
      description: null,
      end: "2026-09-16T00:30:00Z",
      url: null,
      placeId: "sayles-hall",
    });
  });

  it("normalizes BoardEditPost V2 commands into the existing legacy request seam", async () => {
    const editPost = vi.fn(async () => ({
      kind: "ok" as const,
      value: { postId: POST_ID, revision: 3, changed: true },
    }));
    const worker = app({}, { editPost });

    const response = await worker.request(
      `/api/board/posts/${POST_ID}`,
      jsonRequest("PATCH", {
        version: 2,
        expectedRevision: 2,
        patch: {
          title: { action: "clear" },
          body: { action: "set", value: "Replacement body" },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(editPost).toHaveBeenCalledWith(identityValue, POST_ID, {
      expectedRevision: 2,
      title: null,
      body: "Replacement body",
    });
  });

  it("keeps all legacy route request shapes accepted", async () => {
    const editOrganization = vi.fn(async () => ({
      kind: "ok" as const,
      value: { organizationId: "brown-band", revision: 4, changed: true },
    }));
    const editUserEvent = vi.fn(async () => ({
      kind: "ok" as const,
      value: { eventId: EVENT_ID, revision: 3, changed: true },
    }));
    const editPost = vi.fn(async () => ({
      kind: "ok" as const,
      value: { postId: POST_ID, revision: 3, changed: true },
    }));
    const worker = app({ editOrganization, editUserEvent }, { editPost });

    const [organization, userEvent, boardPost] = await Promise.all([
      worker.request(
        "/api/orgs/brown-band",
        jsonRequest("PATCH", {
          expectedRevision: 3,
          patch: { description: "Updated", aboutMd: null },
        }),
      ),
      worker.request(
        `/api/events/${EVENT_ID}`,
        jsonRequest("PATCH", {
          expectedRevision: 2,
          patch: { description: null, end: null, url: null },
        }),
      ),
      worker.request(
        `/api/board/posts/${POST_ID}`,
        jsonRequest("PATCH", {
          expectedRevision: 2,
          title: null,
          body: "Replacement body",
        }),
      ),
    ]);

    expect([organization.status, userEvent.status, boardPost.status]).toEqual([200, 200, 200]);
    expect(editOrganization).toHaveBeenCalledWith(ACTOR_ID, "brown-band", 3, {
      description: "Updated",
      aboutMd: null,
    });
    expect(editUserEvent).toHaveBeenCalledWith(ACTOR_ID, EVENT_ID, 2, {
      description: null,
      end: null,
      url: null,
    });
    expect(editPost).toHaveBeenCalledWith(identityValue, POST_ID, {
      expectedRevision: 2,
      title: null,
      body: "Replacement body",
    });
  });

  it("keeps canonical routes and operation IDs unchanged", () => {
    const document = app().getOpenAPIDocument({
      openapi: "3.1.0",
      info: { title: "Nullable command RED", version: "1" },
    });

    expect(document.paths["/api/events"]?.post?.operationId).toBe("createUserEvent");
    expect(document.paths["/api/events/{id}"]?.patch?.operationId).toBe("updateUserEvent");
    expect(document.paths["/api/orgs/{id}"]?.patch?.operationId).toBe("updateOrganization");
    expect(document.paths["/api/board/posts/{postId}"]?.patch?.operationId).toBe("editBoardPost");
  });
});
