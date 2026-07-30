import type { EventOut } from "@brownsync/contract";
import { addLocalDays, localParts, startOfLocalDay } from "../time/tz";
import { isSameDay } from "./format";

/**
 * Time-bucket grouping for the list view — handoff §3.2 "grouped by time
 * ('Happening now', 'Next hour', 'Tonight' …)". Pure; `now` is injected.
 */

export type TimeBucketId = "now" | "next-hour" | "today" | "tonight" | "tomorrow" | "week";

export type TimeBucket = { id: TimeBucketId; label: string; events: EventOut[] };

export const BUCKET_LABELS: Record<TimeBucketId, string> = {
  now: "Happening now",
  "next-hour": "Next hour",
  today: "Today",
  tonight: "Tonight",
  tomorrow: "Tomorrow",
  week: "This week",
};

const BUCKET_ORDER: readonly TimeBucketId[] = [
  "now",
  "next-hour",
  "today",
  "tonight",
  "tomorrow",
  "week",
];

const HOUR_MS = 60 * 60 * 1000;
/** Events without an `end` are assumed to run this long (list only, never stored). */
export const ASSUMED_DURATION_MS = 2 * HOUR_MS;
/** Local hour from which "later today" reads as "Tonight". */
const EVENING_HOUR = 17;

function effectiveEndMs(e: EventOut, start: Date): number {
  if (e.end) return new Date(e.end).getTime();
  if (e.allDay) {
    return addLocalDays(startOfLocalDay(start), 1).getTime();
  }
  return start.getTime() + ASSUMED_DURATION_MS;
}

/** Bucket for one event, or null when it already ended (drop from the list). */
export function bucketOf(e: EventOut, now: Date): TimeBucketId | null {
  const start = new Date(e.start);
  const startMs = start.getTime();
  const nowMs = now.getTime();
  const tomorrow = addLocalDays(now, 1);

  if (e.allDay) {
    // All-day rows read as day items, never "happening now" noise.
    if (isSameDay(start, now)) return effectiveEndMs(e, start) > nowMs ? "today" : null;
    if (startMs <= nowMs) return null;
    return isSameDay(start, tomorrow) ? "tomorrow" : "week";
  }

  if (startMs <= nowMs) return effectiveEndMs(e, start) > nowMs ? "now" : null;
  if (startMs <= nowMs + HOUR_MS) return "next-hour";
  if (isSameDay(start, now)) {
    return localParts(start).hour >= EVENING_HOUR ? "tonight" : "today";
  }
  if (isSameDay(start, tomorrow)) return "tomorrow";
  return "week";
}

/** Ordered, non-empty buckets; events sorted by start (title tiebreak). */
export function groupEventsByTime(events: readonly EventOut[], now: Date): TimeBucket[] {
  const byBucket = new Map<TimeBucketId, EventOut[]>();
  for (const e of events) {
    const id = bucketOf(e, now);
    if (!id) continue;
    const list = byBucket.get(id);
    if (list) list.push(e);
    else byBucket.set(id, [e]);
  }
  const buckets: TimeBucket[] = [];
  for (const id of BUCKET_ORDER) {
    const list = byBucket.get(id);
    if (!list) continue;
    list.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
    buckets.push({ id, label: BUCKET_LABELS[id], events: list });
  }
  return buckets;
}

/** Starting within 30 min — the ONE ambient pulse the design law allows (§6.4). */
export function isLive(e: EventOut, now: Date): boolean {
  const delta = new Date(e.start).getTime() - now.getTime();
  return delta > 0 && delta <= 30 * 60_000;
}
