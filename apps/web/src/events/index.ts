/**
 * Events directory — browse and search every event in the cursor window
 * without the map, plus calendar export that survives contact with Google.
 *
 * Integration: mount `<EventsDirectory />` on its own route (it owns its
 * scroll container and reads `?q=` / `?cats=` / `?org=` off whatever route
 * it is on). `calendar.ts` is standalone and safe to import anywhere that
 * needs an add-to-calendar affordance.
 */

export {
  allDayRange,
  type CalendarLinks,
  calendarDescription,
  calendarLinks,
  calendarLocation,
  campusBasicDate,
  campusDayKey,
  downloadEventsIcs,
  eventInterval,
  eventsToIcs,
  exportableEvents,
  foldIcsLine,
  googleCalendarUrl,
  googleDatesParam,
  icsCalendarFilename,
  isExportable,
  type OutlookFlavor,
  outlookCalendarUrl,
} from "./calendar";
export {
  type DayGroup,
  type DirectoryFilters,
  EventsDirectory,
  type EventsDirectoryProps,
  eventMatchesQuery,
  filterEvents,
  groupEventsByDay,
  ORG_PARAM,
  organizerOptions,
  QUERY_PARAM,
} from "./EventsDirectory";
export { absoluteHttpUrl } from "./url";
