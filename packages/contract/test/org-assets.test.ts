import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import type { NullableOrgMediaAsset, OrgMediaAsset } from "../src/index";
import * as Contract from "../src/index";

type RuntimeSchema = {
  parse(input: unknown): unknown;
  safeParse(input: unknown): { success: boolean };
};

function schema(name: string): RuntimeSchema {
  const candidate = (Contract as unknown as Record<string, unknown>)[name];
  expect(candidate, `missing contract export ${name}`).toBeDefined();
  return candidate as RuntimeSchema;
}

const mediaId = "71000000-0000-4000-8000-000000000001";
const secondMediaId = "71000000-0000-4000-8000-000000000002";
const clientRequestId = "71000000-0000-4000-8000-000000000003";
const postId = "71000000-0000-4000-8000-000000000004";

const asset = {
  id: mediaId,
  kind: "gallery",
  url: "https://example.supabase.co/storage/v1/object/public/org-media/org/club/gallery/a.webp",
  width: 1920,
  height: 1080,
  byteSize: 2_097_152,
  altText: "Students presenting their robotics project",
  position: 0,
  revision: 2,
};

describe("organization media contracts", () => {
  it("exports every named media and social schema", () => {
    for (const name of [
      "OrgMediaKindSchema",
      "OrgMediaAssetSchema",
      "NullableOrgMediaAssetSchema",
      "OrgMediaCollectionSchema",
      "OrgMediaUploadReservationRequestSchema",
      "OrgMediaUploadReservationSchema",
      "OrgMediaUploadResultSchema",
      "OrgMediaMutationRequestSchema",
      "OrgMediaMutationResultSchema",
      "OrgGalleryReorderRequestSchema",
      "OrgGalleryReorderResultSchema",
      "OrgSocialRenderModeSchema",
      "OrgSocialPostSchema",
      "OrgSocialPostCollectionSchema",
      "OrgSocialPostCreateRequestSchema",
      "OrgSocialPostCreateResultSchema",
      "OrgSocialPostRefreshResultSchema",
      "OrgSocialPostDeleteRequestSchema",
      "OrgSocialPostDeleteResultSchema",
    ]) {
      expect((Contract as unknown as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it("keeps public media output strict, bounded, and free of internal fields", () => {
    const mediaAsset = schema("OrgMediaAssetSchema");
    const collection = schema("OrgMediaCollectionSchema");

    expect(mediaAsset.parse(asset)).toEqual(asset);
    expect(mediaAsset.safeParse({ ...asset, kind: "avatar", position: 0 }).success).toBe(false);
    expect(mediaAsset.safeParse({ ...asset, kind: "gallery", position: null }).success).toBe(false);
    expect(mediaAsset.safeParse({ ...asset, position: 12 }).success).toBe(false);
    expect(mediaAsset.safeParse({ ...asset, byteSize: 2_097_153 }).success).toBe(false);
    expect(mediaAsset.safeParse({ ...asset, objectPath: "private/path.webp" }).success).toBe(false);
    expect(
      collection.parse({
        organizationId: "robotics-club",
        organizationRevision: 7,
        galleryRevision: 3,
        avatar: null,
        banner: null,
        gallery: [asset],
      }),
    ).toMatchObject({ organizationId: "robotics-club", gallery: [asset] });
    expect(
      collection.safeParse({
        organizationId: "robotics-club",
        organizationRevision: 7,
        galleryRevision: 3,
        avatar: null,
        banner: null,
        gallery: Array.from({ length: 13 }, (_, position) => ({
          ...asset,
          id: `71000000-0000-4000-8000-${String(position + 1).padStart(12, "0")}`,
          position,
        })),
      }).success,
    ).toBe(false);
  });

  it("requires avatar and banner keys while accepting object or null values", () => {
    const collection = schema("OrgMediaCollectionSchema");
    const base = {
      organizationId: "robotics-club",
      organizationRevision: 7,
      galleryRevision: 3,
      gallery: [],
    };
    const avatar = { ...asset, kind: "avatar", position: null };
    const banner = { ...asset, kind: "banner", position: null };

    expect(collection.parse({ ...base, avatar, banner: null })).toMatchObject({
      avatar,
      banner: null,
    });
    expect(collection.parse({ ...base, avatar: null, banner })).toMatchObject({
      avatar: null,
      banner,
    });
    expect(collection.safeParse({ ...base, banner: null }).success).toBe(false);
    expect(collection.safeParse({ ...base, avatar: null }).success).toBe(false);
    expect(collection.safeParse({ ...base, avatar: banner, banner: null }).success).toBe(false);
    expect(collection.safeParse({ ...base, avatar: null, banner: avatar }).success).toBe(false);
  });

  it("keeps nonnullable and nullable media assets as distinct named components", () => {
    const registered = z.toJSONSchema(z.globalRegistry) as unknown as {
      schemas: Record<string, Record<string, unknown>>;
    };
    const media = registered.schemas.OrgMediaAsset;
    const nullable = registered.schemas.NullableOrgMediaAsset;
    const collection = registered.schemas.OrgMediaCollection;
    const collectionProperties = collection?.properties as
      | Record<string, Record<string, unknown>>
      | undefined;
    const nullableProperties = nullable?.properties as
      | Record<string, Record<string, unknown>>
      | undefined;
    const nullableMediaAsset = schema("NullableOrgMediaAssetSchema");

    expect(media?.type).toBe("object");
    expect(nullable?.type).toEqual(["object", "null"]);
    expect(nullable?.properties).toEqual({
      ...(media?.properties as Record<string, unknown>),
      kind: { $ref: "#/components/schemas/OrgMediaKind" },
      position: {
        type: ["integer", "null"],
        minimum: 0,
        maximum: 11,
      },
    });
    expect(nullableProperties?.kind?.$ref).toBe("#/components/schemas/OrgMediaKind");
    expect(nullableProperties?.position).toEqual({
      type: ["integer", "null"],
      minimum: 0,
      maximum: 11,
    });
    expect(nullable?.required).toEqual(media?.required);
    expect(nullable?.additionalProperties).toBe(false);
    expect(nullableMediaAsset.parse(null)).toBeNull();
    expect(nullableMediaAsset.parse(asset)).toEqual(asset);
    expectTypeOf<NullableOrgMediaAsset>().toEqualTypeOf<OrgMediaAsset | null>();
    expect(collectionProperties?.avatar).toEqual({ $ref: "NullableOrgMediaAsset" });
    expect(collectionProperties?.banner).toEqual({ $ref: "NullableOrgMediaAsset" });
    expect(collection?.required).toEqual(expect.arrayContaining(["avatar", "banner"]));
  });

  it("accepts omitted or explicit-null inactive reservation revisions", () => {
    const reservation = schema("OrgMediaUploadReservationRequestSchema");
    const avatar = {
      clientRequestId,
      kind: "avatar",
      altText: "  Club logo  ",
      expectedOrganizationRevision: 4,
      expectedGalleryRevision: null,
    };
    const gallery = {
      ...avatar,
      kind: "gallery",
      expectedOrganizationRevision: null,
      expectedGalleryRevision: 9,
    };
    const avatarWithOmittedInactive = {
      clientRequestId,
      kind: "avatar",
      altText: "  Club logo  ",
      expectedOrganizationRevision: 4,
    };
    const galleryWithOmittedInactive = {
      clientRequestId,
      kind: "gallery",
      altText: "  Club logo  ",
      expectedGalleryRevision: 9,
    };

    expect(reservation.parse(avatar)).toEqual({ ...avatar, altText: "Club logo" });
    expect(reservation.parse(gallery)).toEqual({ ...gallery, altText: "Club logo" });
    expect(reservation.parse(avatarWithOmittedInactive)).toEqual({
      ...avatarWithOmittedInactive,
      altText: "Club logo",
    });
    expect(reservation.parse(galleryWithOmittedInactive)).toEqual({
      ...galleryWithOmittedInactive,
      altText: "Club logo",
    });
  });

  it("requires the active revision and rejects a value for the inactive kind", () => {
    const reservation = schema("OrgMediaUploadReservationRequestSchema");
    const avatar = {
      clientRequestId,
      kind: "avatar",
      altText: "Club logo",
      expectedOrganizationRevision: 4,
      expectedGalleryRevision: null,
    };
    const gallery = {
      ...avatar,
      kind: "gallery",
      expectedOrganizationRevision: null,
      expectedGalleryRevision: 9,
    };

    expect(
      reservation.safeParse({
        clientRequestId,
        kind: "avatar",
        altText: "Club logo",
        expectedGalleryRevision: null,
      }).success,
    ).toBe(false);
    expect(reservation.safeParse({ ...avatar, expectedOrganizationRevision: null }).success).toBe(
      false,
    );
    expect(reservation.safeParse({ ...avatar, expectedGalleryRevision: 0 }).success).toBe(false);
    expect(
      reservation.safeParse({
        clientRequestId,
        kind: "gallery",
        altText: "Club photo",
        expectedOrganizationRevision: null,
      }).success,
    ).toBe(false);
    expect(reservation.safeParse({ ...gallery, expectedGalleryRevision: null }).success).toBe(
      false,
    );
    expect(reservation.safeParse({ ...gallery, expectedOrganizationRevision: 0 }).success).toBe(
      false,
    );
    expect(reservation.safeParse({ ...avatar, actorId: clientRequestId }).success).toBe(false);
  });

  it("requires a unique complete gallery order and strict optimistic mutations", () => {
    const reorder = schema("OrgGalleryReorderRequestSchema");
    const mutation = schema("OrgMediaMutationRequestSchema");
    const valid = { expectedGalleryRevision: 3, mediaIds: [mediaId, secondMediaId] };

    expect(reorder.parse(valid)).toEqual(valid);
    expect(reorder.safeParse({ ...valid, mediaIds: [mediaId, mediaId] }).success).toBe(false);
    expect(
      reorder.safeParse({
        ...valid,
        mediaIds: Array.from(
          { length: 13 },
          (_, index) => `71000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        ),
      }).success,
    ).toBe(false);
    expect(mutation.parse({ expectedRevision: 0 })).toEqual({ expectedRevision: 0 });
    expect(mutation.safeParse({ expectedRevision: -1 }).success).toBe(false);
    expect(mutation.safeParse({ expectedRevision: 1, changed: true }).success).toBe(false);
  });

  it("pairs returned revisions with avatar/banner versus gallery mutations", () => {
    const upload = schema("OrgMediaUploadResultSchema");
    const mutation = schema("OrgMediaMutationResultSchema");
    const avatarAsset = { ...asset, kind: "avatar", position: null };

    expect(
      upload.parse({
        asset: avatarAsset,
        organizationRevision: 5,
        galleryRevision: null,
      }),
    ).toMatchObject({ organizationRevision: 5, galleryRevision: null });
    expect(
      upload.safeParse({
        asset: avatarAsset,
        organizationRevision: null,
        galleryRevision: 5,
      }).success,
    ).toBe(false);
    expect(
      upload.safeParse({
        asset,
        organizationRevision: 5,
        galleryRevision: null,
      }).success,
    ).toBe(false);
    expect(
      mutation.parse({
        mediaId,
        kind: "gallery",
        organizationRevision: null,
        galleryRevision: 6,
        changed: true,
      }),
    ).toMatchObject({ organizationRevision: null, galleryRevision: 6 });
    expect(
      mutation.safeParse({
        mediaId,
        kind: "gallery",
        organizationRevision: 6,
        galleryRevision: null,
        changed: true,
      }).success,
    ).toBe(false);
  });
});

describe("organization Instagram-card contracts", () => {
  const linkPost = {
    id: postId,
    permalink: "https://www.instagram.com/p/Abc_123-/",
    renderMode: "link",
    embedUrl: null,
    attribution: null,
    revision: 1,
  };

  it("allows link cards and requires a URL only for embed mode", () => {
    const post = schema("OrgSocialPostSchema");

    expect(post.parse(linkPost)).toEqual(linkPost);
    expect(
      post.safeParse({ ...linkPost, permalink: "https://example.com/p/Abc_123-/" }).success,
    ).toBe(false);
    expect(
      post.parse({
        ...linkPost,
        renderMode: "embed",
        embedUrl: `https://embed.example/api/social-posts/${postId}/embed`,
        attribution: "Brown Robotics",
      }),
    ).toMatchObject({ renderMode: "embed" });
    expect(post.safeParse({ ...linkPost, embedUrl: "https://embed.example/post" }).success).toBe(
      false,
    );
    expect(post.safeParse({ ...linkPost, renderMode: "embed", embedUrl: null }).success).toBe(
      false,
    );
    for (const forbidden of ["renderHtml", "leaseToken", "providerError", "actorId", "status"]) {
      expect(post.safeParse({ ...linkPost, [forbidden]: "private" }).success, forbidden).toBe(
        false,
      );
    }
  });

  it("keeps create input permissive for canonicalization but strict about identity fields", () => {
    const create = schema("OrgSocialPostCreateRequestSchema");
    const valid = {
      clientRequestId,
      permalink: "https://instagram.com/reel/Abc_123/?utm_source=share",
    };

    expect(create.parse(valid)).toEqual(valid);
    expect(create.safeParse({ ...valid, permalink: "" }).success).toBe(false);
    expect(create.safeParse({ ...valid, permalink: "x".repeat(2049) }).success).toBe(false);
    expect(create.safeParse({ ...valid, organizationId: "forged" }).success).toBe(false);
  });

  it("bounds public collections and keeps mutation results named and strict", () => {
    const collection = schema("OrgSocialPostCollectionSchema");
    const createResult = schema("OrgSocialPostCreateResultSchema");
    const refreshResult = schema("OrgSocialPostRefreshResultSchema");
    const deleteRequest = schema("OrgSocialPostDeleteRequestSchema");
    const deleteResult = schema("OrgSocialPostDeleteResultSchema");

    expect(collection.parse({ organizationId: "robotics-club", posts: [linkPost] })).toEqual({
      organizationId: "robotics-club",
      posts: [linkPost],
    });
    expect(
      collection.safeParse({
        organizationId: "robotics-club",
        posts: Array.from({ length: 13 }, () => linkPost),
      }).success,
    ).toBe(false);
    expect(createResult.parse({ post: linkPost, replayed: false })).toEqual({
      post: linkPost,
      replayed: false,
    });
    expect(refreshResult.parse({ post: linkPost, changed: true })).toEqual({
      post: linkPost,
      changed: true,
    });
    expect(deleteRequest.parse({ expectedRevision: 1 })).toEqual({ expectedRevision: 1 });
    expect(deleteResult.parse({ postId, revision: 2, changed: true })).toEqual({
      postId,
      revision: 2,
      changed: true,
    });
    expect(
      deleteResult.safeParse({ postId, revision: 2, changed: true, html: "<p>x</p>" }).success,
    ).toBe(false);
  });
});
