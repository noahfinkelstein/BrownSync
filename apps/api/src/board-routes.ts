import {
  type BoardAlias,
  BoardAppealDecisionRequestSchema,
  BoardAppealDecisionResultSchema,
  BoardAppealResultSchema,
  BoardBanAppealRequestSchema,
  BoardBanRequestSchema,
  BoardBanResultSchema,
  BoardBanRevokeRequestSchema,
  BoardBanRevokeResultSchema,
  BoardCommentMutationResultSchema,
  BoardConfigMutationResultSchema,
  BoardConfigSchema,
  BoardConfigUpdateRequestSchema,
  BoardContentAppealRequestSchema,
  BoardCreateCommentRequestSchema,
  BoardCreateCommentResultSchema,
  BoardCreatePostRequestSchema,
  BoardCreatePostResultSchema,
  BoardDeleteRequestSchema,
  BoardEditCommentRequestSchema,
  type BoardEditPostRequest,
  BoardEditPostRequestSchema,
  BoardFeedQuerySchema,
  BoardFeedSchema,
  BoardModerationDecisionRequestSchema,
  BoardModerationDecisionResultSchema,
  BoardModerationQueueQuerySchema,
  BoardModerationQueueSchema,
  BoardModeratorMutationResultSchema,
  BoardModeratorQuerySchema,
  BoardModeratorsSchema,
  BoardModeratorUpsertRequestSchema,
  BoardOwnContentQuerySchema,
  BoardOwnContentSchema,
  BoardPostMutationResultSchema,
  BoardReportRequestSchema,
  BoardReportResultSchema,
  BoardStatusSchema,
  BoardThreadQuerySchema,
  BoardThreadSchema,
  BoardVoteRequestSchema,
  BoardVoteResultSchema,
} from "@brownsync/contract";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import {
  type AuthEnv,
  type Authenticator,
  createUserWriteRateLimitMiddleware,
  type RateLimiterBinding,
} from "./auth";
import { type BoardIdentity, isBoardActorIdentity } from "./board-identity";
import type {
  BoardEditPostQueryInput,
  BoardIdentityContext,
  BoardQueries,
  BoardQueryFailure,
} from "./board-queries";
import { errorEnvelope } from "./errors";
import { ErrorEnvelopeSchema } from "./routes";

const json = <S>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const noContent = (description: string) => ({ description });
const badRequest = json(ErrorEnvelopeSchema, "Malformed path, query, or request body");
const unauthorized = json(ErrorEnvelopeSchema, "Missing or invalid bearer token");
const forbidden = json(ErrorEnvelopeSchema, "Brown membership or board authority required");
const notFound = json(ErrorEnvelopeSchema, "Board target not found");
const conflict = json(ErrorEnvelopeSchema, "Board state or request identity conflict");
const rateLimited = json(ErrorEnvelopeSchema, "Authenticated board write limit exceeded");
const unavailable = json(ErrorEnvelopeSchema, "Board service temporarily unavailable");
const security = [{ bearerAuth: [] }];

function normalizeBoardEditPost(input: BoardEditPostRequest): BoardEditPostQueryInput {
  if (!("version" in input)) return input;

  const normalized: BoardEditPostQueryInput = {
    expectedRevision: input.expectedRevision,
  };
  if (input.patch.title !== undefined) {
    normalized.title = input.patch.title.action === "clear" ? null : input.patch.title.value;
  }
  if (input.patch.body !== undefined) normalized.body = input.patch.body.value;
  return normalized;
}

const commonResponses = {
  400: badRequest,
  401: unauthorized,
  403: forbidden,
  404: notFound,
  409: conflict,
  429: rateLimited,
  503: unavailable,
};

const postParams = z.object({ postId: z.uuid() }).strict();
const commentParams = z.object({ commentId: z.uuid() }).strict();
const banParams = z.object({ banId: z.uuid() }).strict();
const appealParams = z.object({ appealId: z.uuid() }).strict();
const userParams = z.object({ userId: z.uuid() }).strict();

const feedRoute = createRoute({
  method: "get",
  path: "/api/board/feed",
  operationId: "getBoardFeed",
  summary: "Get the authenticated pseudonymous board feed",
  security,
  request: { query: BoardFeedQuerySchema },
  responses: { 200: json(BoardFeedSchema, "Bounded newest-first board feed"), ...commonResponses },
});

