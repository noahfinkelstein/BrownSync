import { z } from "zod";

export const BOARD_PRIVACY_NOTICE =
  "Posts are pseudonymous, not untraceable. BrownSync stores a stable anonymous identifier so it can enforce bans, rate limits, and abuse controls. The board database does not store your BrownSync account ID with your posts. Your posts can be linked to each other, and someone who obtained both BrownSync’s private board secret and a list of Brown account IDs could reconstruct that link. Board moderators do not see your name or email through the moderation tools.";

export const BOARD_EDGE_METADATA_NOTICE =
  "Cloudflare processes normal edge request metadata, including IP addresses, to deliver and protect the service.";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_CURSOR_LENGTH = 256;

const TimestampSchema = z.iso.datetime({ offset: true });
const CanonicalCursorTimestampSchema = TimestampSchema.refine((value) => {
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}, "Canonical UTC timestamp required");
const EpochSchema = z.number().int().nonnegative();
const RevisionSchema = z.number().int().positive();
const ScoreSchema = z.number().int();
const NullableTitleSchema = z.string().trim().min(1).max(160).nullable();
const NullableBodySchema = z.string().trim().min(1).max(5000).nullable();
const PostBodyInputSchema = z.string().trim().min(1).max(5000);
const CommentBodyInputSchema = z.string().trim().min(1).max(2000);
const AppealBodyInputSchema = z.string().trim().min(1).max(2000);
const ModeratorReasonSchema = z.string().trim().min(1).max(240);
const OptionalModeratorNoteSchema = z.string().trim().min(1).max(1000).nullable().optional();

export const BoardVisibilitySchema = z
  .enum([
    "visible",
    "auto_hidden",
    "moderator_hidden",
    "removed",
    "author_deleted",
    "account_deleted",
  ])
  .meta({ id: "BoardVisibility" });
export type BoardVisibility = z.infer<typeof BoardVisibilitySchema>;

export const BoardContentTypeSchema = z.enum(["post", "comment"]).meta({
  id: "BoardContentType",
});
export type BoardContentType = z.infer<typeof BoardContentTypeSchema>;

export const BoardReportReasonSchema = z
  .enum(["harassment", "hate", "threat", "sexual", "personal_info", "spam", "other"])
  .meta({ id: "BoardReportReason" });
export type BoardReportReason = z.infer<typeof BoardReportReasonSchema>;

export const BoardAppealStateSchema = z.enum(["pending", "approved", "denied"]).meta({
  id: "BoardAppealState",
});
export type BoardAppealState = z.infer<typeof BoardAppealStateSchema>;

export const BoardModerationActionSchema = z.enum(["hide", "remove", "restore", "dismiss"]).meta({
  id: "BoardModerationAction",
});
export type BoardModerationAction = z.infer<typeof BoardModerationActionSchema>;

export const BoardAppealDecisionSchema = z.enum(["approved", "denied"]).meta({
  id: "BoardAppealDecision",
});
export type BoardAppealDecision = z.infer<typeof BoardAppealDecisionSchema>;

export const BoardModeratorRoleSchema = z.enum(["moderator", "owner"]).meta({
  id: "BoardModeratorRole",
});
export type BoardModeratorRole = z.infer<typeof BoardModeratorRoleSchema>;

export const BoardAliasSchema = z
  .string()
  .regex(/^Anonymous Otter [0-9A-F]{4}$/)
  .meta({ id: "BoardAlias" });
export type BoardAlias = z.infer<typeof BoardAliasSchema>;

export type BoardCursorTuple = readonly [timestamp: string, id: string];

function encodeBase64Url(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 3) {
    const first = value.charCodeAt(index);
    const second = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
    const third = index + 2 < value.length ? value.charCodeAt(index + 2) : 0;
    const block = (first << 16) | (second << 8) | third;

    encoded += BASE64_ALPHABET[(block >> 18) & 63] ?? "";
    encoded += BASE64_ALPHABET[(block >> 12) & 63] ?? "";
    if (index + 1 < value.length) encoded += BASE64_ALPHABET[(block >> 6) & 63] ?? "";
    if (index + 2 < value.length) encoded += BASE64_ALPHABET[block & 63] ?? "";
  }
  return encoded.replaceAll("+", "-").replaceAll("/", "_");
}

