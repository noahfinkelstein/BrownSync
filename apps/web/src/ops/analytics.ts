import posthog from "posthog-js";

let initialized = false;

/**
 * PostHog bootstrap — gated on VITE_POSTHOG_KEY so no key ever lives in the
 * repo and dev/e2e runs (no key set) stay completely silent. The integrator
 * calls `initAnalytics()` once from `main.tsx` before rendering; everything
 * else goes through `track()`, which no-ops until init succeeds.
 */
export function initAnalytics(): boolean {
  if (initialized) return true;
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!key) return false;
  posthog.init(key, {
    api_host:
      (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://us.i.posthog.com",
    // One full-bleed map screen — DOM autocapture is pure noise. The moments
    // that matter are instrumented explicitly via track().
    autocapture: false,
    capture_pageview: true,
    persistence: "localStorage",
  });
  initialized = true;
  return true;
}

/** Canonical event names — keep this union tight so dashboards stay coherent. */
export type AnalyticsEvent =
  | "map_loaded"
  | "time_scrubbed"
  | "event_opened"
  | "place_opened"
  | "org_opened"
  | "search_opened"
  | "search_submitted"
  | "layer_toggled"
  | "health_opened";

export function track(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.capture(event, props);
}

export function analyticsEnabled(): boolean {
  return initialized;
}

/** Test seam: forget init state (does not tear down the posthog singleton). */
export function resetAnalyticsForTests(): void {
  initialized = false;
}
