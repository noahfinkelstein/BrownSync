import { HealthOutSchema } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";

describe("GET /api/health", () => {
  it("returns a contract-shaped HealthOut", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = HealthOutSchema.parse(await res.json());
    expect(body.sources).toEqual([]);
  });
});
