import { describe, expect, it, vi } from "vitest";
import {
  buildOrgMediaObjectPath,
  type CloudflareImagesBinding,
  canonicalizeInstagramPermalink,
  createCloudflareImageProcessor,
  createInstagramOEmbedClient,
  createSupabaseMediaObjectStore,
  normalizeEmbedOrigin,
  OrgAssetServiceError,
  parseUploadContentLength,
} from "../src/org-asset-services";

const MiB = 1024 * 1024;
const uploadId = "72000000-0000-4000-8000-000000000001";

function stream(bytes: Uint8Array, chunkSize = bytes.byteLength): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function jpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x03, 0x00, 0x04,
    0x00, 0x01, 0x01, 0x11, 0xff, 0xd9,
  ]);
}

function webp(width: number, height: number, padding = 0): Uint8Array {
  const bytes = new Uint8Array(30 + padding);
  bytes.set([0x52, 0x49, 0x46, 0x46]);
  new DataView(bytes.buffer).setUint32(4, Math.max(22, bytes.length - 8), true);
  bytes.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8);
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  bytes[24] = widthMinusOne & 0xff;
  bytes[25] = (widthMinusOne >>> 8) & 0xff;
  bytes[26] = (widthMinusOne >>> 16) & 0xff;
  bytes[27] = heightMinusOne & 0xff;
  bytes[28] = (heightMinusOne >>> 8) & 0xff;
  bytes[29] = (heightMinusOne >>> 16) & 0xff;
  return bytes;
}

function imagesBinding(output = webp(1024, 768)): {
  binding: CloudflareImagesBinding;
  info: ReturnType<typeof vi.fn>;
  input: ReturnType<typeof vi.fn>;
  transform: ReturnType<typeof vi.fn>;
  outputCall: ReturnType<typeof vi.fn>;
} {
  const info = vi.fn(async (input: ReadableStream<Uint8Array>) => {
    const bytes = new Uint8Array(await new Response(input).arrayBuffer());
    if (bytes[0] === 0x89) return { format: "png", width: 4000, height: 3000 };
    if (bytes[0] === 0xff) return { format: "jpeg", width: 1024, height: 768 };
    return { format: "webp", width: 1024, height: 768 };
  });
  const outputCall = vi.fn(async () => ({
    response: () =>
      new Response(output, {
        headers: { "Content-Type": "image/webp" },
      }),
  }));
  const transform = vi.fn(() => ({ output: outputCall }));
  const input = vi.fn(() => ({ transform }));
  return { binding: { info, input }, info, input, transform, outputCall };
}

async function expectServiceError(
  promise: Promise<unknown>,
  status: number,
  failureCode: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "OrgAssetServiceError",
    status,
    failureCode,
  });
}

