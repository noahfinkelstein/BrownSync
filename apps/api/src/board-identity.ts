const BOARD_AUTHOR_DOMAIN = "brownsync-board-author:v1\0";
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOWERCASE_CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CANONICAL_BASE64URL = /^[A-Za-z0-9_-]+$/;
const AUTHOR_TOKEN = /^[0-9a-f]{64}$/;

export type BoardActorIdentity = Readonly<{
  actorId: string;
  alias: string;
  authorToken: string;
  tokenVersion: 1;
}>;

export type BoardIdentityResult =
  | Readonly<{ kind: "ok"; value: BoardActorIdentity }>
  | Readonly<{ kind: "unavailable" }>;

export interface BoardIdentity {
  derive(actorId: string): Promise<BoardIdentityResult>;
}

export type BoardIdentityOptions = Readonly<{
  encodedPepper?: string;
  webCrypto?: Pick<Crypto, "subtle">;
}>;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodePepper(encodedPepper: string | undefined): Uint8Array<ArrayBuffer> | null {
  if (
    encodedPepper === undefined ||
    !CANONICAL_BASE64URL.test(encodedPepper) ||
    encodedPepper.length % 4 === 1
  ) {
    return null;
  }

  const paddingLength = (4 - (encodedPepper.length % 4)) % 4;
  const padded = `${encodedPepper.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat(
    paddingLength,
  )}`;

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (bytes.byteLength < 32 || encodeBase64Url(bytes) !== encodedPepper) return null;
    return bytes;
  } catch {
    return null;
  }
}

function normalizeActorId(actorId: string): string | null {
  return CANONICAL_UUID.test(actorId) ? actorId.toLowerCase() : null;
}

function toLowercaseHex(value: ArrayBuffer): string {
  let hex = "";
  for (const byte of new Uint8Array(value)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export function isBoardActorIdentity(value: unknown): value is BoardActorIdentity {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const identity = value as Partial<BoardActorIdentity>;
  return (
    typeof identity.actorId === "string" &&
    LOWERCASE_CANONICAL_UUID.test(identity.actorId) &&
    typeof identity.authorToken === "string" &&
    AUTHOR_TOKEN.test(identity.authorToken) &&
    identity.tokenVersion === 1 &&
    identity.alias === `Anonymous Otter ${identity.authorToken.slice(0, 4).toUpperCase()}`
  );
}

export function createBoardIdentity(options: BoardIdentityOptions): BoardIdentity {
  const pepper = decodePepper(options.encodedPepper);
  const webCrypto = options.webCrypto ?? globalThis.crypto;
  let key: Promise<CryptoKey> | undefined;

  return {
    async derive(actorId) {
      const canonicalActorId = normalizeActorId(actorId);
      if (pepper === null || canonicalActorId === null) return { kind: "unavailable" };

      try {
        key ??= webCrypto.subtle.importKey(
          "raw",
          pepper,
          { hash: "SHA-256", name: "HMAC" },
          false,
          ["sign"],
        );
        const signature = await webCrypto.subtle.sign(
          "HMAC",
          await key,
          new TextEncoder().encode(`${BOARD_AUTHOR_DOMAIN}${canonicalActorId}`),
        );
        const authorToken = toLowercaseHex(signature);
        if (!AUTHOR_TOKEN.test(authorToken)) return { kind: "unavailable" };

        return {
          kind: "ok",
          value: {
            actorId: canonicalActorId,
            alias: `Anonymous Otter ${authorToken.slice(0, 4).toUpperCase()}`,
            authorToken,
            tokenVersion: 1,
          },
        };
      } catch {
        return { kind: "unavailable" };
      }
    },
  };
}
