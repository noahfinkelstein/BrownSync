import {
  BOARD_EDGE_METADATA_NOTICE,
  BOARD_PRIVACY_NOTICE,
  type BoardAccountDeletionResult,
  type BoardAlias,
  type BoardAppealDecisionRequest,
  type BoardAppealDecisionResult,
  type BoardAppealResult,
  type BoardBanAppealRequest,
  type BoardBanRequest,
  type BoardBanResult,
  type BoardBanRevokeRequest,
  type BoardBanRevokeResult,
  type BoardComment,
  type BoardCommentMutationResult,
  type BoardConfig,
  type BoardConfigMutationResult,
  type BoardConfigUpdateRequest,
  type BoardContentAppealRequest,
  type BoardCreateCommentRequest,
  type BoardCreateCommentResult,
  type BoardCreatePostRequest,
  type BoardCreatePostResult,
  type BoardDeleteRequest,
  type BoardEditCommentRequest,
  type BoardEditPostRequest,
  type BoardFeed,
  type BoardFeedQuery,
  type BoardModerationDecisionRequest,
  type BoardModerationDecisionResult,
  type BoardModerationQueue,
  type BoardModerationQueueItem,
  type BoardModerationQueueQuery,
  type BoardModeratorMutationResult,
  type BoardModeratorQuery,
  type BoardModerators,
  type BoardModeratorUpsertRequest,
  type BoardOwnContent,
  type BoardOwnContentItem,
  type BoardOwnContentQuery,
  type BoardPost,
  type BoardPostMutationResult,
  type BoardReportRequest,
  type BoardReportResult,
  type BoardStatus,
  type BoardThread,
  type BoardThreadPost,
  type BoardThreadQuery,
  type BoardVoteRequest,
  type BoardVoteResult,
  decodeBoardCursor,
  encodeBoardCursor,
} from "@brownsync/contract";
import type { Sql } from "./db";

export type BoardQueryFailure =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "banned"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unavailable";

export type BoardQueryResult<T> = { kind: "ok"; value: T } | { kind: BoardQueryFailure };

export type BoardEditPostQueryInput = Exclude<BoardEditPostRequest, { version: 2 }>;

export type BoardIdentityContext = {
  actorId: string;
  authorToken: string;
  tokenVersion: 1;
  alias: BoardAlias;
};

export type BoardContentTarget =
  | { postId: string; commentId: null }
  | { postId: null; commentId: string };

export type BoardAppealTarget =
  | { postId: string; commentId: null; banId: null }
  | { postId: null; commentId: string; banId: null }
  | { postId: null; commentId: null; banId: string };