function decodeBase64Url(value: string): string | null {
  if (
    value.length === 0 ||
    value.length > MAX_CURSOR_LENGTH ||
    !BASE64URL.test(value) ||
    value.length % 4 === 1
  ) {
    return null;
  }

  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  let decoded = "";
  for (let index = 0; index < standard.length; index += 4) {
    const a = BASE64_ALPHABET.indexOf(standard[index] ?? "");
    const b = BASE64_ALPHABET.indexOf(standard[index + 1] ?? "");
    const c = index + 2 < standard.length ? BASE64_ALPHABET.indexOf(standard[index + 2] ?? "") : 0;
    const d = index + 3 < standard.length ? BASE64_ALPHABET.indexOf(standard[index + 3] ?? "") : 0;
    if (a < 0 || b < 0 || c < 0 || d < 0) return null;

    const block = (a << 18) | (b << 12) | (c << 6) | d;
    decoded += String.fromCharCode((block >> 16) & 255);
    if (index + 2 < standard.length) decoded += String.fromCharCode((block >> 8) & 255);
    if (index + 3 < standard.length) decoded += String.fromCharCode(block & 255);
  }
  return decoded;
}

export function encodeBoardCursor(tuple: BoardCursorTuple): string {
  if (
    !CanonicalCursorTimestampSchema.safeParse(tuple[0]).success ||
    !CANONICAL_UUID.test(tuple[1]) ||
    tuple.length !== 2
  ) {
    throw new Error("Invalid board cursor tuple");
  }
  const encoded = encodeBase64Url(JSON.stringify(tuple));
  if (encoded.length > MAX_CURSOR_LENGTH) throw new Error("Board cursor exceeds maximum length");
  return encoded;
}

export function decodeBoardCursor(value: string): BoardCursorTuple {
  const decoded = decodeBase64Url(value);
  if (decoded === null) throw new Error("Invalid board cursor");

  let tuple: unknown;
  try {
    tuple = JSON.parse(decoded);
  } catch {
    throw new Error("Invalid board cursor");
  }
  if (
    !Array.isArray(tuple) ||
    tuple.length !== 2 ||
    typeof tuple[0] !== "string" ||
    typeof tuple[1] !== "string" ||
    !CanonicalCursorTimestampSchema.safeParse(tuple[0]).success ||
    !CANONICAL_UUID.test(tuple[1])
  ) {
    throw new Error("Invalid board cursor");
  }
  const result: BoardCursorTuple = [tuple[0], tuple[1]];
  if (encodeBoardCursor(result) !== value) throw new Error("Noncanonical board cursor");
  return result;
}

function boardCursorValueSchema() {
  return z
    .string()
    .max(MAX_CURSOR_LENGTH)
    .regex(BASE64URL)
    .superRefine((value, context) => {
      try {
        decodeBoardCursor(value);
      } catch {
        context.addIssue({ code: "custom", message: "Invalid board cursor" });
      }
    });
}

export const BoardCursorSchema = boardCursorValueSchema().meta({ id: "BoardCursor" });
export type BoardCursor = z.infer<typeof BoardCursorSchema>;
export const BoardNullableCursorSchema = boardCursorValueSchema().nullable().meta({
  id: "BoardNullableCursor",
});

function pageQuery(id: string) {
  return z
    .object({
      cursor: BoardCursorSchema.optional(),
      limit: z.coerce.number().int().min(1).max(50).default(25),
    })
    .strict()
    .meta({ id });
}

export const BoardFeedQuerySchema = pageQuery("BoardFeedQuery");
export type BoardFeedQuery = z.infer<typeof BoardFeedQuerySchema>;
export const BoardThreadQuerySchema = pageQuery("BoardThreadQuery");
export type BoardThreadQuery = z.infer<typeof BoardThreadQuerySchema>;
export const BoardOwnContentQuerySchema = pageQuery("BoardOwnContentQuery");
export type BoardOwnContentQuery = z.infer<typeof BoardOwnContentQuerySchema>;
export const BoardModerationQueueQuerySchema = pageQuery("BoardModerationQueueQuery");
export type BoardModerationQueueQuery = z.infer<typeof BoardModerationQueueQuerySchema>;
export const BoardModeratorQuerySchema = pageQuery("BoardModeratorQuery");
export type BoardModeratorQuery = z.infer<typeof BoardModeratorQuerySchema>;

