import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument, createApp } from "./app";
import type { Queries } from "./queries";

/**
 * Emits packages/contract/openapi.json (OpenAPI 3.1) — the committed artifact
 * future Swift codegen consumes. Run: pnpm --filter @brownsync/api openapi
 *
 * Document generation only registers routes; no handler runs, so the app is
 * built over a Queries stub that refuses to be called.
 */
function stubQueries(): Queries {
  return new Proxy({} as Queries, {
    get(_target, prop) {
      throw new Error(`openapi emission must not touch the database (called ${String(prop)})`);
    },
  });
}

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.resolve(here, "../../../packages/contract/openapi.json");

const doc = buildOpenApiDocument(createApp(stubQueries()));
await writeFile(outFile, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`wrote ${path.relative(process.cwd(), outFile)}`);
