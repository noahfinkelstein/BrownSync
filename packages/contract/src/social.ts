import { z } from "zod";
import { OrgDetailOutSchema } from "./api";
import { CategorySchema } from "./taxonomy";

export const MeOutSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
  })
  .meta({ id: "Me" });
export type MeOut = z.infer<typeof MeOutSchema>;

const OrgRoleSchema = z.enum(["owner", "editor"]);
const OrgClaimStatusSchema = z.enum(["pending", "approved", "rejected"]);
const OrgOverrideFieldSchema = z.enum([
  "description",
  "aboutMd",
  "meetingInfo",
  "links",
  "avatarUrl",
  "bannerUrl",
]);
const HttpsUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine((value) => value.startsWith("https://"), "HTTPS URL required");
const OrgDescriptionSchema = z.string().max(10_000);
const OrgAboutSchema = z.string().max(20_000);
const OrgMeetingInfoSchema = z.string().max(4_000);

type NullableCommand<Value> =
  | {
      action: "set";
      value: Value;
    }
  | {
      action: "clear";
    };

function nullableCommandSchema<ValueSchema extends z.ZodType>(
  id: string,
  value: ValueSchema,
): z.ZodType<NullableCommand<z.output<ValueSchema>>> {
  const schema = z
    .object({
      action: z.enum(["set", "clear"]),
      value: value.optional(),
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
    .meta({ id });

  return schema as unknown as z.ZodType<NullableCommand<z.output<ValueSchema>>>;
}

export const OrgLinkSchema = z
  .object({
    platform: z.enum([
      "instagram",
      "discord",
      "facebook",
      "linkedin",
      "youtube",
      "x",
      "tiktok",
      "website",
      "other",
    ]),
    url: HttpsUrlSchema,
    label: z.string().max(80).optional(),
  })
  .strict()
  .meta({ id: "OrgLink" });
export type OrgLink = z.infer<typeof OrgLinkSchema>;

export const OrgEnrichedDetailSchema = OrgDetailOutSchema.extend({
  advisor: z.string().nullable(),
  fundingCategory: z.string().nullable(),
  aboutMd: z.string().nullable(),
  meetingInfo: z.string().nullable(),
  links: z.array(OrgLinkSchema).max(20),
  avatarUrl: HttpsUrlSchema.nullable(),
  bannerUrl: HttpsUrlSchema.nullable(),
  overriddenFields: z.array(OrgOverrideFieldSchema),
  revision: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
})
  .strict()
  .meta({ id: "OrgEnrichedDetail" });
export type OrgEnrichedDetail = z.infer<typeof OrgEnrichedDetailSchema>;

export const OrgMembershipSchema = z
  .object({
    organizationId: z.string().min(1),
    organizationName: z.string().min(1),
    role: OrgRoleSchema,
    grantedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .meta({ id: "OrgMembership" });
export type OrgMembership = z.infer<typeof OrgMembershipSchema>;

export const OrgClaimSummarySchema = z
  .object({
    id: z.uuid(),
    organizationId: z.string().min(1),
    organizationName: z.string().min(1),
    status: OrgClaimStatusSchema,
    createdAt: z.iso.datetime({ offset: true }),
    reviewedAt: z.iso.datetime({ offset: true }).nullable(),
    reviewNote: z.string().max(2000).nullable(),
  })
  .strict()
  .meta({ id: "OrgClaimSummary" });
export type OrgClaimSummary = z.infer<typeof OrgClaimSummarySchema>;

export const MyOrganizationsSchema = z
  .object({
    memberships: z.array(OrgMembershipSchema),
    claims: z.array(OrgClaimSummarySchema),
  })
  .strict()
  .meta({ id: "MyOrganizations" });
export type MyOrganizations = z.infer<typeof MyOrganizationsSchema>;

export const OrgCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: OrgDescriptionSchema.nullable().optional(),
    aboutMd: OrgAboutSchema.nullable().optional(),
    meetingInfo: OrgMeetingInfoSchema.nullable().optional(),
    links: z.array(OrgLinkSchema).max(20).nullable().optional(),
  })
  .strict()
  .meta({ id: "OrgCreateRequest" });
export type OrgCreateRequest = z.infer<typeof OrgCreateRequestSchema>;

export const OrgCreateResultSchema = z
  .object({
    organizationId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    role: z.literal("owner"),
    disposition: z.enum(["created", "replayed"]),
  })
  .strict()
  .meta({ id: "OrgCreateResult" });
export type OrgCreateResult = z.infer<typeof OrgCreateResultSchema>;

export const OrgClaimRequestSchema = z
  .object({
    evidence: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .meta({ id: "OrgClaimRequest" });
export type OrgClaimRequest = z.infer<typeof OrgClaimRequestSchema>;

export const OrgClaimResultSchema = z
  .object({
    organizationId: z.string().min(1),
    disposition: z.enum(["auto_approved", "pending", "already_admin", "already_pending"]),
    role: OrgRoleSchema.nullable(),
    claimId: z.uuid().nullable(),
  })
  .strict()
  .meta({ id: "OrgClaimResult" });
export type OrgClaimResult = z.infer<typeof OrgClaimResultSchema>;

export const OrgReviewableClaimSchema = z
  .object({
    claimId: z.uuid(),
    organizationId: z.string().min(1),
    organizationName: z.string().min(1),
    claimantDisplayName: z.string().nullable(),
    claimantHandle: z.string().nullable(),
    evidence: z.string().max(2000).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .meta({ id: "OrgReviewableClaim" });
export type OrgReviewableClaim = z.infer<typeof OrgReviewableClaimSchema>;

export const OrgClaimReviewCursorSchema = z
  .object({
    afterCreatedAt: z.iso.datetime({ offset: true }),
    afterClaimId: z.uuid(),
  })
  .strict()
  .meta({ id: "OrgClaimReviewCursor" });
export type OrgClaimReviewCursor = z.infer<typeof OrgClaimReviewCursorSchema>;

export const OrgClaimReviewQueueQuerySchema = z
  .object({
    afterCreatedAt: z.iso.datetime({ offset: true }).optional(),
    afterClaimId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .superRefine((query, context) => {
    if ((query.afterCreatedAt === undefined) !== (query.afterClaimId === undefined)) {
      context.addIssue({
        code: "custom",
        message: "afterCreatedAt and afterClaimId must be provided together",
      });
    }
  });
export type OrgClaimReviewQueueQuery = z.infer<typeof OrgClaimReviewQueueQuerySchema>;

export const OrgClaimReviewQueueSchema = z
  .object({
    claims: z.array(OrgReviewableClaimSchema),
    next: OrgClaimReviewCursorSchema.nullable(),
  })
  .strict()
  .meta({ id: "OrgClaimReviewQueue" });
export type OrgClaimReviewQueue = z.infer<typeof OrgClaimReviewQueueSchema>;

export const OrgClaimDecisionRequestSchema = z
  .object({
    approve: z.boolean(),
    note: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .meta({ id: "OrgClaimDecisionRequest" });
export type OrgClaimDecisionRequest = z.infer<typeof OrgClaimDecisionRequestSchema>;

export const OrgClaimDecisionResultSchema = z
  .object({
    claimId: z.uuid(),
    status: z.enum(["approved", "rejected"]),
    grantedRole: OrgRoleSchema.nullable(),
    changed: z.boolean(),
  })
  .strict()
  .meta({ id: "OrgClaimDecisionResult" });
export type OrgClaimDecisionResult = z.infer<typeof OrgClaimDecisionResultSchema>;

export const OrgEditPatchSchema = z
  .object({
    description: OrgDescriptionSchema.nullable().optional(),
    aboutMd: OrgAboutSchema.nullable().optional(),
    meetingInfo: OrgMeetingInfoSchema.nullable().optional(),
    links: z.array(OrgLinkSchema).max(20).nullable().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "At least one patch field is required")
  .meta({ id: "OrgEditPatch" });
export type OrgEditPatch = z.infer<typeof OrgEditPatchSchema>;

const OrgEditLegacyRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    patch: OrgEditPatchSchema,
  })
  .strict();

export const OrgEditDescriptionCommandSchema = nullableCommandSchema(
  "OrgEditDescriptionCommand",
  OrgDescriptionSchema,
);
export const OrgEditAboutMdCommandSchema = nullableCommandSchema(
  "OrgEditAboutMdCommand",
  OrgAboutSchema,
);
export const OrgEditMeetingInfoCommandSchema = nullableCommandSchema(
  "OrgEditMeetingInfoCommand",
  OrgMeetingInfoSchema,
);
export const OrgEditLinksCommandSchema = nullableCommandSchema(
  "OrgEditLinksCommand",
  z.array(OrgLinkSchema).max(20),
);

export const OrgEditV2PatchSchema = z
  .object({
    description: OrgEditDescriptionCommandSchema.optional(),
    aboutMd: OrgEditAboutMdCommandSchema.optional(),
    meetingInfo: OrgEditMeetingInfoCommandSchema.optional(),
    links: OrgEditLinksCommandSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "At least one patch field is required")
  .meta({ id: "OrgEditV2Patch" });

export const OrgEditV2RequestSchema = z
  .object({
    version: z.literal(2),
    expectedRevision: z.number().int().nonnegative(),
    patch: OrgEditV2PatchSchema,
  })
  .strict()
  .meta({ id: "OrgEditV2Request" });

export const OrgEditRequestSchema = z
  .union([OrgEditLegacyRequestSchema, OrgEditV2RequestSchema])
  .meta({ id: "OrgEditRequest" });
export type OrgEditRequest = z.infer<typeof OrgEditRequestSchema>;

export const OrgEditResultSchema = z
  .object({
    organizationId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    changed: z.boolean(),
  })
  .strict()
  .meta({ id: "OrgEditResult" });
export type OrgEditResult = z.infer<typeof OrgEditResultSchema>;

const UserEventTitleSchema = z.string().trim().min(1).max(200);
const UserEventDescriptionSchema = z.string().max(10_000);
const UserEventPlaceIdSchema = z.string().trim().min(1);
const UserEventLocationRawSchema = z.string().trim().min(1).max(500);
const UserEventTimestampSchema = z.iso.datetime({ offset: true });

function addUserEventLocationIssue(
  input: { locationRaw?: string; placeId?: string },
  context: z.RefinementCtx,
) {
  if ((input.placeId === undefined) === (input.locationRaw === undefined)) {
    context.addIssue({
      code: "custom",
      message: "Exactly one of placeId or locationRaw is required",
    });
  }
}

function addUserEventTimeIssue(
  input: { end?: string | null; start?: string },
  context: z.RefinementCtx,
) {
  if (
    input.start !== undefined &&
    input.end !== undefined &&
    input.end !== null &&
    new Date(input.end).getTime() <= new Date(input.start).getTime()
  ) {
    context.addIssue({
      code: "custom",
      message: "end must be after start",
    });
  }
}

export const UserEventCreateRequestSchema = z
  .object({
    clientRequestId: z.uuid(),
    organizationId: z.string().trim().min(1).nullable().optional(),
    title: UserEventTitleSchema,
    description: UserEventDescriptionSchema.nullable().optional(),
    start: UserEventTimestampSchema,
    end: UserEventTimestampSchema.nullable().optional(),
    category: CategorySchema,
    url: HttpsUrlSchema.nullable().optional(),
    placeId: UserEventPlaceIdSchema.optional(),
    locationRaw: UserEventLocationRawSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    addUserEventLocationIssue(input, context);
    addUserEventTimeIssue(input, context);
  })
  .meta({ id: "UserEventCreateRequest" });
export type UserEventCreateRequest = z.infer<typeof UserEventCreateRequestSchema>;

export const UserEventEditPatchSchema = z
  .object({
    title: UserEventTitleSchema.optional(),
    description: UserEventDescriptionSchema.nullable().optional(),
    start: UserEventTimestampSchema.optional(),
    end: UserEventTimestampSchema.nullable().optional(),
    category: CategorySchema.optional(),
    url: HttpsUrlSchema.nullable().optional(),
    placeId: UserEventPlaceIdSchema.optional(),
    locationRaw: UserEventLocationRawSchema.optional(),
  })
  .strict()
  .superRefine((patch, context) => {
    if (Object.keys(patch).length === 0) {
      context.addIssue({
        code: "custom",
        message: "At least one patch field is required",
      });
    }
    if (patch.placeId !== undefined && patch.locationRaw !== undefined) {
      context.addIssue({
        code: "custom",
        message: "placeId and locationRaw cannot both be provided",
      });
    }
    addUserEventTimeIssue(patch, context);
  })
  .meta({ id: "UserEventEditPatch" });
export type UserEventEditPatch = z.infer<typeof UserEventEditPatchSchema>;

const UserEventEditLegacyRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    patch: UserEventEditPatchSchema,
  })
  .strict();

export const UserEventEditDescriptionCommandSchema = nullableCommandSchema(
  "UserEventEditDescriptionCommand",
  UserEventDescriptionSchema,
);
export const UserEventEditEndCommandSchema = nullableCommandSchema(
  "UserEventEditEndCommand",
  UserEventTimestampSchema,
);
export const UserEventEditUrlCommandSchema = nullableCommandSchema(
  "UserEventEditUrlCommand",
  HttpsUrlSchema,
);

export const UserEventEditV2PatchSchema = z
  .object({
    title: UserEventTitleSchema.optional(),
    description: UserEventEditDescriptionCommandSchema.optional(),
    start: UserEventTimestampSchema.optional(),
    end: UserEventEditEndCommandSchema.optional(),
    category: CategorySchema.optional(),
    url: UserEventEditUrlCommandSchema.optional(),
    placeId: UserEventPlaceIdSchema.optional(),
    locationRaw: UserEventLocationRawSchema.optional(),
  })
  .strict()
  .superRefine((patch, context) => {
    if (Object.keys(patch).length === 0) {
      context.addIssue({
        code: "custom",
        message: "At least one patch field is required",
      });
    }
    if (patch.placeId !== undefined && patch.locationRaw !== undefined) {
      context.addIssue({
        code: "custom",
        message: "placeId and locationRaw cannot both be provided",
      });
    }
    addUserEventTimeIssue(
      {
        start: patch.start,
        end: patch.end?.action === "set" ? patch.end.value : undefined,
      },
      context,
    );
  })
  .meta({ id: "UserEventEditV2Patch" });

export const UserEventEditV2RequestSchema = z
  .object({
    version: z.literal(2),
    expectedRevision: z.number().int().nonnegative(),
    patch: UserEventEditV2PatchSchema,
  })
  .strict()
  .meta({ id: "UserEventEditV2Request" });

export const UserEventEditRequestSchema = z
  .union([UserEventEditLegacyRequestSchema, UserEventEditV2RequestSchema])
  .meta({ id: "UserEventEditRequest" });
export type UserEventEditRequest = z.infer<typeof UserEventEditRequestSchema>;

export const UserEventCreateResultSchema = z
  .object({
    eventId: z.uuid(),
    revision: z.number().int().nonnegative(),
    replayed: z.boolean(),
  })
  .strict()
  .meta({ id: "UserEventCreateResult" });
export type UserEventCreateResult = z.infer<typeof UserEventCreateResultSchema>;

export const UserEventMutationResultSchema = z
  .object({
    eventId: z.uuid(),
    revision: z.number().int().nonnegative(),
    changed: z.boolean(),
  })
  .strict()
  .meta({ id: "UserEventMutationResult" });
export type UserEventMutationResult = z.infer<typeof UserEventMutationResultSchema>;

export const UserEventManagementSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.string().min(1).nullable(),
    organizationName: z.string().min(1).nullable(),
    title: UserEventTitleSchema,
    description: UserEventDescriptionSchema.nullable(),
    start: UserEventTimestampSchema,
    end: UserEventTimestampSchema.nullable(),
    placeId: UserEventPlaceIdSchema,
    placeName: z.string().min(1),
    locationRaw: UserEventLocationRawSchema.nullable(),
    category: CategorySchema,
    url: HttpsUrlSchema.nullable(),
    status: z.enum(["draft", "published", "canceled"]),
    moderationState: z.enum(["active", "hidden"]),
    revision: z.number().int().nonnegative(),
    deletedAt: UserEventTimestampSchema.nullable(),
    createdAt: UserEventTimestampSchema,
    updatedAt: UserEventTimestampSchema,
  })
  .strict()
  .meta({ id: "UserEventManagement" });
export type UserEventManagement = z.infer<typeof UserEventManagementSchema>;

export const UserEventManagementCursorSchema = z
  .object({
    beforeUpdatedAt: UserEventTimestampSchema,
    beforeEventId: z.uuid(),
  })
  .strict()
  .meta({ id: "UserEventManagementCursor" });
export type UserEventManagementCursor = z.infer<typeof UserEventManagementCursorSchema>;

export const MyUserEventsQuerySchema = z
  .object({
    beforeUpdatedAt: UserEventTimestampSchema.optional(),
    beforeEventId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .superRefine((query, context) => {
    if ((query.beforeUpdatedAt === undefined) !== (query.beforeEventId === undefined)) {
      context.addIssue({
        code: "custom",
        message: "beforeUpdatedAt and beforeEventId must be provided together",
      });
    }
  })
  .meta({ id: "MyUserEventsQuery" });
export type MyUserEventsQuery = z.infer<typeof MyUserEventsQuerySchema>;

export const MyUserEventsSchema = z
  .object({
    events: z.array(UserEventManagementSchema).max(100),
    next: UserEventManagementCursorSchema.nullable(),
  })
  .strict()
  .meta({ id: "MyUserEvents" });
export type MyUserEvents = z.infer<typeof MyUserEventsSchema>;
