import type { OrgMediaCollection, OrgSocialPost } from "@brownsync/contract";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { Authenticator, RateLimiterBinding } from "../src/auth";
import type { OrgAssetQueries } from "../src/org-asset-queries";
import type { ImageProcessor, MediaObjectStore } from "../src/org-asset-services";
import { fakeQueries } from "./fixtures";

const actorId = "74000000-0000-4000-8000-000000000001";
const uploadId = "74000000-0000-4000-8000-000000000002";
const mediaId = "74000000-0000-4000-8000-000000000003";
const postId = "74000000-0000-4000-8000-000000000004";
const requestId = "74000000-0000-4000-8000-000000000005";
const leaseToken = "74000000-0000-4000-8000-000000000006";
const organizationId = "robotics-club";

const authenticated: Authenticator = async (c, next) => {
  c.set("user", { id: actorId, email: "member@brown.edu" });
  c.set("authentication", { oauthAuthenticatedAt: Math.floor(Date.now() / 1000) });
  await next();
};

function limiter(success = true): RateLimiterBinding & { limit: ReturnType<typeof vi.fn> } {
  return { limit: vi.fn(async () => ({ success })) };
}

const collection: OrgMediaCollection = {
  organizationId,
  organizationRevision: 2,
  galleryRevision: 1,
  avatar: null,
  banner: null,
  gallery: [],
};

const linkPost: OrgSocialPost = {
  id: postId,
  permalink: "https://www.instagram.com/p/abc/",
  renderMode: "link",
  embedUrl: null,
  attribution: null,
  revision: 0,
};

function assetQueries(overrides: Partial<OrgAssetQueries> = {}): OrgAssetQueries {
  const unavailable = async () => ({ kind: "unavailable" as const });
  return {
    getOrgMedia: unavailable,
    reserveMediaUpload: unavailable,
    beginMediaUpload: unavailable,
    finalizeMediaUpload: unavailable,
    failMediaUpload: unavailable,
    deleteMedia: unavailable,
    reorderGallery: unavailable,
    listSocialPosts: unavailable,
    addSocialPost: unavailable,
    beginSocialPostRefresh: unavailable,
    consumeOEmbedCapacity: unavailable,
    finalizeSocialPost: unavailable,
    deleteSocialPost: unavailable,
    getSocialEmbed: unavailable,
    ...overrides,
  };
}

function options(queries: OrgAssetQueries, overrides: Record<string, unknown> = {}) {
  return {
    authenticator: authenticated,
    orgAssetQueries: queries,
    mediaWriteLimiter: limiter(),
    socialWriteLimiter: limiter(),
    idFactory: { uuid: vi.fn(() => uploadId) },
    ...overrides,
  };
}

