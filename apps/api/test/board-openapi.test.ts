import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type JsonRecord = Record<string, unknown>;

const here = path.dirname(fileURLToPath(import.meta.url));
const document = JSON.parse(
  readFileSync(path.resolve(here, "../../../packages/contract/openapi.json"), "utf8"),
) as JsonRecord;
const schemas = ((document.components as JsonRecord).schemas ?? {}) as JsonRecord;
const paths = document.paths as JsonRecord;

function schemaRefName(value: unknown): string {
  const reference = (value as JsonRecord).$ref;
  expect(reference).toEqual(expect.stringMatching(/^#\/components\/schemas\//));
  return (reference as string).replace("#/components/schemas/", "");
}

describe("Board OpenAPI cursor contract", () => {
  const paginatedOperations = [
    ["/api/board/feed", "get"],
    ["/api/board/feed", "head"],
    ["/api/board/posts/{postId}", "get"],
    ["/api/board/posts/{postId}", "head"],
    ["/api/board/mine", "get"],
    ["/api/board/mine", "head"],
    ["/api/board/moderation/queue", "get"],
    ["/api/board/moderation/queue", "head"],
    ["/api/board/admin/moderators", "get"],
    ["/api/board/admin/moderators", "head"],
  ] as const;

  it.each(paginatedOperations)(
    "keeps the optional request cursor nonnullable for %s %s",
    (route, method) => {
      const operation = (paths[route] as JsonRecord)[method] as JsonRecord;
      const parameters = operation.parameters as JsonRecord[];
      const cursor = parameters.find((parameter) => parameter.name === "cursor");

      expect(cursor).toBeDefined();
      expect(cursor?.required).toBe(false);
      expect(schemaRefName(cursor?.schema)).toBe("BoardCursor");
      expect(schemas.BoardCursor).toMatchObject({
        type: "string",
        maxLength: 256,
        pattern: "^[A-Za-z0-9_-]+$",
      });
    },
  );

  it.each([
    "BoardFeed",
    "BoardThread",
    "BoardOwnContent",
    "BoardModerationQueue",
    "BoardModerators",
  ])("keeps %s.nextCursor nullable through a distinct component", (pageSchemaName) => {
    const pageSchema = schemas[pageSchemaName] as JsonRecord;
    const nextCursor = (pageSchema.properties as JsonRecord).nextCursor;
    const cursorSchemaName = schemaRefName(nextCursor);

    expect(cursorSchemaName).not.toBe("BoardCursor");
    expect(schemas[cursorSchemaName]).toMatchObject({
      type: ["string", "null"],
      maxLength: 256,
      pattern: "^[A-Za-z0-9_-]+$",
    });
  });
});
