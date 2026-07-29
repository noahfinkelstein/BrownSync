import type { HealthOut } from "@brownsync/contract";

/** One row of GET /api/health (contract §3). */
export type SourceHealth = HealthOut["sources"][number];

/** Display vocabulary — matches the ui package's StatusDot, not the wire enum. */
export type EffectiveStatus = "ok" | "stale" | "error";

/**
 * Pollers run at most every 10 minutes (contract §5). 45 minutes without a
 * successful run means something upstream is wedged even if the last recorded
 * run claimed "ok" — surface it as stale rather than lying green.
 */
export const STALE_AFTER_MS = 45 * 60_000;

/** Reader-facing names for wire source slugs. */
const SOURCE_LABELS: Record<string, string> = {
  athletics_ics: "Athletics",
  bdh: "BDH",
  cab: "CAB",
  clubs: "Clubs",
  livewhale: "LiveWhale",
  manual: "Manual",
  osm: "OSM",
};

export function sourceLabel(source: string): string {
  const known = SOURCE_LABELS[source];
  if (known) return known;
  return source
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Wire status + last-ok age → the dot color a reader should see. */
export function effectiveStatus(source: SourceHealth, nowMs: number): EffectiveStatus {
  if (source.status === "error") return "error";
  if (source.status === "never" || source.status === "partial") return "stale";
  if (!source.lastOkAt) return "stale";
  const okAge = nowMs - Date.parse(source.lastOkAt);
  return Number.isNaN(okAge) || okAge > STALE_AFTER_MS ? "stale" : "ok";
}

const SEVERITY: Record<EffectiveStatus, number> = { ok: 0, stale: 1, error: 2 };

/** Worst effective status across all sources — for the compact strip variant. */
export function aggregateStatus(sources: readonly SourceHealth[], nowMs: number): EffectiveStatus {
  let worst: EffectiveStatus = "ok";
  for (const source of sources) {
    const status = effectiveStatus(source, nowMs);
    if (SEVERITY[status] > SEVERITY[worst]) worst = status;
  }
  return worst;
}

/** Short mono word for the popover's right column. */
export function statusWord(source: SourceHealth, nowMs: number): string {
  if (source.status === "never") return "never ran";
  if (source.status === "error") return "failing";
  if (source.status === "partial") return "partial";
  return effectiveStatus(source, nowMs) === "stale" ? "stale" : "ok";
}

/** Most recent successful run across sources — the compact variant's readout. */
export function latestOkAt(sources: readonly SourceHealth[]): string | null {
  let latest: string | null = null;
  for (const source of sources) {
    if (source.lastOkAt && (!latest || source.lastOkAt > latest)) latest = source.lastOkAt;
  }
  return latest;
}