const TERMINAL_VISIBILITY = new Set<BoardVisibility>([
  "removed",
  "author_deleted",
  "account_deleted",
]);

export const BoardPostSchema = z
  .object({
    id: z.uuid(),
    title: NullableTitleSchema,
    body: PostBodyInputSchema,
    visibility: z.literal("visible"),
    moderationEpoch: EpochSchema,
    score: ScoreSchema,
    revision: RevisionSchema,
    authorAlias: BoardAliasSchema,
    isMine: z.boolean(),
    commentCount: z.number().int().nonnegative(),
    myVote: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .meta({ id: "BoardPost" });
export type BoardPost = z.infer<typeof BoardPostSchema>;

export const BoardCommentSchema = z
  .object({
    id: z.uuid(),
    postId: z.uuid(),
    parentCommentId: z.uuid().nullable(),
    body: CommentBodyInputSchema,
    visibility: z.literal("visible"),
    moderationEpoch: EpochSchema,
    score: ScoreSchema,
    revision: RevisionSchema,
    authorAlias: BoardAliasSchema,
    isMine: z.boolean(),
    myVote: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .meta({ id: "BoardComment" });
export type BoardComment = z.infer<typeof BoardCommentSchema>;

export const BoardFeedSchema = z
  .object({
    posts: z.array(BoardPostSchema).max(50),
    nextCursor: BoardNullableCursorSchema,
  })
  .strict()
  .meta({ id: "BoardFeed" });
export type BoardFeed = z.infer<typeof BoardFeedSchema>;

export const BoardThreadPostSchema = z
  .object({
    id: z.uuid(),
    title: NullableTitleSchema,
    body: PostBodyInputSchema,
    visibility: z.literal("visible"),
    moderationEpoch: EpochSchema,
    score: ScoreSchema,
    revision: RevisionSchema,
    authorAlias: BoardAliasSchema,
    isMine: z.boolean(),
    myVote: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .meta({ id: "BoardThreadPost" });
export type BoardThreadPost = z.infer<typeof BoardThreadPostSchema>;

export const BoardThreadSchema = z
  .object({
    post: BoardThreadPostSchema,
    comments: z.array(BoardCommentSchema).max(50),
    nextCursor: BoardNullableCursorSchema,
  })
  .strict()
  .meta({ id: "BoardThread" });
export type BoardThread = z.infer<typeof BoardThreadSchema>;

export const BoardOwnContentItemSchema = z
  .object({
    contentType: BoardContentTypeSchema,
    id: z.uuid(),
    postId: z.uuid(),
    parentCommentId: z.uuid().nullable(),
    title: NullableTitleSchema,
    body: NullableBodySchema,
    visibility: BoardVisibilitySchema,
    moderationEpoch: EpochSchema,
    score: ScoreSchema,
    revision: RevisionSchema,
    authorAlias: BoardAliasSchema,
    isMine: z.literal(true),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const terminal = TERMINAL_VISIBILITY.has(value.visibility);
    if (value.contentType === "comment" && value.title !== null) {
      context.addIssue({ code: "custom", path: ["title"], message: "Comments have no title" });
    }
    if (value.contentType === "comment" && value.body !== null && value.body.length > 2000) {
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: "Comment bodies are limited to 2000 characters",
      });
    }
    if (terminal && (value.title !== null || value.body !== null)) {
      context.addIssue({ code: "custom", message: "Deleted content must not contain text" });
    }
    if (!terminal && value.body === null) {
      context.addIssue({ code: "custom", path: ["body"], message: "Live content requires a body" });
    }
  })
  .meta({ id: "BoardOwnContentItem" });
export type BoardOwnContentItem = z.infer<typeof BoardOwnContentItemSchema>;

export const BoardOwnContentSchema = z
  .object({
    items: z.array(BoardOwnContentItemSchema).max(50),
    nextCursor: BoardNullableCursorSchema,
  })
  .strict()
  .meta({ id: "BoardOwnContent" });
export type BoardOwnContent = z.infer<typeof BoardOwnContentSchema>;

export const BoardStatusSchema = z
  .object({
    enabled: z.boolean(),
    authorAlias: BoardAliasSchema,
    banned: z.boolean(),
    banId: z.uuid().nullable(),
    bannedUntil: TimestampSchema.nullable(),
    banReason: ModeratorReasonSchema.nullable(),
    pendingAppeals: z.number().int().nonnegative(),
    privacyNotice: z.literal(BOARD_PRIVACY_NOTICE),
    edgeMetadataNotice: z.literal(BOARD_EDGE_METADATA_NOTICE),
  })
  .strict()
  .superRefine((value, context) => {
    const hasBan = value.banId !== null && value.bannedUntil !== null && value.banReason !== null;
    if (value.banned !== hasBan) {
      context.addIssue({
        code: "custom",
        message: "Active ban details must be internally consistent",
      });
    }
  })
  .meta({ id: "BoardStatus" });
export type BoardStatus = z.infer<typeof BoardStatusSchema>;

export const BoardCreatePostRequestSchema = z
  .object({
    clientRequestId: z.uuid(),
    title: z.string().trim().min(1).max(160).nullable().optional(),
    body: PostBodyInputSchema,
  })
  .strict()
  .meta({ id: "BoardCreatePostRequest" });
export type BoardCreatePostRequest = z.infer<typeof BoardCreatePostRequestSchema>;

const BoardEditPostLegacyRequestSchema = z
  .object({
    expectedRevision: RevisionSchema,
    title: z.string().trim().min(1).max(160).nullable().optional(),
    body: PostBodyInputSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.title === undefined && value.body === undefined) {
      context.addIssue({ code: "custom", message: "At least one post field is required" });
    }
  });

type BoardEditPostTitleCommand =
  | {
      action: "set";
      value: string;
    }
  | {
      action: "clear";
    };

const BoardEditPostTitleCommandObjectSchema = z
  .object({
    action: z.enum(["set", "clear"]),
    value: z.string().trim().min(1).max(160).optional(),
  })
  .strict()
  .superRefine((command, context) => {
    const hasValue = Object.hasOwn(command, "value");
    if (command.action === "set" && (!hasValue || command.value === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "set commands require a value",
      });
    }
    if (command.action === "clear" && hasValue) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "clear commands must not carry a value",
      });
    }
  })
  .meta({ id: "BoardEditPostTitleCommand" });

