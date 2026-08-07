import type { OrgMediaKind } from "@brownsync/contract";

const MAX_INPUT_BYTES = 8_388_608;
const MAX_OUTPUT_BYTES = 2_097_152;
const MAX_DIMENSION = 12_000;
const MAX_PIXELS = 40_000_000;
const INSTAGRAM_PATH = /^\/(p|reel)\/([A-Za-z0-9_-]{1,64})\/?$/;
const SAFE_TRACKING_KEYS = new Set([
  "igsh",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
]);
const MEDIA_PATH =
  /^org\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(avatar|banner|gallery)\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})[.]webp$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CACHE_CONTROL = "public, max-age=31536000, immutable" as const;

type UploadContentType = "image/jpeg" | "image/png" | "image/webp";
type ImageFormat = "jpeg" | "png" | "webp";

export class OrgAssetServiceError extends Error {
  readonly status: number;
  readonly failureCode: string;

  constructor(status: number, failureCode: string, message = "Organization asset request failed.") {
    super(message);
    this.name = "OrgAssetServiceError";
    this.status = status;
    this.failureCode = failureCode;
  }
}

export interface ImageProcessor {
  process(input: {
    stream: ReadableStream<Uint8Array>;
    declaredContentType: UploadContentType;
    declaredLength: number | null;
    kind: OrgMediaKind;
  }): Promise<{
    bytes: Uint8Array;
    width: number;
    height: number;
    byteSize: number;
    contentType: "image/webp";
  }>;
}

type ImagesInfo = {
  format?: string;
  width?: number;
  height?: number;
};

type ImagesOutput = Response | { response(): Response | Promise<Response> };

export interface CloudflareImagesBinding {
  info(stream: ReadableStream<Uint8Array>): Promise<ImagesInfo>;
  input(stream: ReadableStream<Uint8Array>): {
    transform(options: { width: number; height: number; fit: "scale-down"; metadata: "none" }): {
      output(options: { format: "image/webp"; quality: 82; anim: false }): Promise<ImagesOutput>;
    };
  };
}

export interface MediaObjectStore {
  putImmutable(input: {
    path: string;
    bytes: Uint8Array;
    contentType: "image/webp";
    cacheControl: typeof CACHE_CONTROL;
  }): Promise<{ publicUrl: string }>;
  delete(path: string): Promise<"deleted" | "missing">;
}

export interface InstagramOEmbedClient {
  fetch(
    permalink: string,
  ): Promise<
    | { kind: "ready"; renderHtml: string; attribution: string | null }
    | { kind: "link_only"; errorCode: string }
  >;
}

export interface MediaCleanupScheduler {
  wake(): void;
}

export interface Clock {
  now(): Date;
}

export interface IdFactory {
  uuid(): string;
}

function bytesToAscii(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  return prefix.every((value, index) => bytes[offset + index] === value);
}

function classifyImage(bytes: Uint8Array): ImageFormat {
  if (
    bytes.length >= 24 &&
    hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) &&
    hasPrefix(bytes, [0x49, 0x48, 0x44, 0x52], 12)
  ) {
    return "png";
  }
  if (bytes.length >= 4 && hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return "jpeg";
  }
  if (
    bytes.length >= 30 &&
    hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    hasPrefix(bytes, [0x57, 0x45, 0x42, 0x50], 8) &&
    (hasPrefix(bytes, [0x56, 0x50, 0x38, 0x20], 12) ||
      hasPrefix(bytes, [0x56, 0x50, 0x38, 0x4c], 12) ||
      hasPrefix(bytes, [0x56, 0x50, 0x38, 0x58], 12))
  ) {
    return "webp";
  }

  const prefix = bytesToAscii(bytes.slice(0, 64)).trimStart().toLowerCase();
  if (prefix.startsWith("<svg") || prefix.startsWith("<?xml")) {
    throw new OrgAssetServiceError(422, "invalid_image");
  }
  if (
    hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38]) ||
    (bytes.length >= 12 &&
      hasPrefix(bytes, [0x66, 0x74, 0x79, 0x70], 4) &&
      ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "avif", "avis"].includes(
        bytesToAscii(bytes.slice(8, 12)),
      ))
  ) {
    throw new OrgAssetServiceError(415, "unsupported_media_type");
  }
  throw new OrgAssetServiceError(422, "invalid_image");
}

