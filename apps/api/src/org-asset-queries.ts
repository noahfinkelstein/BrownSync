import type {
  OrgGalleryReorderResult,
  OrgMediaCollection,
  OrgMediaKind,
  OrgMediaMutationResult,
  OrgMediaUploadReservation,
  OrgMediaUploadResult,
  OrgSocialPost,
  OrgSocialPostCollection,
  OrgSocialPostDeleteResult,
} from "@brownsync/contract";
import type { Sql } from "./db";

export type OrgAssetQueryFailure =
  | "bad_request"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unavailable";

export type OrgAssetQueryResult<T> = { kind: "ok"; value: T } | { kind: OrgAssetQueryFailure };

export type MediaUploadClaim = {
  uploadId: string;
  organizationId: string;
  kind: OrgMediaKind;
  objectPath: string;
  altText: string;
  expiresAt: string;
};

export type MediaUploadFinalization = OrgMediaUploadResult & { replayed: boolean };

export type SocialPostClaim = {
  post: OrgSocialPost;
  organizationId: string;
  leaseToken: string | null;
  replayed: boolean;
  refreshRequired: boolean;
};

export type SocialPostRefreshClaim = {
  post: OrgSocialPost;
  organizationId: string;
  leaseToken: string | null;
  claimed: boolean;
};

export type SocialPostFinalization = {
  post: OrgSocialPost;
  organizationId: string;
  changed: boolean;
  replayed: boolean;
};

export type SocialEmbed = {
  postId: string;
  permalink: string;
  renderHtml: string;
  revision: number;
};

export interface OrgAssetQueries {
  getOrgMedia(organizationId: string): Promise<OrgAssetQueryResult<OrgMediaCollection>>;
  reserveMediaUpload(
    actorId: string,
    organizationId: string,
    input: {
      clientRequestId: string;
      uploadId: string;
      kind: OrgMediaKind;
      altText: string;
      expectedOrganizationRevision: number | null;
      expectedGalleryRevision: number | null;
      objectPath: string;
    },
  ): Promise<OrgAssetQueryResult<OrgMediaUploadReservation>>;
  beginMediaUpload(
    actorId: string,
    uploadId: string,
  ): Promise<OrgAssetQueryResult<MediaUploadClaim>>;
  finalizeMediaUpload(
    actorId: string,
    uploadId: string,
    input: {
      mediaId: string;
      publicUrl: string;
      width: number;
      height: number;
      byteSize: number;
    },
  ): Promise<OrgAssetQueryResult<MediaUploadFinalization>>;
  failMediaUpload(
    actorId: string,
    uploadId: string,
    failureCode: string,
    objectMayExist: boolean,
  ): Promise<
    OrgAssetQueryResult<{
      uploadId: string;
      status: string;
      changed: boolean;
      cleanupEnqueued: boolean;
    }>
  >;
  deleteMedia(
    actorId: string,
    organizationId: string,
    mediaId: string,
    expectedRevision: number,
  ): Promise<OrgAssetQueryResult<OrgMediaMutationResult>>;
  reorderGallery(
    actorId: string,
    organizationId: string,
    expectedGalleryRevision: number,
    mediaIds: string[],
  ): Promise<OrgAssetQueryResult<OrgGalleryReorderResult>>;
  listSocialPosts(organizationId: string): Promise<OrgAssetQueryResult<OrgSocialPostCollection>>;
  addSocialPost(
    actorId: string,
    organizationId: string,
    clientRequestId: string,
    postId: string,
    permalink: string,
  ): Promise<OrgAssetQueryResult<SocialPostClaim>>;
  beginSocialPostRefresh(
    actorId: string,
    organizationId: string,
    postId: string,
  ): Promise<OrgAssetQueryResult<SocialPostRefreshClaim>>;
  consumeOEmbedCapacity(
    postId: string,
    leaseToken: string,
  ): Promise<
    OrgAssetQueryResult<{ allowed: boolean; remaining: number; retryAfterSeconds: number }>
  >;
  finalizeSocialPost(
    actorId: string | null,
    postId: string,
    leaseToken: string,
    input: {
      outcome: "ready" | "link_only" | "deferred";
      renderHtml: string | null;
      attribution: string | null;
      errorCode: string | null;
    },
  ): Promise<OrgAssetQueryResult<SocialPostFinalization>>;
  deleteSocialPost(
    actorId: string,
    organizationId: string,
    postId: string,
    expectedRevision: number,
  ): Promise<OrgAssetQueryResult<OrgSocialPostDeleteResult>>;
  getSocialEmbed(postId: string): Promise<OrgAssetQueryResult<SocialEmbed>>;
}

