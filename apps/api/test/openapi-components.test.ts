import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The committed packages/contract/openapi.json is the Swift codegen input
 * (ARCHITECTURE.md:56). This file emits it, so this file guards its shape.
 *
 * Every response body must resolve to a NAMED component. When schemas are
 * inlined at the response site, swift-openapi-generator synthesizes nested
 * types like
 *   Operations.getEvents.Output.Ok.Body.jsonPayload.eventsPayload
 * which are unusable from SwiftUI. Named components become `Components.Schemas.Event`.
 *
 * Names come from zod v4's native `.meta({ id })` on the schema itself —
 * verified to register through @hono/zod-openapi 1.5.1 without packages/contract
 * taking a hono dependency. A new response schema that forgets `.meta({ id })`
 * fails here rather than being discovered in Xcode.
 *
 * Regenerate with: pnpm --filter @brownsync/api openapi
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(
  readFileSync(path.resolve(here, "../../../packages/contract/openapi.json"), "utf8"),
);

type JsonRecord = Record<string, unknown>;

function responseSchemas(): { path: string; method: string; status: string; schema: JsonRecord }[] {
  const out: { path: string; method: string; status: string; schema: JsonRecord }[] = [];
  for (const [p, ops] of Object.entries(doc.paths as JsonRecord)) {
    for (const [method, op] of Object.entries(ops as JsonRecord)) {
      const responses = (op as JsonRecord).responses as JsonRecord | undefined;
      for (const [status, resp] of Object.entries(responses ?? {})) {
        const content = (resp as JsonRecord)?.content as JsonRecord | undefined;
        const json = content?.["application/json"] as JsonRecord | undefined;
        if (json?.schema) out.push({ path: p, method, status, schema: json.schema as JsonRecord });
      }
    }
  }
  return out;
}

describe("openapi.json — named components (Swift codegen input)", () => {
  it("is OpenAPI 3.1", () => {
    expect(doc.openapi).toMatch(/^3\.1\./);
  });

  it("registers every contract §3 Out-shape as a named component", () => {
    const names = Object.keys(doc.components?.schemas ?? {});
    for (const required of [
      "Event",
      "EventDetail",
      "Place",
      "PlaceActivity",
      "Org",
      "OrgDetail",
      "Meeting",
      "Now",
      "Health",
      "SourceHealth",
      "ErrorEnvelope",
      // Enums — these become Swift enums rather than bare Strings.
      "Category",
      "PlaceKind",
      "OrgKind",
    ]) {
      expect(names, `missing component: ${required}`).toContain(required);
    }
  });

  it("resolves every JSON response body to a $ref, never an inline object", () => {
    const inlined = responseSchemas().filter((r) => !("$ref" in r.schema));
    expect(
      inlined.map((r) => `${r.method.toUpperCase()} ${r.path} → ${r.status}`),
      "these responses inline their schema; add .meta({ id }) to the schema",
    ).toEqual([]);
  });

  it("has no dangling $ref", () => {
    const defined = new Set(Object.keys(doc.components?.schemas ?? {}));
    const refs = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node as JsonRecord)) {
        if (k === "$ref" && typeof v === "string") refs.add(v.replace("#/components/schemas/", ""));
        else walk(v);
      }
    };
    walk(doc);
    expect([...refs].filter((r) => !defined.has(r))).toEqual([]);
  });

  it("is in sync with the emitter — regenerate if this fails", async () => {
    const { buildOpenApiDocument, createApp } = await import("../src/app");
    const stub = new Proxy({} as never, {
      get(_t, prop) {
        throw new Error(`openapi emission must not touch the database (${String(prop)})`);
      },
    });
    const fresh = buildOpenApiDocument(createApp(stub));
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(doc);
  });
});
