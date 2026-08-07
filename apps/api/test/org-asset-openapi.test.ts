import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument, createApp } from "../src/app";

type JsonRecord = Record<string, unknown>;

const here = path.dirname(fileURLToPath(import.meta.url));
const canonicalPath = path.resolve(here, "../../../packages/contract/openapi.json");
const iosPath = path.resolve(
  here,
  "../../ios/packages/BrownSyncAPI/Sources/BrownSyncAPI/openapi.json",
);
const baseline = JSON.parse(
  readFileSync(path.resolve(here, "fixtures/task-5e-openapi-baseline.json"), "utf8"),
) as {
  operations: Record<string, string>;
  schemas: Record<string, string>;
  securitySchemes: Record<string, string>;
};
const intentionalPostTask5ESchemaDrift: Record<string, string> = {
  OrgEditRequest: "8ecd5e70c4a0fb81b2b2353efaf4da9ac1a98bb3dd824dda365fab02845cb280",
  UserEventCreateRequest: "81c45dedac1d04e3e7ae26bb0635facf5f10e16f0799dcb59f2ef69cc1615c5d",
  UserEventEditRequest: "b202246ee1a20b024c8df608063bb6c5eef90a51398f369a6ce33d316ad9a54b",
};
const committed = JSON.parse(readFileSync(canonicalPath, "utf8")) as JsonRecord;
const stub = new Proxy({} as never, {
  get(_target, property) {
    throw new Error(`OpenAPI emission touched a dependency (${String(property)})`);
  },
});
const fresh = buildOpenApiDocument(createApp(stub)) as unknown as JsonRecord;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function operation(document: JsonRecord, route: string, method: string): JsonRecord {
  const paths = document.paths as JsonRecord;
  return ((paths[route] as JsonRecord | undefined)?.[method] ?? {}) as JsonRecord;
}

function statuses(document: JsonRecord, route: string, method: string): string[] {
  return Object.keys(operation(document, route, method).responses as JsonRecord).sort();
}

function documentReferences(document: JsonRecord): string[] {
  const references: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value as JsonRecord)) {
      if (key === "$ref" && typeof nested === "string") references.push(nested);
      else visit(nested);
    }
  };
  visit(document);
  return references;
}

function resolveLocalReference(document: JsonRecord, reference: string): unknown {
  if (!reference.startsWith("#/")) return undefined;
  let current: unknown = document;
  for (const rawSegment of reference.slice(2).split("/")) {
    if (current === null || typeof current !== "object") return undefined;
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!Object.hasOwn(current, segment)) return undefined;
    current = (current as JsonRecord)[segment];
  }
  return current;
}

