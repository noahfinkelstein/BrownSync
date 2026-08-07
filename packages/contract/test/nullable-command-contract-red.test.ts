import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BoardEditPostRequestSchema } from "../src/board";
import {
  OrgEditRequestSchema,
  UserEventCreateRequestSchema,
  UserEventEditRequestSchema,
} from "../src/social";

const CLIENT_REQUEST_ID = "95000000-0000-4000-8000-000000000001";

const createRequiredFields = {
  clientRequestId: CLIENT_REQUEST_ID,
  title: "Campus software study break",
  start: "2026-09-15T22:00:00Z",
  category: "social" as const,
  placeId: "salomon-center",
};

type JsonSchema = Record<string, unknown>;

function emittedSchemas(): Record<string, JsonSchema> {
  return (
    z.toJSONSchema(z.globalRegistry) as unknown as {
      schemas: Record<string, JsonSchema>;
    }
  ).schemas;
}

function properties(schema: JsonSchema): Record<string, JsonSchema> {
  return schema.properties as Record<string, JsonSchema>;
}

function countKey(value: unknown, key: string): number {
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countKey(item, key), 0);
  }
  if (value === null || typeof value !== "object") return 0;
  return Object.entries(value).reduce(
    (count, [entryKey, entryValue]) =>
      count + (entryKey === key ? 1 : 0) + countKey(entryValue, key),
    0,
  );
}

