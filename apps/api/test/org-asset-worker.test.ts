import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker";

const postId = "75000000-0000-4000-8000-000000000001";
const uploadId = "75000000-0000-4000-8000-000000000002";
const embedOrigin = "https://embed.brownsync.app";
const context = () => ({ waitUntil: vi.fn() });

describe("Worker organization-asset route classification", () => {
  it.each([
    ["GET", undefined, embedOrigin],
    ["HEAD", undefined, embedOrigin],
    ["GET", embedOrigin, "https://api.brownsync.app"],
    ["HEAD", embedOrigin, "https://api.brownsync.app"],
  ] as const)(
    "conceals an unconfigured/wrong-origin embed %s before limiter or database",
    async (method, configured, requestOrigin) => {
      const publicLimit = vi.fn(async () => ({ success: false }));
      const response = await worker.fetch(
        new Request(`${requestOrigin}/api/social-posts/${postId}/embed`, {
          method,
          headers: { "CF-Connecting-IP": "203.0.113.4" },
        }),
        {
          INSTAGRAM_EMBED_ORIGIN: configured,
          PUBLIC_READ_LIMITER: { limit: publicLimit },
        },
        context(),
      );

      expect(response.status).toBe(404);
      if (method === "HEAD") expect(await response.text()).toBe("");
      expect(publicLimit).not.toHaveBeenCalled();
    },
  );

  it.each(["GET", "HEAD"] as const)(
    "applies the public limiter before exact-origin embed SQL on %s",
    async (method) => {
      const publicLimit = vi.fn(async () => ({ success: true }));
      const response = await worker.fetch(
        new Request(`${embedOrigin}/api/social-posts/${postId}/embed`, {
          method,
          headers: { "CF-Connecting-IP": "203.0.113.4" },
        }),
        {
          INSTAGRAM_EMBED_ORIGIN: embedOrigin,
          PUBLIC_READ_LIMITER: { limit: publicLimit },
        },
        context(),
      );

      expect(response.status).toBe(503);
      expect(publicLimit).toHaveBeenCalledWith({ key: "read:203.0.113.4" });
    },
  );

  it.each([
    [`/api/orgs/robotics-club/media`, "GET"],
    [`/api/orgs/robotics-club/media/uploads`, "POST"],
    [`/api/org-media/uploads/${uploadId}`, "PUT"],
    [`/api/orgs/robotics-club/media/75000000-0000-4000-8000-000000000003`, "DELETE"],
    [`/api/orgs/robotics-club/media/gallery`, "PATCH"],
    [`/api/orgs/robotics-club/social-posts`, "GET"],
    [`/api/orgs/robotics-club/social-posts`, "POST"],
    [`/api/orgs/robotics-club/social-posts/${postId}/refresh`, "POST"],
    [`/api/orgs/robotics-club/social-posts/${postId}`, "DELETE"],
    [`/api/social-posts/${postId}/embed`, "GET"],
  ])("keeps OPTIONS for %s free of auth, limiters, adapters, and SQL", async (path, method) => {
    const explode = {
      limit: vi.fn(async () => {
        throw new Error("OPTIONS touched limiter");
      }),
    };
    const images = new Proxy({} as never, {
      get(_target, property) {
        throw new Error(`OPTIONS touched Images ${String(property)}`);
      },
    });
    const response = await worker.fetch(
      new Request(`https://api.brownsync.app${path}`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": method,
        },
      }),
      {
        IMAGES: images,
        PUBLIC_READ_LIMITER: explode,
        MEDIA_WRITE_LIMITER: explode,
        SOCIAL_WRITE_LIMITER: explode,
        SUPABASE_SERVICE_ROLE_KEY: "must-not-be-used",
        SUPABASE_URL: "https://project.supabase.co",
      },
      context(),
    );

    expect(response.status, path).toBe(204);
    expect(explode.limit).not.toHaveBeenCalled();
  });

  it.each([
    ["reserve", "POST", "/api/orgs/robotics-club/media/uploads"],
    ["upload", "PUT", `/api/org-media/uploads/${uploadId}`],
    [
      "delete media",
      "DELETE",
      "/api/orgs/robotics-club/media/75000000-0000-4000-8000-000000000003",
    ],
    ["reorder", "PATCH", "/api/orgs/robotics-club/media/gallery"],
    ["add post", "POST", "/api/orgs/robotics-club/social-posts"],
    ["refresh post", "POST", `/api/orgs/robotics-club/social-posts/${postId}/refresh`],
    ["delete post", "DELETE", `/api/orgs/robotics-club/social-posts/${postId}`],
  ])(
    "authenticates protected %s before public or dedicated limiter",
    async (_label, method, path) => {
      const publicLimit = vi.fn(async () => ({ success: false }));
      const mediaLimit = vi.fn(async () => ({ success: false }));
      const socialLimit = vi.fn(async () => ({ success: false }));
      const response = await worker.fetch(
        new Request(`https://api.brownsync.app${path}`, {
          method,
          headers: { "Content-Type": method === "PUT" ? "image/png" : "application/json" },
          body:
            method === "POST" || method === "PATCH" || method === "DELETE"
              ? "{}"
              : new Uint8Array([1]),
        }),
        {
          PUBLIC_READ_LIMITER: { limit: publicLimit },
          MEDIA_WRITE_LIMITER: { limit: mediaLimit },
          SOCIAL_WRITE_LIMITER: { limit: socialLimit },
          SUPABASE_URL: "https://worker-asset-test.supabase.co",
        },
        context(),
      );

      expect(response.status).toBe(401);
      expect(publicLimit).not.toHaveBeenCalled();
      expect(mediaLimit).not.toHaveBeenCalled();
      expect(socialLimit).not.toHaveBeenCalled();
    },
  );
});
