import { z } from "zod";

const HttpsUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine((value) => value.startsWith("https://"), "HTTPS URL required");
const CanonicalInstagramPermalinkSchema = HttpsUrlSchema.regex(
  /^https:\/\/www[.]instagram[.]com\/(p|reel)\/[A-Za-z0-9_-]{1,64}\/$/,
  "Canonical Instagram post or Reel permalink required",
);
const NonnegativeRevisionSchema = z.number().int().nonnegative();

export const OrgMediaKindSchema = z
  .enum(["avatar", "banner", "gallery"])
  .meta({ id: "OrgMediaKind" });
export type OrgMediaKind = z.infer<typeof OrgMediaKindSchema>;

const OrgMediaAssetShape = {
  id: z.uuid(),
  kind: OrgMediaKindSchema,
  url: HttpsUrlSchema,
  width: z.number().int().min(1).max(12_000),
  height: z.number().int().min(1).max(12_000),
  byteSize: z.number().int().min(1).max(2_097_152),
  altText: z.string().trim().min(1).max(500),
  position: z.number().int().min(0).max(11).nullable(),
  revision: NonnegativeRevisionSchema,
};

const createOrgMediaAssetSchema = () =>
  z
    .object(OrgMediaAssetShape)
    .strict()
    .superRefine((value, context) => {
      if ((value.kind === "gallery") !== (value.position !== null)) {
        context.addIssue({
          code: "custom",
          path: ["position"],
          message: "position is required only for gallery media",
        });
      }
    });

export const OrgMediaAssetSchema = createOrgMediaAssetSchema().meta({
  id: "OrgMediaAsset",
});
export type OrgMediaAsset = z.infer<typeof OrgMediaAssetSchema>;

const OrgMediaAssetJsonSchema = (
  z.toJSONSchema(z.globalRegistry) as unknown as {
    schemas: Record<string, Record<string, unknown>>;
  }
).schemas.OrgMediaAsset;
if (OrgMediaAssetJsonSchema === undefined) {
  throw new Error("OrgMediaAsset JSON Schema registration failed");
}
const OrgMediaAssetJsonSchemaProperties = OrgMediaAssetJsonSchema.properties as
  | Record<string, Record<string, unknown>>
  | undefined;
if (OrgMediaAssetJsonSchemaProperties === undefined) {
  throw new Error("OrgMediaAsset JSON Schema properties registration failed");
}
export const NullableOrgMediaAssetSchema = createOrgMediaAssetSchema()
  .nullable()
  .meta({
    ...OrgMediaAssetJsonSchema,
    properties: {
      ...OrgMediaAssetJsonSchemaProperties,
      kind: {
        ...OrgMediaAssetJsonSchemaProperties.kind,
        $ref: "#/components/schemas/OrgMediaKind",
      },
      position: {
        type: ["integer", "null"],
        minimum: 0,
        maximum: 11,
      },
    },
    $schema: undefined,
    anyOf: undefined,
    id: "NullableOrgMediaAsset",
    type: ["object", "null"],
  });
export type NullableOrgMediaAsset = z.infer<typeof NullableOrgMediaAssetSchema>;

export const OrgMediaCollectionSchema = z
  .object({
    organizationId: z.string().min(1),
    organizationRevision: NonnegativeRevisionSchema,
    galleryRevision: NonnegativeRevisionSchema,
    avatar: NullableOrgMediaAssetSchema,
    banner: NullableOrgMediaAssetSchema,
    gallery: z.array(OrgMediaAssetSchema).max(12),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.avatar !== null && value.avatar.kind !== "avatar") {
      context.addIssue({
        code: "custom",
        path: ["avatar", "kind"],
        message: "avatar kind required",
      });
    }
    if (value.banner !== null && value.banner.kind !== "banner") {
      context.addIssue({
        code: "custom",
        path: ["banner", "kind"],
        message: "banner kind required",
      });
    }
    for (let index = 0; index < value.gallery.length; index += 1) {
      const asset = value.gallery[index];
      if (asset?.kind !== "gallery" || asset.position !== index) {
        context.addIssue({
          code: "custom",
          path: ["gallery", index],
          message: "gallery must contain ordered gallery assets",
        });
      }
    }
  })
  .meta({ id: "OrgMediaCollection" });
export type OrgMediaCollection = z.infer<typeof OrgMediaCollectionSchema>;

export const OrgMediaUploadReservationRequestSchema = z
  .object({
    clientRequestId: z.uuid(),
    kind: OrgMediaKindSchema,
    altText: z.string().trim().min(1).max(500),
    expectedOrganizationRevision: NonnegativeRevisionSchema.nullable().optional(),
    expectedGalleryRevision: NonnegativeRevisionSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const isGallery = value.kind === "gallery";
    if (
      isGallery !==
      (value.expectedOrganizationRevision === null ||
        value.expectedOrganizationRevision === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedOrganizationRevision"],
        message: isGallery
          ? "gallery reservations must not carry an organization revision"
          : "avatar and banner reservations require an organization revision",
      });
    }
    if (
      isGallery !==
      (value.expectedGalleryRevision !== null && value.expectedGalleryRevision !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedGalleryRevision"],
        message: isGallery
          ? "gallery reservations require a gallery revision"
          : "avatar and banner reservations must not carry a gallery revision",
      });
    }
  })
  .meta({ id: "OrgMediaUploadReservationRequest" });
export type OrgMediaUploadReservationRequest = z.infer<
  typeof OrgMediaUploadReservationRequestSchema
>;

export const OrgMediaUploadReservationSchema = z
  .object({
    uploadId: z.uuid(),
    kind: OrgMediaKindSchema,
    expiresAt: z.iso.datetime({ offset: true }),
    replayed: z.boolean(),
  })
  .strict()
  .meta({ id: "OrgMediaUploadReservation" });
