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
const committed = JSON.parse(readFileSync(canonicalPath, "utf8")) as JsonRecord;
const stub = new Proxy({} as never, {
  get(_target, property) {
    throw new Error(`OpenAPI emission must not touch the database (${String(property)})`);
  },
});
const fresh = buildOpenApiDocument(createApp(stub)) as unknown as JsonRecord;

function paths(document: JsonRecord): JsonRecord {
  return document.paths as JsonRecord;
}

function operation(document: JsonRecord, route: string, method: string): JsonRecord {
  return ((paths(document)[route] as JsonRecord | undefined)?.[method] ?? {}) as JsonRecord;
}

function responseRef(document: JsonRecord, route: string, method: string, status: string): unknown {
  const responses = operation(document, route, method).responses as JsonRecord;
  const response = responses?.[status] as JsonRecord;
  const content = response?.content as JsonRecord;
  const media = content?.["application/json"] as JsonRecord;
  const schema = media?.schema as JsonRecord;
  return schema?.$ref;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

describe("student-event OpenAPI and Swift snapshot", () => {
  it.each([
    ["/api/events", "48d3cc1e278a16ba1b9fac12a7c96f2ad883e6a844d1c328a362de3c1488fab3"],
    ["/api/events/{id}", "a6c696b00851772c79950241d19f93094d66fe86803a293f324f71a3ad17671d"],
  ])("preserves the public GET operation at %s exactly", (route, expected) => {
    expect(hash(operation(committed, route, "get"))).toBe(expected);
    expect(hash(operation(fresh, route, "get"))).toBe(expected);
  });

  it.each([
    ["/api/events", "post", "createUserEvent", "201", "UserEventCreateResult"],
    ["/api/events/{id}", "patch", "updateUserEvent", "200", "UserEventMutationResult"],
    ["/api/events/{id}", "delete", "deleteUserEvent", "200", "UserEventMutationResult"],
    ["/api/me/events", "get", "listMyUserEvents", "200", "MyUserEvents"],
    ["/api/me/events/{id}", "get", "getMyUserEvent", "200", "UserEventManagement"],
  ])(
    "publishes named protected operation %s %s",
    (route, method, operationId, status, component) => {
      const op = operation(committed, route, method);
      expect(op.operationId).toBe(operationId);
      expect(op.security).toEqual([{ bearerAuth: [] }]);
      expect(responseRef(committed, route, method, status)).toBe(
        `#/components/schemas/${component}`,
      );
    },
  );

  it("uses strict named request components and keeps delete bodyless and revision-free", () => {
    const create = operation(committed, "/api/events", "post");
    const edit = operation(committed, "/api/events/{id}", "patch");
    const remove = operation(committed, "/api/events/{id}", "delete");
    const createBody = create.requestBody as JsonRecord;
    const editBody = edit.requestBody as JsonRecord;
    const createContent = createBody?.content as JsonRecord;
    const editContent = editBody?.content as JsonRecord;

    expect(((createContent?.["application/json"] as JsonRecord)?.schema as JsonRecord)?.$ref).toBe(
      "#/components/schemas/UserEventCreateRequest",
    );
    expect(((editContent?.["application/json"] as JsonRecord)?.schema as JsonRecord)?.$ref).toBe(
      "#/components/schemas/UserEventEditRequest",
    );
    expect(remove).not.toHaveProperty("requestBody");
    expect(JSON.stringify(remove)).not.toContain("expectedRevision");
  });

  it("documents 422 only on location-resolving create/edit operations", () => {
    expect(
      (operation(committed, "/api/events", "post").responses as JsonRecord)["422"],
    ).toBeDefined();
    expect(
      (operation(committed, "/api/events/{id}", "patch").responses as JsonRecord)["422"],
    ).toBeDefined();
    for (const [route, method] of [
      ["/api/events/{id}", "delete"],
      ["/api/me/events", "get"],
      ["/api/me/events/{id}", "get"],
    ] as const) {
      expect((operation(committed, route, method).responses as JsonRecord)["422"]).toBeUndefined();
    }
  });

  it("contains no creator identity or coordinate fields in any student-event component", () => {
    const schemas = (committed.components as JsonRecord).schemas as JsonRecord;
    const studentSchemas = Object.fromEntries(
      Object.entries(schemas).filter(
        ([name]) => name.includes("UserEvent") || name === "MyUserEvents",
      ),
    );
    const serialized = JSON.stringify(studentSchemas);
    const managementSerialized = JSON.stringify(
      Object.fromEntries(
        Object.entries(studentSchemas).filter(([name]) => name !== "UserEventCreateRequest"),
      ),
    );

    for (const forbidden of [
      "createdBy",
      "updatedBy",
      "deletedBy",
      "payloadFingerprint",
      '"lat"',
      '"lng"',
      "coordinates",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(JSON.stringify(schemas.UserEventCreateRequest)).toContain("clientRequestId");
    expect(managementSerialized).not.toContain("clientRequestId");
  });

  it("keeps the committed document synchronized and the iOS snapshot byte-identical", () => {
    expect(committed).toEqual(JSON.parse(JSON.stringify(fresh)));
    expect(readFileSync(iosPath)).toEqual(readFileSync(canonicalPath));
  });
});
