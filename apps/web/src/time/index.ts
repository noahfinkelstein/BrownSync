// apps/web/src/time — the time machine (Phase 2 G).
// Everything on screen filters through one cursor store; scrubbing never
// refetches. Mount `TimeMachineBar` into the header {SLOT:scrubber} and call
// `connectTimeCursorToUrl(timeCursor, createHistoryUrlAdapter())` once at app
// bootstrap (or swap in a router-based UrlAdapter — see urlSync.ts).

export {
  createTimeCursor,
  DEFAULT_WINDOW_AFTER_MS,
  DEFAULT_WINDOW_BEFORE_MS,
  FALLBACK_EVENT_DURATION_MS,
  floorToMinute,
  LIVE_TICK_MS,
  type TimeCursorOptions,
  type TimeCursorStore,
  type TimeWindow,
  timeCursor,
} from "./cursor";
export { formatClock, formatCursor, formatRelative } from "./format";
export {
  getPreset,
  type TimePreset,
  type TimePresetId,
  tonightPreset,
  weekendPreset,
} from "./presets";
export {
  createScrubberScale,
  SCRUB_SPAN_DAYS,
  SCRUB_STEP_MINUTES,
  type ScrubberScale,
  stepLocalDay,
} from "./scrubberScale";
export { TimeMachineBar, type TimeMachineBarProps } from "./TimeMachineBar";
export { TimePresets, type TimePresetsProps } from "./TimePresets";
export { TimeScrubber, type TimeScrubberProps } from "./TimeScrubber";
export {
  addLocalDays,
  CAMPUS_TZ,
  DAY_MS,
  dayBoundaries,
  HOUR_MS,
  isSameLocalDay,
  localDayOfWeek,
  localParts,
  localWeekday,
  MINUTE_MS,
  startOfLocalDay,
  tzOffsetMs,
  zonedTimeToUtc,
} from "./tz";
export {
  AT_PARAM,
  type ConnectUrlOptions,
  connectTimeCursorToUrl,
  createHistoryUrlAdapter,
  decodeAt,
  encodeAt,
  type HistoryWindowLike,
  type UrlAdapter,
} from "./urlSync";
export { useTimeCursor } from "./useTimeCursor";
