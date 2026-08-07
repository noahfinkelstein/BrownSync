import { describe, expect, it, vi } from "vitest";
import type { Sql } from "../src/db";
import { createOrgAssetQueries } from "../src/org-asset-queries";

const actorId = "73000000-0000-4000-8000-000000000001";
const uploadId = "73000000-0000-4000-8000-000000000002";
const mediaId = "73000000-0000-4000-8000-000000000003";
const postId = "73000000-0000-4000-8000-000000000004";
const requestId = "73000000-0000-4000-8000-000000000005";
const leaseToken = "73000000-0000-4000-8000-000000000006";
const organizationId = "robotics-club";

function queryText(call: unknown[] | undefined): string {
  const strings = call?.[0] as TemplateStringsArray | undefined;
  return strings === undefined ? "" : strings.join("?").replaceAll(/\s+/g, " ").trim();
}

function sqlMock(rows: unknown[]) {
  return vi.fn(async () => rows);
}

describe("organization asset query adapter", () => {
  it("maps the public media sentinel and ordered safe assets without internal paths", async () => {
    const sql = sqlMock([
      {
        organization_id: organizationId,
        organization_revision: 8,
        gallery_revision: 3,
        media_id: null,
        kind: null,
        public_url: null,
        width: null,
        height: null,
        byte_size: null,
        alt_text: null,
        position: null,
        asset_revision: null,
        object_path: "must-not-leak",
      },
    ]);

    const result = await createOrgAssetQueries(sql as unknown as Sql).getOrgMedia(organizationId);

    expect(queryText(sql.mock.calls[0])).toContain("brownsync_get_org_media(?::text)");
    expect(sql.mock.calls[0]?.slice(1)).toEqual([organizationId]);
    expect(result).toEqual({
      kind: "ok",
      value: {
        organizationId,
        organizationRevision: 8,
        galleryRevision: 3,
        avatar: null,
        banner: null,
        gallery: [],
      },
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("calls exact reserve/begin/finalize/fail routines and pairs mapped revisions", async () => {
    const sql = vi
      .fn()
      .mockResolvedValueOnce([
        {
          upload_id: uploadId,
          kind: "gallery",
          expires_at: new Date("2026-07-30T12:10:00Z"),
          replayed: false,
        },
      ])
      .mockResolvedValueOnce([
        {
          upload_id: uploadId,
          organization_id: organizationId,
          kind: "gallery",
          object_path: `org/${organizationId}/gallery/${uploadId}.webp`,
          alt_text: "Robotics demo",
          expires_at: new Date("2026-07-30T12:10:00Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          media_id: mediaId,
          kind: "gallery",
          public_url: "https://project.supabase.co/media.webp",
          width: 1920,
          height: 1080,
          byte_size: 1000,
          alt_text: "Robotics demo",
          position: 0,
          asset_revision: 1,
          organization_revision: 8,
          gallery_revision: 4,
          replayed: false,
        },
      ])
      .mockResolvedValueOnce([
        { upload_id: uploadId, status: "failed", changed: true, cleanup_enqueued: true },
      ]);
    const queries = createOrgAssetQueries(sql as unknown as Sql);
    const path = `org/${organizationId}/gallery/${uploadId}.webp`;

    const reserved = await queries.reserveMediaUpload(actorId, organizationId, {
      clientRequestId: requestId,
      uploadId,
      kind: "gallery",
      altText: "Robotics demo",
      expectedOrganizationRevision: null,
      expectedGalleryRevision: 3,
      objectPath: path,
    });
    const begun = await queries.beginMediaUpload(actorId, uploadId);
    const finalized = await queries.finalizeMediaUpload(actorId, uploadId, {
      mediaId,
      publicUrl: "https://project.supabase.co/media.webp",
      width: 1920,
      height: 1080,
      byteSize: 1000,
    });
    const failed = await queries.failMediaUpload(actorId, uploadId, "finalization_failed", true);

    expect(sql.mock.calls.map(queryText)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("brownsync_reserve_org_media_upload("),
        expect.stringContaining("brownsync_begin_org_media_upload("),
        expect.stringContaining("brownsync_finalize_org_media_upload("),
        expect.stringContaining("brownsync_fail_org_media_upload("),
      ]),
    );
    expect(sql.mock.calls[0]?.slice(1)).toEqual([
      actorId,
      organizationId,
      requestId,
      uploadId,
      "gallery",
      "Robotics demo",
      null,
      3,
      path,
    ]);
    expect(reserved).toMatchObject({ kind: "ok", value: { uploadId, replayed: false } });
    expect(begun).toMatchObject({ kind: "ok", value: { uploadId, objectPath: path } });
    expect(finalized).toEqual({
      kind: "ok",
      value: {
        asset: {
          id: mediaId,
          kind: "gallery",
          url: "https://project.supabase.co/media.webp",
          width: 1920,
          height: 1080,
          byteSize: 1000,
          altText: "Robotics demo",
          position: 0,
          revision: 1,
        },
        organizationRevision: null,
        galleryRevision: 4,
        replayed: false,
      },
    });
    expect(failed).toMatchObject({ kind: "ok", value: { cleanupEnqueued: true } });
  });

  it("uses exact optimistic media delete and complete-gallery reorder routines", async () => {
    const sql = vi
      .fn()
      .mockResolvedValueOnce([
        {
          media_id: mediaId,
          kind: "gallery",
          organization_revision: 8,
          gallery_revision: 5,
          changed: true,
        },
      ])
      .mockResolvedValueOnce([{ gallery_revision: 6, changed: true }]);
    const queries = createOrgAssetQueries(sql as unknown as Sql);

    const removed = await queries.deleteMedia(actorId, organizationId, mediaId, 4);
    const reordered = await queries.reorderGallery(actorId, organizationId, 5, [mediaId]);

    expect(sql.mock.calls[0]?.slice(1)).toEqual([actorId, organizationId, mediaId, 4]);
    expect(sql.mock.calls[1]?.slice(1)).toEqual([actorId, organizationId, 5, [mediaId]]);
    expect(removed).toEqual({
      kind: "ok",
      value: {
        mediaId,
        kind: "gallery",
        organizationRevision: null,
        galleryRevision: 5,
        changed: true,
      },
    });
    expect(reordered).toEqual({
      kind: "ok",
      value: { galleryRevision: 6, changed: true },
    });
  });

  it("maps public social rows to link/embed cards without HTML or leases", async () => {
    const sql = sqlMock([
      {
        organization_id: organizationId,
        post_id: postId,
        permalink: "https://www.instagram.com/p/abc/",
        status: "ready",
        revision: 2,
        cache_expires_at: new Date("2026-07-31T12:00:00Z"),
        attribution: "Brown Robotics",
        embed_available: true,
        render_html: "must-not-leak",
        lease_token: "must-not-leak",
      },
    ]);
    const queries = createOrgAssetQueries(sql as unknown as Sql, {
      embedOrigin: "https://embed.brownsync.app",
    });

    const result = await queries.listSocialPosts(organizationId);

    expect(result).toEqual({
      kind: "ok",
      value: {
        organizationId,
        posts: [
          {
            id: postId,
            permalink: "https://www.instagram.com/p/abc/",
            renderMode: "embed",
            embedUrl: `https://embed.brownsync.app/api/social-posts/${postId}/embed`,
            attribution: "Brown Robotics",
            revision: 2,
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("never infers embed availability from a stale ready mutation row", async () => {
    const sql = sqlMock([
      {
        post_id: postId,
        organization_id: organizationId,
        permalink: "https://www.instagram.com/p/abc/",
        status: "ready",
        revision: 2,
        lease_token: leaseToken,
        cache_expires_at: new Date("2026-07-29T12:00:00Z"),
        attribution: "Brown Robotics",
        replayed: true,
        refresh_required: true,
      },
    ]);
    const result = await createOrgAssetQueries(sql as unknown as Sql, {
      embedOrigin: "https://embed.brownsync.app",
    }).addSocialPost(
      actorId,
      organizationId,
      requestId,
      postId,
      "https://www.instagram.com/p/abc/",
    );

    expect(result).toMatchObject({
      kind: "ok",
      value: {
        post: { renderMode: "link", embedUrl: null },
        refreshRequired: true,
      },
    });
  });

  it("calls add, manual-refresh, capacity, finalize, and delete with exact lease arguments", async () => {
    const socialRow = {
      post_id: postId,
      organization_id: organizationId,
      permalink: "https://www.instagram.com/p/abc/",
      status: "pending",
      revision: 0,
      lease_token: leaseToken,
      cache_expires_at: null,
      attribution: null,
      replayed: false,
      refresh_required: true,
    };
    const sql = vi
      .fn()
      .mockResolvedValueOnce([socialRow])
      .mockResolvedValueOnce([{ ...socialRow, claimed: true }])
      .mockResolvedValueOnce([{ allowed: true, remaining: 899, retry_after_seconds: 0 }])
      .mockResolvedValueOnce([
        {
          ...socialRow,
          status: "ready",
          revision: 1,
          cache_expires_at: new Date("2026-07-31T12:00:00Z"),
          attribution: "Brown Robotics",
          changed: true,
          replayed: false,
        },
      ])
      .mockResolvedValueOnce([{ post_id: postId, revision: 2, changed: true }]);
    const queries = createOrgAssetQueries(sql as unknown as Sql);

    await queries.addSocialPost(
      actorId,
      organizationId,
      requestId,
      postId,
      "https://www.instagram.com/p/abc/",
    );
    await queries.beginSocialPostRefresh(actorId, organizationId, postId);
    await queries.consumeOEmbedCapacity(postId, leaseToken);
    await queries.finalizeSocialPost(actorId, postId, leaseToken, {
      outcome: "ready",
      renderHtml: "<blockquote>x</blockquote>",
      attribution: "Brown Robotics",
      errorCode: null,
    });
    await queries.deleteSocialPost(actorId, organizationId, postId, 1);

    expect(sql.mock.calls[0]?.slice(1)).toEqual([
      actorId,
      organizationId,
      requestId,
      postId,
      "https://www.instagram.com/p/abc/",
    ]);
    expect(sql.mock.calls[1]?.slice(1)).toEqual([actorId, organizationId, postId]);
    expect(sql.mock.calls[2]?.slice(1)).toEqual([postId, leaseToken]);
    expect(sql.mock.calls[3]?.slice(1)).toEqual([
      actorId,
      postId,
      leaseToken,
      "ready",
      "<blockquote>x</blockquote>",
      "Brown Robotics",
      null,
    ]);
    expect(sql.mock.calls[4]?.slice(1)).toEqual([actorId, organizationId, postId, 1]);
  });

  it("maps the isolated embed projection without exposing internal state", async () => {
    const sql = sqlMock([
      {
        post_id: postId,
        permalink: "https://www.instagram.com/p/abc/",
        render_html: "<blockquote>safe</blockquote>",
        revision: 3,
      },
    ]);

    const result = await createOrgAssetQueries(sql as unknown as Sql).getSocialEmbed(postId);

    expect(queryText(sql.mock.calls[0])).toContain("brownsync_get_org_social_embed(?::uuid)");
    expect(result).toEqual({
      kind: "ok",
      value: {
        postId,
        permalink: "https://www.instagram.com/p/abc/",
        renderHtml: "<blockquote>safe</blockquote>",
        revision: 3,
      },
    });
  });

  it.each([
    ["INPUT_INVALID", "bad_request"],
    ["PERMALINK_INVALID", "bad_request"],
    ["FORBIDDEN", "forbidden"],
    ["UPLOAD_NOT_FOUND", "not_found"],
    ["REVISION_CONFLICT", "conflict"],
    ["RATE_LIMITED", "rate_limited"],
  ] as const)("maps stable 0017 error %s to %s", async (suffix, expected) => {
    const sql = vi.fn(async () => {
      throw new Error(`BROWNSYNC_ORG_ASSET_${suffix}`);
    });

    const result = await createOrgAssetQueries(sql as unknown as Sql).beginMediaUpload(
      actorId,
      uploadId,
    );

    expect(result).toEqual({ kind: expected });
  });

  it("maps unknown and structurally empty continuation results to unavailable", async () => {
    const sql = vi
      .fn()
      .mockRejectedValueOnce(new Error("private driver detail"))
      .mockResolvedValueOnce([]);
    const queries = createOrgAssetQueries(sql as unknown as Sql);

    expect(await queries.beginMediaUpload(actorId, uploadId)).toEqual({ kind: "unavailable" });
    expect(
      await queries.finalizeMediaUpload(actorId, uploadId, {
        mediaId,
        publicUrl: "https://project.supabase.co/media.webp",
        width: 100,
        height: 100,
        byteSize: 1000,
      }),
    ).toEqual({ kind: "unavailable" });
  });
});
