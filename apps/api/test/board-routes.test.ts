import {
  BOARD_EDGE_METADATA_NOTICE,
  BOARD_PRIVACY_NOTICE,
  BoardCreatePostResultSchema,
  BoardFeedSchema,
} from "@brownsync/contract";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import type { AuthEnv, Authenticator, RateLimiterBinding } from "../src/auth";
import type { BoardIdentity } from "../src/board-identity";
import type { BoardQueries } from "../src/board-queries";
import { registerBoardRoutes } from "../src/board-routes";
import { errorEnvelope } from "../src/errors";

const ACTOR_ID = "83000000-0000-4000-8000-000000000001";
const POST_ID = "83000000-0000-4000-8000-000000000002";
const COMMENT_ID = "83000000-0000-4000-8000-000000000003";
const REQUEST_ID = "83000000-0000-4000-8000-000000000004";
const AUTHOR_TOKEN = "a".repeat(64);
const CREATED_AT = "2026-07-30T18:00:00.000Z";

const authenticated: Authenticator = async (c, next) => {
  c.set("user", { id: ACTOR_ID, email: "member@brown.edu" });
  c.set("authentication", { oauthAuthenticatedAt: null });
  await next();
};

function blocked(status: 401 | 403): Authenticator {
  return async (c) =>
    c.json(
      errorEnvelope(status === 401 ? "unauthorized" : "brown_membership_required", "blocked"),
      status,
    );
}

function limiter(success = true): RateLimiterBinding & { limit: ReturnType<typeof vi.fn> } {
  return { limit: vi.fn(async () => ({ success })) };
}

function identity(
  result: Awaited<ReturnType<BoardIdentity["derive"]>> = {
    kind: "ok",
    value: {
      actorId: ACTOR_ID,
      authorToken: AUTHOR_TOKEN,
      tokenVersion: 1,
      alias: "Anonymous Otter AAAA",
    },
  },
): BoardIdentity & { derive: ReturnType<typeof vi.fn> } {
  return { derive: vi.fn(async () => result) };
}

function queries(overrides: Partial<BoardQueries> = {}): BoardQueries {
  const unavailable = async () => ({ kind: "unavailable" as const });
  return new Proxy(overrides as BoardQueries, {
    get(target, property, receiver) {
      return Reflect.has(target, property) ? Reflect.get(target, property, receiver) : unavailable;
    },
  });
}

function createBoardApp(
  boardQueries: BoardQueries,
  options: {
    authenticator?: Authenticator;
    boardIdentity?: BoardIdentity;
    boardWriteLimiter?: RateLimiterBinding;
  } = {},
) {
  const app = new OpenAPIHono<AuthEnv>({
    defaultHook: (result, c) => {
      if (!result.success)
        return c.json(errorEnvelope("bad_request", "Malformed board request."), 400);
    },
  });
  app.onError((_error, c) => c.json(errorEnvelope("internal", "Unexpected server error."), 500));
  app.notFound((c) => c.json(errorEnvelope("not_found", "No such route."), 404));
  registerBoardRoutes(app, boardQueries, {
    authenticator: options.authenticator ?? authenticated,
    boardIdentity: options.boardIdentity ?? identity(),
    boardWriteLimiter: options.boardWriteLimiter ?? limiter(),
  });
  return app;
}