export const BoardEditPostTitleCommandSchema =
  BoardEditPostTitleCommandObjectSchema as unknown as z.ZodType<BoardEditPostTitleCommand>;

export const BoardEditPostBodyCommandSchema = z
  .object({
    action: z.literal("set"),
    value: PostBodyInputSchema,
  })
  .strict()
  .meta({ id: "BoardEditPostBodyCommand" });

export const BoardEditPostV2PatchSchema = z
  .object({
    title: BoardEditPostTitleCommandSchema.optional(),
    body: BoardEditPostBodyCommandSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "At least one post field is required")
  .meta({ id: "BoardEditPostV2Patch" });

export const BoardEditPostV2RequestSchema = z
  .object({
    version: z.literal(2),
    expectedRevision: RevisionSchema,
    patch: BoardEditPostV2PatchSchema,
  })
  .strict()
  .meta({ id: "BoardEditPostV2Request" });

export const BoardEditPostRequestSchema = z
  .union([BoardEditPostLegacyRequestSchema, BoardEditPostV2RequestSchema])
  .meta({ id: "BoardEditPostRequest" });
export type BoardEditPostRequest = z.infer<typeof BoardEditPostRequestSchema>;

export const BoardCreateCommentRequestSchema = z
  .object({
    clientRequestId: z.uuid(),
    parentCommentId: z.uuid().nullable().optional(),
    body: CommentBodyInputSchema,
  })
  .strict()
  .meta({ id: "BoardCreateCommentRequest" });
export type BoardCreateCommentRequest = z.infer<typeof BoardCreateCommentRequestSchema>;

export const BoardEditCommentRequestSchema = z
  .object({ expectedRevision: RevisionSchema, body: CommentBodyInputSchema })
  .strict()
  .meta({ id: "BoardEditCommentRequest" });
export type BoardEditCommentRequest = z.infer<typeof BoardEditCommentRequestSchema>;

export const BoardDeleteRequestSchema = z
  .object({ expectedRevision: RevisionSchema })
  .strict()
  .meta({ id: "BoardDeleteRequest" });
export type BoardDeleteRequest = z.infer<typeof BoardDeleteRequestSchema>;

export const BoardVoteRequestSchema = z
  .object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) })
  .strict()
  .meta({ id: "BoardVoteRequest" });