export type OrgMediaUploadReservation = z.infer<typeof OrgMediaUploadReservationSchema>;

export const OrgMediaUploadResultSchema = z
  .object({
    asset: OrgMediaAssetSchema,
    organizationRevision: NonnegativeRevisionSchema.nullable(),
    galleryRevision: NonnegativeRevisionSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const isGallery = value.asset.kind === "gallery";
    if (
      isGallery !== (value.organizationRevision === null) ||
      isGallery !== (value.galleryRevision !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "result revision must match the media kind",
      });
    }
  })
  .meta({ id: "OrgMediaUploadResult" });
export type OrgMediaUploadResult = z.infer<typeof OrgMediaUploadResultSchema>;

export const OrgMediaMutationRequestSchema = z
  .object({ expectedRevision: NonnegativeRevisionSchema })
  .strict()
  .meta({ id: "OrgMediaMutationRequest" });
export type OrgMediaMutationRequest = z.infer<typeof OrgMediaMutationRequestSchema>;

export const OrgMediaMutationResultSchema = z
  .object({
    mediaId: z.uuid(),
    kind: OrgMediaKindSchema,
    organizationRevision: NonnegativeRevisionSchema.nullable(),
    galleryRevision: NonnegativeRevisionSchema.nullable(),
    changed: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    const isGallery = value.kind === "gallery";
    if (
      isGallery !== (value.organizationRevision === null) ||
      isGallery !== (value.galleryRevision !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "result revision must match the media kind",
      });
    }
  })
  .meta({ id: "OrgMediaMutationResult" });
export type OrgMediaMutationResult = z.infer<typeof OrgMediaMutationResultSchema>;

export const OrgGalleryReorderRequestSchema = z
  .object({
    expectedGalleryRevision: NonnegativeRevisionSchema,
    mediaIds: z.array(z.uuid()).max(12),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.mediaIds).size !== value.mediaIds.length) {
      context.addIssue({
        code: "custom",
        path: ["mediaIds"],
        message: "mediaIds must be unique",
      });
    }
  })
  .meta({ id: "OrgGalleryReorderRequest" });
export type OrgGalleryReorderRequest = z.infer<typeof OrgGalleryReorderRequestSchema>;

export const OrgGalleryReorderResultSchema = z
  .object({
    galleryRevision: NonnegativeRevisionSchema,
    changed: z.boolean(),
  })
  .strict()
  .meta({ id: "OrgGalleryReorderResult" });
export type OrgGalleryReorderResult = z.infer<typeof OrgGalleryReorderResultSchema>;

export const OrgSocialRenderModeSchema = z
  .enum(["link", "embed"])
  .meta({ id: "OrgSocialRenderMode" });
export type OrgSocialRenderMode = z.infer<typeof OrgSocialRenderModeSchema>;

export const OrgSocialPostSchema = z
  .object({
    id: z.uuid(),
    permalink: CanonicalInstagramPermalinkSchema,
    renderMode: OrgSocialRenderModeSchema,
    embedUrl: HttpsUrlSchema.nullable(),
    attribution: z.string().trim().min(1).max(200).nullable(),
    revision: NonnegativeRevisionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.renderMode === "embed") !== (value.embedUrl !== null)) {
      context.addIssue({
        code: "custom",
        path: ["embedUrl"],
        message: "embedUrl is required only for embed render mode",
      });
    }
  })
  .meta({ id: "OrgSocialPost" });
export type OrgSocialPost = z.infer<typeof OrgSocialPostSchema>;

export const OrgSocialPostCollectionSchema = z
  .object({
    organizationId: z.string().min(1),
    posts: z.array(OrgSocialPostSchema).max(12),
  })
  .strict()
  .meta({ id: "OrgSocialPostCollection" });
export type OrgSocialPostCollection = z.infer<typeof OrgSocialPostCollectionSchema>;

export const OrgSocialPostCreateRequestSchema = z
  .object({
    clientRequestId: z.uuid(),
    permalink: z.string().min(1).max(2048),
  })
  .strict()
  .meta({ id: "OrgSocialPostCreateRequest" });
export type OrgSocialPostCreateRequest = z.infer<typeof OrgSocialPostCreateRequestSchema>;

export const OrgSocialPostCreateResultSchema = z
  .object({
    post: OrgSocialPostSchema,
    replayed: z.boolean(),
  })
  .strict()
  .meta({ id: "OrgSocialPostCreateResult" });
export type OrgSocialPostCreateResult = z.infer<typeof OrgSocialPostCreateResultSchema>;

export const OrgSocialPostRefreshResultSchema = z
  .object({
    post: OrgSocialPostSchema,
    changed: z.boolean(),
  })
  .strict()
  .meta({ id: "OrgSocialPostRefreshResult" });
export type OrgSocialPostRefreshResult = z.infer<typeof OrgSocialPostRefreshResultSchema>;

export const OrgSocialPostDeleteRequestSchema = z
  .object({ expectedRevision: NonnegativeRevisionSchema })
  .strict()
  .meta({ id: "OrgSocialPostDeleteRequest" });
export type OrgSocialPostDeleteRequest = z.infer<typeof OrgSocialPostDeleteRequestSchema>;

export const OrgSocialPostDeleteResultSchema = z
  .object({
    postId: z.uuid(),
    revision: NonnegativeRevisionSchema,
    changed: z.boolean(),
  })
  .strict()
  .meta({ id: "OrgSocialPostDeleteResult" });
export type OrgSocialPostDeleteResult = z.infer<typeof OrgSocialPostDeleteResultSchema>;
