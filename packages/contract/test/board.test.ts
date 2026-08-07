import { describe, expect, it } from "vitest";
import {
  BOARD_EDGE_METADATA_NOTICE,
  BOARD_PRIVACY_NOTICE,
  BoardAliasSchema,
  BoardAppealDecisionRequestSchema,
  BoardBanRequestSchema,
  BoardCommentSchema,
  BoardConfigUpdateRequestSchema,
  BoardContentAppealRequestSchema,
  BoardCreateCommentRequestSchema,
  BoardCreatePostRequestSchema,
  BoardDeleteRequestSchema,
  BoardEditCommentRequestSchema,
  BoardEditPostRequestSchema,
  BoardFeedQuerySchema,
  BoardFeedSchema,
  BoardModerationDecisionRequestSchema,
  BoardModerationQueueSchema,
  BoardModeratorUpsertRequestSchema,
  BoardOwnContentItemSchema,
  BoardPostSchema,
  BoardReportRequestSchema,
  BoardStatusSchema,
  BoardVoteRequestSchema,
  decodeBoardCursor,
  encodeBoardCursor,
} from "../src/board";

const POST_ID = "81000000-0000-4000-8000-000000000001";
const COMMENT_ID = "81000000-0000-4000-8000-000000000002";
const REQUEST_ID = "81000000-0000-4000-8000-000000000003";
const CREATED_AT = "2026-07-30T18:00:00.000Z";

