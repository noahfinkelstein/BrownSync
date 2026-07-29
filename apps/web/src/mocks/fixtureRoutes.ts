import {
  getEventDetail,
  getOrgDetail,
  getPlaceActivity,
  healthSnapshot,
  listOrgs,
  listPlaces,
  meetingsAt,
  nowSnapshot,
  queryEvents,
} from "./fixtureApi";
import type { FixtureData } from "./fixtures";

/**
 * In-process READ-API router over a FixtureData set — the single dispatch
 * point behind fixture mode (`VITE_USE_FIXTURES=1`, README "Zero-backend").
 * Path → fixtureApi call with apps/api response envelopes, so EVERY fetch
 * layer (src/data/api.ts, the lane-H `getJson`, ops/useHealth) can serve the
 * same dataset with zero network. Also backs the MSW handlers, keeping test
 * and fixture-mode semantics identical by construction.
 */

export type FixtureResponse =
  | { status: 200; body: unknown }
  | { status: 404; body: { error: { code: "not_found"; message: string } } };

const ok = (body: unknown): FixtureResponse => ({ status: 200, body });
const notFound = (message: string): FixtureResponse => ({
  status: 404,
  body: { error: { code: "not_found", message } },
});

const EVENT_ID_RE = /^\/api\/events\/([^/]+)$/;
const PLACE_ACTIVITY_RE = /^\/api\/places\/([^/]+)\/activity$/;
const ORG_ID_RE = /^\/api\/orgs\/([^/]+)$/;

/**
 * Resolve one read-API request against the fixture dataset. Unknown paths
 * throw — the app only ever requests contract §3 routes, so an unhandled
 * path is a programmer error, not a user-visible 404.
 */
export function fixtureRoute(
  data: FixtureData,
  path: string,
  params: Record<string, string | undefined> = {},
): FixtureResponse {
  if (path === "/api/events") {
    return ok({
      events: queryEvents(data, {
        from: params.from,
        to: params.to,
        bbox: params.bbox,
        category: params.category,
        q: params.q,
      }),
    });
  }
  const eventMatch = EVENT_ID_RE.exec(path);
  if (eventMatch?.[1] !== undefined) {
    const id = decodeURIComponent(eventMatch[1]);
    const detail = getEventDetail(data, id);
    return detail ? ok(detail) : notFound(`no event ${id}`);
  }
  if (path === "/api/places") return ok({ places: listPlaces(data) });
  const activityMatch = PLACE_ACTIVITY_RE.exec(path);
  if (activityMatch?.[1] !== undefined) {
    const id = decodeURIComponent(activityMatch[1]);
    const activity = getPlaceActivity(data, id, params.at);
    return activity ? ok(activity) : notFound(`no place ${id}`);
  }
  if (path === "/api/orgs") return ok({ orgs: listOrgs(data) });
  const orgMatch = ORG_ID_RE.exec(path);
  if (orgMatch?.[1] !== undefined) {
    const id = decodeURIComponent(orgMatch[1]);
    const detail = getOrgDetail(data, id, params.at);
    return detail ? ok(detail) : notFound(`no org ${id}`);
  }
  if (path === "/api/meetings") return ok({ meetings: meetingsAt(data, params.at) });
  if (path === "/api/now") return ok(nowSnapshot(data, params.at));
  if (path === "/api/health") return ok(healthSnapshot(data));
  throw new Error(`unhandled fixture path: ${path}`);
}