describe("raw organization image processing", () => {
  it("parses only canonical, positive, bounded Content-Length values", () => {
    expect(parseUploadContentLength(null)).toBeNull();
    expect(parseUploadContentLength("1")).toBe(1);
    expect(parseUploadContentLength("8388608")).toBe(8 * MiB);
    for (const value of ["0", "01", "+1", "1.0", " 1", "1, 1", "1,2", "8388609"]) {
      expect(() => parseUploadContentLength(value), value).toThrow(OrgAssetServiceError);
    }
  });

  it("checks actual streaming length and applies the exact lossless-metadata transform seam", async () => {
    const fixture = png(4000, 3000);
    const { binding, info, input, transform, outputCall } = imagesBinding();
    const processor = createCloudflareImageProcessor(binding);

    const result = await processor.process({
      stream: stream(fixture, 3),
      declaredContentType: "image/png",
      declaredLength: fixture.byteLength,
      kind: "avatar",
    });

    expect(result).toEqual({
      bytes: webp(1024, 768),
      width: 1024,
      height: 768,
      byteSize: 30,
      contentType: "image/webp",
    });
    expect(info).toHaveBeenCalledTimes(2);
    expect(input).toHaveBeenCalledOnce();
    expect(transform).toHaveBeenCalledWith({
      width: 1024,
      height: 1024,
      fit: "scale-down",
      metadata: "none",
    });
    expect(outputCall).toHaveBeenCalledWith({
      format: "image/webp",
      quality: 82,
      anim: false,
    });
  });

  it.each([
    ["image/jpeg", jpeg()],
    ["image/webp", webp(1024, 768)],
  ] as const)(
    "accepts a decoded %s input when magic, MIME, and info agree",
    async (contentType, fixture) => {
      const { binding } = imagesBinding();
      await expect(
        createCloudflareImageProcessor(binding).process({
          stream: stream(fixture),
          declaredContentType: contentType,
          declaredLength: null,
          kind: "gallery",
        }),
      ).resolves.toMatchObject({ contentType: "image/webp" });
    },
  );

  it("rejects lying lengths, streamed overflow, MIME spoofing, prohibited inputs, and polyglots", async () => {
    const { binding } = imagesBinding();
    const processor = createCloudflareImageProcessor(binding);
    const fixture = png(800, 600);

    await expectServiceError(
      processor.process({
        stream: stream(fixture),
        declaredContentType: "image/png",
        declaredLength: fixture.byteLength - 1,
        kind: "gallery",
      }),
      422,
      "invalid_image",
    );
    await expectServiceError(
      processor.process({
        stream: stream(new Uint8Array(8 * MiB + 1), 65_537),
        declaredContentType: "image/png",
        declaredLength: null,
        kind: "gallery",
      }),
      413,
      "input_too_large",
    );
    await expectServiceError(
      processor.process({
        stream: stream(fixture),
        declaredContentType: "image/jpeg",
        declaredLength: null,
        kind: "gallery",
      }),
      415,
      "unsupported_media_type",
    );
    await expectServiceError(
      processor.process({
        stream: stream(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")),
        declaredContentType: "image/png",
        declaredLength: null,
        kind: "gallery",
      }),
      422,
      "invalid_image",
    );
    const polyglot = new Uint8Array([
      ...fixture,
      ...new TextEncoder().encode("<script>x</script>"),
    ]);
    await expectServiceError(
      processor.process({
        stream: stream(polyglot),
        declaredContentType: "image/png",
        declaredLength: null,
        kind: "gallery",
      }),
      422,
      "invalid_image",
    );
    for (const prohibited of [
      new TextEncoder().encode("GIF89a"),
      new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
      new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]),
    ]) {
      await expectServiceError(
        processor.process({
          stream: stream(prohibited),
          declaredContentType: "image/png",
          declaredLength: null,
          kind: "gallery",
        }),
        415,
        "unsupported_media_type",
      );
    }
    for (const truncated of [
      new Uint8Array([0xff, 0xd8, 0xff]),
      png(100, 100).slice(0, 20),
      webp(100, 100).slice(0, 20),
      new Uint8Array(),
    ]) {
      await expectServiceError(
        processor.process({
          stream: stream(truncated),
          declaredContentType: "image/png",
          declaredLength: null,
          kind: "gallery",
        }),
        422,
        "invalid_image",
      );
    }
  });

  it("rejects info disagreement, dimension/pixel overflow, malformed output, and output overflow", async () => {
    const disagreement = imagesBinding();
    disagreement.info.mockResolvedValueOnce({ format: "jpeg", width: 100, height: 100 });
    await expectServiceError(
      createCloudflareImageProcessor(disagreement.binding).process({
        stream: stream(png(100, 100)),
        declaredContentType: "image/png",
        declaredLength: null,
        kind: "gallery",
      }),
      415,
      "unsupported_media_type",
    );

    const dimensions = imagesBinding();
    dimensions.info.mockResolvedValueOnce({ format: "png", width: 12_001, height: 1 });
    await expectServiceError(
      createCloudflareImageProcessor(dimensions.binding).process({
        stream: stream(png(12_001, 1)),
        declaredContentType: "image/png",
        declaredLength: null,
        kind: "gallery",
      }),
      413,
      "dimension_limit",
    );

    const pixels = imagesBinding();
    pixels.info.mockResolvedValueOnce({ format: "png", width: 10_000, height: 4_001 });
    await expectServiceError(
      createCloudflareImageProcessor(pixels.binding).process({
        stream: stream(png(10_000, 4_001)),
        declaredContentType: "image/png",
        declaredLength: null,
        kind: "gallery",
      }),
      413,
      "pixel_limit",
    );

    const malformed = imagesBinding(new TextEncoder().encode("not webp"));
    await expectServiceError(
      createCloudflareImageProcessor(malformed.binding).process({
        stream: stream(png(100, 100)),
        declaredContentType: "image/png",
        declaredLength: null,
        kind: "gallery",
      }),
      422,
      "transform_failed",
    );

    const oversized = imagesBinding(webp(100, 100, 2 * MiB + 1));
    await expectServiceError(
      createCloudflareImageProcessor(oversized.binding).process({
        stream: stream(png(100, 100)),
        declaredContentType: "image/png",
        declaredLength: null,
        kind: "gallery",
      }),
      413,
      "output_too_large",
    );

    const wrongOutputInfo = imagesBinding();
    wrongOutputInfo.info
      .mockResolvedValueOnce({ format: "png", width: 100, height: 100 })
      .mockResolvedValueOnce({ format: "webp", width: 1921, height: 100 });
    await expectServiceError(
      createCloudflareImageProcessor(wrongOutputInfo.binding).process({
        stream: stream(png(100, 100)),
        declaredContentType: "image/png",
        declaredLength: null,
        kind: "gallery",
      }),
      422,
      "transform_failed",
    );
  });
});

