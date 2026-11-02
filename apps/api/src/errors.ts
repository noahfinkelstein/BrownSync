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

/**
 * workerd (Cloudflare Workers) socket failures carry no `code`: the runtime
 * rejects with a bare Error("connection attempt failed"), surfaced verbatim
 * through postgres.js's cf/ build. Matched by message as a fallback.
 *
 * "tenant or user not found" is Supabase's Supavisor pooler rejecting the
 * startup packet — observed in production when the project is paused (free
 * tier auto-pauses after a week with no traffic) or DATABASE_URL points at a
 * stale project ref. On the Node poller this surfaces with `code: "ENOTFOUND"`
 * (already covered above), but the cf/ build's rejection carries no `code` at
 * all — only this message — so without the fallback the API reported a bare
 * 500 "internal" error instead of 503 "db_unavailable" for the same outage.
 */
const DB_UNAVAILABLE_MESSAGES = ["connection attempt failed", "tenant or user not found"];

export function isDbUnavailable(err: unknown, depth = 0): boolean {
  if (depth > 5 || err === null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && DB_UNAVAILABLE_CODES.has(code)) return true;
  const message = (err as { message?: unknown }).message;
  if (
    typeof message === "string" &&
    DB_UNAVAILABLE_MESSAGES.some((m) => message.toLowerCase().includes(m))
  ) {
    return true;
  }
  return isDbUnavailable((err as { cause?: unknown }).cause, depth + 1);
}
