// @vitest-environment jsdom
import { PlaceOutSchema } from "@brownsync/contract";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getJson } from "../src/data/search";
import { useHealth } from "../src/ops/useHealth";

/**
 * VITE_USE_FIXTURES=1 must make the WHOLE app zero-backend (README
 * "Zero-backend (fixture mode): no database, no network") — including the
 * lane-H fetch helper (browse list, places, orgs, search, place activity)
 * and the self-contained /api/health poller. Regression for the Phase 3
 * finding where fixture mode only covered src/data/api.ts: the map showed
 * pins while the list pane, search, health strip, and place/org pages all
 * rendered their error states.
 */

const networkTouched = vi.fn();

beforeEach(() => {
  vi.stubEnv("VITE_USE_FIXTURES", "1");
  vi.stubGlobal("fetch", (...args: unknown[]) => {
    networkTouched(args);
    throw new Error("fixture mode must not touch the network");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  networkTouched.mockClear();
});

describe("fixture mode is fully zero-network", () => {
  it("lane-H getJson serves fixture data without fetch", async () => {
    const body = await getJson("/api/places", z.object({ places: z.array(PlaceOutSchema) }));
    expect(body.places.length).toBeGreaterThan(0);
    expect(networkTouched).not.toHaveBeenCalled();
  });

  it("lane-H getJson maps fixture 404s onto ApiError", async () => {
    await expect(getJson("/api/orgs/nope", z.unknown())).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
    });
  });

  it("useHealth reaches `ready` from fixture data without fetch", async () => {
    const { result, unmount } = renderHook(() => useHealth());
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    expect(result.current.sources.length).toBeGreaterThan(0);
    expect(networkTouched).not.toHaveBeenCalled();
    unmount();
  });
});