export type BoardVoteRequest = z.infer<typeof BoardVoteRequestSchema>;

export const BoardReportRequestSchema = z
  .object({
    reason: BoardReportReasonSchema,
    detail: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict()
  .meta({ id: "BoardReportRequest" });
export type BoardReportRequest = z.infer<typeof BoardReportRequestSchema>;

export const BoardContentAppealRequestSchema = z
  .object({
    clientRequestId: z.uuid(),
    targetEpoch: EpochSchema,
    body: AppealBodyInputSchema,
  })
  .strict()
  .meta({ id: "BoardContentAppealRequest" });
export type BoardContentAppealRequest = z.infer<typeof BoardContentAppealRequestSchema>;

export const BoardBanAppealRequestSchema = z
  .object({ clientRequestId: z.uuid(), body: AppealBodyInputSchema })
  .strict()
  .meta({ id: "BoardBanAppealRequest" });
export type BoardBanAppealRequest = z.infer<typeof BoardBanAppealRequestSchema>;

export const BoardModerationDecisionRequestSchema = z
  .object({
    clientRequestId: z.uuid(),
    expectedEpoch: EpochSchema,
    action: BoardModerationActionSchema,
    reason: ModeratorReasonSchema,
  })
  .strict()
  .meta({ id: "BoardModerationDecisionRequest" });
export type BoardModerationDecisionRequest = z.infer<typeof BoardModerationDecisionRequestSchema>;

export const BoardBanRequestSchema = z
  .object({
    clientRequestId: z.uuid(),
    durationSeconds: z.number().int().min(300).max(31_536_000),
    reason: ModeratorReasonSchema,
    note: OptionalModeratorNoteSchema,
  })
  .strict()
  .meta({ id: "BoardBanRequest" });
export type BoardBanRequest = z.infer<typeof BoardBanRequestSchema>;

export const BoardBanRevokeRequestSchema = z
  .object({ clientRequestId: z.uuid(), reason: ModeratorReasonSchema })
  .strict()
  .meta({ id: "BoardBanRevokeRequest" });
export type BoardBanRevokeRequest = z.infer<typeof BoardBanRevokeRequestSchema>;

export const BoardAppealDecisionRequestSchema = z
  .object({
    clientRequestId: z.uuid(),
    decision: BoardAppealDecisionSchema,
    reason: ModeratorReasonSchema,
  })
  .strict()
  .meta({ id: "BoardAppealDecisionRequest" });
export type BoardAppealDecisionRequest = z.infer<typeof BoardAppealDecisionRequestSchema>;

export const BoardConfigUpdateRequestSchema = z
  .object({
    enabled: z.boolean(),
    autoHideThreshold: z.number().int().min(2).max(10),
  })
  .strict()
  .meta({ id: "BoardConfigUpdateRequest" });
export type BoardConfigUpdateRequest = z.infer<typeof BoardConfigUpdateRequestSchema>;

export const BoardModeratorUpsertRequestSchema = z
  .object({ role: BoardModeratorRoleSchema })
  .strict()
  .meta({ id: "BoardModeratorUpsertRequest" });
export type BoardModeratorUpsertRequest = z.infer<typeof BoardModeratorUpsertRequestSchema>;

export const BoardCreatePostResultSchema = z
  .object({ postId: z.uuid(), revision: RevisionSchema, replayed: z.boolean() })
  .strict()
  .meta({ id: "BoardCreatePostResult" });
export type BoardCreatePostResult = z.infer<typeof BoardCreatePostResultSchema>;

export const BoardPostMutationResultSchema = z
  .object({ postId: z.uuid(), revision: RevisionSchema, changed: z.boolean() })
  .strict()
  .meta({ id: "BoardPostMutationResult" });
export type BoardPostMutationResult = z.infer<typeof BoardPostMutationResultSchema>;

export const BoardCreateCommentResultSchema = z
  .object({
    commentId: z.uuid(),
    postId: z.uuid(),
    revision: RevisionSchema,
    replayed: z.boolean(),
  })
  .strict()
  .meta({ id: "BoardCreateCommentResult" });
export type BoardCreateCommentResult = z.infer<typeof BoardCreateCommentResultSchema>;

export const BoardCommentMutationResultSchema = z
  .object({ commentId: z.uuid(), revision: RevisionSchema, changed: z.boolean() })
  .strict()
  .meta({ id: "BoardCommentMutationResult" });
export type BoardCommentMutationResult = z.infer<typeof BoardCommentMutationResultSchema>;

export const BoardVoteResultSchema = z
  .object({
    postId: z.uuid().nullable(),
    commentId: z.uuid().nullable(),
    value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    score: ScoreSchema,
    changed: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.postId === null) === (value.commentId === null)) {
      context.addIssue({ code: "custom", message: "Exactly one vote target is required" });
    }
  })
  .meta({ id: "BoardVoteResult" });