describe("immutable media object storage", () => {
  it("generates only server-owned immutable paths", () => {
    expect(buildOrgMediaObjectPath("robotics-club", "gallery", uploadId)).toBe(
      `org/robotics-club/gallery/${uploadId}.webp`,
    );
    for (const organizationId of ["../club", "club/name", "club%2fname", "", "UPPER"]) {
      expect(() => buildOrgMediaObjectPath(organizationId, "gallery", uploadId)).toThrow(
        OrgAssetServiceError,
      );
    }
  });

  it("uploads only supplied WebP bytes with no-upsert and immutable caching", async () => {
    const processed = webp(640, 480);
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.body).toEqual(processed);
      return new Response(null, { status: 201 });
    });
    const store = createSupabaseMediaObjectStore({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "server-secret",
      fetcher,
    });
    const path = buildOrgMediaObjectPath("robotics-club", "gallery", uploadId);

    const result = await store.putImmutable({
      path,
      bytes: processed,
      contentType: "image/webp",
      cacheControl: "public, max-age=31536000, immutable",
    });

    expect(result.publicUrl).toBe(
      `https://project.supabase.co/storage/v1/object/public/org-media/${path}`,
    );
    const [requestUrl, init] = fetcher.mock.calls[0] ?? [];
    expect(String(requestUrl)).toBe(
      `https://project.supabase.co/storage/v1/object/org-media/${path}`,
    );
    expect(new Headers(init?.headers).get("x-upsert")).toBe("false");
    expect(new Headers(init?.headers).get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(new Headers(init?.headers).get("content-type")).toBe("image/webp");
    expect(init?.redirect).toBe("error");
    expect(JSON.stringify(result)).not.toContain("server-secret");
  });

  it("rejects non-WebP or oversized bytes again at the privileged Storage seam", async () => {
    const fetcher = vi.fn();
    const store = createSupabaseMediaObjectStore({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "server-secret",
      fetcher,
    });
    const path = buildOrgMediaObjectPath("robotics-club", "gallery", uploadId);

    await expect(
      store.putImmutable({
        path,
        bytes: png(100, 100),
        contentType: "image/webp",
        cacheControl: "public, max-age=31536000, immutable",
      }),
    ).rejects.toMatchObject({ failureCode: "storage_failed" });
    await expect(
      store.putImmutable({
        path,
        bytes: webp(100, 100, 2 * MiB + 1),
        contentType: "image/webp",
        cacheControl: "public, max-age=31536000, immutable",
      }),
    ).rejects.toMatchObject({ failureCode: "storage_failed" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("treats missing delete objects as success and never follows credentialed redirects", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ message: "Successfully deleted" }));
    const store = createSupabaseMediaObjectStore({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "server-secret",
      fetcher,
    });
    const path = buildOrgMediaObjectPath("robotics-club", "gallery", uploadId);

    await expect(store.delete(path)).resolves.toBe("missing");
    await expect(store.delete(path)).resolves.toBe("deleted");
    for (const call of fetcher.mock.calls) {
      expect(String(call[0])).toBe("https://project.supabase.co/storage/v1/object/org-media");
      expect(call[1]?.method).toBe("DELETE");
      expect(call[1]?.redirect).toBe("error");
      expect(new Headers(call[1]?.headers).get("content-type")).toBe("application/json");
      expect(call[1]?.body).toBe(JSON.stringify({ prefixes: [path] }));
    }
  });
});