export interface BoardQueries {
  getFeed(
    identity: BoardIdentityContext,
    query: BoardFeedQuery,
  ): Promise<BoardQueryResult<BoardFeed>>;
  getThread(
    identity: BoardIdentityContext,
    postId: string,
    query: BoardThreadQuery,
  ): Promise<BoardQueryResult<BoardThread>>;
  getOwnContent(
    identity: BoardIdentityContext,
    query: BoardOwnContentQuery,
  ): Promise<BoardQueryResult<BoardOwnContent>>;
  getStatus(identity: BoardIdentityContext): Promise<BoardQueryResult<BoardStatus>>;
  createPost(
    identity: BoardIdentityContext,
    input: BoardCreatePostRequest,
  ): Promise<BoardQueryResult<BoardCreatePostResult>>;
  editPost(
    identity: BoardIdentityContext,
    postId: string,
    input: BoardEditPostQueryInput,
  ): Promise<BoardQueryResult<BoardPostMutationResult>>;
  deletePost(
    identity: BoardIdentityContext,
    postId: string,
    input: BoardDeleteRequest,
  ): Promise<BoardQueryResult<BoardPostMutationResult>>;
  createComment(
    identity: BoardIdentityContext,
    postId: string,
    input: BoardCreateCommentRequest,
  ): Promise<BoardQueryResult<BoardCreateCommentResult>>;
  editComment(
    identity: BoardIdentityContext,
    commentId: string,
    input: BoardEditCommentRequest,
  ): Promise<BoardQueryResult<BoardCommentMutationResult>>;
  deleteComment(
    identity: BoardIdentityContext,
    commentId: string,
    input: BoardDeleteRequest,
  ): Promise<BoardQueryResult<BoardCommentMutationResult>>;
  setVote(
    identity: BoardIdentityContext,
    target: BoardContentTarget,
    input: BoardVoteRequest,
  ): Promise<BoardQueryResult<BoardVoteResult>>;
  reportContent(
    identity: BoardIdentityContext,
    target: BoardContentTarget,
    input: BoardReportRequest,
  ): Promise<BoardQueryResult<BoardReportResult>>;
  createAppeal(
    identity: BoardIdentityContext,
    target: BoardAppealTarget,
    input: BoardContentAppealRequest | BoardBanAppealRequest,
  ): Promise<BoardQueryResult<BoardAppealResult>>;
  getModerationQueue(
    actorId: string,
    query: BoardModerationQueueQuery,
  ): Promise<BoardQueryResult<BoardModerationQueue>>;
  decideContent(
    actorId: string,
    target: BoardContentTarget,
    input: BoardModerationDecisionRequest,
  ): Promise<BoardQueryResult<BoardModerationDecisionResult>>;
  createBan(
    actorId: string,
    target: BoardContentTarget,
    input: BoardBanRequest,
  ): Promise<BoardQueryResult<BoardBanResult>>;
  revokeBan(
    actorId: string,
    banId: string,
    input: BoardBanRevokeRequest,
  ): Promise<BoardQueryResult<BoardBanRevokeResult>>;
  decideAppeal(
    actorId: string,
    appealId: string,
    input: BoardAppealDecisionRequest,
  ): Promise<BoardQueryResult<BoardAppealDecisionResult>>;
  getConfig(actorId: string): Promise<BoardQueryResult<BoardConfig>>;
  setConfig(
    actorId: string,
    input: BoardConfigUpdateRequest,
  ): Promise<BoardQueryResult<BoardConfigMutationResult>>;
  listModerators(
    actorId: string,
    query: BoardModeratorQuery,
  ): Promise<BoardQueryResult<BoardModerators>>;
  addModerator(
    actorId: string,
    userId: string,
    input: BoardModeratorUpsertRequest,
  ): Promise<BoardQueryResult<BoardModeratorMutationResult>>;
  removeModerator(
    actorId: string,
    userId: string,
  ): Promise<BoardQueryResult<BoardModeratorMutationResult>>;
  deleteAccount(
    actorId: string,
    authorToken: string,
  ): Promise<BoardQueryResult<BoardAccountDeletionResult>>;
}

type DateValue = Date | string;

type FeedRow = {
  post_id: string;
  title: string | null;
  body: string;
  visibility: BoardPost["visibility"];
  moderation_epoch: number | string;
  score: number;
  revision: number | string;
  author_alias: BoardAlias;
  is_mine: boolean;
  comment_count: number | string;
  viewer_vote: -1 | 0 | 1 | null;
  created_at: DateValue;
  updated_at: DateValue;
  has_more: boolean;
};

type ThreadRow = {
  post_id: string;
  post_title: string | null;
  post_body: string;
  post_visibility: BoardThreadPost["visibility"];
  post_moderation_epoch: number | string;
  post_score: number;
  post_revision: number | string;
  post_author_alias: BoardAlias;
  post_is_mine: boolean;
  post_viewer_vote: -1 | 0 | 1 | null;
  post_created_at: DateValue;
  post_updated_at: DateValue;
  comment_id: string | null;
  parent_comment_id: string | null;
  comment_body: string | null;
  comment_visibility: BoardComment["visibility"] | null;
  comment_moderation_epoch: number | string | null;
  comment_score: number | null;
  comment_revision: number | string | null;
  comment_author_alias: BoardAlias | null;
  comment_is_mine: boolean | null;
  comment_viewer_vote: -1 | 0 | 1 | null;
  comment_created_at: DateValue | null;
  comment_updated_at: DateValue | null;
  has_more: boolean;
};