export type BoardVoteResult = z.infer<typeof BoardVoteResultSchema>;

export const BoardReportResultSchema = z
  .object({
    reportId: z.uuid(),
    targetEpoch: EpochSchema,
    visibility: BoardVisibilitySchema,
    revision: RevisionSchema,
    autoHidden: z.boolean(),
    replayed: z.boolean(),
  })
  .strict()
  .meta({ id: "BoardReportResult" });
export type BoardReportResult = z.infer<typeof BoardReportResultSchema>;

export const BoardAppealResultSchema = z
  .object({ appealId: z.uuid(), state: BoardAppealStateSchema, replayed: z.boolean() })
  .strict()
  .meta({ id: "BoardAppealResult" });
export type BoardAppealResult = z.infer<typeof BoardAppealResultSchema>;

export const BoardModerationQueueItemSchema = z
  .object({
    queueKind: z.enum(["report", "appeal"]),
    queueId: z.uuid(),
    targetType: z.enum(["post", "comment", "ban"]),
    targetId: z.uuid(),
    postId: z.uuid().nullable(),
    parentCommentId: z.uuid().nullable(),
    title: NullableTitleSchema,
    body: NullableBodySchema,
    visibility: BoardVisibilitySchema.nullable(),
    moderationEpoch: EpochSchema.nullable(),
    score: ScoreSchema.nullable(),
    openReportCount: z.number().int().nonnegative(),
    reportReasons: z.array(BoardReportReasonSchema).max(7),
    appealBody: AppealBodyInputSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.queueKind === "report" && value.appealBody !== null) {
      context.addIssue({
        code: "custom",
        path: ["appealBody"],
        message: "Report queue items do not contain appeal text",
      });
    }
    if (value.queueKind === "appeal" && value.appealBody === null) {
      context.addIssue({
        code: "custom",
        path: ["appealBody"],
        message: "Appeal queue items require appeal text",
      });
    }
    if (value.targetType === "ban") {
      if (
        value.queueKind !== "appeal" ||
        value.postId !== null ||
        value.parentCommentId !== null ||
        value.title !== null ||
        value.body !== null ||
        value.visibility !== null ||
        value.moderationEpoch !== null ||
        value.score !== null ||
        value.openReportCount !== 0 ||
        value.reportReasons.length !== 0
      ) {
        context.addIssue({
          code: "custom",
          message: "Ban queue items contain only bounded appeal metadata",
        });
      }
      return;
    }
    if (
      value.postId === null ||
      value.visibility === null ||
      value.moderationEpoch === null ||
      value.score === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Content queue items require content projection fields",
      });
      return;
    }
    if (value.targetType === "comment" && value.title !== null) {
      context.addIssue({ code: "custom", path: ["title"], message: "Comments have no title" });
    }
    if (value.targetType === "comment" && value.body !== null && value.body.length > 2000) {
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: "Comment bodies are limited to 2000 characters",
      });
    }
    const terminal = TERMINAL_VISIBILITY.has(value.visibility);
    if (terminal && (value.title !== null || value.body !== null)) {
      context.addIssue({ code: "custom", message: "Deleted queue content must not contain text" });
    }
    if (!terminal && value.body === null) {
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: "Live queue content requires a body",
      });
    }
  })
  .meta({ id: "BoardModerationQueueItem" });
