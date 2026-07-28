import { type HealthOut, HealthOutSchema } from "@brownsync/contract";
import { OpenAPIHono } from "@hono/zod-openapi";

/**
 * Read API per DATA_CONTRACT.md §3. Phase 0 ships /api/health only (static);
 * Phase 1 agent C adds the SQL-backed routes and OpenAPI emission.
 */
export const app = new OpenAPIHono();

app.get("/api/health", (c) => {
  const body: HealthOut = HealthOutSchema.parse({ sources: [] });
  return c.json(body);
});
