/**
 * apps/web/src/orgs — the club directory.
 *
 * Integration: `ClubsDirectory` is the whole screen (its own scroll, its own
 * back-link to the map) and takes no route params — mount it at whatever path
 * you like. It reads and writes `?q=`, `?cats=` and `?events=` through
 * TanStack Router's functional `search` updates, so sibling params survive:
 *
 *   const ClubsDirectory = lazyRouteComponent(
 *     () => import("./orgs/ClubsDirectory"), "ClubsDirectory");
 *
 * `?cats=` is the SAME param `browse/filter.ts` publishes, so a category
 * selected on the map arrives here already applied.
 */

export { ClubsDirectory, type ClubsDirectoryProps, default } from "./ClubsDirectory";
export {
  type CategoryFacet,
  categoryFacets,
  classifyOrgLink,
  EVENTS_PARAM,
  filterOrgs,
  type LinkableOrg,
  type NormalizeOptions,
  normalizeOrgUrl,
  type OrgEventCounts,
  type OrgFilter,
  type OrgLink,
  type OrgLinkPlatform,
  orgLinks,
  orgSearchKeys,
  PLATFORM_LABELS,
  parseQ,
  parseWithEvents,
  Q_PARAM,
  useDirectoryQuery,
} from "./orgLinks";