const post = {
  id: POST_ID,
  title: "A thoughtful Brown question",
  body: "What would make this campus service more useful?",
  visibility: "visible" as const,
  moderationEpoch: 0,
  score: 2,
  revision: 1,
  authorAlias: "Anonymous Otter 4F2A",
  isMine: false,
  commentCount: 1,
  myVote: 0 as const,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

const comment = {
  id: COMMENT_ID,
  postId: POST_ID,
  parentCommentId: null,
  body: "A bounded, privacy-preserving discussion space.",
  visibility: "visible" as const,
  moderationEpoch: 0,
  score: 1,
  revision: 1,
  authorAlias: "Anonymous Otter A11C",
  isMine: true,
  myVote: 1 as const,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

describe("board contract", () => {
  it("pins both honest privacy disclosures verbatim", () => {
    expect(BOARD_PRIVACY_NOTICE).toBe(
      "Posts are pseudonymous, not untraceable. BrownSync stores a stable anonymous identifier so it can enforce bans, rate limits, and abuse controls. The board database does not store your BrownSync account ID with your posts. Your posts can be linked to each other, and someone who obtained both BrownSync’s private board secret and a list of Brown account IDs could reconstruct that link. Board moderators do not see your name or email through the moderation tools.",
    );
    expect(BOARD_EDGE_METADATA_NOTICE).toBe(
      "Cloudflare processes normal edge request metadata, including IP addresses, to deliver and protect the service.",
    );
  });

  it("accepts only canonical aliases and opaque canonical cursor tuples", () => {
    expect(BoardAliasSchema.parse("Anonymous Otter 4F2A")).toBe("Anonymous Otter 4F2A");
    expect(BoardAliasSchema.safeParse("Anonymous Otter 4f2a").success).toBe(false);

    const cursor = encodeBoardCursor([CREATED_AT, POST_ID]);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain("=");
    expect(decodeBoardCursor(cursor)).toEqual([CREATED_AT, POST_ID]);
    expect(BoardFeedQuerySchema.parse({ cursor, limit: "50" })).toEqual({ cursor, limit: 50 });
    expect(BoardFeedQuerySchema.parse({})).toEqual({ limit: 25 });

    const padded = `${cursor}=`;
    const malformed = [
      padded,
      "not+base64url",
      "e30",
      encodeBoardCursor([CREATED_AT, POST_ID]).toUpperCase(),
      "a".repeat(257),
    ];
    for (const value of malformed) {
      expect(BoardFeedQuerySchema.safeParse({ cursor: value }).success).toBe(false);
    }
    const timestampAliases = [
      "WyIyMDI2LTA3LTMwVDE4OjAwOjAwWiIsIjgxMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSJd",
      "WyIyMDI2LTA3LTMwVDE4OjAwOjAwLjAwMCswMDowMCIsIjgxMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSJd",
    ];
    for (const alias of timestampAliases) {
      expect(BoardFeedQuerySchema.safeParse({ cursor: alias }).success).toBe(false);
    }
    expect(BoardFeedQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(BoardFeedQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
  });

  it("keeps member post and comment projections strict and identity-safe", () => {
    expect(BoardPostSchema.parse(post)).toEqual(post);
    expect(BoardCommentSchema.parse(comment)).toEqual(comment);

    const forbiddenFields = [
      "authorToken",
      "tokenVersion",
      "actorId",
      "profileId",
      "email",
      "reporterId",
      "ipAddress",
      "deviceId",
      "jwt",
      "pepper",
      "moderatorNote",
    ];
    for (const field of forbiddenFields) {
      expect(BoardPostSchema.safeParse({ ...post, [field]: "secret" }).success).toBe(false);
      expect(BoardCommentSchema.safeParse({ ...comment, [field]: "secret" }).success).toBe(false);
    }
  });

  it("enforces live text and body-free terminal tombstones", () => {
    expect(
      BoardOwnContentItemSchema.parse({
        contentType: "post",
        id: POST_ID,
        postId: POST_ID,
        parentCommentId: null,
        title: null,
        body: null,
        visibility: "account_deleted",
        moderationEpoch: 0,
        score: 0,
        revision: 1,
        authorAlias: "Anonymous Otter 4F2A",
        isMine: true,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
    ).toMatchObject({ title: null, body: null, visibility: "account_deleted" });
    expect(
      BoardOwnContentItemSchema.parse({
        contentType: "comment",
        id: COMMENT_ID,
        postId: POST_ID,
        parentCommentId: null,
        title: null,
        body: null,
        visibility: "author_deleted",
        moderationEpoch: 0,
        score: 0,
        revision: 1,
        authorAlias: "Anonymous Otter 4F2A",
        isMine: true,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
    ).toMatchObject({ body: null, visibility: "author_deleted" });

    expect(BoardPostSchema.safeParse({ ...post, body: null }).success).toBe(false);
    expect(BoardPostSchema.safeParse({ ...post, visibility: "removed" }).success).toBe(false);
    expect(BoardCommentSchema.safeParse({ ...comment, visibility: "auto_hidden" }).success).toBe(
      false,
    );
  });

  it("bounds pages and rejects response-side private additions", () => {
    expect(BoardFeedSchema.parse({ posts: [post], nextCursor: null })).toEqual({
      posts: [post],
      nextCursor: null,
    });
    expect(
      BoardFeedSchema.safeParse({
        posts: Array.from({ length: 51 }, () => post),
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      BoardFeedSchema.safeParse({ posts: [post], nextCursor: null, reporterEmail: "x@brown.edu" })
        .success,
    ).toBe(false);
    expect(
      BoardOwnContentItemSchema.safeParse({
        contentType: "comment",
        id: COMMENT_ID,
        postId: POST_ID,
        parentCommentId: null,
        title: null,
        body: "x".repeat(2001),
        visibility: "visible",
        moderationEpoch: 0,
        score: 0,
        revision: 1,
        authorAlias: "Anonymous Otter 4F2A",
        isMine: true,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }).success,
    ).toBe(false);
  });

  it("normalizes and strictly bounds member mutation requests", () => {
    expect(
      BoardCreatePostRequestSchema.parse({
        clientRequestId: REQUEST_ID,
        title: "  Campus question  ",
        body: "  What do you think?  ",
      }),
    ).toEqual({
      clientRequestId: REQUEST_ID,
      title: "Campus question",
      body: "What do you think?",
    });
    expect(
      BoardCreateCommentRequestSchema.parse({
        clientRequestId: REQUEST_ID,
        body: "  Reply  ",
      }),
    ).toEqual({ clientRequestId: REQUEST_ID, body: "Reply" });
    expect(
      BoardEditPostRequestSchema.parse({
        expectedRevision: 2,
        title: null,
        body: " Replacement ",
      }),
    ).toEqual({ expectedRevision: 2, title: null, body: "Replacement" });
    expect(BoardEditCommentRequestSchema.parse({ expectedRevision: 2, body: " Edited " })).toEqual({
      expectedRevision: 2,
      body: "Edited",
    });
    expect(BoardDeleteRequestSchema.parse({ expectedRevision: 2 })).toEqual({
      expectedRevision: 2,
    });
    expect(BoardDeleteRequestSchema.safeParse({ expectedRevision: 0 }).success).toBe(false);

    expect(
      BoardCreatePostRequestSchema.safeParse({
        clientRequestId: REQUEST_ID,
        body: "x",
        authorToken: "forged",
      }).success,
    ).toBe(false);
    expect(
      BoardEditPostRequestSchema.safeParse({ expectedRevision: 1, title: undefined }).success,
    ).toBe(false);
    expect(
      BoardCreatePostRequestSchema.safeParse({
        clientRequestId: REQUEST_ID,
        title: "x".repeat(161),
        body: "x",
      }).success,
    ).toBe(false);
    expect(
      BoardCreatePostRequestSchema.safeParse({
        clientRequestId: REQUEST_ID,
        body: "x".repeat(5001),
      }).success,
    ).toBe(false);
    expect(
      BoardCreateCommentRequestSchema.safeParse({
        clientRequestId: REQUEST_ID,
        body: "x".repeat(2001),
      }).success,
    ).toBe(false);
  });

  it("freezes votes, reports, appeals, moderation, bans, config, and owner roles", () => {
    expect(BoardVoteRequestSchema.safeParse({ value: -1 }).success).toBe(true);
    expect(BoardVoteRequestSchema.safeParse({ value: 0 }).success).toBe(true);
    expect(BoardVoteRequestSchema.safeParse({ value: 1 }).success).toBe(true);
    expect(BoardVoteRequestSchema.safeParse({ value: 2 }).success).toBe(false);

    expect(
      BoardReportRequestSchema.parse({ reason: "personal_info", detail: "  Phone number  " }),
    ).toEqual({ reason: "personal_info", detail: "Phone number" });
    expect(
      BoardContentAppealRequestSchema.safeParse({
        clientRequestId: REQUEST_ID,
        targetEpoch: 1,
        body: "x".repeat(2001),
      }).success,
    ).toBe(false);
    expect(
      BoardModerationDecisionRequestSchema.safeParse({
        clientRequestId: REQUEST_ID,
        expectedEpoch: 1,
        action: "publish",
        reason: "No",
      }).success,
    ).toBe(false);
    expect(
      BoardBanRequestSchema.safeParse({
        clientRequestId: REQUEST_ID,
        durationSeconds: 299,
        reason: "Too short",
      }).success,
    ).toBe(false);
    expect(
      BoardAppealDecisionRequestSchema.safeParse({
        clientRequestId: REQUEST_ID,
        decision: "approved",
        reason: "  Reconsidered  ",
      }).success,
    ).toBe(true);
    expect(
      BoardConfigUpdateRequestSchema.safeParse({ enabled: true, autoHideThreshold: 11 }).success,
    ).toBe(false);
    expect(BoardModeratorUpsertRequestSchema.safeParse({ role: "owner" }).success).toBe(true);
    expect(BoardModeratorUpsertRequestSchema.safeParse({ role: "admin" }).success).toBe(false);
  });

  it("keeps status and moderation projections strict", () => {
    const status = {
      enabled: true,
      authorAlias: "Anonymous Otter 4F2A",
      banned: false,
      banId: null,
      bannedUntil: null,
      banReason: null,
      pendingAppeals: 0,
      privacyNotice: BOARD_PRIVACY_NOTICE,
      edgeMetadataNotice: BOARD_EDGE_METADATA_NOTICE,
    };
    expect(BoardStatusSchema.parse(status)).toEqual(status);
    expect(BoardStatusSchema.safeParse({ ...status, authorToken: "secret" }).success).toBe(false);

    const queue = {
      items: [
        {
          queueKind: "report",
          queueId: REQUEST_ID,
          targetType: "post",
          targetId: POST_ID,
          postId: POST_ID,
          parentCommentId: null,
          title: post.title,
          body: post.body,
          visibility: "auto_hidden",
          moderationEpoch: 0,
          score: -3,
          openReportCount: 3,
          reportReasons: ["harassment"],
          appealBody: null,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        },
      ],
      nextCursor: null,
    };
    expect(BoardModerationQueueSchema.parse(queue)).toEqual(queue);
    expect(
      BoardModerationQueueSchema.safeParse({
        ...queue,
        items: [{ ...queue.items[0], reporterId: POST_ID }],
      }).success,
    ).toBe(false);
    expect(
      BoardModerationQueueSchema.safeParse({
        ...queue,
        items: [
          {
            ...queue.items[0],
            targetType: "comment",
            targetId: COMMENT_ID,
            parentCommentId: null,
            title: null,
            body: "x".repeat(2001),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      BoardModerationQueueSchema.safeParse({
        ...queue,
        items: [
          {
            ...queue.items[0],
            visibility: "account_deleted",
            title: "leaked",
            body: "leaked",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      BoardModerationQueueSchema.parse({
        items: [
          {
            queueKind: "appeal",
            queueId: REQUEST_ID,
            targetType: "ban",
            targetId: POST_ID,
            postId: null,
            parentCommentId: null,
            title: null,
            body: null,
            visibility: null,
            moderationEpoch: null,
            score: null,
            openReportCount: 0,
            reportReasons: [],
            appealBody: "Please reconsider this ban.",
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
          },
        ],
        nextCursor: null,
      }).items[0],
    ).toMatchObject({ targetType: "ban", appealBody: "Please reconsider this ban." });
  });

  it("allows a nullable grantor for the initial owner while keeping owner rows strict", async () => {
    const { BoardModeratorSchema } = await import("../src/board");
    expect(
      BoardModeratorSchema.parse({
        userId: POST_ID,
        role: "owner",
        grantedBy: null,
        grantedAt: CREATED_AT,
      }),
    ).toEqual({
      userId: POST_ID,
      role: "owner",
      grantedBy: null,
      grantedAt: CREATED_AT,
    });
  });
});
