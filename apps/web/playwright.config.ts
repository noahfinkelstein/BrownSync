import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the Vite dev server, hermetic by construction: every spec
 * installs route mocks for /api/* (fixture JSON) and the basemap glyph CDN,
 * and aborts all other external requests — tests never touch live servers.
 *
 * Files are named *.e2e.ts (not *.spec/test) so Vitest never picks them up.
 * Deliberately NOT wired into the turbo pipeline — `pnpm e2e` runs it, and
 * CI runs it as a dedicated step in .github/workflows/ci.yml (wired at
 * Phase 3 integration; PERF_ENFORCE stays unset there — see perf.e2e.ts).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5183",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev --port 5183 --strictPort",
    url: "http://localhost:5183",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