export type BoardModerationQueueItem = z.infer<typeof BoardModerationQueueItemSchema>;

export const BoardModerationQueueSchema = z
  .object({
    items: z.array(BoardModerationQueueItemSchema).max(50),
    nextCursor: BoardNullableCursorSchema,
  })
  .strict()
  .meta({ id: "BoardModerationQueue" });
export type BoardModerationQueue = z.infer<typeof BoardModerationQueueSchema>;

export const BoardModerationDecisionResultSchema = z
  .object({
    targetType: BoardContentTypeSchema,
    targetId: z.uuid(),
    visibility: BoardVisibilitySchema,
    moderationEpoch: EpochSchema,
    revision: RevisionSchema,
    replayed: z.boolean(),
  })
  .strict()
  .meta({ id: "BoardModerationDecisionResult" });
export type BoardModerationDecisionResult = z.infer<typeof BoardModerationDecisionResultSchema>;

export const BoardBanResultSchema = z
  .object({ banId: z.uuid(), expiresAt: TimestampSchema, replayed: z.boolean() })
  .strict()
  .meta({ id: "BoardBanResult" });
export type BoardBanResult = z.infer<typeof BoardBanResultSchema>;

export const BoardBanRevokeResultSchema = z
  .object({
    banId: z.uuid(),
    revokedAt: TimestampSchema,
    changed: z.boolean(),
    replayed: z.boolean(),
  })
  .strict()
  .meta({ id: "BoardBanRevokeResult" });
export type BoardBanRevokeResult = z.infer<typeof BoardBanRevokeResultSchema>;

export const BoardAppealDecisionResultSchema = z
  .object({
    appealId: z.uuid(),
    state: BoardAppealStateSchema,
    targetType: z.enum(["post", "comment", "ban"]),
    targetId: z.uuid(),
    changed: z.boolean(),
    replayed: z.boolean(),
  })
  .strict()
  .meta({ id: "BoardAppealDecisionResult" });
export type BoardAppealDecisionResult = z.infer<typeof BoardAppealDecisionResultSchema>;

export const BoardConfigSchema = z
  .object({
    enabled: z.boolean(),
    autoHideThreshold: z.number().int().min(2).max(10),
    updatedAt: TimestampSchema,
  })
  .strict()
  .meta({ id: "BoardConfig" });
export type BoardConfig = z.infer<typeof BoardConfigSchema>;

export const BoardConfigMutationResultSchema = BoardConfigSchema.extend({
  changed: z.boolean(),
})
  .strict()
  .meta({ id: "BoardConfigMutationResult" });
export type BoardConfigMutationResult = z.infer<typeof BoardConfigMutationResultSchema>;

export const BoardModeratorSchema = z
  .object({
    userId: z.uuid(),
    role: BoardModeratorRoleSchema,
    grantedBy: z.uuid().nullable(),
    grantedAt: TimestampSchema,
  })
  .strict()
  .meta({ id: "BoardModerator" });
export type BoardModerator = z.infer<typeof BoardModeratorSchema>;

export const BoardModeratorsSchema = z
  .object({
    moderators: z.array(BoardModeratorSchema).max(50),
    nextCursor: BoardNullableCursorSchema,
  })
  .strict()
  .meta({ id: "BoardModerators" });
export type BoardModerators = z.infer<typeof BoardModeratorsSchema>;

export const BoardModeratorMutationResultSchema = z
  .object({ userId: z.uuid(), role: BoardModeratorRoleSchema.optional(), changed: z.boolean() })
  .strict()
  .meta({ id: "BoardModeratorMutationResult" });
export type BoardModeratorMutationResult = z.infer<typeof BoardModeratorMutationResultSchema>;

export const BoardAccountDeletionResultSchema = z
  .object({
    postsTombstoned: z.number().int().nonnegative(),
    commentsTombstoned: z.number().int().nonnegative(),
    replayed: z.boolean(),
  })
  .strict()
  .meta({ id: "BoardAccountDeletionResult" });
export type BoardAccountDeletionResult = z.infer<typeof BoardAccountDeletionResultSchema>;