describe("organization asset public and protected routes", () => {
  it("serves public media/social GET and HEAD without touching hosted adapters", async () => {
    const getOrgMedia = vi.fn(async () => ({ kind: "ok" as const, value: collection }));
    const listSocialPosts = vi.fn(async () => ({
      kind: "ok" as const,
      value: { organizationId, posts: [linkPost] },
    }));
    const imageProcessor = { process: vi.fn() };
    const objectStore = { putImmutable: vi.fn(), delete: vi.fn() };
    const instagramClient = { fetch: vi.fn() };
    const app = createApp(
      fakeQueries(),
      options(assetQueries({ getOrgMedia, listSocialPosts }), {
        imageProcessor,
        objectStore,
        instagramClient,
      }),
    );

    for (const method of ["GET", "HEAD"]) {
      const media = await app.request(`/api/orgs/${organizationId}/media`, { method });
      const social = await app.request(`/api/orgs/${organizationId}/social-posts`, { method });
      expect(media.status).toBe(200);
      expect(social.status).toBe(200);
      if (method === "GET") {
        expect(await media.json()).toEqual(collection);
        expect(await social.json()).toEqual({ organizationId, posts: [linkPost] });
      } else {
        expect(await media.text()).toBe("");
        expect(await social.text()).toBe("");
      }
    }
    expect(imageProcessor.process).not.toHaveBeenCalled();
    expect(objectStore.putImmutable).not.toHaveBeenCalled();
    expect(instagramClient.fetch).not.toHaveBeenCalled();
  });

  it("authenticates each mutation before its dedicated limiter and query", async () => {
    const reserve = vi.fn();
    const mediaLimiter = limiter();
    const blocked: Authenticator = async (c) =>
      c.json({ error: { code: "unauthorized", message: "blocked" } }, 401);
    const app = createApp(
      fakeQueries(),
      options(assetQueries({ reserveMediaUpload: reserve }), {
        authenticator: blocked,
        mediaWriteLimiter: mediaLimiter,
      }),
    );

    const response = await app.request(`/api/orgs/${organizationId}/media/uploads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientRequestId: requestId,
        kind: "gallery",
        altText: "Robotics demo",
        expectedOrganizationRevision: null,
        expectedGalleryRevision: 1,
      }),
    });

    expect(response.status).toBe(401);
    expect(mediaLimiter.limit).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("reserves a server-owned immutable path and never accepts a client path", async () => {
    const reserve = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        uploadId,
        kind: "gallery" as const,
        expiresAt: "2026-07-30T12:10:00.000Z",
        replayed: false,
      },
    }));
    const app = createApp(fakeQueries(), options(assetQueries({ reserveMediaUpload: reserve })));
    const body = {
      clientRequestId: requestId,
      kind: "gallery",
      altText: "Robotics demo",
      expectedOrganizationRevision: null,
      expectedGalleryRevision: 1,
    };

    const response = await app.request(`/api/orgs/${organizationId}/media/uploads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const forged = await app.request(`/api/orgs/${organizationId}/media/uploads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, objectPath: "../forged.webp" }),
    });

    expect(response.status).toBe(201);
    expect(forged.status).toBe(400);
    expect(reserve).toHaveBeenCalledOnce();
    expect(reserve).toHaveBeenCalledWith(actorId, organizationId, {
      ...body,
      uploadId,
      objectPath: `org/${organizationId}/gallery/${uploadId}.webp`,
    });
  });

  it.each([
    [
      "avatar",
      {
        clientRequestId: requestId,
        kind: "avatar",
        altText: "Club logo",
        expectedOrganizationRevision: 4,
      },
      {
        expectedOrganizationRevision: 4,
        expectedGalleryRevision: null,
      },
    ],
    [
      "gallery",
      {
        clientRequestId: requestId,
        kind: "gallery",
        altText: "Robotics demo",
        expectedGalleryRevision: 1,
      },
      {
        expectedOrganizationRevision: null,
        expectedGalleryRevision: 1,
      },
    ],
  ] as const)(
    "normalizes the omitted inactive %s revision before the query seam",
    async (kind, body, revisions) => {
      const reserve = vi.fn(async () => ({
        kind: "ok" as const,
        value: {
          uploadId,
          kind,
          expiresAt: "2026-07-30T12:10:00.000Z",
          replayed: false,
        },
      }));
      const app = createApp(fakeQueries(), options(assetQueries({ reserveMediaUpload: reserve })));

      const response = await app.request(`/api/orgs/${organizationId}/media/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(201);
      expect(reserve).toHaveBeenCalledWith(actorId, organizationId, {
        ...body,
        ...revisions,
        uploadId,
        objectPath: `org/${organizationId}/${kind}/${uploadId}.webp`,
      });
    },
  );

  it("keeps raw upload ordering and stores only the processor's WebP bytes", async () => {
    const calls: string[] = [];
    const rawBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const processed = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const begin = vi.fn(async () => {
      calls.push("begin");
      return {
        kind: "ok" as const,
        value: {
          uploadId,
          organizationId,
          kind: "gallery" as const,
          objectPath: `org/${organizationId}/gallery/${uploadId}.webp`,
          altText: "Robotics demo",
          expiresAt: "2026-07-30T12:10:00.000Z",
        },
      };
    });
    const imageProcessor: ImageProcessor = {
      process: vi.fn(async (input) => {
        calls.push("process");
        expect(input.declaredContentType).toBe("image/png");
        expect(input.declaredLength).toBe(rawBytes.byteLength);
        expect(new Uint8Array(await new Response(input.stream).arrayBuffer())).toEqual(rawBytes);
        return {
          bytes: processed,
          width: 640,
          height: 480,
          byteSize: processed.byteLength,
          contentType: "image/webp" as const,
        };
      }),
    };
    const objectStore: MediaObjectStore = {
      putImmutable: vi.fn(async (input) => {
        calls.push("store");
        expect(input.bytes).toEqual(processed);
        expect(input.bytes).not.toEqual(rawBytes);
        return { publicUrl: "https://project.supabase.co/media.webp" };
      }),
      delete: vi.fn(),
    };
    const finalize = vi.fn(async () => {
      calls.push("finalize");
      return {
        kind: "ok" as const,
        value: {
          asset: {
            id: mediaId,
            kind: "gallery" as const,
            url: "https://project.supabase.co/media.webp",
            width: 640,
            height: 480,
            byteSize: processed.byteLength,
            altText: "Robotics demo",
            position: 0,
            revision: 1,
          },
          organizationRevision: null,
          galleryRevision: 2,
          replayed: false,
        },
      };
    });
    const app = createApp(
      fakeQueries(),
      options(assetQueries({ beginMediaUpload: begin, finalizeMediaUpload: finalize }), {
        imageProcessor,
        objectStore,
        idFactory: { uuid: vi.fn(() => mediaId) },
      }),
    );

    const response = await app.request(`/api/org-media/uploads/${uploadId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(rawBytes.byteLength),
      },
      body: rawBytes,
    });

    expect(response.status).toBe(201);
    expect(calls).toEqual(["begin", "process", "store", "finalize"]);
    expect(await response.json()).toMatchObject({ asset: { id: mediaId }, galleryRevision: 2 });
  });

  it("marks a claimed upload failed when a required adapter is missing", async () => {
    const begin = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        uploadId,
        organizationId,
        kind: "gallery" as const,
        objectPath: `org/${organizationId}/gallery/${uploadId}.webp`,
        altText: "Robotics demo",
        expiresAt: "2026-07-30T12:10:00.000Z",
      },
    }));
    const fail = vi.fn(async () => ({
      kind: "ok" as const,
      value: { uploadId, status: "failed", changed: true, cleanupEnqueued: false },
    }));
    const app = createApp(
      fakeQueries(),
      options(assetQueries({ beginMediaUpload: begin, failMediaUpload: fail })),
    );

    const response = await app.request(`/api/org-media/uploads/${uploadId}`, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array([0x89, 0x50]),
    });

    expect(response.status).toBe(503);
    expect(fail).toHaveBeenCalledWith(actorId, uploadId, "transform_failed", false);
  });

  it("deletes or queues an object after finalization failure without restoring visibility", async () => {
    const path = `org/${organizationId}/gallery/${uploadId}.webp`;
    const fail = vi.fn(async () => ({
      kind: "ok" as const,
      value: { uploadId, status: "failed", changed: true, cleanupEnqueued: true },
    }));
    const wake = vi.fn();
    const objectStore: MediaObjectStore = {
      putImmutable: vi.fn(async () => ({
        publicUrl: "https://project.supabase.co/media.webp",
      })),
      delete: vi.fn(async () => "deleted" as const),
    };
    const app = createApp(
      fakeQueries(),
      options(
        assetQueries({
          beginMediaUpload: async () => ({
            kind: "ok",
            value: {
              uploadId,
              organizationId,
              kind: "gallery",
              objectPath: path,
              altText: "Robotics demo",
              expiresAt: "2026-07-30T12:10:00.000Z",
            },
          }),
          finalizeMediaUpload: async () => ({ kind: "conflict" }),
          failMediaUpload: fail,
        }),
        {
          imageProcessor: {
            process: async () => ({
              bytes: new Uint8Array([1]),
              width: 1,
              height: 1,
              byteSize: 1,
              contentType: "image/webp",
            }),
          },
          objectStore,
          cleanupScheduler: { wake },
          idFactory: { uuid: () => mediaId },
        },
      ),
    );

    const response = await app.request(`/api/org-media/uploads/${uploadId}`, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array([1]),
    });

    expect(response.status).toBe(409);
    expect(objectStore.delete).toHaveBeenCalledWith(path);
    expect(fail).toHaveBeenCalledWith(actorId, uploadId, "finalization_failed", true);
    expect(wake).toHaveBeenCalledOnce();
  });

  it("retries an ambiguous finalization and never deletes a possibly committed public object", async () => {
    const path = `org/${organizationId}/gallery/${uploadId}.webp`;
    const finalize = vi.fn(async () => ({ kind: "unavailable" as const }));
    const fail = vi.fn(async () => ({
      kind: "ok" as const,
      value: { uploadId, status: "finalized", changed: false, cleanupEnqueued: false },
    }));
    const objectStore: MediaObjectStore = {
      putImmutable: async () => ({ publicUrl: "https://project.supabase.co/media.webp" }),
      delete: vi.fn(),
    };
    const app = createApp(
      fakeQueries(),
      options(
        assetQueries({
          beginMediaUpload: async () => ({
            kind: "ok",
            value: {
              uploadId,
              organizationId,
              kind: "gallery",
              objectPath: path,
              altText: "Robotics demo",
              expiresAt: "2026-07-30T12:10:00.000Z",
            },
          }),
          finalizeMediaUpload: finalize,
          failMediaUpload: fail,
        }),
        {
          imageProcessor: {
            process: async () => ({
              bytes: new Uint8Array([1]),
              width: 1,
              height: 1,
              byteSize: 1,
              contentType: "image/webp",
            }),
          },
          objectStore,
          idFactory: { uuid: () => mediaId },
        },
      ),
    );

    const response = await app.request(`/api/org-media/uploads/${uploadId}`, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array([1]),
    });

    expect(response.status).toBe(503);
    expect(finalize).toHaveBeenCalledTimes(2);
    expect(finalize.mock.calls[0]).toEqual(finalize.mock.calls[1]);
    expect(objectStore.delete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(actorId, uploadId, "finalization_failed", true);
  });

  it.each([
    [undefined, false, 415, "unsupported_media_type"],
    ["image/png", false, 422, "invalid_image"],
    ["multipart/form-data; boundary=x", true, 415, "unsupported_media_type"],
    ["application/octet-stream", true, 415, "unsupported_media_type"],
  ] as const)(
    "fails a claimed upload with content type %s before processing",
    async (contentType, hasBody, status, code) => {
      const process = vi.fn();
      const fail = vi.fn(async () => ({
        kind: "ok" as const,
        value: { uploadId, status: "failed", changed: true, cleanupEnqueued: false },
      }));
      const app = createApp(
        fakeQueries(),
        options(
          assetQueries({
            beginMediaUpload: async () => ({
              kind: "ok",
              value: {
                uploadId,
                organizationId,
                kind: "gallery",
                objectPath: `org/${organizationId}/gallery/${uploadId}.webp`,
                altText: "Robotics demo",
                expiresAt: "2026-07-30T12:10:00.000Z",
              },
            }),
            failMediaUpload: fail,
          }),
          { imageProcessor: { process } },
        ),
      );
      const headers = contentType === undefined ? undefined : { "Content-Type": contentType };
      const response = await app.request(`/api/org-media/uploads/${uploadId}`, {
        method: "PUT",
        headers,
        body: hasBody ? new Uint8Array([1]) : undefined,
      });

      expect(response.status).toBe(status);
      expect(fail).toHaveBeenCalledWith(actorId, uploadId, code, false);
      expect(process).not.toHaveBeenCalled();
    },
  );

  it("supports optimistic media delete and complete gallery reorder surfaces", async () => {
    const remove = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        mediaId,
        kind: "gallery" as const,
        organizationRevision: null,
        galleryRevision: 2,
        changed: true,
      },
    }));
    const reorder = vi.fn(async () => ({
      kind: "ok" as const,
      value: { galleryRevision: 3, changed: true },
    }));
    const app = createApp(
      fakeQueries(),
      options(assetQueries({ deleteMedia: remove, reorderGallery: reorder })),
    );

    const deleted = await app.request(`/api/orgs/${organizationId}/media/${mediaId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    const reordered = await app.request(`/api/orgs/${organizationId}/media/gallery`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedGalleryRevision: 2, mediaIds: [mediaId] }),
    });

    expect(deleted.status).toBe(200);
    expect(reordered.status).toBe(200);
    expect(remove).toHaveBeenCalledWith(actorId, organizationId, mediaId, 1);
    expect(reorder).toHaveBeenCalledWith(actorId, organizationId, 2, [mediaId]);
  });

  it("returns dedicated media limiter denial before a reservation query", async () => {
    const reserve = vi.fn();
    const denied = limiter(false);
    const app = createApp(
      fakeQueries(),
      options(assetQueries({ reserveMediaUpload: reserve }), {
        mediaWriteLimiter: denied,
      }),
    );
    const response = await app.request(`/api/orgs/${organizationId}/media/uploads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientRequestId: requestId,
        kind: "gallery",
        altText: "Robotics demo",
        expectedOrganizationRevision: null,
        expectedGalleryRevision: 1,
      }),
    });

    expect(response.status).toBe(429);
    expect(denied.limit).toHaveBeenCalledWith({ key: `write:${actorId}` });
    expect(reserve).not.toHaveBeenCalled();
  });
});

describe("organization Instagram-card routes", () => {
  it("returns missing-provider add as link-only without consuming provider capacity", async () => {
    const calls: string[] = [];
    const add = vi.fn(async () => {
      calls.push("add");
      return {
        kind: "ok" as const,
        value: {
          post: linkPost,
          organizationId,
          leaseToken,
          replayed: false,
          refreshRequired: true,
        },
      };
    });
    const capacity = vi.fn(async () => {
      calls.push("capacity");
      return {
        kind: "ok" as const,
        value: { allowed: true, remaining: 899, retryAfterSeconds: 0 },
      };
    });
    const finalize = vi.fn(async () => {
      calls.push("finalize");
      return {
        kind: "ok" as const,
        value: {
          post: linkPost,
          organizationId,
          changed: true,
          replayed: false,
        },
      };
    });
    const app = createApp(
      fakeQueries(),
      options(
        assetQueries({
          addSocialPost: add,
          consumeOEmbedCapacity: capacity,
          finalizeSocialPost: finalize,
        }),
        {
          idFactory: { uuid: () => postId },
        },
      ),
    );

    const response = await app.request(`/api/orgs/${organizationId}/social-posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientRequestId: requestId,
        permalink: "https://instagram.com/p/abc/?utm_source=share",
      }),
    });

    expect(response.status).toBe(201);
    expect(calls).toEqual(["add", "finalize"]);
    expect(capacity).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      actorId,
      organizationId,
      requestId,
      postId,
      "https://www.instagram.com/p/abc/",
    );
    expect(await response.json()).toEqual({ post: linkPost, replayed: false });
  });

  it("never calls Graph when durable capacity is unavailable", async () => {
    const instagramClient = { fetch: vi.fn() };
    const finalize = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        post: linkPost,
        organizationId,
        changed: false,
        replayed: false,
      },
    }));
    const app = createApp(
      fakeQueries(),
      options(
        assetQueries({
          addSocialPost: async () => ({
            kind: "ok",
            value: {
              post: linkPost,
              organizationId,
              leaseToken,
              replayed: false,
              refreshRequired: true,
            },
          }),
          consumeOEmbedCapacity: async () => ({
            kind: "ok",
            value: { allowed: false, remaining: 0, retryAfterSeconds: 60 },
          }),
          finalizeSocialPost: finalize,
        }),
        { instagramClient, idFactory: { uuid: () => postId } },
      ),
    );

    const response = await app.request(`/api/orgs/${organizationId}/social-posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientRequestId: requestId,
        permalink: "https://www.instagram.com/p/abc/",
      }),
    });

    expect(response.status).toBe(201);
    expect(instagramClient.fetch).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(actorId, postId, leaseToken, {
      outcome: "deferred",
      renderHtml: null,
      attribution: null,
      errorCode: "capacity_exhausted",
    });
  });

  it("passes the canonical SQL-returned permalink to a configured provider after capacity", async () => {
    const fetchProvider = vi.fn(async () => ({
      kind: "link_only" as const,
      errorCode: "provider_unavailable",
    }));
    const app = createApp(
      fakeQueries(),
      options(
        assetQueries({
          addSocialPost: async () => ({
            kind: "ok",
            value: {
              post: linkPost,
              organizationId,
              leaseToken,
              replayed: false,
              refreshRequired: true,
            },
          }),
          consumeOEmbedCapacity: async () => ({
            kind: "ok",
            value: { allowed: true, remaining: 899, retryAfterSeconds: 0 },
          }),
          finalizeSocialPost: async () => ({
            kind: "ok",
            value: {
              post: linkPost,
              organizationId,
              changed: true,
              replayed: false,
            },
          }),
        }),
        {
          instagramClient: { fetch: fetchProvider },
          idFactory: { uuid: () => postId },
        },
      ),
    );
    const response = await app.request(`/api/orgs/${organizationId}/social-posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientRequestId: requestId,
        permalink: "https://instagram.com/p/abc/?utm_source=share",
      }),
    });

    expect(response.status).toBe(201);
    expect(fetchProvider).toHaveBeenCalledWith("https://www.instagram.com/p/abc/");
  });

  it("keeps manual refresh bodyless/idempotent and social delete revision-guarded", async () => {
    const refresh = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        post: linkPost,
        organizationId,
        leaseToken: null,
        claimed: false,
      },
    }));
    const remove = vi.fn(async () => ({
      kind: "ok" as const,
      value: { postId, revision: 2, changed: true },
    }));
    const app = createApp(
      fakeQueries(),
      options(
        assetQueries({
          beginSocialPostRefresh: refresh,
          deleteSocialPost: remove,
        }),
      ),
    );

    const refreshed = await app.request(
      `/api/orgs/${organizationId}/social-posts/${postId}/refresh`,
      { method: "POST" },
    );
    const deleted = await app.request(`/api/orgs/${organizationId}/social-posts/${postId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1 }),
    });

    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toEqual({ post: linkPost, changed: false });
    expect(refresh).toHaveBeenCalledWith(actorId, organizationId, postId);
    expect(deleted.status).toBe(200);
    expect(remove).toHaveBeenCalledWith(actorId, organizationId, postId, 1);
  });

  it("returns the same concealed 404 for unconfigured or wrong embed origin before querying", async () => {
    const getEmbed = vi.fn();
    for (const [embedOrigin, requestOrigin] of [
      [undefined, "https://embed.brownsync.app"],
      ["https://embed.brownsync.app", "https://api.brownsync.app"],
    ]) {
      const app = createApp(
        fakeQueries(),
        options(assetQueries({ getSocialEmbed: getEmbed }), { embedOrigin }),
      );
      const response = await app.request(`${requestOrigin}/api/social-posts/${postId}/embed`);
      expect(response.status).toBe(404);
    }
    expect(getEmbed).not.toHaveBeenCalled();
  });

  it("serves an isolated safe embed only on the exact configured origin", async () => {
    const getEmbed = vi.fn(async () => ({
      kind: "ok" as const,
      value: {
        postId,
        permalink: "https://www.instagram.com/p/abc/",
        renderHtml: "<blockquote>safe</blockquote>",
        revision: 2,
      },
    }));
    const app = createApp(
      fakeQueries(),
      options(assetQueries({ getSocialEmbed: getEmbed }), {
        embedOrigin: "https://embed.brownsync.app",
      }),
    );

    const response = await app.request(
      `https://embed.brownsync.app/api/social-posts/${postId}/embed`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(await response.text()).toContain("<blockquote>safe</blockquote>");
    expect(getEmbed).toHaveBeenCalledWith(postId);

    const head = await app.request(`https://embed.brownsync.app/api/social-posts/${postId}/embed`, {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(await head.text()).toBe("");
  });

  it.each(["GET", "HEAD"] as const)(
    "conceals malformed embed identifiers as 404 on exact and wrong origins for %s",
    async (method) => {
      const getEmbed = vi.fn();
      const app = createApp(
        fakeQueries(),
        options(assetQueries({ getSocialEmbed: getEmbed }), {
          embedOrigin: "https://embed.brownsync.app",
        }),
      );
      for (const origin of ["https://embed.brownsync.app", "https://api.brownsync.app"]) {
        const response = await app.request(`${origin}/api/social-posts/not-a-uuid/embed`, {
          method,
        });
        expect(response.status).toBe(404);
        if (method === "HEAD") expect(await response.text()).toBe("");
      }
      expect(getEmbed).not.toHaveBeenCalled();
    },
  );

  it("maps public query failures only to its documented status surface", async () => {
    for (const [kind, expected] of [
      ["bad_request", 400],
      ["not_found", 404],
      ["rate_limited", 429],
      ["forbidden", 503],
      ["conflict", 503],
      ["unavailable", 503],
    ] as const) {
      const app = createApp(
        fakeQueries(),
        options(assetQueries({ getOrgMedia: async () => ({ kind }) })),
      );
      const response = await app.request(`/api/orgs/${organizationId}/media`);
      expect(response.status, kind).toBe(expected);
    }
  });

  it("keeps every new route OPTIONS request dependency-free", async () => {
    const queries = new Proxy({} as OrgAssetQueries, {
      get(_target, property) {
        throw new Error(`OPTIONS touched query ${String(property)}`);
      },
    });
    const blocked = {
      limit: vi.fn(async () => {
        throw new Error("OPTIONS touched limiter");
      }),
    };
    const app = createApp(
      fakeQueries(),
      options(queries, {
        authenticator: async () => {
          throw new Error("OPTIONS touched auth");
        },
        mediaWriteLimiter: blocked,
        socialWriteLimiter: blocked,
      }),
    );
    for (const [path, method] of [
      [`/api/orgs/${organizationId}/media`, "GET"],
      [`/api/orgs/${organizationId}/media/uploads`, "POST"],
      [`/api/org-media/uploads/${uploadId}`, "PUT"],
      [`/api/orgs/${organizationId}/media/${mediaId}`, "DELETE"],
      [`/api/orgs/${organizationId}/media/gallery`, "PATCH"],
      [`/api/orgs/${organizationId}/social-posts`, "GET"],
      [`/api/orgs/${organizationId}/social-posts/${postId}/refresh`, "POST"],
      [`/api/orgs/${organizationId}/social-posts/${postId}`, "DELETE"],
      [`/api/social-posts/${postId}/embed`, "GET"],
    ]) {
      const response = await app.request(path as string, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": method,
        },
      });
      expect(response.status, path).toBe(204);
    }
  });
});
