import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "../src/app";
import { isDbUnavailable } from "../src/errors";
import { fakeQueries } from "./fixtures";

const ErrorEnvelope = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

function connectionRefused(): Error {
  const err = new Error("connect ECONNREFUSED 127.0.0.1:54322") as Error & { code: string };
  err.code = "ECONNREFUSED";
  return err;
}

describe("error envelope + DB-unreachable handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 503 with an envelope when the database is unreachable", async () => {
    const app = createApp(fakeQueries({ events: async () => Promise.reject(connectionRefused()) }));
    const res = await app.request("/api/events");
    expect(res.status).toBe(503);
    const body = ErrorEnvelope.parse(await res.json());
    expect(body.error.code).toBe("db_unavailable");
  });

  it("returns 503 for postgres.js connect timeouts (code CONNECT_TIMEOUT)", async () => {
    const err = new Error("write CONNECT_TIMEOUT") as Error & { code: string };
    err.code = "CONNECT_TIMEOUT";
    const app = createApp(fakeQueries({ health: async () => Promise.reject(err) }));
    const res = await app.request("/api/health");
    expect(res.status).toBe(503);
  });

  it("returns 500 with an envelope for unexpected errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp(
      fakeQueries({
        orgs: async () => {
          throw new Error("boom");
        },
      }),
    );
    const res = await app.request("/api/orgs");
    expect(res.status).toBe(500);
    const body = ErrorEnvelope.parse(await res.json());
    expect(body.error.code).toBe("internal");
  });
});

describe("isDbUnavailable", () => {
  it("recognizes socket, postgres.js, and SQLSTATE connection codes", () => {
    expect(isDbUnavailable(connectionRefused())).toBe(true);
    expect(isDbUnavailable({ code: "57P01" })).toBe(true);
    expect(isDbUnavailable({ code: "08006" })).toBe(true);
    expect(isDbUnavailable({ code: "53300" })).toBe(true);
  });

  it("walks the cause chain", () => {
    const wrapped = new Error("query failed", { cause: connectionRefused() });
    expect(isDbUnavailable(wrapped)).toBe(true);
  });

  it("does not classify ordinary errors as unavailability", () => {
    expect(isDbUnavailable(new Error("syntax error"))).toBe(false);
    expect(isDbUnavailable({ code: "23505" })).toBe(false); // unique violation
    expect(isDbUnavailable(null)).toBe(false);
    expect(isDbUnavailable("nope")).toBe(false);
  });
});
