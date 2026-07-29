import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/**
 * Node-side MSW server for Vitest. Tests NEVER hit live servers:
 *
 *   beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
 *   afterEach(() => mockServer.resetHandlers());
 *   afterAll(() => mockServer.close());
 *
 * Override with deterministic data per-suite:
 *   mockServer.use(...buildHandlers(makeFixtureData(new Date("2026-10-01T23:00:00Z"))));
 */
export const mockServer = setupServer(...handlers);