function expectedFormat(contentType: UploadContentType): ImageFormat {
  if (contentType === "image/jpeg") return "jpeg";
  if (contentType === "image/png") return "png";
  return "webp";
}

function rejectPolyglot(bytes: Uint8Array): void {
  const ascii = bytesToAscii(bytes).toLowerCase();
  if (
    ascii.includes("<script") ||
    ascii.includes("<svg") ||
    ascii.includes("<?xml") ||
    ascii.includes("<!doctype html")
  ) {
    throw new OrgAssetServiceError(422, "invalid_image");
  }
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  maximum: number,
  overflowCode: string,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength === 0) continue;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new OrgAssetServiceError(413, overflowCode);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function streamFrom(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function validateInfo(
  info: ImagesInfo,
  inputFormat: ImageFormat,
): {
  width: number;
  height: number;
} {
  if (info.format?.toLowerCase() !== inputFormat) {
    throw new OrgAssetServiceError(415, "unsupported_media_type");
  }
  if (
    typeof info.width !== "number" ||
    !Number.isInteger(info.width) ||
    info.width <= 0 ||
    typeof info.height !== "number" ||
    !Number.isInteger(info.height) ||
    info.height <= 0
  ) {
    throw new OrgAssetServiceError(422, "invalid_image");
  }
  if (info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) {
    throw new OrgAssetServiceError(413, "dimension_limit");
  }
  if (info.width * info.height > MAX_PIXELS) {
    throw new OrgAssetServiceError(413, "pixel_limit");
  }
  return { width: info.width, height: info.height };
}

const geometry: Record<OrgMediaKind, { width: number; height: number }> = {
  avatar: { width: 1024, height: 1024 },
  banner: { width: 1920, height: 1080 },
  gallery: { width: 1920, height: 1920 },
};

async function outputResponse(output: ImagesOutput): Promise<Response> {
  if (output instanceof Response) return output;
  return output.response();
}

export function parseUploadContentLength(header: string | null): number | null {
  if (header === null) return null;
  if (!/^(0|[1-9][0-9]*)$/.test(header)) {
    throw new OrgAssetServiceError(400, "invalid_image");
  }
  const length = Number(header);
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_INPUT_BYTES) {
    throw new OrgAssetServiceError(413, "input_too_large");
  }
  return length;
}

export function createCloudflareImageProcessor(binding: CloudflareImagesBinding): ImageProcessor {
  return {
    async process(input) {
      const bytes = await readBoundedStream(input.stream, MAX_INPUT_BYTES, "input_too_large");
      if (bytes.byteLength === 0) throw new OrgAssetServiceError(422, "invalid_image");
      if (input.declaredLength !== null && input.declaredLength !== bytes.byteLength) {
        throw new OrgAssetServiceError(422, "invalid_image");
      }
      const magicFormat = classifyImage(bytes);
      if (magicFormat !== expectedFormat(input.declaredContentType)) {
        throw new OrgAssetServiceError(415, "unsupported_media_type");
      }
      rejectPolyglot(bytes);

      let sourceInfo: ImagesInfo;
      try {
        sourceInfo = await binding.info(streamFrom(bytes));
      } catch {
        throw new OrgAssetServiceError(422, "invalid_image");
      }
      validateInfo(sourceInfo, magicFormat);

      let transformedResponse: Response;
      try {
        const target = geometry[input.kind];
        const output = await binding
          .input(streamFrom(bytes))
          .transform({
            width: target.width,
            height: target.height,
            fit: "scale-down",
            metadata: "none",
          })
          .output({ format: "image/webp", quality: 82, anim: false });
        transformedResponse = await outputResponse(output);
      } catch (error) {
        if (error instanceof OrgAssetServiceError) throw error;
        throw new OrgAssetServiceError(422, "transform_failed");
      }
      if (transformedResponse.headers.get("Content-Type")?.toLowerCase() !== "image/webp") {
        throw new OrgAssetServiceError(422, "transform_failed");
      }
      if (transformedResponse.body === null) {
        throw new OrgAssetServiceError(422, "transform_failed");
      }
      const transformed = await readBoundedStream(
        transformedResponse.body,
        MAX_OUTPUT_BYTES,
        "output_too_large",
      );
      let outputFormat: ImageFormat;
      try {
        outputFormat = classifyImage(transformed);
      } catch (error) {
        if (error instanceof OrgAssetServiceError && error.status === 413) throw error;
        throw new OrgAssetServiceError(422, "transform_failed");
      }
      if (outputFormat !== "webp") throw new OrgAssetServiceError(422, "transform_failed");

      let transformedInfo: ImagesInfo;
      try {
        transformedInfo = await binding.info(streamFrom(transformed));
      } catch {
        throw new OrgAssetServiceError(422, "transform_failed");
      }
      let dimensions: { width: number; height: number };
      try {
        dimensions = validateInfo(transformedInfo, "webp");
      } catch {
        throw new OrgAssetServiceError(422, "transform_failed");
      }
      const target = geometry[input.kind];
      if (dimensions.width > target.width || dimensions.height > target.height) {
        throw new OrgAssetServiceError(422, "transform_failed");
      }
      return {
        bytes: transformed,
        width: dimensions.width,
        height: dimensions.height,
        byteSize: transformed.byteLength,
        contentType: "image/webp" as const,
      };
    },
  };
}

