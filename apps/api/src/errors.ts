/**
 * Error envelope — every non-2xx response body is `{ error: { code, message } }`.
 */
export type ErrorEnvelope = {
  error: { code: string; message: string };
};

export function errorEnvelope(code: string, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

/**
 * Network / connection-level failure codes (Node socket errors + postgres.js
 * connection errors + Postgres class 08 / 53300 / 57P0x SQLSTATEs). Any of
 * these means "the database is unreachable right now" → 503, not 500.
 */
const DB_UNAVAILABLE_CODES = new Set([
  // Node socket errors
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "EPIPE",
  // postgres.js connection lifecycle errors
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  // Postgres SQLSTATE: connection exceptions, too many connections, shutdown
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "53300",
  "57P01",
  "57P02",
  "57P03",
]);

export function isDbUnavailable(err: unknown, depth = 0): boolean {
  if (depth > 5 || err === null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && DB_UNAVAILABLE_CODES.has(code)) return true;
  return isDbUnavailable((err as { cause?: unknown }).cause, depth + 1);
}
