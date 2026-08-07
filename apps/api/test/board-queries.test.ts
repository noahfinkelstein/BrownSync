import { encodeBoardCursor } from "@brownsync/contract";
import { describe, expect, it, vi } from "vitest";
import { createBoardQueries } from "../src/board-queries";
import type { Sql } from "../src/db";

const ACTOR_ID = "82000000-0000-4000-8000-000000000001";
const POST_ID = "82000000-0000-4000-8000-000000000002";
const COMMENT_ID = "82000000-0000-4000-8000-000000000003";
const REQUEST_ID = "82000000-0000-4000-8000-000000000004";
const BAN_ID = "82000000-0000-4000-8000-000000000005";
const APPEAL_ID = "82000000-0000-4000-8000-000000000006";
const TARGET_USER_ID = "82000000-0000-4000-8000-000000000007";
const CREATED_AT = "2026-07-30T18:00:00.000Z";
const UPDATED_AT = "2026-07-30T19:00:00.000Z";
const AUTHOR_TOKEN = "a".repeat(64);
const identity = {
  actorId: ACTOR_ID,
  authorToken: AUTHOR_TOKEN,
  tokenVersion: 1 as const,
  alias: "Anonymous Otter AAAA" as const,
};

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

function withJson<T extends ReturnType<typeof vi.fn>>(sql: T) {
  return Object.assign(sql, {
    json: vi.fn((value: unknown) => ({ encoded: value })),
  });
}