type OwnRow = {
  item_type: BoardOwnContentItem["contentType"];
  item_id: string;
  post_id: string;
  parent_comment_id: string | null;
  title: string | null;
  body: string | null;
  visibility: BoardOwnContentItem["visibility"];
  moderation_epoch: number | string;
  score: number;
  revision: number | string;
  created_at: DateValue;
  updated_at: DateValue;
  has_more: boolean;
};

type StatusRow = {
  enabled: boolean;
  author_alias: BoardAlias;
  banned: boolean;
  ban_id: string | null;
  banned_until: DateValue | null;
  ban_reason: string | null;
  pending_appeals: number | string;
};

type QueueRow = {
  queue_kind: BoardModerationQueueItem["queueKind"];
  queue_id: string;
  target_type: BoardModerationQueueItem["targetType"];
  target_id: string;
  post_id: string | null;
  parent_comment_id: string | null;
  title: string | null;
  body: string | null;
  visibility: BoardModerationQueueItem["visibility"];
  moderation_epoch: number | string | null;
  score: number | null;
  open_report_count: number | string;
  report_reasons: BoardModerationQueueItem["reportReasons"];
  appeal_body: string | null;
  created_at: DateValue;
  updated_at: DateValue;
  has_more: boolean;
};

const conflictSuffixes = new Set(["REVISION_CONFLICT", "REQUEST_CONFLICT", "TERMINAL_CONFLICT"]);

function queryFailure(error: unknown): BoardQueryFailure {
  const message = error instanceof Error ? error.message : "";
  const match = /BROWNSYNC_BOARD_([A-Z_]+)/.exec(message);
  const suffix = match?.[1] ?? "";
  if (suffix === "INPUT_INVALID") return "bad_request";
  if (suffix === "UNAUTHORIZED") return "unauthorized";
  if (suffix === "FORBIDDEN" || suffix === "ACCOUNT_DELETED") return "forbidden";
  if (suffix === "BANNED") return "banned";
  if (suffix === "NOT_FOUND") return "not_found";
  if (conflictSuffixes.has(suffix)) return "conflict";
  if (suffix === "RATE_LIMITED") return "rate_limited";
  return "unavailable";
}

function timestamp(value: DateValue): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("invalid board timestamp");
  return date.toISOString();
}

function vote(value: -1 | 0 | 1 | null): -1 | 0 | 1 {
  return value ?? 0;
}

function cursorInput(cursor: string | undefined): [string | null, string | null] {
  if (cursor === undefined) return [null, null];
  const [at, id] = decodeBoardCursor(cursor);
  return [at, id];
}

function nextCursor(
  hasMore: boolean,
  at: DateValue | null | undefined,
  id: string | null | undefined,
): string | null {
  if (!hasMore || at === null || at === undefined || id === null || id === undefined) return null;
  return encodeBoardCursor([timestamp(at), id]);
}