type MediaRow = {
  organization_id: string;
  organization_revision: number | string;
  gallery_revision: number | string;
  media_id: string | null;
  kind: OrgMediaKind | null;
  public_url: string | null;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  alt_text: string | null;
  position: number | null;
  asset_revision: number | string | null;
};

type ReserveRow = {
  upload_id: string;
  kind: OrgMediaKind;
  expires_at: Date;
  replayed: boolean;
};

type BeginRow = {
  upload_id: string;
  organization_id: string;
  kind: OrgMediaKind;
  object_path: string;
  alt_text: string;
  expires_at: Date;
};

type FinalizeMediaRow = {
  media_id: string;
  kind: OrgMediaKind;
  public_url: string;
  width: number;
  height: number;
  byte_size: number;
  alt_text: string;
  position: number | null;
  asset_revision: number | string;
  organization_revision: number | string;
  gallery_revision: number | string;
  replayed: boolean;
};

type FailMediaRow = {
  upload_id: string;
  status: string;
  changed: boolean;
  cleanup_enqueued: boolean;
};

type DeleteMediaRow = {
  media_id: string;
  kind: OrgMediaKind;
  organization_revision: number | string;
  gallery_revision: number | string;
  changed: boolean;
};

type SocialRow = {
  organization_id: string;
  post_id: string;
  permalink: string;
  status: string;
  revision: number | string;
  cache_expires_at: Date | null;
  attribution: string | null;
  embed_available?: boolean;
  lease_token?: string | null;
  replayed?: boolean;
  refresh_required?: boolean;
  claimed?: boolean;
  changed?: boolean;
};

const badRequestSuffixes = new Set([
  "INPUT_INVALID",
  "KIND_INVALID",
  "ALT_TEXT_INVALID",
  "PATH_INVALID",
  "OUTPUT_INVALID",
  "GALLERY_INVALID",
  "PERMALINK_INVALID",
  "CACHE_INVALID",
  "FAILURE_INVALID",
  "CLAIM_INVALID",
]);
const notFoundSuffixes = new Set([
  "ORGANIZATION_NOT_FOUND",
  "UPLOAD_NOT_FOUND",
  "MEDIA_NOT_FOUND",
  "SOCIAL_POST_NOT_FOUND",
  "CLEANUP_NOT_FOUND",
]);
const conflictSuffixes = new Set([
  "REQUEST_CONFLICT",
  "UPLOAD_BUSY",
  "UPLOAD_CLAIMED",
  "UPLOAD_TERMINAL",
  "REVISION_CONFLICT",
  "GALLERY_LIMIT",
  "LEASE_CONFLICT",
  "FINALIZATION_CONFLICT",
]);

function queryFailure(error: unknown): OrgAssetQueryFailure {
  const message = error instanceof Error ? error.message : "";
  const match = /BROWNSYNC_ORG_ASSET_([A-Z_]+)/.exec(message);
  const suffix = match?.[1] ?? "";
  if (badRequestSuffixes.has(suffix)) return "bad_request";
  if (suffix === "UNAUTHORIZED" || suffix === "FORBIDDEN") return "forbidden";
  if (notFoundSuffixes.has(suffix)) return "not_found";
  if (conflictSuffixes.has(suffix)) return "conflict";
  if (suffix === "RATE_LIMITED") return "rate_limited";
  return "unavailable";
}

function assetFromRow(row: MediaRow | FinalizeMediaRow) {
  const mediaId = "media_id" in row ? row.media_id : null;
  if (
    mediaId === null ||
    row.kind === null ||
    row.public_url === null ||
    row.width === null ||
    row.height === null ||
    row.byte_size === null ||
    row.alt_text === null ||
    row.asset_revision === null
  ) {
    throw new Error("invalid media projection");
  }
  return {
    id: mediaId,
    kind: row.kind,
    url: row.public_url,
    width: row.width,
    height: row.height,
    byteSize: row.byte_size,
    altText: row.alt_text,
    position: row.position,
    revision: Number(row.asset_revision),
  };
}