describe("board query adapter", () => {
  it("calls all member reads with actor/token/version first and maps bounded safe pages", async () => {
    const sql = withJson(
      vi
        .fn()
        .mockResolvedValueOnce([
          {
            post_id: POST_ID,
            title: "Question",
            body: "What should we build?",
            visibility: "visible",
            moderation_epoch: 0,
            score: 2,
            revision: 1,
            author_alias: "Anonymous Otter AAAA",
            is_mine: true,
            comment_count: 1,
            viewer_vote: 1,
            created_at: new Date(CREATED_AT),
            updated_at: new Date(UPDATED_AT),
            has_more: true,
            author_token: "must-not-leak",
          },
        ])
        .mockResolvedValueOnce([
          {
            post_id: POST_ID,
            post_title: "Question",
            post_body: "What should we build?",
            post_visibility: "visible",
            post_moderation_epoch: 0,
            post_score: 2,
            post_revision: 1,
            post_author_alias: "Anonymous Otter AAAA",
            post_is_mine: true,
            post_viewer_vote: 1,
            post_created_at: new Date(CREATED_AT),
            post_updated_at: new Date(UPDATED_AT),
            comment_id: COMMENT_ID,
            parent_comment_id: null,
            comment_body: "A board.",
            comment_visibility: "visible",
            comment_moderation_epoch: 0,
            comment_score: 1,
            comment_revision: 1,
            comment_author_alias: "Anonymous Otter BBBB",
            comment_is_mine: false,
            comment_viewer_vote: 0,
            comment_created_at: new Date(CREATED_AT),
            comment_updated_at: new Date(UPDATED_AT),
            has_more: false,
          },
        ])
        .mockResolvedValueOnce([
          {
            item_type: "comment",
            item_id: COMMENT_ID,
            post_id: POST_ID,
            parent_comment_id: null,
            title: null,
            body: "A board.",
            visibility: "visible",
            moderation_epoch: 0,
            score: 1,
            revision: 1,
            created_at: new Date(CREATED_AT),
            updated_at: new Date(UPDATED_AT),
            has_more: false,
          },
        ])
        .mockResolvedValueOnce([
          {
            enabled: true,
            author_alias: "Anonymous Otter AAAA",
            banned: false,
            ban_id: null,
            banned_until: null,
            ban_reason: null,
            pending_appeals: 0,
          },
        ]),
    );
    const queries = createBoardQueries(sql as unknown as Sql);
    const cursor = encodeBoardCursor([CREATED_AT, POST_ID]);

    const feed = await queries.getFeed(identity, { cursor, limit: 25 });
    const thread = await queries.getThread(identity, POST_ID, { limit: 25 });
    const mine = await queries.getOwnContent(identity, { limit: 25 });
    const status = await queries.getStatus(identity);

    expect(sql.mock.calls.map(queryText)).toEqual([
      expect.stringContaining("brownsync_get_board_feed("),
      expect.stringContaining("brownsync_get_board_thread("),
      expect.stringContaining("brownsync_get_own_board_content("),
      expect.stringContaining("brownsync_get_board_status("),
    ]);
    expect(sql.mock.calls[0]?.slice(1)).toEqual([
      ACTOR_ID,
      AUTHOR_TOKEN,
      1,
      CREATED_AT,
      POST_ID,
      25,
    ]);
    expect(sql.mock.calls[1]?.slice(1)).toEqual([
      ACTOR_ID,
      AUTHOR_TOKEN,
      1,
      POST_ID,
      null,
      null,
      25,
    ]);
    expect(sql.mock.calls[2]?.slice(1)).toEqual([ACTOR_ID, AUTHOR_TOKEN, 1, null, null, 25]);
    expect(sql.mock.calls[3]?.slice(1)).toEqual([ACTOR_ID, AUTHOR_TOKEN, 1]);
    expect(feed).toMatchObject({
      kind: "ok",
      value: {
        posts: [{ id: POST_ID, authorAlias: "Anonymous Otter AAAA", isMine: true }],
      },
    });
    expect((feed as { value: { nextCursor: string } }).value.nextCursor).toBe(
      encodeBoardCursor([CREATED_AT, POST_ID]),
    );
    expect(JSON.stringify(feed)).not.toContain("must-not-leak");
    expect(thread).toMatchObject({
      kind: "ok",
      value: {
        post: { id: POST_ID },
        comments: [{ id: COMMENT_ID, postId: POST_ID }],
        nextCursor: null,
      },
    });
    expect((thread as { value: { post: object } }).value.post).not.toHaveProperty("commentCount");
    expect(mine).toMatchObject({
      kind: "ok",
      value: {
        items: [
          {
            contentType: "comment",
            id: COMMENT_ID,
            authorAlias: "Anonymous Otter AAAA",
            isMine: true,
          },
        ],
      },
    });
    expect(status).toMatchObject({
      kind: "ok",
      value: {
        enabled: true,
        privacyNotice: expect.stringContaining("pseudonymous"),
        edgeMetadataNotice: expect.stringContaining("IP addresses"),
      },
    });
  });

  it("calls all nine member writes with exact selector and optimistic/idempotency arguments", async () => {
    const sql = withJson(
      vi
        .fn()
        .mockResolvedValueOnce([{ post_id: POST_ID, revision: 1, replayed: false }])
        .mockResolvedValueOnce([{ post_id: POST_ID, revision: 2, changed: true }])
        .mockResolvedValueOnce([{ post_id: POST_ID, revision: 3, changed: true }])
        .mockResolvedValueOnce([
          { comment_id: COMMENT_ID, post_id: POST_ID, revision: 1, replayed: false },
        ])
        .mockResolvedValueOnce([{ comment_id: COMMENT_ID, revision: 2, changed: true }])
        .mockResolvedValueOnce([{ comment_id: COMMENT_ID, revision: 3, changed: true }])
        .mockResolvedValueOnce([
          { post_id: POST_ID, comment_id: null, value: 1, score: 3, changed: true },
        ])
        .mockResolvedValueOnce([
          {
            report_id: REQUEST_ID,
            target_epoch: 0,
            visibility: "auto_hidden",
            revision: 2,
            auto_hidden: true,
            replayed: false,
          },
        ])
        .mockResolvedValueOnce([{ appeal_id: APPEAL_ID, state: "pending", replayed: false }])
        .mockResolvedValueOnce([{ appeal_id: APPEAL_ID, state: "pending", replayed: true }]),
    );
    const queries = createBoardQueries(sql as unknown as Sql);

    await queries.createPost(identity, {
      clientRequestId: REQUEST_ID,
      title: null,
      body: "Question",
    });
    await queries.editPost(identity, POST_ID, {
      expectedRevision: 1,
      title: null,
      body: "Edited",
    });
    await queries.deletePost(identity, POST_ID, { expectedRevision: 2 });
    await queries.createComment(identity, POST_ID, {
      clientRequestId: REQUEST_ID,
      parentCommentId: null,
      body: "Reply",
    });
    await queries.editComment(identity, COMMENT_ID, { expectedRevision: 1, body: "Edited reply" });
    await queries.deleteComment(identity, COMMENT_ID, { expectedRevision: 2 });
    await queries.setVote(identity, { postId: POST_ID, commentId: null }, { value: 1 });
    await queries.reportContent(
      identity,
      { postId: null, commentId: COMMENT_ID },
      { reason: "spam", detail: null },
    );
    await queries.createAppeal(
      identity,
      { postId: POST_ID, commentId: null, banId: null },
      { clientRequestId: REQUEST_ID, targetEpoch: 0, body: "Please reconsider." },
    );
    await queries.createAppeal(
      identity,
      { postId: null, commentId: null, banId: BAN_ID },
      { clientRequestId: REQUEST_ID, body: "Please reconsider the ban." },
    );

    expect(sql.mock.calls.map(queryText)).toEqual([
      expect.stringContaining("brownsync_create_board_post("),
      expect.stringContaining("brownsync_edit_board_post("),
      expect.stringContaining("brownsync_delete_board_post("),
      expect.stringContaining("brownsync_create_board_comment("),
      expect.stringContaining("brownsync_edit_board_comment("),
      expect.stringContaining("brownsync_delete_board_comment("),
      expect.stringContaining("brownsync_set_board_vote("),
      expect.stringContaining("brownsync_report_board_content("),
      expect.stringContaining("brownsync_create_board_appeal("),
      expect.stringContaining("brownsync_create_board_appeal("),
    ]);
    expect(sql.mock.calls[0]?.slice(1)).toEqual([
      ACTOR_ID,
      AUTHOR_TOKEN,
      1,
      REQUEST_ID,
      null,
      "Question",
    ]);
    expect(sql.mock.calls[1]?.slice(1, -1)).toEqual([ACTOR_ID, AUTHOR_TOKEN, 1, POST_ID, 1]);
    expect(sql.json).toHaveBeenCalledWith({ title: null, body: "Edited" });
    expect(sql.mock.calls[2]?.slice(1)).toEqual([ACTOR_ID, AUTHOR_TOKEN, 1, POST_ID, 2]);
    expect(sql.mock.calls[3]?.slice(1)).toEqual([
      ACTOR_ID,
      AUTHOR_TOKEN,
      1,
      REQUEST_ID,
      POST_ID,
      null,
      "Reply",
    ]);
    expect(sql.mock.calls[4]?.slice(1)).toEqual([
      ACTOR_ID,
      AUTHOR_TOKEN,
      1,
      COMMENT_ID,
      1,
      "Edited reply",
    ]);
    expect(sql.mock.calls[5]?.slice(1)).toEqual([ACTOR_ID, AUTHOR_TOKEN, 1, COMMENT_ID, 2]);
    expect(sql.mock.calls[6]?.slice(1)).toEqual([ACTOR_ID, AUTHOR_TOKEN, 1, POST_ID, null, 1]);
    expect(sql.mock.calls[7]?.slice(1)).toEqual([
      ACTOR_ID,
      AUTHOR_TOKEN,
      1,
      null,
      COMMENT_ID,
      "spam",
      null,
    ]);
    expect(sql.mock.calls[8]?.slice(1)).toEqual([
      ACTOR_ID,
      AUTHOR_TOKEN,
      1,
      REQUEST_ID,
      POST_ID,
      null,
      null,
      0,
      "Please reconsider.",
    ]);
    expect(sql.mock.calls[9]?.slice(1)).toEqual([
      ACTOR_ID,
      AUTHOR_TOKEN,
      1,
      REQUEST_ID,
      null,
      null,
      BAN_ID,
      null,
      "Please reconsider the ban.",
    ]);
  });

  it("keeps moderator and owner calls actor-only while mapping nullable ban queue/admin rows", async () => {
    const sql = vi
      .fn()
      .mockResolvedValueOnce([
        {
          queue_kind: "appeal",
          queue_id: APPEAL_ID,
          target_type: "ban",
          target_id: BAN_ID,
          post_id: null,
          parent_comment_id: null,
          title: null,
          body: null,
          visibility: null,
          moderation_epoch: null,
          score: null,
          open_report_count: 0,
          report_reasons: [],
          appeal_body: "Please reconsider.",
          created_at: new Date(CREATED_AT),
          updated_at: new Date(UPDATED_AT),
          has_more: false,
        },
      ])
      .mockResolvedValueOnce([
        {
          target_type: "post",
          target_id: POST_ID,
          visibility: "moderator_hidden",
          moderation_epoch: 1,
          revision: 2,
          replayed: false,
        },
      ])
      .mockResolvedValueOnce([
        { ban_id: BAN_ID, expires_at: new Date(UPDATED_AT), replayed: false },
      ])
      .mockResolvedValueOnce([
        { ban_id: BAN_ID, revoked_at: new Date(UPDATED_AT), changed: true, replayed: false },
      ])
      .mockResolvedValueOnce([
        {
          appeal_id: APPEAL_ID,
          state: "approved",
          target_type: "ban",
          target_id: BAN_ID,
          changed: true,
          replayed: false,
        },
      ])
      .mockResolvedValueOnce([
        { enabled: true, auto_hide_threshold: 3, updated_at: new Date(UPDATED_AT) },
      ])
      .mockResolvedValueOnce([
        {
          enabled: false,
          auto_hide_threshold: 4,
          updated_at: new Date(UPDATED_AT),
          changed: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          user_id: TARGET_USER_ID,
          role: "owner",
          granted_by: null,
          granted_at: new Date(CREATED_AT),
          has_more: false,
        },
      ])
      .mockResolvedValueOnce([{ user_id: TARGET_USER_ID, role: "moderator", changed: true }])
      .mockResolvedValueOnce([{ user_id: TARGET_USER_ID, changed: true }]);
    const queries = createBoardQueries(sql as unknown as Sql);

    await queries.getModerationQueue(ACTOR_ID, { limit: 25 });
    await queries.decideContent(
      ACTOR_ID,
      { postId: POST_ID, commentId: null },
      {
        clientRequestId: REQUEST_ID,
        expectedEpoch: 0,
        action: "hide",
        reason: "Safety",
      },
    );
    await queries.createBan(
      ACTOR_ID,
      { postId: null, commentId: COMMENT_ID },
      {
        clientRequestId: REQUEST_ID,
        durationSeconds: 300,
        reason: "Safety",
        note: null,
      },
    );
    await queries.revokeBan(ACTOR_ID, BAN_ID, {
      clientRequestId: REQUEST_ID,
      reason: "Resolved",
    });
    await queries.decideAppeal(ACTOR_ID, APPEAL_ID, {
      clientRequestId: REQUEST_ID,
      decision: "approved",
      reason: "Resolved",
    });
    await queries.getConfig(ACTOR_ID);
    await queries.setConfig(ACTOR_ID, { enabled: false, autoHideThreshold: 4 });
    const moderators = await queries.listModerators(ACTOR_ID, { limit: 25 });
    await queries.addModerator(ACTOR_ID, TARGET_USER_ID, { role: "moderator" });
    await queries.removeModerator(ACTOR_ID, TARGET_USER_ID);

    expect(sql.mock.calls[0]?.slice(1)).toEqual([ACTOR_ID, null, null, 25]);
    expect(sql.mock.calls[1]?.slice(1)).toEqual([
      ACTOR_ID,
      REQUEST_ID,
      POST_ID,
      null,
      0,
      "hide",
      "Safety",
    ]);
    expect(sql.mock.calls[2]?.slice(1)).toEqual([
      ACTOR_ID,
      REQUEST_ID,
      null,
      COMMENT_ID,
      300,
      "Safety",
      null,
    ]);
    expect(sql.mock.calls[3]?.slice(1)).toEqual([ACTOR_ID, REQUEST_ID, BAN_ID, "Resolved"]);
    expect(sql.mock.calls[4]?.slice(1)).toEqual([
      ACTOR_ID,
      REQUEST_ID,
      APPEAL_ID,
      "approved",
      "Resolved",
    ]);
    expect(sql.mock.calls[5]?.slice(1)).toEqual([ACTOR_ID]);
    expect(sql.mock.calls[6]?.slice(1)).toEqual([ACTOR_ID, false, 4]);
    expect(sql.mock.calls[7]?.slice(1)).toEqual([ACTOR_ID, null, null, 25]);
    expect(sql.mock.calls[8]?.slice(1)).toEqual([ACTOR_ID, TARGET_USER_ID, "moderator"]);
    expect(sql.mock.calls[9]?.slice(1)).toEqual([ACTOR_ID, TARGET_USER_ID]);
    for (const call of sql.mock.calls) {
      expect(call.slice(1)).not.toContain(AUTHOR_TOKEN);
    }
    expect(moderators).toMatchObject({
      kind: "ok",
      value: { moderators: [{ userId: TARGET_USER_ID, grantedBy: null }] },
    });
  });

  it("maps exact account-cleanup output without accepting token version", async () => {
    const sql = sqlMock([{ posts_tombstoned: 2, comments_tombstoned: 3, replayed: false }]);
    const result = await createBoardQueries(sql as unknown as Sql).deleteAccount(
      ACTOR_ID,
      AUTHOR_TOKEN,
    );

    expect(queryText(sql.mock.calls[0])).toContain("brownsync_delete_board_account(");
    expect(sql.mock.calls[0]?.slice(1)).toEqual([ACTOR_ID, AUTHOR_TOKEN]);
    expect(result).toEqual({
      kind: "ok",
      value: { postsTombstoned: 2, commentsTombstoned: 3, replayed: false },
    });
  });

  it.each([
    ["BROWNSYNC_BOARD_INPUT_INVALID", "bad_request"],
    ["BROWNSYNC_BOARD_UNAUTHORIZED", "unauthorized"],
    ["BROWNSYNC_BOARD_FORBIDDEN", "forbidden"],
    ["BROWNSYNC_BOARD_BANNED", "banned"],
    ["BROWNSYNC_BOARD_NOT_FOUND", "not_found"],
    ["BROWNSYNC_BOARD_ACCOUNT_DELETED", "forbidden"],
    ["BROWNSYNC_BOARD_REQUEST_CONFLICT", "conflict"],
    ["BROWNSYNC_BOARD_REVISION_CONFLICT", "conflict"],
    ["BROWNSYNC_BOARD_TERMINAL_CONFLICT", "conflict"],
    ["BROWNSYNC_BOARD_RATE_LIMITED", "rate_limited"],
    ["BROWNSYNC_BOARD_DISABLED", "unavailable"],
    ["BROWNSYNC_BOARD_IDENTITY_UNAVAILABLE", "unavailable"],
    ["connection failed", "unavailable"],
  ])("maps stable SQL error %s to %s", async (message, kind) => {
    const sql = vi.fn(async () => {
      throw new Error(message);
    });
    const result = await createBoardQueries(sql as unknown as Sql).getStatus(identity);
    expect(result).toEqual({ kind });
  });
});