function postFromFeed(row: FeedRow): BoardPost {
  return {
    id: row.post_id,
    title: row.title,
    body: row.body,
    visibility: row.visibility,
    moderationEpoch: Number(row.moderation_epoch),
    score: row.score,
    revision: Number(row.revision),
    authorAlias: row.author_alias,
    isMine: row.is_mine,
    commentCount: Number(row.comment_count),
    myVote: vote(row.viewer_vote),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function postFromThread(row: ThreadRow): BoardThreadPost {
  return {
    id: row.post_id,
    title: row.post_title,
    body: row.post_body,
    visibility: row.post_visibility,
    moderationEpoch: Number(row.post_moderation_epoch),
    score: row.post_score,
    revision: Number(row.post_revision),
    authorAlias: row.post_author_alias,
    isMine: row.post_is_mine,
    myVote: vote(row.post_viewer_vote),
    createdAt: timestamp(row.post_created_at),
    updatedAt: timestamp(row.post_updated_at),
  };
}

function commentFromThread(row: ThreadRow): BoardComment | null {
  if (
    row.comment_id === null ||
    row.comment_body === null ||
    row.comment_visibility === null ||
    row.comment_moderation_epoch === null ||
    row.comment_score === null ||
    row.comment_revision === null ||
    row.comment_author_alias === null ||
    row.comment_is_mine === null ||
    row.comment_created_at === null ||
    row.comment_updated_at === null
  ) {
    return null;
  }
  return {
    id: row.comment_id,
    postId: row.post_id,
    parentCommentId: row.parent_comment_id,
    body: row.comment_body,
    visibility: row.comment_visibility,
    moderationEpoch: Number(row.comment_moderation_epoch),
    score: row.comment_score,
    revision: Number(row.comment_revision),
    authorAlias: row.comment_author_alias,
    isMine: row.comment_is_mine,
    myVote: vote(row.comment_viewer_vote),
    createdAt: timestamp(row.comment_created_at),
    updatedAt: timestamp(row.comment_updated_at),
  };
}

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("missing board projection");
  return row;
}

export function createBoardQueries(sql: Sql): BoardQueries {
  return {
    async getFeed(identity, query) {
      try {
        const [cursorAt, cursorId] = cursorInput(query.cursor);
        const rows = (await sql`
          select * from public.brownsync_get_board_feed(
            ${identity.actorId}::uuid,
            ${identity.authorToken}::text,
            ${identity.tokenVersion}::integer,
            ${cursorAt}::timestamptz,
            ${cursorId}::uuid,
            ${query.limit}::integer
          )
        `) as unknown as FeedRow[];
        const page = rows.slice(0, query.limit);
        const last = page.at(-1);
        return {
          kind: "ok",
          value: {
            posts: page.map(postFromFeed),
            nextCursor: nextCursor(last?.has_more ?? false, last?.created_at, last?.post_id),
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async getThread(identity, postId, query) {
      try {
        const [cursorAt, cursorId] = cursorInput(query.cursor);
        const rows = (await sql`
          select * from public.brownsync_get_board_thread(
            ${identity.actorId}::uuid,
            ${identity.authorToken}::text,
            ${identity.tokenVersion}::integer,
            ${postId}::uuid,
            ${cursorAt}::timestamptz,
            ${cursorId}::uuid,
            ${query.limit}::integer
          )
        `) as unknown as ThreadRow[];
        const first = one(rows);
        const comments = rows
          .map(commentFromThread)
          .filter((comment): comment is BoardComment => comment !== null)
          .slice(0, query.limit);
        const lastComment = comments.at(-1);
        const lastRow = rows.findLast((row) => row.comment_id === lastComment?.id);
        return {
          kind: "ok",
          value: {
            post: postFromThread(first),
            comments,
            nextCursor: nextCursor(
              lastRow?.has_more ?? false,
              lastRow?.comment_created_at,
              lastRow?.comment_id,
            ),
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async getOwnContent(identity, query) {
      try {
        const [cursorAt, cursorId] = cursorInput(query.cursor);
        const rows = (await sql`
          select * from public.brownsync_get_own_board_content(
            ${identity.actorId}::uuid,
            ${identity.authorToken}::text,
            ${identity.tokenVersion}::integer,
            ${cursorAt}::timestamptz,
            ${cursorId}::uuid,
            ${query.limit}::integer
          )
        `) as unknown as OwnRow[];
        const page = rows.slice(0, query.limit);
        const items: BoardOwnContentItem[] = page.map((row) => ({
          contentType: row.item_type,
          id: row.item_id,
          postId: row.post_id,
          parentCommentId: row.parent_comment_id,
          title: row.title,
          body: row.body,
          visibility: row.visibility,
          moderationEpoch: Number(row.moderation_epoch),
          score: row.score,
          revision: Number(row.revision),
          authorAlias: identity.alias,
          isMine: true,
          createdAt: timestamp(row.created_at),
          updatedAt: timestamp(row.updated_at),
        }));
        const last = page.at(-1);
        return {
          kind: "ok",
          value: {
            items,
            nextCursor: nextCursor(last?.has_more ?? false, last?.updated_at, last?.item_id),
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async getStatus(identity) {
      try {
        const rows = (await sql`
          select * from public.brownsync_get_board_status(
            ${identity.actorId}::uuid,
            ${identity.authorToken}::text,
            ${identity.tokenVersion}::integer
          )
        `) as unknown as StatusRow[];
        const row = one(rows);
        return {
          kind: "ok",
          value: {
            enabled: row.enabled,
            authorAlias: row.author_alias,
            banned: row.banned,
            banId: row.ban_id,
            bannedUntil: row.banned_until === null ? null : timestamp(row.banned_until),
            banReason: row.ban_reason,
            pendingAppeals: Number(row.pending_appeals),
            privacyNotice: BOARD_PRIVACY_NOTICE,
            edgeMetadataNotice: BOARD_EDGE_METADATA_NOTICE,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async createPost(identity, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_create_board_post(
            ${identity.actorId}::uuid,
            ${identity.authorToken}::text,
            ${identity.tokenVersion}::integer,
            ${input.clientRequestId}::uuid,
            ${input.title ?? null}::text,
            ${input.body}::text
          )
        `) as unknown as { post_id: string; revision: number | string; replayed: boolean }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: {
            postId: row.post_id,
            revision: Number(row.revision),
            replayed: row.replayed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async editPost(identity, postId, input) {
      try {
        const patch: { title?: string | null; body?: string } = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.body !== undefined) patch.body = input.body;
        const rows = (await sql`
          select * from public.brownsync_edit_board_post(
            ${identity.actorId}::uuid,
            ${identity.authorToken}::text,
            ${identity.tokenVersion}::integer,
            ${postId}::uuid,
            ${input.expectedRevision}::bigint,
            ${sql.json(patch as never)}::jsonb
          )
        `) as unknown as { post_id: string; revision: number | string; changed: boolean }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: { postId: row.post_id, revision: Number(row.revision), changed: row.changed },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async deletePost(identity, postId, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_delete_board_post(
            ${identity.actorId}::uuid,
            ${identity.authorToken}::text,
            ${identity.tokenVersion}::integer,
            ${postId}::uuid,
            ${input.expectedRevision}::bigint
          )
        `) as unknown as { post_id: string; revision: number | string; changed: boolean }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: { postId: row.post_id, revision: Number(row.revision), changed: row.changed },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async createComment(identity, postId, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_create_board_comment(
            ${identity.actorId}::uuid,
            ${identity.authorToken}::text,
            ${identity.tokenVersion}::integer,
            ${input.clientRequestId}::uuid,
            ${postId}::uuid,
            ${input.parentCommentId ?? null}::uuid,
            ${input.body}::text
          )
        `) as unknown as {
          comment_id: string;
          post_id: string;
          revision: number | string;
          replayed: boolean;
        }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: {
            commentId: row.comment_id,
            postId: row.post_id,
            revision: Number(row.revision),
            replayed: row.replayed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async editComment(identity, commentId, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_edit_board_comment(
            ${identity.actorId}::uuid,
            ${identity.authorToken}::text,
            ${identity.tokenVersion}::integer,
            ${commentId}::uuid,
            ${input.expectedRevision}::bigint,
            ${input.body}::text
          )
        `) as unknown as { comment_id: string; revision: number | string; changed: boolean }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: {
            commentId: row.comment_id,
            revision: Number(row.revision),
            changed: row.changed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async deleteComment(identity, commentId, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_delete_board_comment(
            ${identity.actorId}::uuid,
            ${identity.authorToken}::text,
            ${identity.tokenVersion}::integer,
            ${commentId}::uuid,
            ${input.expectedRevision}::bigint
          )
        `) as unknown as { comment_id: string; revision: number | string; changed: boolean }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: {
            commentId: row.comment_id,
            revision: Number(row.revision),
            changed: row.changed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async setVote(identity, target, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_set_board_vote(
            ${identity.actorId}::uuid,
            ${identity.authorToken}::text,
            ${identity.tokenVersion}::integer,
            ${target.postId}::uuid,
            ${target.commentId}::uuid,
            ${input.value}::integer
          )
        `) as unknown as {
          post_id: string | null;
          comment_id: string | null;
          value: -1 | 0 | 1;
          score: number;
          changed: boolean;
        }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: {
            postId: row.post_id,
            commentId: row.comment_id,
            value: row.value,
            score: row.score,
            changed: row.changed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async reportContent(identity, target, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_report_board_content(
            ${identity.actorId}::uuid,
            ${identity.authorToken}::text,
            ${identity.tokenVersion}::integer,
            ${target.postId}::uuid,
            ${target.commentId}::uuid,
            ${input.reason}::text,
            ${input.detail ?? null}::text
          )
        `) as unknown as {
          report_id: string;
          target_epoch: number | string;
          visibility: BoardReportResult["visibility"];
          revision: number | string;
          auto_hidden: boolean;
          replayed: boolean;
        }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: {
            reportId: row.report_id,
            targetEpoch: Number(row.target_epoch),
            visibility: row.visibility,
            revision: Number(row.revision),
            autoHidden: row.auto_hidden,
            replayed: row.replayed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async createAppeal(identity, target, input) {
      try {
        const targetEpoch = "targetEpoch" in input ? input.targetEpoch : null;
        const rows = (await sql`
          select * from public.brownsync_create_board_appeal(
            ${identity.actorId}::uuid,
            ${identity.authorToken}::text,
            ${identity.tokenVersion}::integer,
            ${input.clientRequestId}::uuid,
            ${target.postId}::uuid,
            ${target.commentId}::uuid,
            ${target.banId}::uuid,
            ${targetEpoch}::bigint,
            ${input.body}::text
          )
        `) as unknown as {
          appeal_id: string;
          state: BoardAppealResult["state"];
          replayed: boolean;
        }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: { appealId: row.appeal_id, state: row.state, replayed: row.replayed },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async getModerationQueue(actorId, query) {
      try {
        const [cursorAt, cursorId] = cursorInput(query.cursor);
        const rows = (await sql`
          select * from public.brownsync_get_board_moderation_queue(
            ${actorId}::uuid,
            ${cursorAt}::timestamptz,
            ${cursorId}::uuid,
            ${query.limit}::integer
          )
        `) as unknown as QueueRow[];
        const page = rows.slice(0, query.limit);
        const items: BoardModerationQueueItem[] = page.map((row) => ({
          queueKind: row.queue_kind,
          queueId: row.queue_id,
          targetType: row.target_type,
          targetId: row.target_id,
          postId: row.post_id,
          parentCommentId: row.parent_comment_id,
          title: row.title,
          body: row.body,
          visibility: row.visibility,
          moderationEpoch: row.moderation_epoch === null ? null : Number(row.moderation_epoch),
          score: row.score,
          openReportCount: Number(row.open_report_count),
          reportReasons: row.report_reasons,
          appealBody: row.appeal_body,
          createdAt: timestamp(row.created_at),
          updatedAt: timestamp(row.updated_at),
        }));
        const last = page.at(-1);
        return {
          kind: "ok",
          value: {
            items,
            nextCursor: nextCursor(last?.has_more ?? false, last?.updated_at, last?.queue_id),
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async decideContent(actorId, target, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_decide_board_content(
            ${actorId}::uuid,
            ${input.clientRequestId}::uuid,
            ${target.postId}::uuid,
            ${target.commentId}::uuid,
            ${input.expectedEpoch}::bigint,
            ${input.action}::text,
            ${input.reason}::text
          )
        `) as unknown as {
          target_type: BoardModerationDecisionResult["targetType"];
          target_id: string;
          visibility: BoardModerationDecisionResult["visibility"];
          moderation_epoch: number | string;
          revision: number | string;
          replayed: boolean;
        }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: {
            targetType: row.target_type,
            targetId: row.target_id,
            visibility: row.visibility,
            moderationEpoch: Number(row.moderation_epoch),
            revision: Number(row.revision),
            replayed: row.replayed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async createBan(actorId, target, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_create_board_ban(
            ${actorId}::uuid,
            ${input.clientRequestId}::uuid,
            ${target.postId}::uuid,
            ${target.commentId}::uuid,
            ${input.durationSeconds}::integer,
            ${input.reason}::text,
            ${input.note ?? null}::text
          )
        `) as unknown as { ban_id: string; expires_at: DateValue; replayed: boolean }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: {
            banId: row.ban_id,
            expiresAt: timestamp(row.expires_at),
            replayed: row.replayed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async revokeBan(actorId, banId, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_revoke_board_ban(
            ${actorId}::uuid,
            ${input.clientRequestId}::uuid,
            ${banId}::uuid,
            ${input.reason}::text
          )
        `) as unknown as {
          ban_id: string;
          revoked_at: DateValue;
          changed: boolean;
          replayed: boolean;
        }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: {
            banId: row.ban_id,
            revokedAt: timestamp(row.revoked_at),
            changed: row.changed,
            replayed: row.replayed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async decideAppeal(actorId, appealId, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_decide_board_appeal(
            ${actorId}::uuid,
            ${input.clientRequestId}::uuid,
            ${appealId}::uuid,
            ${input.decision}::text,
            ${input.reason}::text
          )
        `) as unknown as {
          appeal_id: string;
          state: BoardAppealDecisionResult["state"];
          target_type: BoardAppealDecisionResult["targetType"];
          target_id: string;
          changed: boolean;
          replayed: boolean;
        }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: {
            appealId: row.appeal_id,
            state: row.state,
            targetType: row.target_type,
            targetId: row.target_id,
            changed: row.changed,
            replayed: row.replayed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async getConfig(actorId) {
      try {
        const rows = (await sql`
          select * from public.brownsync_get_board_config(${actorId}::uuid)
        `) as unknown as {
          enabled: boolean;
          auto_hide_threshold: number;
          updated_at: DateValue;
        }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: {
            enabled: row.enabled,
            autoHideThreshold: row.auto_hide_threshold,
            updatedAt: timestamp(row.updated_at),
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async setConfig(actorId, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_set_board_config(
            ${actorId}::uuid,
            ${input.enabled}::boolean,
            ${input.autoHideThreshold}::integer
          )
        `) as unknown as {
          enabled: boolean;
          auto_hide_threshold: number;
          updated_at: DateValue;
          changed: boolean;
        }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: {
            enabled: row.enabled,
            autoHideThreshold: row.auto_hide_threshold,
            updatedAt: timestamp(row.updated_at),
            changed: row.changed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async listModerators(actorId, query) {
      try {
        const [cursorAt, cursorId] = cursorInput(query.cursor);
        const rows = (await sql`
          select * from public.brownsync_list_board_moderators(
            ${actorId}::uuid,
            ${cursorAt}::timestamptz,
            ${cursorId}::uuid,
            ${query.limit}::integer
          )
        `) as unknown as {
          user_id: string;
          role: "moderator" | "owner";
          granted_by: string | null;
          granted_at: DateValue;
          has_more: boolean;
        }[];
        const page = rows.slice(0, query.limit);
        const last = page.at(-1);
        return {
          kind: "ok",
          value: {
            moderators: page.map((row) => ({
              userId: row.user_id,
              role: row.role,
              grantedBy: row.granted_by,
              grantedAt: timestamp(row.granted_at),
            })),
            nextCursor: nextCursor(last?.has_more ?? false, last?.granted_at, last?.user_id),
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async addModerator(actorId, userId, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_add_board_moderator(
            ${actorId}::uuid,
            ${userId}::uuid,
            ${input.role}::text
          )
        `) as unknown as {
          user_id: string;
          role: "moderator" | "owner";
          changed: boolean;
        }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: { userId: row.user_id, role: row.role, changed: row.changed },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async removeModerator(actorId, userId) {
      try {
        const rows = (await sql`
          select * from public.brownsync_remove_board_moderator(
            ${actorId}::uuid,
            ${userId}::uuid
          )
        `) as unknown as { user_id: string; changed: boolean }[];
        const row = one(rows);
        return { kind: "ok", value: { userId: row.user_id, changed: row.changed } };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async deleteAccount(actorId, authorToken) {
      try {
        const rows = (await sql`
          select * from public.brownsync_delete_board_account(
            ${actorId}::uuid,
            ${authorToken}::text
          )
        `) as unknown as {
          posts_tombstoned: number | string;
          comments_tombstoned: number | string;
          replayed: boolean;
        }[];
        const row = one(rows);
        return {
          kind: "ok",
          value: {
            postsTombstoned: Number(row.posts_tombstoned),
            commentsTombstoned: Number(row.comments_tombstoned),
            replayed: row.replayed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },
  };
}
