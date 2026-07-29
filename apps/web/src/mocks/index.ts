// @brownsync/web mocks — API-shaped fixtures + MSW handlers, shared across
// Phase 2 lanes. Node server lives in ./server (import directly in tests so
// browser bundles never pull in msw/node).

export {
  type EventsFilter,
  getDefaultFixtureData,
  getEventDetail,
  getOrgDetail,
  getPlaceActivity,
  healthSnapshot,
  listOrgs,
  listPlaces,
  meetingsAt,
  nowSnapshot,
  queryEvents,
  resetDefaultFixtureData,
} from "./fixtureApi";
export { type FixtureResponse, fixtureRoute } from "./fixtureRoutes";
export {
  campusDayToken,
  campusMinutes,
  FIXTURE_IDS,
  FIXTURE_ORGS,
  FIXTURE_PLACES,
  type FixtureData,
  makeFixtureData,
} from "./fixtures";
export { buildHandlers, handlers } from "./handlers";
