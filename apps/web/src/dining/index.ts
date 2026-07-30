// apps/web/src/dining — dining halls, hours and menus.
//
// The data is a static daily artifact (`/data/dining-menus.json`), not an API
// route: Brown OIT's service bus sends no CORS header, so the browser cannot
// reach it and proxying it per visitor would turn one polite daily request
// into thousands. See gate G4 in BROWNSYNC_V2_PLAN.md.

export { DiningPanel } from "./DiningPanel";
export {
  CAMPUS_TZ,
  campusDate,
  type DiningDocument,
  type DiningItem,
  type DiningLocation,
  type DiningService,
  type DiningStation,
  type DiningStatus,
  dietaryIcons,
  formatServiceTime,
  isServing,
  servicesOn,
  sortByAvailability,
  statusAt,
} from "./model";
export { DINING_DATA_URL, useDining } from "./useDining";
