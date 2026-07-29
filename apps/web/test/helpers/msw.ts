import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { EVENTS, MEETINGS, ORGS, PAST_EVENTS, PLACES } from "./fixtures";

/**
 * MSW request mocking for lane H — the handlers speak DATA_CONTRACT.md §3.
 * Wildcard origins because the data layer resolves against
 * window.location.origin. `seenRequests` records every /api/events URL so
 * tests can assert q/bbox propagation; reset it in beforeEach.
 */

export const seenRequests: URL[] = [];

export function resetSeenRequests(): void {
  seenRequests.length = 0;
}

function notFound(message: string) {
  return HttpResponse.json({ error: { code: "not_found", message } }, { status: 404 });
}

export function defaultHandlers() {
  return [
    http.get("*/api/events", ({ request }) => {
      const url = new URL(request.url);
      seenRequests.push(url);
      const q = url.searchParams.get("q")?.toLowerCase();
      const category = url.searchParams.get("category");
      let events = EVENTS;
      if (q) events = events.filter((e) => e.title.toLowerCase().includes(q));
      if (category) events = events.filter((e) => e.category === category);
      return HttpResponse.json({ events });
    }),
    http.get("*/api/places", () => HttpResponse.json({ places: PLACES })),
    http.get("*/api/orgs", () => HttpResponse.json({ orgs: ORGS })),
    http.get("*/api/meetings", () => HttpResponse.json({ meetings: MEETINGS })),
    http.get("*/api/places/:id/activity", ({ params }) => {
      const place = PLACES.find((p) => p.id === params.id);
      if (!place) return notFound(`no place ${String(params.id)}`);
      return HttpResponse.json({
        place,
        events: EVENTS.filter((e) => e.placeId === place.id),
        meetings: MEETINGS.filter((m) => m.placeId === place.id),
      });
    }),
    http.get("*/api/orgs/:id", ({ params }) => {
      const org = ORGS.find((o) => o.id === params.id);
      if (!org) return notFound(`no org ${String(params.id)}`);
      return HttpResponse.json({
        ...org,
        upcoming: EVENTS.filter((e) => e.orgId === org.id),
        past: PAST_EVENTS.filter((e) => e.orgId === org.id),
      });
    }),
  ];
}

export function createServer() {
  return setupServer(...defaultHandlers());
}