export function buildOrgMediaObjectPath(
  organizationId: string,
  kind: OrgMediaKind,
  uploadId: string,
): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organizationId) || !UUID_V4.test(uploadId)) {
    throw new OrgAssetServiceError(400, "invalid_image");
  }
  return `org/${organizationId}/${kind}/${uploadId}.webp`;
}

function assertMediaPath(path: string): void {
  if (!MEDIA_PATH.test(path)) throw new OrgAssetServiceError(400, "storage_failed");
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function normalizeSupabaseOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OrgAssetServiceError(503, "storage_unavailable");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new OrgAssetServiceError(503, "storage_unavailable");
  }
  return url.origin;
}

export function createSupabaseMediaObjectStore(options: {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetcher?: Fetcher;
}): MediaObjectStore {
  const origin = normalizeSupabaseOrigin(options.supabaseUrl);
  if (options.serviceRoleKey.length === 0) {
    throw new OrgAssetServiceError(503, "storage_unavailable");
  }
  const fetcher = options.fetcher ?? fetch;
  const headers = (contentType?: "image/webp", cacheControl?: typeof CACHE_CONTROL) => {
    const value = new Headers({
      apikey: options.serviceRoleKey,
      Authorization: `Bearer ${options.serviceRoleKey}`,
    });
    if (contentType !== undefined) value.set("Content-Type", contentType);
    if (cacheControl !== undefined) value.set("Cache-Control", cacheControl);
    return value;
  };

  return {
    async putImmutable(input) {
      assertMediaPath(input.path);
      if (input.contentType !== "image/webp" || input.cacheControl !== CACHE_CONTROL) {
        throw new OrgAssetServiceError(503, "storage_failed");
      }
      try {
        if (
          input.bytes.byteLength < 1 ||
          input.bytes.byteLength > MAX_OUTPUT_BYTES ||
          classifyImage(input.bytes) !== "webp"
        ) {
          throw new Error("invalid processed object");
        }
        rejectPolyglot(input.bytes);
      } catch {
        throw new OrgAssetServiceError(503, "storage_failed");
      }
      const requestHeaders = headers(input.contentType, input.cacheControl);
      requestHeaders.set("x-upsert", "false");
      let response: Response;
      try {
        response = await fetcher(`${origin}/storage/v1/object/org-media/${input.path}`, {
          method: "POST",
          headers: requestHeaders,
          body: input.bytes,
          redirect: "error",
        });
      } catch {
        throw new OrgAssetServiceError(503, "storage_unavailable");
      }
      if (!response.ok) throw new OrgAssetServiceError(503, "storage_failed");
      return {
        publicUrl: `${origin}/storage/v1/object/public/org-media/${input.path}`,
      };
    },
    async delete(path) {
      assertMediaPath(path);
      const requestHeaders = headers();
      requestHeaders.set("Content-Type", "application/json");
      let response: Response;
      try {
        response = await fetcher(`${origin}/storage/v1/object/org-media`, {
          method: "DELETE",
          headers: requestHeaders,
          body: JSON.stringify({ prefixes: [path] }),
          redirect: "error",
        });
      } catch {
        throw new OrgAssetServiceError(503, "storage_unavailable");
      }
      if (response.status === 404) return "missing";
      if (!response.ok) throw new OrgAssetServiceError(503, "storage_failed");
      return "deleted";
    },
  };
}

