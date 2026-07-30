const HOUR_MS = 60 * 60_000;

/**
 * Query policy for JSON artifacts regenerated daily by ingestion.
 *
 * A mounted SPA must eventually observe a newly published artifact, while
 * focus and interval refetches stay bounded to one request per hour.
 */
export const DAILY_ARTIFACT_QUERY_OPTIONS = {
  staleTime: HOUR_MS,
  gcTime: 2 * HOUR_MS,
  refetchInterval: HOUR_MS,
  refetchOnWindowFocus: true,
} as const;