describe("generated-safe nullable command contract RED", () => {
  it("registers every exact V2 component and wires patches through direct refs", () => {
    const schemas = emittedSchemas();
    for (const id of [
      "OrgEditDescriptionCommand",
      "OrgEditAboutMdCommand",
      "OrgEditMeetingInfoCommand",
      "OrgEditLinksCommand",
      "OrgEditV2Patch",
      "OrgEditV2Request",
      "UserEventEditDescriptionCommand",
      "UserEventEditEndCommand",
      "UserEventEditUrlCommand",
      "UserEventEditV2Patch",
      "UserEventEditV2Request",
      "BoardEditPostTitleCommand",
      "BoardEditPostBodyCommand",
      "BoardEditPostV2Patch",
      "BoardEditPostV2Request",
    ]) {
      expect(schemas[id], id).toBeDefined();
    }

    expect(properties(schemas.OrgEditV2Patch ?? {})).toMatchObject({
      description: { $ref: "OrgEditDescriptionCommand" },
      aboutMd: { $ref: "OrgEditAboutMdCommand" },
      meetingInfo: { $ref: "OrgEditMeetingInfoCommand" },
      links: { $ref: "OrgEditLinksCommand" },
    });
    expect(properties(schemas.OrgEditV2Request ?? {}).patch).toEqual({
      $ref: "OrgEditV2Patch",
    });
    expect(properties(schemas.UserEventEditV2Patch ?? {})).toMatchObject({
      description: { $ref: "UserEventEditDescriptionCommand" },
      end: { $ref: "UserEventEditEndCommand" },
      url: { $ref: "UserEventEditUrlCommand" },
    });
    expect(properties(schemas.UserEventEditV2Request ?? {}).patch).toEqual({
      $ref: "UserEventEditV2Patch",
    });
    expect(properties(schemas.BoardEditPostV2Patch ?? {})).toMatchObject({
      title: { $ref: "BoardEditPostTitleCommand" },
      body: { $ref: "BoardEditPostBodyCommand" },
    });
    expect(properties(schemas.BoardEditPostV2Request ?? {}).patch).toEqual({
      $ref: "BoardEditPostV2Patch",
    });
    expect((schemas.OrgEditRequest?.anyOf as JsonSchema[] | undefined)?.[1]).toEqual({
      $ref: "OrgEditV2Request",
    });
    expect((schemas.UserEventEditRequest?.anyOf as JsonSchema[] | undefined)?.[1]).toEqual({
      $ref: "UserEventEditV2Request",
    });
    expect((schemas.BoardEditPostRequest?.anyOf as JsonSchema[] | undefined)?.[1]).toEqual({
      $ref: "BoardEditPostV2Request",
    });

    for (const id of ["OrgEditV2Patch", "UserEventEditV2Patch", "BoardEditPostV2Patch"]) {
      expect(schemas[id]?.type, id).toBe("object");
      expect(schemas[id]?.additionalProperties, id).toBe(false);
    }
    for (const id of ["OrgEditV2Request", "UserEventEditV2Request", "BoardEditPostV2Request"]) {
      expect(schemas[id]?.type, id).toBe("object");
      expect(schemas[id]?.additionalProperties, id).toBe(false);
      expect(schemas[id]?.required, id).toEqual(["version", "expectedRevision", "patch"]);
    }
  });

  it("emits flat strict commands with generator-safe action/value fields", () => {
    const schemas = emittedSchemas();
    const nullableCommands = [
      "OrgEditDescriptionCommand",
      "OrgEditAboutMdCommand",
      "OrgEditMeetingInfoCommand",
      "OrgEditLinksCommand",
      "UserEventEditDescriptionCommand",
      "UserEventEditEndCommand",
      "UserEventEditUrlCommand",
      "BoardEditPostTitleCommand",
    ] as const;

    for (const id of nullableCommands) {
      const command = schemas[id] ?? {};
      expect(command.type, id).toBe("object");
      expect(command.additionalProperties, id).toBe(false);
      expect(command.required, id).toEqual(["action"]);
      expect(properties(command).action, id).toEqual({
        type: "string",
        enum: ["set", "clear"],
      });
      expect(properties(command).value, id).toBeDefined();
      expect(countKey(command, "oneOf"), id).toBe(0);
    }

    expect(properties(schemas.OrgEditDescriptionCommand ?? {}).value).toEqual({
      type: "string",
      maxLength: 10_000,
    });
    expect(properties(schemas.OrgEditAboutMdCommand ?? {}).value).toEqual({
      type: "string",
      maxLength: 20_000,
    });
    expect(properties(schemas.OrgEditMeetingInfoCommand ?? {}).value).toEqual({
      type: "string",
      maxLength: 4_000,
    });
    expect(properties(schemas.OrgEditLinksCommand ?? {}).value).toEqual({
      maxItems: 20,
      type: "array",
      items: { $ref: "OrgLink" },
    });
    expect(properties(schemas.UserEventEditDescriptionCommand ?? {}).value).toEqual({
      type: "string",
      maxLength: 10_000,
    });
    expect(properties(schemas.UserEventEditEndCommand ?? {}).value).toMatchObject({
      type: "string",
      format: "date-time",
    });
    expect(properties(schemas.UserEventEditUrlCommand ?? {}).value).toEqual({
      type: "string",
      maxLength: 2048,
      format: "uri",
    });
    expect(properties(schemas.BoardEditPostTitleCommand ?? {}).value).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 160,
    });

    const body = schemas.BoardEditPostBodyCommand ?? {};
    expect(body.type).toBe("object");
    expect(body.additionalProperties).toBe(false);
    expect(body.required).toEqual(["action", "value"]);
    expect(properties(body).action).toEqual({ type: "string", const: "set" });
    expect(properties(body).value).toMatchObject({
      type: "string",
      minLength: 1,
      maxLength: 5000,
    });
    expect(countKey(body, "oneOf")).toBe(0);

    for (const id of ["OrgEditV2Patch", "UserEventEditV2Patch", "BoardEditPostV2Patch"]) {
      expect(countKey(schemas[id], "oneOf"), id).toBe(0);
    }
  });

  it("accepts omitted and explicit-null user-event create optionals", () => {
    const omitted = UserEventCreateRequestSchema.safeParse(createRequiredFields);
    const explicitNull = UserEventCreateRequestSchema.safeParse({
      ...createRequiredFields,
      organizationId: null,
      description: null,
      end: null,
      url: null,
    });

    expect(omitted.success).toBe(true);
    expect(explicitNull.success).toBe(true);
  });

  it("accepts strict OrgEdit V2 set, clear, and absent commands", () => {
    const input = {
      version: 2,
      expectedRevision: 3,
      patch: {
        description: { action: "set", value: "Updated description" },
        aboutMd: { action: "clear" },
        links: {
          action: "set",
          value: [{ platform: "website", url: "https://example.edu/org" }],
        },
      },
    };

    expect(OrgEditRequestSchema.parse(input)).toEqual(input);
  });

  it("accepts strict UserEventEdit V2 set, clear, and absent commands", () => {
    const input = {
      version: 2,
      expectedRevision: 2,
      patch: {
        title: "Updated study break",
        description: { action: "clear" },
        end: { action: "set", value: "2026-09-16T00:30:00Z" },
        url: { action: "clear" },
        placeId: "sayles-hall",
      },
    };
    const setDescriptionWithoutEndOrUrl = {
      version: 2,
      expectedRevision: 2,
      patch: {
        description: { action: "set", value: "Updated description" },
      },
    };

    expect(UserEventEditRequestSchema.parse(input)).toEqual(input);
    expect(UserEventEditRequestSchema.parse(setDescriptionWithoutEndOrUrl)).toEqual(
      setDescriptionWithoutEndOrUrl,
    );
  });

  it("keeps V2 locationRaw parity and rejects simultaneous placeId", () => {
    const locationOnly = {
      version: 2,
      expectedRevision: 2,
      patch: {
        locationRaw: "  Sayles Hall  ",
      },
    };

    expect(UserEventEditRequestSchema.parse(locationOnly)).toEqual({
      ...locationOnly,
      patch: { locationRaw: "Sayles Hall" },
    });
    expect(
      UserEventEditRequestSchema.safeParse({
        version: 2,
        expectedRevision: 2,
        patch: {
          placeId: "sayles-hall",
          locationRaw: "Sayles Hall",
        },
      }).success,
    ).toBe(false);
  });

  it("enforces V2 start and end.set ordering", () => {
    const valid = {
      version: 2,
      expectedRevision: 2,
      patch: {
        start: "2026-09-15T22:00:00Z",
        end: { action: "set", value: "2026-09-16T00:30:00Z" },
      },
    };

    expect(UserEventEditRequestSchema.parse(valid)).toEqual(valid);
    expect(
      UserEventEditRequestSchema.safeParse({
        ...valid,
        patch: {
          start: "2026-09-16T00:30:00Z",
          end: { action: "set", value: "2026-09-15T22:00:00Z" },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts strict BoardEditPost V2 set, clear, and absent commands", () => {
    const clearTitle = {
      version: 2,
      expectedRevision: 2,
      patch: {
        title: { action: "clear" },
        body: { action: "set", value: "Replacement body" },
      },
    };
    const setTitleWithoutBody = {
      version: 2,
      expectedRevision: 2,
      patch: {
        title: { action: "set", value: "Replacement title" },
      },
    };

    expect(BoardEditPostRequestSchema.parse(clearTitle)).toEqual(clearTitle);
    expect(BoardEditPostRequestSchema.parse(setTitleWithoutBody)).toEqual(setTitleWithoutBody);
  });

  it("trims bounded BoardEditPost V2 set values", () => {
    expect(
      BoardEditPostRequestSchema.parse({
        version: 2,
        expectedRevision: 2,
        patch: {
          title: { action: "set", value: "  Replacement title  " },
          body: { action: "set", value: "  Replacement body  " },
        },
      }),
    ).toEqual({
      version: 2,
      expectedRevision: 2,
      patch: {
        title: { action: "set", value: "Replacement title" },
        body: { action: "set", value: "Replacement body" },
      },
    });
  });

  it.each([
    [
      "OrgEdit wrong version",
      OrgEditRequestSchema,
      {
        version: 1,
        expectedRevision: 1,
        patch: { description: { action: "clear" } },
      },
    ],
    [
      "OrgEdit omitted version",
      OrgEditRequestSchema,
      {
        expectedRevision: 1,
        patch: { description: { action: "clear" } },
      },
    ],
    [
      "UserEventEdit wrong version",
      UserEventEditRequestSchema,
      {
        version: 1,
        expectedRevision: 1,
        patch: { end: { action: "clear" } },
      },
    ],
    [
      "UserEventEdit omitted version",
      UserEventEditRequestSchema,
      {
        expectedRevision: 1,
        patch: { end: { action: "clear" } },
      },
    ],
    [
      "BoardEditPost wrong version",
      BoardEditPostRequestSchema,
      {
        version: 1,
        expectedRevision: 1,
        patch: { title: { action: "clear" } },
      },
    ],
    [
      "BoardEditPost omitted version",
      BoardEditPostRequestSchema,
      {
        expectedRevision: 1,
        patch: { title: { action: "clear" } },
      },
    ],
  ] as const)("requires literal version 2 for %s", (_label, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it.each([
    [
      "OrgEdit unknown action",
      OrgEditRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { description: { action: "unset" } },
      },
    ],
    [
      "OrgEdit set without value",
      OrgEditRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { aboutMd: { action: "set" } },
      },
    ],
    [
      "OrgEdit clear with value",
      OrgEditRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { meetingInfo: { action: "clear", value: "forbidden" } },
      },
    ],
    [
      "UserEventEdit unknown action",
      UserEventEditRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { description: { action: "unset" } },
      },
    ],
    [
      "UserEventEdit set without value",
      UserEventEditRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { end: { action: "set" } },
      },
    ],
    [
      "UserEventEdit clear with value",
      UserEventEditRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { url: { action: "clear", value: "https://example.edu" } },
      },
    ],
    [
      "BoardEditPost unknown action",
      BoardEditPostRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { title: { action: "unset" } },
      },
    ],
    [
      "BoardEditPost set without value",
      BoardEditPostRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { body: { action: "set" } },
      },
    ],
    [
      "BoardEditPost clear with value",
      BoardEditPostRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { title: { action: "clear", value: "forbidden" } },
      },
    ],
    [
      "BoardEditPost clear for required body",
      BoardEditPostRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { body: { action: "clear" } },
      },
    ],
    [
      "OrgEdit set with explicit undefined",
      OrgEditRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { description: { action: "set", value: undefined } },
      },
    ],
    [
      "OrgEdit clear with an undefined value key",
      OrgEditRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { description: { action: "clear", value: undefined } },
      },
    ],
    [
      "UserEventEdit clear with an undefined value key",
      UserEventEditRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { end: { action: "clear", value: undefined } },
      },
    ],
    [
      "BoardEditPost clear with an undefined value key",
      BoardEditPostRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { title: { action: "clear", value: undefined } },
      },
    ],
  ] as const)("rejects malformed %s commands", (_label, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it.each([
    ["OrgEdit empty patch", OrgEditRequestSchema, { version: 2, expectedRevision: 1, patch: {} }],
    [
      "UserEventEdit empty patch",
      UserEventEditRequestSchema,
      { version: 2, expectedRevision: 1, patch: {} },
    ],
    [
      "BoardEditPost empty patch",
      BoardEditPostRequestSchema,
      { version: 2, expectedRevision: 1, patch: {} },
    ],
    [
      "OrgEdit extra root key",
      OrgEditRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { description: { action: "clear" } },
        actorId: "forged",
      },
    ],
    [
      "UserEventEdit extra command key",
      UserEventEditRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { end: { action: "clear", actorId: "forged" } },
      },
    ],
    [
      "BoardEditPost extra patch key",
      BoardEditPostRequestSchema,
      {
        version: 2,
        expectedRevision: 1,
        patch: { title: { action: "clear" }, authorToken: "forged" },
      },
    ],
  ] as const)("rejects %s", (_label, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it("retains size and HTTPS constraints inside V2 set commands", () => {
    expect(
      OrgEditRequestSchema.safeParse({
        version: 2,
        expectedRevision: 1,
        patch: { description: { action: "set", value: "x".repeat(10_001) } },
      }).success,
    ).toBe(false);
    expect(
      OrgEditRequestSchema.safeParse({
        version: 2,
        expectedRevision: 1,
        patch: {
          links: {
            action: "set",
            value: [{ platform: "website", url: "http://example.edu/org" }],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      UserEventEditRequestSchema.safeParse({
        version: 2,
        expectedRevision: 1,
        patch: { description: { action: "set", value: "x".repeat(10_001) } },
      }).success,
    ).toBe(false);
    expect(
      UserEventEditRequestSchema.safeParse({
        version: 2,
        expectedRevision: 1,
        patch: { url: { action: "set", value: "http://example.edu/event" } },
      }).success,
    ).toBe(false);
    expect(
      BoardEditPostRequestSchema.safeParse({
        version: 2,
        expectedRevision: 1,
        patch: { title: { action: "set", value: "x".repeat(161) } },
      }).success,
    ).toBe(false);
    expect(
      BoardEditPostRequestSchema.safeParse({
        version: 2,
        expectedRevision: 1,
        patch: { body: { action: "set", value: "x".repeat(5_001) } },
      }).success,
    ).toBe(false);
  });

  it("keeps every legacy request shape accepted", () => {
    expect(
      OrgEditRequestSchema.parse({
        expectedRevision: 3,
        patch: { description: "Updated", aboutMd: null },
      }),
    ).toEqual({
      expectedRevision: 3,
      patch: { description: "Updated", aboutMd: null },
    });
    expect(
      UserEventEditRequestSchema.parse({
        expectedRevision: 2,
        patch: { description: null, end: null, url: null },
      }),
    ).toEqual({
      expectedRevision: 2,
      patch: { description: null, end: null, url: null },
    });
    expect(
      BoardEditPostRequestSchema.parse({
        expectedRevision: 2,
        title: null,
        body: "Replacement body",
      }),
    ).toEqual({
      expectedRevision: 2,
      title: null,
      body: "Replacement body",
    });
  });
});
