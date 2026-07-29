import { HttpResponse, http, type RequestHandler } from "msw";
import { getDefaultFixtureData } from "./fixtureApi";
import { fixtureRoute } from "./fixtureRoutes";
import type { FixtureData } from "./fixtures";

/**
 * MSW handlers for the read API (DATA_CONTRACT.md §3), backed by the shared
 * fixture dataset. Path patterns are host-agnostic (wildcard-host "/api/…")
 * so they match whatever `VITE_API_URL` a test or lane configures, and every
 * handler delegates to the SAME `fixtureRoute` dispatcher fixture mode uses —
 * MSW tests and `VITE_USE_FIXTURES=1` cannot drift apart. Reusable by every
 * lane — import { handlers } (live "now"-anchored data) or
 * buildHandlers(makeFixtureData(fixedBase)) for deterministic tests.
 */

export function buildHandlers(data?: FixtureData): RequestHandler[] {
  const d = () => data ?? getDefaultFixtureData();
  const respond = (path: string, request: Request) => {
    const res = fixtureRoute(
      d(),
      path,
      Object.fromEntries(new URL(request.url).searchParams) as Record<string, string | undefined>,
    );
    // Route bodies are always JSON-shaped objects (contract envelopes / error envelope).
    return HttpResponse.json(res.body as Record<string, unknown>, { status: res.status });
  };
  return [
    http.get("*/api/events/:id", ({ params, request }) =>
      respond(`/api/events/${encodeURIComponent(String(params.id))}`, request),
    ),
    http.get("*/api/events", ({ request }) => respond("/api/events", request)),
    http.get("*/api/places/:id/activity", ({ params, request }) =>
      respond(`/api/places/${encodeURIComponent(String(params.id))}/activity`, request),
    ),
    http.get("*/api/places", ({ request }) => respond("/api/places", request)),
    http.get("*/api/orgs/:id", ({ params, request }) =>
      respond(`/api/orgs/${encodeURIComponent(String(params.id))}`, request),
    ),
    http.get("*/api/orgs", ({ request }) => respond("/api/orgs", request)),
    http.get("*/api/meetings", ({ request }) => respond("/api/meetings", request)),
    http.get("*/api/now", ({ request }) => respond("/api/now", request)),
    http.get("*/api/health", ({ request }) => respond("/api/health", request)),
  ];
}

/** Default handlers over "now"-anchored fixture data. */
export const handlers: RequestHandler[] = buildHandlers();