const feed = {
  posts: [
    {
      id: POST_ID,
      title: "Question",
      body: "What should BrownSync build?",
      visibility: "visible" as const,
      moderationEpoch: 0,
      score: 1,
      revision: 1,
      authorAlias: "Anonymous Otter AAAA",
      isMine: true,
      commentCount: 0,
      myVote: 0 as const,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
  ],
  nextCursor: null,
};

describe("board route surface and dependency ordering", () => {
  it("registers every frozen member, moderator, and owner method including HEAD", () => {
    const app = createBoardApp(queries());
    const document = app.getOpenAPIDocument({
      openapi: "3.1.0",
      info: { title: "Board", version: "1" },
    });
    const expected: Record<string, string[]> = {
      "/api/board/feed": ["get", "head"],
      "/api/board/posts/{postId}": ["get", "head", "patch", "delete"],
      "/api/board/mine": ["get", "head"],
      "/api/board/status": ["get", "head"],
      "/api/board/posts": ["post"],
      "/api/board/posts/{postId}/comments": ["post"],
      "/api/board/comments/{commentId}": ["patch", "delete"],
      "/api/board/posts/{postId}/vote": ["put"],
      "/api/board/comments/{commentId}/vote": ["put"],
      "/api/board/posts/{postId}/reports": ["post"],
      "/api/board/comments/{commentId}/reports": ["post"],
      "/api/board/posts/{postId}/appeals": ["post"],
      "/api/board/comments/{commentId}/appeals": ["post"],
      "/api/board/bans/{banId}/appeals": ["post"],
      "/api/board/moderation/queue": ["get", "head"],
      "/api/board/moderation/posts/{postId}/decision": ["post"],
      "/api/board/moderation/comments/{commentId}/decision": ["post"],
      "/api/board/moderation/posts/{postId}/bans": ["post"],
      "/api/board/moderation/comments/{commentId}/bans": ["post"],
      "/api/board/moderation/bans/{banId}/revoke": ["post"],
      "/api/board/moderation/appeals/{appealId}/decision": ["post"],
      "/api/board/admin/config": ["get", "head", "patch"],
      "/api/board/admin/moderators": ["get", "head"],
      "/api/board/admin/moderators/{userId}": ["put", "delete"],
    };

    expect(Object.keys(document.paths).sort()).toEqual(Object.keys(expected).sort());
    for (const [path, methods] of Object.entries(expected)) {
      const registered = Object.keys(document.paths[path] ?? {}).filter(
        (method) => method !== "parameters",
      );
      expect(registered.sort(), path).toEqual(methods.sort());
    }
  });

  it.each([
    "/api/board/feed",
    `/api/board/posts/${POST_ID}`,
    "/api/board/moderation/queue",
    "/api/board/admin/config",
    `/api/board/moderation/posts/${POST_ID}/decision`,
  ])("keeps OPTIONS unauthenticated and dependency-free for %s", async (path) => {
    const auth = vi.fn<Authenticator>(async (_c, next) => {
      await next();
    });
    const writeLimiter = limiter();
    const boardIdentity = identity();
    const getFeed = vi.fn();
    const app = createBoardApp(queries({ getFeed }), {
      authenticator: auth,
      boardIdentity,
      boardWriteLimiter: writeLimiter,
    });

    const response = await app.request(path, { method: "OPTIONS" });

    expect(response.status).toBe(204);
    expect(auth).not.toHaveBeenCalled();
    expect(writeLimiter.limit).not.toHaveBeenCalled();
    expect(boardIdentity.derive).not.toHaveBeenCalled();
    expect(getFeed).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", "/api/board/posts", "createPost"],
    ["PATCH", `/api/board/posts/${POST_ID}`, "editPost"],
    ["DELETE", `/api/board/comments/${COMMENT_ID}`, "deleteComment"],
    ["PUT", `/api/board/posts/${POST_ID}/vote`, "setVote"],
  ] as const)(
    "runs authentication before any write dependency for %s %s",
    async (method, path, queryName) => {
      const writeLimiter = limiter();
      const boardIdentity = identity();
      const query = vi.fn();
      const app = createBoardApp(queries({ [queryName]: query } as Partial<BoardQueries>), {
        authenticator: blocked(401),
        boardIdentity,
        boardWriteLimiter: writeLimiter,
      });

      const response = await app.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(401);
      expect(writeLimiter.limit).not.toHaveBeenCalled();
      expect(boardIdentity.derive).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("runs auth, write limiter, identity, and database in exact order", async () => {
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
    const boardIdentity: BoardIdentity = {
      derive: vi.fn(async () => {
        order.push("identity");
        return {
          kind: "ok" as const,
          value: {
            actorId: ACTOR_ID,
            authorToken: AUTHOR_TOKEN,
            tokenVersion: 1 as const,
            alias: "Anonymous Otter AAAA",
          },
        };
      }),
    };
    const createPost = vi.fn(async () => {
      order.push("query");
      return {
        kind: "ok" as const,
        value: { postId: POST_ID, revision: 1, replayed: false },
      };
    });
    const app = createBoardApp(queries({ createPost }), {
      authenticator: auth,
      boardIdentity,
      boardWriteLimiter: writeLimiter,
    });

    const response = await app.request("/api/board/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientRequestId: REQUEST_ID,
        title: "  Question  ",
        body: "  What should we build?  ",
      }),
    });

    expect(response.status).toBe(201);
    expect(BoardCreatePostResultSchema.parse(await response.json())).toEqual({
      postId: POST_ID,
      revision: 1,
      replayed: false,
    });
    expect(order).toEqual(["auth", "limit", "identity", "query"]);
    expect(createPost).toHaveBeenCalledWith(
      {
        actorId: ACTOR_ID,
        authorToken: AUTHOR_TOKEN,
        tokenVersion: 1,
        alias: "Anonymous Otter AAAA",
      },
      {
        clientRequestId: REQUEST_ID,
        title: "Question",
        body: "What should we build?",
      },
    );
  });

  it.each(["GET", "HEAD"])(
    "keeps %s board reads authenticated and DB-backed without a limiter",
    async (method) => {
      const order: string[] = [];
      const auth: Authenticator = async (c, next) => {
        order.push("auth");
        c.set("user", { id: ACTOR_ID, email: "member@brown.edu" });
        c.set("authentication", { oauthAuthenticatedAt: null });
        await next();
      };
      const boardIdentity: BoardIdentity = {
        derive: vi.fn(async () => {
          order.push("identity");
          return {
            kind: "ok" as const,
            value: {
              actorId: ACTOR_ID,
              authorToken: AUTHOR_TOKEN,
              tokenVersion: 1 as const,
              alias: "Anonymous Otter AAAA",
            },
          };
        }),
      };
      const getFeed = vi.fn(async () => {
        order.push("query");
        return { kind: "ok" as const, value: feed };
      });
      const writeLimiter = limiter(false);
      const app = createBoardApp(queries({ getFeed }), {
        authenticator: auth,
        boardIdentity,
        boardWriteLimiter: writeLimiter,
      });

      const response = await app.request("/api/board/feed", { method });

      expect(response.status).toBe(200);
      expect(order).toEqual(["auth", "identity", "query"]);
      expect(writeLimiter.limit).not.toHaveBeenCalled();
      expect(getFeed).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: ACTOR_ID, authorToken: AUTHOR_TOKEN }),
        { limit: 25 },
      );
      if (method === "GET") {
        expect(BoardFeedSchema.parse(await response.json())).toEqual(feed);
      } else {
        expect(await response.text()).toBe("");
      }
    },
  );

  it("derives identity before moderator and owner queries but passes only actor UUID to SQL seams", async () => {
    const boardIdentity = identity();
    const decideContent = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        targetType: "post" as const,
        targetId: POST_ID,
        visibility: "moderator_hidden" as const,
        moderationEpoch: 1,
        revision: 2,
        replayed: false,
      },
    }));
    const getConfig = vi.fn(async () => ({
      kind: "ok" as const,
      value: { enabled: true, autoHideThreshold: 3, updatedAt: CREATED_AT },
    }));
    const app = createBoardApp(queries({ decideContent, getConfig }), { boardIdentity });

    const decision = await app.request(`/api/board/moderation/posts/${POST_ID}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientRequestId: REQUEST_ID,
        expectedEpoch: 0,
        action: "hide",
        reason: "Safety",
      }),
    });
    const config = await app.request("/api/board/admin/config");

    expect(decision.status).toBe(200);
    expect(config.status).toBe(200);
    expect(boardIdentity.derive).toHaveBeenCalledTimes(2);
    expect(decideContent).toHaveBeenCalledWith(
      ACTOR_ID,
      { postId: POST_ID, commentId: null },
      {
        clientRequestId: REQUEST_ID,
        expectedEpoch: 0,
        action: "hide",
        reason: "Safety",
      },
    );
    expect(getConfig).toHaveBeenCalledWith(ACTOR_ID);
  });

  it.each([
    [
      "moderator",
      `/api/board/moderation/posts/${POST_ID}/decision`,
      {
        clientRequestId: REQUEST_ID,
        expectedEpoch: 0,
        action: "hide",
        reason: "Safety",
      },
    ],
    ["owner", "/api/board/admin/config", { enabled: false, autoHideThreshold: 4 }],
  ] as const)(
    "runs auth, limiter, identity, and query for a %s write",
    async (role, path, body) => {
      const order: string[] = [];
      const auth: Authenticator = async (c, next) => {
        order.push("auth");
        c.set("user", { id: ACTOR_ID, email: "member@brown.edu" });
        c.set("authentication", { oauthAuthenticatedAt: null });
        await next();
      };
      const boardIdentity: BoardIdentity = {
        derive: vi.fn(async () => {
          order.push("identity");
          return {
            kind: "ok" as const,
            value: {
              actorId: ACTOR_ID,
              authorToken: AUTHOR_TOKEN,
              tokenVersion: 1 as const,
              alias: "Anonymous Otter AAAA",
            },
          };
        }),
      };
      const writeLimiter = {
        limit: vi.fn(async () => {
          order.push("limit");
          return { success: true };
        }),
      };
      const decideContent = vi.fn(async () => {
        order.push("query");
        return {
          kind: "ok" as const,
          value: {
            targetType: "post" as const,
            targetId: POST_ID,
            visibility: "moderator_hidden" as const,
            moderationEpoch: 1,
            revision: 2,
            replayed: false,
          },
        };
      });
      const setConfig = vi.fn(async () => {
        order.push("query");
        return {
          kind: "ok" as const,
          value: {
            enabled: false,
            autoHideThreshold: 4,
            updatedAt: CREATED_AT,
            changed: true,
          },
        };
      });
      const app = createBoardApp(queries({ decideContent, setConfig }), {
        authenticator: auth,
        boardIdentity,
        boardWriteLimiter: writeLimiter,
      });

      const response = await app.request(path, {
        method: role === "moderator" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(200);
      expect(order).toEqual(["auth", "limit", "identity", "query"]);
    },
  );

  it.each([
    ["GET", "/api/board/status"],
    ["POST", "/api/board/posts"],
    ["GET", "/api/board/moderation/queue"],
    ["GET", "/api/board/admin/config"],
  ])("fails %s %s closed at identity without reaching the database", async (method, path) => {
    const getStatus = vi.fn();
    const createPost = vi.fn();
    const getModerationQueue = vi.fn();
    const getConfig = vi.fn();
    const app = createBoardApp(queries({ getStatus, createPost, getModerationQueue, getConfig }), {
      boardIdentity: identity({ kind: "unavailable" }),
    });

    const response = await app.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body:
        method === "POST"
          ? JSON.stringify({
              clientRequestId: REQUEST_ID,
              body: "Question",
            })
          : undefined,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "board_service_unavailable", message: "Board service unavailable." },
    });
    expect(getStatus).not.toHaveBeenCalled();
    expect(createPost).not.toHaveBeenCalled();
    expect(getModerationQueue).not.toHaveBeenCalled();
    expect(getConfig).not.toHaveBeenCalled();
  });

  it.each([
    [
      "mismatched actor",
      {
        kind: "ok",
        value: {
          actorId: "83000000-0000-4000-8000-000000000099",
          authorToken: AUTHOR_TOKEN,
          tokenVersion: 1,
          alias: "Anonymous Otter AAAA",
        },
      },
    ],
    [
      "invalid token",
      {
        kind: "ok",
        value: {
          actorId: ACTOR_ID,
          authorToken: "secret-token",
          tokenVersion: 1,
          alias: "Anonymous Otter SECR",
        },
      },
    ],
    [
      "mismatched alias",
      {
        kind: "ok",
        value: {
          actorId: ACTOR_ID,
          authorToken: AUTHOR_TOKEN,
          tokenVersion: 1,
          alias: "Anonymous Otter BBBB",
        },
      },
    ],
    [
      "invalid version",
      {
        kind: "ok",
        value: {
          actorId: ACTOR_ID,
          authorToken: AUTHOR_TOKEN,
          tokenVersion: 2,
          alias: "Anonymous Otter AAAA",
        },
      },
    ],
  ] as const)("fails closed for a %s identity adapter result", async (_label, derived) => {
    const getStatus = vi.fn();
    const boardIdentity = {
      derive: vi.fn(async () => derived),
    } as unknown as BoardIdentity;
    const app = createBoardApp(queries({ getStatus }), { boardIdentity });

    const response = await app.request("/api/board/status");

    expect(response.status).toBe(503);
    expect(getStatus).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(AUTHOR_TOKEN);
  });

  it("turns a thrown identity failure into a secret-free 503 without logging or querying", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const getStatus = vi.fn();
    const boardIdentity: BoardIdentity = {
      derive: vi.fn(async () => {
        throw new Error(AUTHOR_TOKEN);
      }),
    };
    const app = createBoardApp(queries({ getStatus }), { boardIdentity });

    const response = await app.request("/api/board/status");

    expect(response.status).toBe(503);
    expect(getStatus).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(AUTHOR_TOKEN);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  it("contains a thrown query failure as a secret-free 503 without reaching the global logger", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const getStatus = vi.fn(async () => {
      throw new Error(AUTHOR_TOKEN);
    });
    const app = createBoardApp(queries({ getStatus }));

    const response = await app.request("/api/board/status");

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(AUTHOR_TOKEN);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  it("rejects malformed cursor, path IDs, and strict request additions before identity or query", async () => {
    const boardIdentity = identity();
    const getFeed = vi.fn();
    const createPost = vi.fn();
    const app = createBoardApp(queries({ getFeed, createPost }), { boardIdentity });

    const [cursor, path, body] = await Promise.all([
      app.request("/api/board/feed?cursor=e30"),
      app.request("/api/board/posts/not-a-uuid"),
      app.request("/api/board/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRequestId: REQUEST_ID,
          body: "Question",
          actorId: ACTOR_ID,
        }),
      }),
    ]);

    expect([cursor.status, path.status, body.status]).toEqual([400, 400, 400]);
    expect(boardIdentity.derive).not.toHaveBeenCalled();
    expect(getFeed).not.toHaveBeenCalled();
    expect(createPost).not.toHaveBeenCalled();
  });

  it.each([
    ["bad_request", 400],
    ["unauthorized", 401],
    ["forbidden", 403],
    ["banned", 403],
    ["not_found", 404],
    ["conflict", 409],
    ["rate_limited", 429],
    ["unavailable", 503],
  ] as const)("maps query failure %s to HTTP %s", async (kind, status) => {
    const getStatus = vi.fn(async () => ({ kind }));
    const app = createBoardApp(queries({ getStatus }));

    const response = await app.request("/api/board/status");

    expect(response.status).toBe(status);
    if (status === 429) expect(response.headers.get("retry-after")).toBe("60");
  });

  it("pins both privacy notices in status responses", async () => {
    const getStatus = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        enabled: true,
        authorAlias: "Anonymous Otter AAAA",
        banned: false,
        banId: null,
        bannedUntil: null,
        banReason: null,
        pendingAppeals: 0,
        privacyNotice: BOARD_PRIVACY_NOTICE as typeof BOARD_PRIVACY_NOTICE,
        edgeMetadataNotice: BOARD_EDGE_METADATA_NOTICE as typeof BOARD_EDGE_METADATA_NOTICE,
      },
    }));
    const app = createBoardApp(queries({ getStatus }));
    const response = await app.request("/api/board/status");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      privacyNotice: BOARD_PRIVACY_NOTICE,
      edgeMetadataNotice: BOARD_EDGE_METADATA_NOTICE,
    });
    expect(JSON.stringify(payload)).not.toContain(AUTHOR_TOKEN);
  });

  it("fails closed without reflecting a secret-bearing query projection", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const getStatus = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        enabled: true,
        authorAlias: "Anonymous Otter AAAA",
        banned: false,
        banId: null,
        bannedUntil: null,
        banReason: null,
        pendingAppeals: 0,
        privacyNotice: BOARD_PRIVACY_NOTICE as typeof BOARD_PRIVACY_NOTICE,
        edgeMetadataNotice: BOARD_EDGE_METADATA_NOTICE as typeof BOARD_EDGE_METADATA_NOTICE,
        authorToken: AUTHOR_TOKEN,
      },
    }));
    const app = createBoardApp(queries({ getStatus }));

    const response = await app.request("/api/board/status");

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(AUTHOR_TOKEN);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});