export function canonicalizeInstagramPermalink(input: string): string {
  if (
    input.length < 1 ||
    input.length > 2048 ||
    input.trim() !== input ||
    !input.startsWith("https://") ||
    input.includes("\\")
  ) {
    throw new OrgAssetServiceError(400, "permalink_invalid");
  }
  const authority = input.slice("https://".length).split(/[/?#]/, 1)[0] ?? "";
  if (authority.includes(":")) throw new OrgAssetServiceError(400, "permalink_invalid");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new OrgAssetServiceError(400, "permalink_invalid");
  }
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "instagram.com" && url.hostname !== "www.instagram.com") ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.pathname.includes("%")
  ) {
    throw new OrgAssetServiceError(400, "permalink_invalid");
  }
  const path = INSTAGRAM_PATH.exec(url.pathname);
  if (path === null) throw new OrgAssetServiceError(400, "permalink_invalid");
  const seen = new Set<string>();
  for (const [key] of url.searchParams) {
    if (!SAFE_TRACKING_KEYS.has(key) || seen.has(key)) {
      throw new OrgAssetServiceError(400, "permalink_invalid");
    }
    seen.add(key);
  }
  return `https://www.instagram.com/${path[1]}/${path[2]}/`;
}

function safeInstagramHref(value: string): string | null {
  if (
    value.length < 1 ||
    value.length > 2048 ||
    value.trim() !== value ||
    !value.startsWith("https://") ||
    value.includes("\\") ||
    value.includes("&#") ||
    value.includes("&colon;")
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      (url.hostname !== "instagram.com" && url.hostname !== "www.instagram.com") ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== ""
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function sanitizeTagAttributes(tag: string, source: string): string | null {
  if (source.trim() === "") return "";
  const allowed: string[] = [];
  const matcher = /\s+([A-Za-z][A-Za-z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy;
  let offset = 0;
  while (offset < source.length) {
    matcher.lastIndex = offset;
    const match = matcher.exec(source);
    if (match === null || match.index !== offset) return null;
    offset = matcher.lastIndex;
    const name = (match[1] ?? "").toLowerCase();
    const value = match[2] ?? match[3] ?? "";
    if (name === "class" && /^[A-Za-z0-9 _-]{1,200}$/.test(value)) {
      allowed.push(`class="${escapeAttribute(value)}"`);
      continue;
    }
    if (tag === "a" && name === "href") {
      const href = safeInstagramHref(value);
      if (href === null) return null;
      allowed.push(`href="${escapeAttribute(href)}"`);
      continue;
    }
    if (tag === "a" && name === "target" && value === "_blank") {
      allowed.push('target="_blank"');
      continue;
    }
    if (
      tag === "a" &&
      name === "rel" &&
      value.split(/\s+/).every((token) => ["nofollow", "noopener", "noreferrer"].includes(token))
    ) {
      allowed.push(`rel="${escapeAttribute(value)}"`);
      continue;
    }
    if (tag === "blockquote" && name === "data-instgrm-permalink") {
      try {
        allowed.push(
          `data-instgrm-permalink="${escapeAttribute(canonicalizeInstagramPermalink(value))}"`,
        );
      } catch {
        return null;
      }
      continue;
    }
    if (tag === "blockquote" && name === "data-instgrm-version" && /^[0-9]{1,3}$/.test(value)) {
      allowed.push(`data-instgrm-version="${value}"`);
      continue;
    }
    return null;
  }
  return allowed.length === 0 ? "" : ` ${allowed.join(" ")}`;
}

function sanitizeInstagramHtml(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const html = value.trim();
  if (html.length < 1 || html.length > 50_000) return null;
  const allowedTags = new Set(["blockquote", "a", "div", "p", "span"]);
  const stack: string[] = [];
  const output: string[] = [];
  const tags = /<[^>]*>/g;
  let offset = 0;
  for (const match of html.matchAll(tags)) {
    const index = match.index;
    if (index === undefined) return null;
    output.push(html.slice(offset, index));
    offset = index + match[0].length;
    const closing = /^<\/([A-Za-z]+)\s*>$/.exec(match[0]);
    if (closing !== null) {
      const tag = (closing[1] ?? "").toLowerCase();
      if (stack.pop() !== tag) return null;
      output.push(`</${tag}>`);
      continue;
    }
    const opening = /^<([A-Za-z]+)([\s\S]*)>$/.exec(match[0]);
    if (opening === null) return null;
    const tag = (opening[1] ?? "").toLowerCase();
    if (!allowedTags.has(tag)) return null;
    const attributes = sanitizeTagAttributes(tag, opening[2] ?? "");
    if (attributes === null) return null;
    stack.push(tag);
    output.push(`<${tag}${attributes}>`);
  }
  output.push(html.slice(offset));
  if (stack.length !== 0) return null;
  const sanitized = output.join("");
  if (!sanitized.startsWith("<blockquote") || !sanitized.endsWith("</blockquote>")) return null;
  return sanitized;
}

export function createInstagramOEmbedClient(options: {
  enabled?: boolean;
  accessToken?: string;
  graphVersion?: string;
  fetcher?: Fetcher;
}): InstagramOEmbedClient {
  const configured =
    options.enabled === true &&
    typeof options.accessToken === "string" &&
    options.accessToken.trim().length > 0 &&
    (options.graphVersion ?? "v26.0") === "v26.0";
  if (!configured) {
    return {
      async fetch() {
        return { kind: "link_only", errorCode: "provider_unconfigured" };
      },
    };
  }
  const fetcher = options.fetcher ?? fetch;
  const accessToken = options.accessToken as string;

  return {
    async fetch(permalink) {
      const canonical = canonicalizeInstagramPermalink(permalink);
      const url = new URL("https://graph.facebook.com/v26.0/instagram_oembed");
      url.searchParams.set("url", canonical);
      url.searchParams.set("omitscript", "true");
      url.searchParams.set("access_token", accessToken);
      let response: Response;
      try {
        response = await fetcher(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          redirect: "error",
        });
      } catch {
        return { kind: "link_only", errorCode: "provider_unavailable" };
      }
      if (!response.ok) {
        return { kind: "link_only", errorCode: "provider_unavailable" };
      }
      const length = response.headers.get("Content-Length");
      if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > 100_000)) {
        return { kind: "link_only", errorCode: "provider_invalid" };
      }
      let body: unknown;
      try {
        if (response.body === null) throw new Error("missing body");
        const bytes = await readBoundedStream(response.body, 100_000, "provider_invalid");
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return { kind: "link_only", errorCode: "provider_invalid" };
      }
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return { kind: "link_only", errorCode: "provider_invalid" };
      }
      const record = body as Record<string, unknown>;
      const renderHtml = sanitizeInstagramHtml(record.html);
      if (renderHtml === null) {
        return { kind: "link_only", errorCode: "provider_invalid" };
      }
      const rawAttribution = record.author_name;
      const attribution =
        typeof rawAttribution === "string" &&
        rawAttribution.trim().length > 0 &&
        rawAttribution.trim().length <= 200
          ? rawAttribution.trim()
          : null;
      return { kind: "ready", renderHtml, attribution };
    },
  };
}

export function normalizeEmbedOrigin(value: string | undefined): string | null {
  if (value === undefined) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  return url.origin;
}

export const ORG_MEDIA_CACHE_CONTROL = CACHE_CONTROL;
export const ORG_MEDIA_MAX_INPUT_BYTES = MAX_INPUT_BYTES;
export const ORG_MEDIA_MAX_OUTPUT_BYTES = MAX_OUTPUT_BYTES;