function postFromRow(
  row: SocialRow,
  embedOrigin: string | null,
  embedAvailable = row.embed_available === true,
): OrgSocialPost {
  const canEmbed = row.status === "ready" && embedAvailable && embedOrigin !== null;
  return {
    id: row.post_id,
    permalink: row.permalink,
    renderMode: canEmbed ? "embed" : "link",
    embedUrl: canEmbed ? `${embedOrigin}/api/social-posts/${row.post_id}/embed` : null,
    attribution: row.attribution,
    revision: Number(row.revision),
  };
}

export function createOrgAssetQueries(
  sql: Sql,
  options: { embedOrigin?: string | null } = {},
): OrgAssetQueries {
  const embedOrigin = options.embedOrigin ?? null;
  return {
    async getOrgMedia(organizationId) {
      try {
        const rows = (await sql`
          select * from public.brownsync_get_org_media(${organizationId}::text)
        `) as unknown as MediaRow[];
        const first = rows[0];
        if (first === undefined) return { kind: "unavailable" };
        const assets = rows.filter((row) => row.media_id !== null).map(assetFromRow);
        return {
          kind: "ok",
          value: {
            organizationId: first.organization_id,
            organizationRevision: Number(first.organization_revision),
            galleryRevision: Number(first.gallery_revision),
            avatar: assets.find((asset) => asset.kind === "avatar") ?? null,
            banner: assets.find((asset) => asset.kind === "banner") ?? null,
            gallery: assets
              .filter((asset) => asset.kind === "gallery")
              .sort((left, right) => (left.position ?? 0) - (right.position ?? 0)),
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async reserveMediaUpload(actorId, organizationId, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_reserve_org_media_upload(
            ${actorId}::uuid,
            ${organizationId}::text,
            ${input.clientRequestId}::uuid,
            ${input.uploadId}::uuid,
            ${input.kind}::text,
            ${input.altText}::text,
            ${input.expectedOrganizationRevision}::bigint,
            ${input.expectedGalleryRevision}::bigint,
            ${input.objectPath}::text
          )
        `) as unknown as ReserveRow[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return {
          kind: "ok",
          value: {
            uploadId: row.upload_id,
            kind: row.kind,
            expiresAt: row.expires_at.toISOString(),
            replayed: row.replayed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async beginMediaUpload(actorId, uploadId) {
      try {
        const rows = (await sql`
          select * from public.brownsync_begin_org_media_upload(
            ${actorId}::uuid,
            ${uploadId}::uuid
          )
        `) as unknown as BeginRow[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return {
          kind: "ok",
          value: {
            uploadId: row.upload_id,
            organizationId: row.organization_id,
            kind: row.kind,
            objectPath: row.object_path,
            altText: row.alt_text,
            expiresAt: row.expires_at.toISOString(),
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async finalizeMediaUpload(actorId, uploadId, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_finalize_org_media_upload(
            ${actorId}::uuid,
            ${uploadId}::uuid,
            ${input.mediaId}::uuid,
            ${input.publicUrl}::text,
            ${input.width}::integer,
            ${input.height}::integer,
            ${input.byteSize}::integer
          )
        `) as unknown as FinalizeMediaRow[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        const isGallery = row.kind === "gallery";
        return {
          kind: "ok",
          value: {
            asset: assetFromRow(row),
            organizationRevision: isGallery ? null : Number(row.organization_revision),
            galleryRevision: isGallery ? Number(row.gallery_revision) : null,
            replayed: row.replayed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async failMediaUpload(actorId, uploadId, failureCode, objectMayExist) {
      try {
        const rows = (await sql`
          select * from public.brownsync_fail_org_media_upload(
            ${actorId}::uuid,
            ${uploadId}::uuid,
            ${failureCode}::text,
            ${objectMayExist}::boolean
          )
        `) as unknown as FailMediaRow[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return {
          kind: "ok",
          value: {
            uploadId: row.upload_id,
            status: row.status,
            changed: row.changed,
            cleanupEnqueued: row.cleanup_enqueued,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async deleteMedia(actorId, organizationId, mediaId, expectedRevision) {
      try {
        const rows = (await sql`
          select * from public.brownsync_delete_org_media(
            ${actorId}::uuid,
            ${organizationId}::text,
            ${mediaId}::uuid,
            ${expectedRevision}::bigint
          )
        `) as unknown as DeleteMediaRow[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        const isGallery = row.kind === "gallery";
        return {
          kind: "ok",
          value: {
            mediaId: row.media_id,
            kind: row.kind,
            organizationRevision: isGallery ? null : Number(row.organization_revision),
            galleryRevision: isGallery ? Number(row.gallery_revision) : null,
            changed: row.changed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async reorderGallery(actorId, organizationId, expectedGalleryRevision, mediaIds) {
      try {
        const rows = (await sql`
          select * from public.brownsync_reorder_org_gallery(
            ${actorId}::uuid,
            ${organizationId}::text,
            ${expectedGalleryRevision}::bigint,
            ${mediaIds}::uuid[]
          )
        `) as unknown as { gallery_revision: number | string; changed: boolean }[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return {
          kind: "ok",
          value: { galleryRevision: Number(row.gallery_revision), changed: row.changed },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async listSocialPosts(organizationId) {
      try {
        const rows = (await sql`
          select * from public.brownsync_list_org_social_posts(${organizationId}::text)
        `) as unknown as SocialRow[];
        return {
          kind: "ok",
          value: {
            organizationId,
            posts: rows.map((row) => postFromRow(row, embedOrigin)),
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async addSocialPost(actorId, organizationId, clientRequestId, postId, permalink) {
      try {
        const rows = (await sql`
          select * from public.brownsync_add_org_social_post(
            ${actorId}::uuid,
            ${organizationId}::text,
            ${clientRequestId}::uuid,
            ${postId}::uuid,
            ${permalink}::text
          )
        `) as unknown as SocialRow[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return {
          kind: "ok",
          value: {
            post: postFromRow(row, embedOrigin, false),
            organizationId: row.organization_id,
            leaseToken: row.lease_token ?? null,
            replayed: row.replayed ?? false,
            refreshRequired: row.refresh_required ?? false,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async beginSocialPostRefresh(actorId, organizationId, postId) {
      try {
        const rows = (await sql`
          select * from public.brownsync_begin_org_social_post_refresh(
            ${actorId}::uuid,
            ${organizationId}::text,
            ${postId}::uuid
          )
        `) as unknown as SocialRow[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return {
          kind: "ok",
          value: {
            post: postFromRow(row, embedOrigin, false),
            organizationId: row.organization_id,
            leaseToken: row.lease_token ?? null,
            claimed: row.claimed ?? false,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async consumeOEmbedCapacity(postId, leaseToken) {
      try {
        const rows = (await sql`
          select * from public.brownsync_consume_oembed_capacity(
            ${postId}::uuid,
            ${leaseToken}::uuid
          )
        `) as unknown as {
          allowed: boolean;
          remaining: number;
          retry_after_seconds: number;
        }[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return {
          kind: "ok",
          value: {
            allowed: row.allowed,
            remaining: row.remaining,
            retryAfterSeconds: row.retry_after_seconds,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async finalizeSocialPost(actorId, postId, leaseToken, input) {
      try {
        const rows = (await sql`
          select * from public.brownsync_finalize_org_social_post(
            ${actorId}::uuid,
            ${postId}::uuid,
            ${leaseToken}::uuid,
            ${input.outcome}::text,
            ${input.renderHtml}::text,
            ${input.attribution}::text,
            ${input.errorCode}::text
          )
        `) as unknown as SocialRow[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return {
          kind: "ok",
          value: {
            post: postFromRow(row, embedOrigin, false),
            organizationId: row.organization_id,
            changed: row.changed ?? false,
            replayed: row.replayed ?? false,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async deleteSocialPost(actorId, organizationId, postId, expectedRevision) {
      try {
        const rows = (await sql`
          select * from public.brownsync_delete_org_social_post(
            ${actorId}::uuid,
            ${organizationId}::text,
            ${postId}::uuid,
            ${expectedRevision}::bigint
          )
        `) as unknown as {
          post_id: string;
          revision: number | string;
          changed: boolean;
        }[];
        const row = rows[0];
        if (row === undefined) return { kind: "unavailable" };
        return {
          kind: "ok",
          value: {
            postId: row.post_id,
            revision: Number(row.revision),
            changed: row.changed,
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },

    async getSocialEmbed(postId) {
      try {
        const rows = (await sql`
          select * from public.brownsync_get_org_social_embed(${postId}::uuid)
        `) as unknown as {
          post_id: string;
          permalink: string;
          render_html: string;
          revision: number | string;
        }[];
        const row = rows[0];
        if (row === undefined) return { kind: "not_found" };
        return {
          kind: "ok",
          value: {
            postId: row.post_id,
            permalink: row.permalink,
            renderHtml: row.render_html,
            revision: Number(row.revision),
          },
        };
      } catch (error) {
        return { kind: queryFailure(error) };
      }
    },
  };
}