const feedHeadRoute = createRoute({
  method: "head",
  path: "/api/board/feed",
  operationId: "headBoardFeed",
  summary: "Check the authenticated board feed",
  security,
  request: { query: BoardFeedQuerySchema },
  responses: { 200: noContent("Board feed is available"), ...commonResponses },
});

const threadRoute = createRoute({
  method: "get",
  path: "/api/board/posts/{postId}",
  operationId: "getBoardThread",
  summary: "Get one visible board post and its bounded comments",
  security,
  request: { params: postParams, query: BoardThreadQuerySchema },
  responses: {
    200: json(BoardThreadSchema, "Post and oldest-first comment page"),
    ...commonResponses,
  },
});

const threadHeadRoute = createRoute({
  method: "head",
  path: "/api/board/posts/{postId}",
  operationId: "headBoardThread",
  summary: "Check one authenticated board thread",
  security,
  request: { params: postParams, query: BoardThreadQuerySchema },
  responses: { 200: noContent("Board thread is available"), ...commonResponses },
});

const mineRoute = createRoute({
  method: "get",
  path: "/api/board/mine",
  operationId: "getOwnBoardContent",
  summary: "List the authenticated member's own board content",
  security,
  request: { query: BoardOwnContentQuerySchema },
  responses: {
    200: json(BoardOwnContentSchema, "Bounded own-content page including hidden states"),
    ...commonResponses,
  },
});

const mineHeadRoute = createRoute({
  method: "head",
  path: "/api/board/mine",
  operationId: "headOwnBoardContent",
  summary: "Check the authenticated member's own board content",
  security,
  request: { query: BoardOwnContentQuerySchema },
  responses: { 200: noContent("Own board content is available"), ...commonResponses },
});

const statusRoute = createRoute({
  method: "get",
  path: "/api/board/status",
  operationId: "getBoardStatus",
  summary: "Get board availability, alias, ban status, and privacy disclosures",
  security,
  responses: { 200: json(BoardStatusSchema, "Board member status"), ...commonResponses },
});

const statusHeadRoute = createRoute({
  method: "head",
  path: "/api/board/status",
  operationId: "headBoardStatus",
  summary: "Check authenticated board status",
  security,
  responses: { 200: noContent("Board status is available"), ...commonResponses },
});

