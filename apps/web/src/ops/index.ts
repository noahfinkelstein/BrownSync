// Lane I public surface — the integrator imports from "./ops" only.

export {
  type AnalyticsEvent,
  analyticsEnabled,
  initAnalytics,
  resetAnalyticsForTests,
  track,
} from "./analytics";
export { HealthStrip, type HealthStripProps } from "./HealthStrip";
export {
  aggregateStatus,
  type EffectiveStatus,
  effectiveStatus,
  latestOkAt,
  type SourceHealth,
  STALE_AFTER_MS,
  sourceLabel,
  statusWord,
} from "./health-model";
export { EmptyEvents, EmptyPlaceDay, EmptySearch } from "./states/empty";
export { ErrorState, type ErrorStateProps } from "./states/error";
export { ListSkeleton, PanelSkeleton } from "./states/skeletons";
export { formatAgo } from "./time";
export {
  HEALTH_REFRESH_MS,
  type HealthPhase,
  type HealthState,
  healthUrl,
  useHealth,
} from "./useHealth";