describe("organization asset OpenAPI and Swift snapshot", () => {
  const routes = [
    ["/api/orgs/{id}/media", "get", "getOrganizationMedia", ["200", "400", "404", "429", "503"]],
    [
      "/api/orgs/{id}/media/uploads",
      "post",
      "reserveOrganizationMediaUpload",
      ["201", "400", "401", "403", "404", "409", "429", "503"],
    ],
    [
      "/api/org-media/uploads/{uploadId}",
      "put",
      "uploadOrganizationMedia",
      ["201", "400", "401", "403", "404", "409", "413", "415", "422", "429", "503"],
    ],
    [
      "/api/orgs/{id}/media/{mediaId}",
      "delete",
      "deleteOrganizationMedia",
      ["200", "400", "401", "403", "404", "409", "429", "503"],
    ],
    [
      "/api/orgs/{id}/media/gallery",
      "patch",
      "reorderOrganizationGallery",
      ["200", "400", "401", "403", "404", "409", "429", "503"],
    ],
    [
      "/api/orgs/{id}/social-posts",
      "get",
      "listOrganizationSocialPosts",
      ["200", "400", "404", "429", "503"],
    ],
    [
      "/api/orgs/{id}/social-posts",
      "post",
      "addOrganizationSocialPost",
      ["201", "400", "401", "403", "404", "409", "429", "503"],
    ],
    [
      "/api/orgs/{id}/social-posts/{postId}/refresh",
      "post",
      "refreshOrganizationSocialPost",
      ["200", "400", "401", "403", "404", "409", "429", "503"],
    ],
    [
      "/api/orgs/{id}/social-posts/{postId}",
      "delete",
      "deleteOrganizationSocialPost",
      ["200", "400", "401", "403", "404", "409", "429", "503"],
    ],
    [
      "/api/social-posts/{postId}/embed",
      "get",
      "getOrganizationSocialEmbed",
      ["200", "404", "429", "503"],
    ],
  ] as const;

  it.each(routes)(
    "publishes exact operation %s %s and documented status surface",
    (route, method, id, expected) => {
      expect(operation(committed, route, method).operationId).toBe(id);
      expect(statuses(committed, route, method)).toEqual([...expected].sort());
    },
  );

  it("protects mutations while keeping public JSON and isolated embed reads anonymous", () => {
    for (const [route, method] of routes) {
      const protectedOperation = ["post", "put", "patch", "delete"].includes(method);
      if (protectedOperation) {
        expect(operation(committed, route, method).security).toEqual([{ bearerAuth: [] }]);
      } else {
        expect(operation(committed, route, method)).not.toHaveProperty("security");
      }
    }
  });

  it("documents the raw upload as exactly three binary media types and leaves refresh bodyless", () => {
    const upload = operation(committed, "/api/org-media/uploads/{uploadId}", "put");
    const requestBody = upload.requestBody as JsonRecord;
    const content = requestBody.content as JsonRecord;
    expect(Object.keys(content).sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
    for (const media of Object.values(content) as JsonRecord[]) {
      expect(media.schema).toEqual({ type: "string", format: "binary" });
    }
    expect(
      operation(committed, "/api/orgs/{id}/social-posts/{postId}/refresh", "post"),
    ).not.toHaveProperty("requestBody");
  });

  it("keeps public schemas named, strict, nonnullable, and free of internal state", () => {
    const schemas = (committed.components as JsonRecord).schemas as JsonRecord;
    for (const name of [
      "OrgMediaKind",
      "OrgMediaAsset",
      "NullableOrgMediaAsset",
      "OrgMediaCollection",
      "OrgMediaUploadReservationRequest",
      "OrgMediaUploadReservation",
      "OrgMediaUploadResult",
      "OrgMediaMutationRequest",
      "OrgMediaMutationResult",
      "OrgGalleryReorderRequest",
      "OrgGalleryReorderResult",
      "OrgSocialRenderMode",
      "OrgSocialPost",
      "OrgSocialPostCollection",
      "OrgSocialPostCreateRequest",
      "OrgSocialPostCreateResult",
      "OrgSocialPostRefreshResult",
      "OrgSocialPostDeleteRequest",
      "OrgSocialPostDeleteResult",
    ]) {
      expect(schemas[name], name).toBeDefined();
    }
    expect((schemas.OrgMediaAsset as JsonRecord).type).toBe("object");
    const nullableAsset = schemas.NullableOrgMediaAsset as JsonRecord;
    const nullableAssetProperties = nullableAsset.properties as JsonRecord;
    expect(nullableAsset.type).toEqual(["object", "null"]);
    expect((nullableAssetProperties.position as JsonRecord).type).toEqual(["integer", "null"]);
    expect(nullableAssetProperties.position).not.toHaveProperty("anyOf");
    const serialized = JSON.stringify(
      Object.fromEntries(
        Object.entries(schemas).filter(
          ([name]) =>
            name.startsWith("OrgMedia") ||
            name.startsWith("OrgSocial") ||
            name.startsWith("OrgGallery"),
        ),
      ),
    );
    for (const secret of [
      "objectPath",
      "renderHtml",
      "leaseToken",
      "providerError",
      "actorId",
      "accessToken",
      "failureCode",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("emits only canonical local schema references across the full document", () => {
    const prefix = "#/components/schemas/";
    const references = documentReferences(fresh);

    expect(references.filter((reference) => !reference.startsWith(prefix))).toEqual([]);
    expect(
      references.filter((reference) => resolveLocalReference(fresh, reference) === undefined),
    ).toEqual([]);
  });

  it("preserves the pre-Task-5E surface except the exact pinned nullable-contract remedy", () => {
    const paths = fresh.paths as JsonRecord;
    for (const [key, expected] of Object.entries(baseline.operations)) {
      const space = key.indexOf(" ");
      const method = key.slice(0, space).toLowerCase();
      const route = key.slice(space + 1);
      expect(hash((paths[route] as JsonRecord)?.[method]), key).toBe(expected);
    }
    const components = fresh.components as JsonRecord;
    const schemas = components.schemas as JsonRecord;
    const securitySchemes = components.securitySchemes as JsonRecord;
    const schemaDrift = new Map<string, string>();
    for (const [name, expected] of Object.entries(baseline.schemas)) {
      const actual = hash(schemas[name]);
      if (actual !== expected) schemaDrift.set(name, actual);
    }
    expect([...schemaDrift.keys()].sort()).toEqual(
      Object.keys(intentionalPostTask5ESchemaDrift).sort(),
    );
    for (const [name, actual] of schemaDrift) {
      expect(actual, name).toBe(intentionalPostTask5ESchemaDrift[name]);
    }
    for (const [name, expected] of Object.entries(baseline.securitySchemes)) {
      expect(hash(securitySchemes[name]), name).toBe(expected);
    }
  });

  it("keeps the emitted document synchronized and the iOS snapshot byte-identical", () => {
    expect(committed).toEqual(JSON.parse(JSON.stringify(fresh)));
    expect(readFileSync(iosPath)).toEqual(readFileSync(canonicalPath));
  });
});
