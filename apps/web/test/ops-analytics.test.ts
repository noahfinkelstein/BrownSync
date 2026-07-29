import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyticsEnabled,
  initAnalytics,
  resetAnalyticsForTests,
  track,
} from "../src/ops/analytics";

const { init, capture } = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn() }));

vi.mock("posthog-js", () => ({ default: { init, capture } }));

describe("analytics", () => {
  beforeEach(() => {
    resetAnalyticsForTests();
    init.mockClear();
    capture.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does nothing without VITE_POSTHOG_KEY — no key ever ships in the repo", () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "");
    expect(initAnalytics()).toBe(false);
    expect(analyticsEnabled()).toBe(false);
    expect(init).not.toHaveBeenCalled();

    track("map_loaded");
    expect(capture).not.toHaveBeenCalled();
  });

  it("initializes posthog once when the key is present", () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    expect(initAnalytics()).toBe(true);
    expect(initAnalytics()).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(
      "phc_test_key",
      expect.objectContaining({ autocapture: false, capture_pageview: true }),
    );
  });

  it("respects VITE_POSTHOG_HOST and defaults to US cloud otherwise", () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    vi.stubEnv("VITE_POSTHOG_HOST", "https://eu.i.posthog.com");
    initAnalytics();
    expect(init).toHaveBeenCalledWith(
      "phc_test_key",
      expect.objectContaining({ api_host: "https://eu.i.posthog.com" }),
    );
  });

  it("routes track() to posthog.capture only after init", () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    initAnalytics();
    track("event_opened", { eventId: "abc" });
    expect(capture).toHaveBeenCalledWith("event_opened", { eventId: "abc" });
  });
});
