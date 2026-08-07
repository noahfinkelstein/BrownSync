import { describe, expect, it, vi } from "vitest";
import { type BoardIdentityResult, createBoardIdentity } from "../src/board-identity";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const PEPPER_32_BYTES = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const PEPPER_31_BYTES = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHg";
const PEPPER_33_BYTES = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8g";
const EXPECTED_TOKEN = "55caa01066713671b919ea7c26db87b31d14e6fb35c24f1160d05434d072950f";

async function derive(encodedPepper: string | undefined, actorId = ACTOR_ID) {
  return createBoardIdentity({ encodedPepper }).derive(actorId);
}

function expectUnavailable(result: BoardIdentityResult) {
  expect(result).toEqual({ kind: "unavailable" });
}

describe("board author identity", () => {
  it("derives the frozen Web Crypto HMAC vector and deterministic public alias", async () => {
    await expect(derive(PEPPER_32_BYTES)).resolves.toEqual({
      kind: "ok",
      value: {
        actorId: ACTOR_ID,
        alias: "Anonymous Otter 55CA",
        authorToken: EXPECTED_TOKEN,
        tokenVersion: 1,
      },
    });
  });

  it("normalizes a canonical UUID to lowercase before derivation", async () => {
    const lowercase = "abcdef12-3456-4789-8abc-def012345678";
    const uppercase = lowercase.toUpperCase();

    const [lowerResult, upperResult] = await Promise.all([
      derive(PEPPER_32_BYTES, lowercase),
      derive(PEPPER_32_BYTES, uppercase),
    ]);

    expect(upperResult).toEqual(lowerResult);
    expect(lowerResult).toMatchObject({
      kind: "ok",
      value: { actorId: lowercase, tokenVersion: 1 },
    });
  });

  it.each([
    ["leading whitespace", ` ${ACTOR_ID}`],
    ["trailing whitespace", `${ACTOR_ID} `],
    ["braces", `{${ACTOR_ID}}`],
    ["URN", `urn:uuid:${ACTOR_ID}`],
    ["compact", ACTOR_ID.replaceAll("-", "")],
    ["nil/version zero", "00000000-0000-0000-8000-000000000000"],
    ["invalid variant", "10000000-0000-4000-7000-000000000001"],
    ["newline", `${ACTOR_ID}\n`],
  ])("fails closed for a noncanonical actor UUID with %s", async (_label, actorId) => {
    expectUnavailable(await derive(PEPPER_32_BYTES, actorId));
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace", ` ${PEPPER_32_BYTES}`],
    ["padding", `${PEPPER_32_BYTES}=`],
    ["standard base64 alphabet", `${PEPPER_32_BYTES.slice(0, -1)}/`],
    ["invalid alphabet", `${PEPPER_32_BYTES.slice(0, -1)}$`],
    ["impossible encoded length", "A"],
    ["fewer than 32 decoded bytes", PEPPER_31_BYTES],
    ["noncanonical unused-bit alias", `${PEPPER_32_BYTES.slice(0, -1)}9`],
  ])("fails closed for a %s pepper", async (_label, encodedPepper) => {
    expectUnavailable(await derive(encodedPepper));
  });

  it("accepts a canonical pepper longer than the minimum", async () => {
    const result = await derive(PEPPER_33_BYTES);

    expect(result).toMatchObject({
      kind: "ok",
      value: {
        actorId: ACTOR_ID,
        alias: expect.stringMatching(/^Anonymous Otter [0-9A-F]{4}$/),
        authorToken: expect.stringMatching(/^[0-9a-f]{64}$/),
        tokenVersion: 1,
      },
    });
  });

  it.each(["importKey", "sign"] as const)(
    "turns a Web Crypto %s failure into an unavailable result without logging secrets",
    async (operation) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const secretBearingError = new Error(`${PEPPER_32_BYTES}:${EXPECTED_TOKEN}`);
      const subtle = {
        importKey:
          operation === "importKey"
            ? vi.fn(async () => {
                throw secretBearingError;
              })
            : globalThis.crypto.subtle.importKey.bind(globalThis.crypto.subtle),
        sign:
          operation === "sign"
            ? vi.fn(async () => {
                throw secretBearingError;
              })
            : globalThis.crypto.subtle.sign.bind(globalThis.crypto.subtle),
      } as unknown as SubtleCrypto;

      const result = await createBoardIdentity({
        encodedPepper: PEPPER_32_BYTES,
        webCrypto: { subtle },
      }).derive(ACTOR_ID);

      expectUnavailable(result);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(PEPPER_32_BYTES);
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    },
  );
});
