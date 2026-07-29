import { HttpResponse, http, type RequestHandler } from "msw";
import {
  getDefaultFixtureData,
  getEventDetail,
  healthSnapshot,
  meetingsAt,
  nowSnapshot,
  queryEvents,
} from "./fixtureApi";
import type { FixtureData } from "./fixtures";

/**
 * MSW handlers for the read API (DATA_CONTRACT.md §3), backed by the shared
 * fixture dataset. Path patterns are host-agnostic (wildcard-host "/api/…")
 * so they match whatever `VITE_API_URL` a test or lane configures. Reusable
 * by every Phase 2 lane — import { handlers } (live "now"-anchored data) or
 * buildHandlers(makeFixtureData(fixedBase)) for deterministic tests.
 */

const notFound = (message: string) =>
  HttpResponse.json({ error: { code: "not_found", message } }, { status: 404 });

export function buildHandlers(data?: FixtureData): RequestHandler[] {
  const d = () => data ?? getDefaultFixtureData();
  return [
    http.get("*/api/events/:id", ({ params }) => {
      const detail = getEventDetail(d(), String(params.id));
      return detail ? HttpResponse.json(detail) : notFound(`no event ${String(params.id)}`);
    }),
    http.get("*/api/events", ({ request }) => {
      const url = new URL(request.url);
      return HttpResponse.json({
        events: queryEvents(d(), {
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined,
          category: url.searchParams.get("category") ?? undefined,
          q: url.searchParams.get("q") ?? undefined,
        }),
      });
    }),
    http.get("*/api/meetings", ({ request }) => {
      const at = new URL(request.url).searchParams.get("at") ?? undefined;
      return HttpResponse.json({ meetings: meetingsAt(d(), at) });
    }),
    http.get("*/api/now", ({ request }) => {
      const at = new URL(request.url).searchParams.get("at") ?? undefined;
      return HttpResponse.json(nowSnapshot(d(), at));
    }),
    http.get("*/api/health", () => HttpResponse.json(healthSnapshot(d()))),
  ];
}

/** Default handlers over "now"-anchored fixture data. */
export const handlers: RequestHandler[] = buildHandlers();