const createPostRoute = createRoute({
  method: "post",
  path: "/api/board/posts",
  operationId: "createBoardPost",
  summary: "Create an idempotent pseudonymous board post",
  security,
  request: {
    body: {
      content: { "application/json": { schema: BoardCreatePostRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: json(BoardCreatePostResultSchema, "Created or idempotently replayed post"),
    ...commonResponses,
  },
});

const editPostRoute = createRoute({
  method: "patch",
  path: "/api/board/posts/{postId}",
  operationId: "editBoardPost",
  summary: "Optimistically edit an authored board post",
  security,
  request: {
    params: postParams,
    body: {
      content: { "application/json": { schema: BoardEditPostRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: json(BoardPostMutationResultSchema, "Effective post revision"),
    ...commonResponses,
  },
});

const deletePostRoute = createRoute({
  method: "delete",
  path: "/api/board/posts/{postId}",
  operationId: "deleteBoardPost",
  summary: "Tombstone an authored board post",
  security,
  request: {
    params: postParams,
    body: {
      content: { "application/json": { schema: BoardDeleteRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: json(BoardPostMutationResultSchema, "Observable terminal replay result"),
    ...commonResponses,
  },
});

const createCommentRoute = createRoute({
  method: "post",
  path: "/api/board/posts/{postId}/comments",
  operationId: "createBoardComment",
  summary: "Create an idempotent pseudonymous board comment",
  security,
  request: {
    params: postParams,
    body: {
      content: { "application/json": { schema: BoardCreateCommentRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: json(BoardCreateCommentResultSchema, "Created or idempotently replayed comment"),
    ...commonResponses,
  },
});

const editCommentRoute = createRoute({
  method: "patch",
  path: "/api/board/comments/{commentId}",
  operationId: "editBoardComment",
  summary: "Optimistically edit an authored board comment",
  security,
  request: {
    params: commentParams,
    body: {
      content: { "application/json": { schema: BoardEditCommentRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: json(BoardCommentMutationResultSchema, "Effective comment revision"),
    ...commonResponses,
  },
});

const deleteCommentRoute = createRoute({
  method: "delete",
  path: "/api/board/comments/{commentId}",
  operationId: "deleteBoardComment",
  summary: "Tombstone an authored board comment",
  security,
  request: {
    params: commentParams,
    body: {
      content: { "application/json": { schema: BoardDeleteRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: json(BoardCommentMutationResultSchema, "Observable terminal replay result"),
    ...commonResponses,
  },
});

function targetWriteRoute(
  operationId: string,
  summary: string,
  path: string,
  schema: typeof BoardVoteRequestSchema | typeof BoardReportRequestSchema,
  responseSchema: typeof BoardVoteResultSchema | typeof BoardReportResultSchema,
) {
  return createRoute({
    method: operationId.includes("Vote") ? "put" : "post",
    path,
    operationId,
    summary,
    security,
    request: {
      params: path.includes("comments") ? commentParams : postParams,
      body: { content: { "application/json": { schema } }, required: true },
    },
    responses: { 200: json(responseSchema, "Board mutation result"), ...commonResponses },
  });
}

const votePostRoute = targetWriteRoute(
  "setBoardPostVote",
  "Set or clear the authenticated member's post vote",
  "/api/board/posts/{postId}/vote",
  BoardVoteRequestSchema,
  BoardVoteResultSchema,
);
const voteCommentRoute = targetWriteRoute(
  "setBoardCommentVote",
  "Set or clear the authenticated member's comment vote",
  "/api/board/comments/{commentId}/vote",
  BoardVoteRequestSchema,
  BoardVoteResultSchema,
);
const reportPostRoute = targetWriteRoute(
  "reportBoardPost",
  "Report a board post once per moderation epoch",
  "/api/board/posts/{postId}/reports",
  BoardReportRequestSchema,
  BoardReportResultSchema,
);
const reportCommentRoute = targetWriteRoute(
  "reportBoardComment",
  "Report a board comment once per moderation epoch",
  "/api/board/comments/{commentId}/reports",
  BoardReportRequestSchema,
  BoardReportResultSchema,
);

const appealPostRoute = createRoute({
  method: "post",
  path: "/api/board/posts/{postId}/appeals",
  operationId: "appealBoardPost",
  summary: "Appeal moderation of an authored post",
  security,
  request: {
    params: postParams,
    body: {
      content: { "application/json": { schema: BoardContentAppealRequestSchema } },
      required: true,
    },
  },
  responses: { 200: json(BoardAppealResultSchema, "Appeal result"), ...commonResponses },
});

const appealCommentRoute = createRoute({
  method: "post",
  path: "/api/board/comments/{commentId}/appeals",
  operationId: "appealBoardComment",
  summary: "Appeal moderation of an authored comment",
  security,
  request: {
    params: commentParams,
    body: {
      content: { "application/json": { schema: BoardContentAppealRequestSchema } },
      required: true,
    },
  },
  responses: { 200: json(BoardAppealResultSchema, "Appeal result"), ...commonResponses },
});

const appealBanRoute = createRoute({
  method: "post",
  path: "/api/board/bans/{banId}/appeals",
  operationId: "appealBoardBan",
  summary: "Appeal the authenticated member's board ban",
  security,
  request: {
    params: banParams,
    body: {
      content: { "application/json": { schema: BoardBanAppealRequestSchema } },
      required: true,
    },
  },
  responses: { 200: json(BoardAppealResultSchema, "Appeal result"), ...commonResponses },
});

const moderationQueueRoute = createRoute({
  method: "get",
  path: "/api/board/moderation/queue",
  operationId: "getBoardModerationQueue",
  summary: "List the bounded moderation queue",
  security,
  request: { query: BoardModerationQueueQuerySchema },
  responses: {
    200: json(BoardModerationQueueSchema, "Reports and appeals without member identities"),
    ...commonResponses,
  },
});

const moderationQueueHeadRoute = createRoute({
  method: "head",
  path: "/api/board/moderation/queue",
  operationId: "headBoardModerationQueue",
  summary: "Check the moderation queue",
  security,
  request: { query: BoardModerationQueueQuerySchema },
  responses: { 200: noContent("Moderation queue is available"), ...commonResponses },
});

function moderationTargetRoute(
  operationId: string,
  summary: string,
  path: string,
  schema: typeof BoardModerationDecisionRequestSchema | typeof BoardBanRequestSchema,
  responseSchema: typeof BoardModerationDecisionResultSchema | typeof BoardBanResultSchema,
) {
  return createRoute({
    method: "post",
    path,
    operationId,
    summary,
    security,
    request: {
      params: path.includes("comments") ? commentParams : postParams,
      body: { content: { "application/json": { schema } }, required: true },
    },
    responses: { 200: json(responseSchema, "Moderation result"), ...commonResponses },
  });
}

const decidePostRoute = moderationTargetRoute(
  "decideBoardPost",
  "Apply an idempotent moderation decision to a post",
  "/api/board/moderation/posts/{postId}/decision",
  BoardModerationDecisionRequestSchema,
  BoardModerationDecisionResultSchema,
);
const decideCommentRoute = moderationTargetRoute(
  "decideBoardComment",
  "Apply an idempotent moderation decision to a comment",
  "/api/board/moderation/comments/{commentId}/decision",
  BoardModerationDecisionRequestSchema,
  BoardModerationDecisionResultSchema,
);
const banPostRoute = moderationTargetRoute(
  "createBoardPostBan",
  "Ban the anonymous author of a post",
  "/api/board/moderation/posts/{postId}/bans",
  BoardBanRequestSchema,
  BoardBanResultSchema,
);
const banCommentRoute = moderationTargetRoute(
  "createBoardCommentBan",
  "Ban the anonymous author of a comment",
  "/api/board/moderation/comments/{commentId}/bans",
  BoardBanRequestSchema,
  BoardBanResultSchema,
);

const revokeBanRoute = createRoute({
  method: "post",
  path: "/api/board/moderation/bans/{banId}/revoke",
  operationId: "revokeBoardBan",
  summary: "Idempotently revoke a board ban",
  security,
  request: {
    params: banParams,
    body: {
      content: { "application/json": { schema: BoardBanRevokeRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: json(BoardBanRevokeResultSchema, "Observable ban revocation result"),
    ...commonResponses,
  },
});

const decideAppealRoute = createRoute({
  method: "post",
  path: "/api/board/moderation/appeals/{appealId}/decision",
  operationId: "decideBoardAppeal",
  summary: "Apply an idempotent appeal decision",
  security,
  request: {
    params: appealParams,
    body: {
      content: { "application/json": { schema: BoardAppealDecisionRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: json(BoardAppealDecisionResultSchema, "Appeal decision result"),
    ...commonResponses,
  },
});

const configRoute = createRoute({
  method: "get",
  path: "/api/board/admin/config",
  operationId: "getBoardConfig",
  summary: "Get owner-controlled board configuration",
  security,
  responses: { 200: json(BoardConfigSchema, "Board configuration"), ...commonResponses },
});

const configHeadRoute = createRoute({
  method: "head",
  path: "/api/board/admin/config",
  operationId: "headBoardConfig",
  summary: "Check owner-controlled board configuration",
  security,
  responses: { 200: noContent("Board configuration is available"), ...commonResponses },
});

const updateConfigRoute = createRoute({
  method: "patch",
  path: "/api/board/admin/config",
  operationId: "updateBoardConfig",
  summary: "Update owner-controlled board configuration",
  security,
  request: {
    body: {
      content: { "application/json": { schema: BoardConfigUpdateRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: json(BoardConfigMutationResultSchema, "Effective board configuration"),
    ...commonResponses,
  },
});

const moderatorsRoute = createRoute({
  method: "get",
  path: "/api/board/admin/moderators",
  operationId: "listBoardModerators",
  summary: "List owner-visible board moderator membership",
  security,
  request: { query: BoardModeratorQuerySchema },
  responses: {
    200: json(BoardModeratorsSchema, "Bounded board moderator page"),
    ...commonResponses,
  },
});

const moderatorsHeadRoute = createRoute({
  method: "head",
  path: "/api/board/admin/moderators",
  operationId: "headBoardModerators",
  summary: "Check owner-visible board moderator membership",
  security,
  request: { query: BoardModeratorQuerySchema },
  responses: { 200: noContent("Board moderator page is available"), ...commonResponses },
});

const addModeratorRoute = createRoute({
  method: "put",
  path: "/api/board/admin/moderators/{userId}",
  operationId: "addBoardModerator",
  summary: "Add or change a board moderator membership",
  security,
  request: {
    params: userParams,
    body: {
      content: { "application/json": { schema: BoardModeratorUpsertRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: json(BoardModeratorMutationResultSchema, "Moderator membership result"),
    ...commonResponses,
  },
});

const removeModeratorRoute = createRoute({
  method: "delete",
  path: "/api/board/admin/moderators/{userId}",
  operationId: "removeBoardModerator",
  summary: "Remove a board moderator membership",
  security,
  request: { params: userParams },
  responses: {
    200: json(BoardModeratorMutationResultSchema, "Moderator removal result"),
    ...commonResponses,
  },
});

function nonOptions(middleware: MiddlewareHandler<AuthEnv>): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    if (c.req.method === "OPTIONS") {
      await next();
      return;
    }
    return middleware(c, next);
  };
}

function writesOnly(middleware: MiddlewareHandler<AuthEnv>): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
      await next();
      return;
    }
    return middleware(c, next);
  };
}

const boardFailureBoundary: MiddlewareHandler<AuthEnv> = async (c, next) => {
  try {
    await next();
  } catch {
    return c.json(errorEnvelope("board_service_unavailable", "Board service unavailable."), 503);
  }
};

function boardError(c: Context<AuthEnv>, kind: BoardQueryFailure) {
  switch (kind) {
    case "bad_request":
      return c.json(errorEnvelope("bad_request", "Board request rejected."), 400);
    case "unauthorized":
      return c.json(errorEnvelope("unauthorized", "Board authentication required."), 401);
    case "forbidden":
      return c.json(errorEnvelope("board_forbidden", "Board access denied."), 403);
    case "banned":
      return c.json(errorEnvelope("board_banned", "Board write access is suspended."), 403);
    case "not_found":
      return c.json(errorEnvelope("not_found", "Board target not found."), 404);
    case "conflict":
      return c.json(errorEnvelope("conflict", "Board state changed."), 409);
    case "rate_limited":
      return c.json(errorEnvelope("rate_limited", "Too many board requests."), 429, {
        "Retry-After": "60",
      });
    case "unavailable":
      return c.json(errorEnvelope("board_service_unavailable", "Board service unavailable."), 503);
  }
}

async function derivedIdentity(
  c: Context<AuthEnv>,
  boardIdentity: BoardIdentity,
): Promise<BoardIdentityContext | null> {
  try {
    const authenticatedActorId = c.get("user").id;
    const result = await boardIdentity.derive(authenticatedActorId);
    if (
      result.kind !== "ok" ||
      !isBoardActorIdentity(result.value) ||
      result.value.actorId !== authenticatedActorId.toLowerCase()
    ) {
      return null;
    }
    return {
      actorId: result.value.actorId,
      authorToken: result.value.authorToken,
      tokenVersion: result.value.tokenVersion,
      alias: result.value.alias as BoardAlias,
    };
  } catch {
    return null;
  }
}

function unavailableIdentity(c: Context<AuthEnv>) {
  return boardError(c, "unavailable");
}

function validatedBoardResponse<T>(
  schema: {
    safeParse(input: unknown): { success: true; data: T } | { success: false };
  },
  value: unknown,
): { kind: "ok"; value: T } | { kind: "invalid" } {
  const result = schema.safeParse(value);
  return result.success ? { kind: "ok", value: result.data } : { kind: "invalid" };
}

function boardJson<T, S extends 200 | 201>(
  c: Context<AuthEnv>,
  schema: {
    safeParse(input: unknown): { success: true; data: T } | { success: false };
  },
  value: unknown,
  status: S,
) {
  const parsed = validatedBoardResponse(schema, value);
  if (parsed.kind === "invalid") return boardError(c, "unavailable");
  return c.json(parsed.value, status);
}

function boardHead<T>(
  c: Context<AuthEnv>,
  schema: {
    safeParse(input: unknown): { success: true; data: T } | { success: false };
  },
  value: unknown,
) {
  const parsed = validatedBoardResponse(schema, value);
  if (parsed.kind === "invalid") return boardError(c, "unavailable");
  return c.body(null, 200);
}

function containedBoardQueries(queries: BoardQueries): BoardQueries {
  return new Proxy(queries, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          return await Reflect.apply(value, target, args);
        } catch {
          return { kind: "unavailable" as const };
        }
      };
    },
  });
}

export type BoardRouteOptions = {
  authenticator: Authenticator;
  boardIdentity: BoardIdentity;
  boardWriteLimiter?: RateLimiterBinding;
};

export function registerBoardRoutes(
  app: OpenAPIHono<AuthEnv>,
  unsafeQueries: BoardQueries,
  options: BoardRouteOptions,
): void {
  const writeLimiter = createUserWriteRateLimitMiddleware(options.boardWriteLimiter);
  const queries = containedBoardQueries(unsafeQueries);

  app.options("/api/board", (c) => c.body(null, 204));
  app.options("/api/board/*", (c) => c.body(null, 204));
  app.use("/api/board", boardFailureBoundary);
  app.use("/api/board/*", boardFailureBoundary);
  app.use("/api/board", nonOptions(options.authenticator));
  app.use("/api/board/*", nonOptions(options.authenticator));
  app.use("/api/board", writesOnly(writeLimiter));
  app.use("/api/board/*", writesOnly(writeLimiter));

  app.openapi(feedRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.getFeed(identity, c.req.valid("query"));
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardFeedSchema, result.value, 200);
  });
  app.openapi(feedHeadRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.getFeed(identity, c.req.valid("query"));
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardHead(c, BoardFeedSchema, result.value);
  });

  app.openapi(threadRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const { postId } = c.req.valid("param");
    const result = await queries.getThread(identity, postId, c.req.valid("query"));
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardThreadSchema, result.value, 200);
  });
  app.openapi(threadHeadRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const { postId } = c.req.valid("param");
    const result = await queries.getThread(identity, postId, c.req.valid("query"));
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardHead(c, BoardThreadSchema, result.value);
  });

  app.openapi(mineRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.getOwnContent(identity, c.req.valid("query"));
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardOwnContentSchema, result.value, 200);
  });
  app.openapi(mineHeadRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.getOwnContent(identity, c.req.valid("query"));
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardHead(c, BoardOwnContentSchema, result.value);
  });

  app.openapi(statusRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.getStatus(identity);
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardStatusSchema, result.value, 200);
  });
  app.openapi(statusHeadRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.getStatus(identity);
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardHead(c, BoardStatusSchema, result.value);
  });

  app.openapi(createPostRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.createPost(identity, c.req.valid("json"));
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardCreatePostResultSchema, result.value, 201);
  });
  app.openapi(editPostRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.editPost(
      identity,
      c.req.valid("param").postId,
      normalizeBoardEditPost(c.req.valid("json")),
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardPostMutationResultSchema, result.value, 200);
  });
  app.openapi(deletePostRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.deletePost(
      identity,
      c.req.valid("param").postId,
      c.req.valid("json"),
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardPostMutationResultSchema, result.value, 200);
  });
  app.openapi(createCommentRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.createComment(
      identity,
      c.req.valid("param").postId,
      c.req.valid("json"),
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardCreateCommentResultSchema, result.value, 201);
  });
  app.openapi(editCommentRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.editComment(
      identity,
      c.req.valid("param").commentId,
      c.req.valid("json"),
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardCommentMutationResultSchema, result.value, 200);
  });
  app.openapi(deleteCommentRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.deleteComment(
      identity,
      c.req.valid("param").commentId,
      c.req.valid("json"),
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardCommentMutationResultSchema, result.value, 200);
  });

  app.openapi(votePostRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const params = postParams.parse(c.req.valid("param"));
    const input = BoardVoteRequestSchema.parse(c.req.valid("json"));
    const result = await queries.setVote(
      identity,
      { postId: params.postId, commentId: null },
      input,
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardVoteResultSchema, result.value, 200);
  });
  app.openapi(voteCommentRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const params = commentParams.parse(c.req.valid("param"));
    const input = BoardVoteRequestSchema.parse(c.req.valid("json"));
    const result = await queries.setVote(
      identity,
      { postId: null, commentId: params.commentId },
      input,
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardVoteResultSchema, result.value, 200);
  });
  app.openapi(reportPostRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const params = postParams.parse(c.req.valid("param"));
    const input = BoardReportRequestSchema.parse(c.req.valid("json"));
    const result = await queries.reportContent(
      identity,
      { postId: params.postId, commentId: null },
      input,
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardReportResultSchema, result.value, 200);
  });
  app.openapi(reportCommentRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const params = commentParams.parse(c.req.valid("param"));
    const input = BoardReportRequestSchema.parse(c.req.valid("json"));
    const result = await queries.reportContent(
      identity,
      { postId: null, commentId: params.commentId },
      input,
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardReportResultSchema, result.value, 200);
  });

  app.openapi(appealPostRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.createAppeal(
      identity,
      { postId: c.req.valid("param").postId, commentId: null, banId: null },
      c.req.valid("json"),
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardAppealResultSchema, result.value, 200);
  });
  app.openapi(appealCommentRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.createAppeal(
      identity,
      { postId: null, commentId: c.req.valid("param").commentId, banId: null },
      c.req.valid("json"),
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardAppealResultSchema, result.value, 200);
  });
  app.openapi(appealBanRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.createAppeal(
      identity,
      { postId: null, commentId: null, banId: c.req.valid("param").banId },
      c.req.valid("json"),
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardAppealResultSchema, result.value, 200);
  });

  app.openapi(moderationQueueRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.getModerationQueue(identity.actorId, c.req.valid("query"));
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardModerationQueueSchema, result.value, 200);
  });
  app.openapi(moderationQueueHeadRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.getModerationQueue(identity.actorId, c.req.valid("query"));
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardHead(c, BoardModerationQueueSchema, result.value);
  });

  app.openapi(decidePostRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const params = postParams.parse(c.req.valid("param"));
    const input = BoardModerationDecisionRequestSchema.parse(c.req.valid("json"));
    const result = await queries.decideContent(
      identity.actorId,
      { postId: params.postId, commentId: null },
      input,
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardModerationDecisionResultSchema, result.value, 200);
  });
  app.openapi(decideCommentRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const params = commentParams.parse(c.req.valid("param"));
    const input = BoardModerationDecisionRequestSchema.parse(c.req.valid("json"));
    const result = await queries.decideContent(
      identity.actorId,
      { postId: null, commentId: params.commentId },
      input,
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardModerationDecisionResultSchema, result.value, 200);
  });
  app.openapi(banPostRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const params = postParams.parse(c.req.valid("param"));
    const input = BoardBanRequestSchema.parse(c.req.valid("json"));
    const result = await queries.createBan(
      identity.actorId,
      { postId: params.postId, commentId: null },
      input,
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardBanResultSchema, result.value, 200);
  });
  app.openapi(banCommentRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const params = commentParams.parse(c.req.valid("param"));
    const input = BoardBanRequestSchema.parse(c.req.valid("json"));
    const result = await queries.createBan(
      identity.actorId,
      { postId: null, commentId: params.commentId },
      input,
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardBanResultSchema, result.value, 200);
  });
  app.openapi(revokeBanRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.revokeBan(
      identity.actorId,
      c.req.valid("param").banId,
      c.req.valid("json"),
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardBanRevokeResultSchema, result.value, 200);
  });
  app.openapi(decideAppealRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.decideAppeal(
      identity.actorId,
      c.req.valid("param").appealId,
      c.req.valid("json"),
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardAppealDecisionResultSchema, result.value, 200);
  });

  app.openapi(configRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.getConfig(identity.actorId);
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardConfigSchema, result.value, 200);
  });
  app.openapi(configHeadRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.getConfig(identity.actorId);
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardHead(c, BoardConfigSchema, result.value);
  });
  app.openapi(updateConfigRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.setConfig(identity.actorId, c.req.valid("json"));
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardConfigMutationResultSchema, result.value, 200);
  });

  app.openapi(moderatorsRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.listModerators(identity.actorId, c.req.valid("query"));
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardModeratorsSchema, result.value, 200);
  });
  app.openapi(moderatorsHeadRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.listModerators(identity.actorId, c.req.valid("query"));
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardHead(c, BoardModeratorsSchema, result.value);
  });
  app.openapi(addModeratorRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.addModerator(
      identity.actorId,
      c.req.valid("param").userId,
      c.req.valid("json"),
    );
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardModeratorMutationResultSchema, result.value, 200);
  });
  app.openapi(removeModeratorRoute, async (c) => {
    const identity = await derivedIdentity(c, options.boardIdentity);
    if (identity === null) return unavailableIdentity(c);
    const result = await queries.removeModerator(identity.actorId, c.req.valid("param").userId);
    if (result.kind !== "ok") return boardError(c, result.kind);
    return boardJson(c, BoardModeratorMutationResultSchema, result.value, 200);
  });
}