describe("Instagram permalink and provider isolation", () => {
  it.each([
    [
      "https://instagram.com/p/Abc_123-/?utm_source=share&igsh=abc",
      "https://www.instagram.com/p/Abc_123-/",
    ],
    ["https://www.instagram.com/reel/xyz/", "https://www.instagram.com/reel/xyz/"],
  ])("canonicalizes the exact public post/reel URL corpus", (input, expected) => {
    expect(canonicalizeInstagramPermalink(input)).toBe(expected);
  });

  it.each([
    "http://instagram.com/p/a/",
    "https://evil.example/p/a/",
    "https://instagram.com.evil.example/p/a/",
    "https://user@instagram.com/p/a/",
    "https://instagram.com:444/p/a/",
    "https://instagram.com:443/p/a/",
    "https://instagram.com/p/a/#fragment",
    "https://instagram.com/p/a/?next=https://evil.example",
    "https://instagram.com/p/a/?utm_source=x&utm_source=y",
    "https://instagram.com/%70/a/",
    "https://instagram.com/p/a/extra",
    "https://instagram.com/stories/a/1/",
    "https://instagram.com/profile/",
    " https://instagram.com/p/a/",
    "https://instagram.com/p/a/ ",
    "https://instagram.com\\p\\a",
    "https:\\instagram.com\\p\\a",
  ])("rejects SSRF, tracking ambiguity, and non-post URL %s", (input) => {
    expect(() => canonicalizeInstagramPermalink(input)).toThrow(OrgAssetServiceError);
  });

  it("makes zero Graph calls when disabled, unconfigured, or version-mismatched", async () => {
    const fetcher = vi.fn();
    for (const client of [
      createInstagramOEmbedClient({ enabled: false, fetcher }),
      createInstagramOEmbedClient({ enabled: true, accessToken: undefined, fetcher }),
      createInstagramOEmbedClient({ enabled: true, accessToken: "   ", fetcher }),
      createInstagramOEmbedClient({
        enabled: true,
        accessToken: "secret",
        graphVersion: "v27.0",
        fetcher,
      }),
    ]) {
      await expect(client.fetch("https://www.instagram.com/p/abc/")).resolves.toEqual({
        kind: "link_only",
        errorCode: "provider_unconfigured",
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("calls only Graph v26 and returns a bounded safe fragment without exposing the token", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        html: '<blockquote class="instagram-media"><a href="https://www.instagram.com/p/abc/">x</a></blockquote>',
        author_name: "Brown Robotics",
        provider_name: "Instagram",
        provider_url: "https://www.instagram.com/",
        title: "Photo",
        type: "rich",
        version: "1.0",
        width: 658,
        thumbnail_url: "https://scontent.cdninstagram.com/image.jpg",
      }),
    );
    const client = createInstagramOEmbedClient({
      enabled: true,
      accessToken: "never-log-this-token",
      graphVersion: "v26.0",
      fetcher,
    });

    const result = await client.fetch("https://www.instagram.com/p/abc/");

    expect(result).toEqual({
      kind: "ready",
      renderHtml:
        '<blockquote class="instagram-media"><a href="https://www.instagram.com/p/abc/">x</a></blockquote>',
      attribution: "Brown Robotics",
    });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    const init = fetcher.mock.calls[0]?.[1];
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://graph.facebook.com/v26.0/instagram_oembed",
    );
    expect(url.searchParams.get("url")).toBe("https://www.instagram.com/p/abc/");
    expect(url.searchParams.get("omitscript")).toBe("true");
    expect(url.searchParams.get("access_token")).toBe("never-log-this-token");
    expect(init).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    expect(JSON.stringify(result)).not.toContain("never-log-this-token");
  });

  it.each([
    [400, { error: { code: 190, message: "token text" } }],
    [403, { error: { code: 200, message: "permission" } }],
    [429, { error: { code: 368, message: "throttled" } }],
    [200, { html: "<script>steal()</script>", author_name: "bad" }],
    [200, { html: "x".repeat(50_001), author_name: "too large" }],
    [200, { malformed: true }],
  ])("degrades Graph status %s or malformed payload to a safe link card", async (status, body) => {
    const fetcher = vi.fn(async () => Response.json(body, { status }));
    const result = await createInstagramOEmbedClient({
      enabled: true,
      accessToken: "secret",
      fetcher,
    }).fetch("https://www.instagram.com/p/abc/");

    expect(result.kind).toBe("link_only");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("token text");
  });

  it("bounds the provider body before JSON parsing and rejects active/phishing nested markup", async () => {
    const oversizedFetcher = vi.fn(
      async () =>
        new Response(new Uint8Array(100_001), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const oversized = await createInstagramOEmbedClient({
      enabled: true,
      accessToken: "secret",
      fetcher: oversizedFetcher,
    }).fetch("https://www.instagram.com/p/abc/");
    expect(oversized).toEqual({ kind: "link_only", errorCode: "provider_invalid" });

    for (const html of [
      '<blockquote><form action="https://evil.example"><input></form></blockquote>',
      '<blockquote><base href="https://evil.example/"><a href="/x">x</a></blockquote>',
      '<blockquote><a href="javascript:alert(1)">x</a></blockquote>',
      '<blockquote><a href="java&#x73;cript:alert(1)">x</a></blockquote>',
      '<blockquote><a href="https://evil.example/">x</a></blockquote>',
      '<blockquote><span style="background:url(javascript:alert(1))">x</span></blockquote>',
    ]) {
      const fetcher = vi.fn(async () => Response.json({ html, author_name: "bad" }));
      await expect(
        createInstagramOEmbedClient({
          enabled: true,
          accessToken: "secret",
          fetcher,
        }).fetch("https://www.instagram.com/p/abc/"),
      ).resolves.toEqual({ kind: "link_only", errorCode: "provider_invalid" });
    }
  });

  it("normalizes only an exact HTTPS embed origin", () => {
    expect(normalizeEmbedOrigin("https://embed.brownsync.app/")).toBe(
      "https://embed.brownsync.app",
    );
    for (const input of [
      undefined,
      "http://embed.brownsync.app",
      "https://user@embed.brownsync.app",
      "https://embed.brownsync.app/path",
      "not a url",
    ]) {
      expect(normalizeEmbedOrigin(input)).toBeNull();
    }
  });
});
