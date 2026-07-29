import { describe, expect, it } from "vitest";
import { formatClock, formatDayLabel, formatDayTime, formatRelative } from "../src/browse/format";
import { BUCKET_LABELS, bucketOf, groupEventsByTime, isLive } from "../src/browse/grouping";
import { mkEvent } from "./helpers/fixtures";

/** Local-time helpers: buckets are wall-time buckets (afternoon `now`). */
const NOW = new Date(2026, 6, 28, 15, 0); // Tue Jul 28 2026 15:00 local

function at(hours: number, minutes = 0, dayOffset = 0): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

describe("groupEventsByTime (handoff §3.2)", () => {
  it("buckets events into the fixed labelled groups in display order", () => {
    const events = [
      mkEvent({ id: "wk", title: "Career fair", start: at(12, 0, 4) }),
      mkEvent({ id: "tmw", title: "Morning run", start: at(10, 0, 1) }),
      mkEvent({ id: "tonight", title: "Concert", start: at(19, 0) }),
      mkEvent({ id: "today", title: "Reading group", start: at(16, 30) }),
      mkEvent({ id: "soon", title: "Colloquium", start: at(15, 40) }),
      mkEvent({ id: "live", title: "Workshop", start: at(14, 30), end: at(16, 0) }),
    ];
    const groups = groupEventsByTime(events, NOW);
    expect(groups.map((g) => g.label)).toEqual([
      "Happening now",
      "Next hour",
      "Today",
      "Tonight",
      "Tomorrow",
      "This week",
    ]);
    expect(groups.map((g) => g.events.map((e) => e.id))).toEqual([
      ["live"],
      ["soon"],
      ["today"],
      ["tonight"],
      ["tmw"],
      ["wk"],
    ]);
  });

  it("omits empty groups and drops already-ended events", () => {
    const events = [
      mkEvent({ id: "over", title: "Breakfast", start: at(8, 0), end: at(9, 0) }),
      mkEvent({ id: "tonight", title: "Trivia", start: at(21, 0) }),
    ];
    const groups = groupEventsByTime(events, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe("tonight");
  });

  it("assumes 2 h duration when end is null", () => {
    // Started 90 min ago, no end -> still happening.
    expect(bucketOf(mkEvent({ id: "a", title: "A", start: at(13, 30) }), NOW)).toBe("now");
    // Started 3 h ago, no end -> gone.
    expect(bucketOf(mkEvent({ id: "b", title: "B", start: at(12, 0) }), NOW)).toBeNull();
  });

  it("puts an event within 60 min into Next hour even across midnight", () => {
    const lateNow = new Date(2026, 6, 28, 23, 45);
    const e = mkEvent({ id: "mid", title: "Midnight ramble", start: at(0, 30, 1) });
    expect(bucketOf(e, lateNow)).toBe("next-hour");
  });

  it("evening now: later-today events all read as Tonight", () => {
    const eveningNow = new Date(2026, 6, 28, 20, 0);
    const e = mkEvent({ id: "late", title: "Late show", start: at(21, 30) });
    expect(bucketOf(e, eveningNow)).toBe("tonight");
  });

  it("keeps all-day events as day items, not Happening now", () => {
    const allDay = mkEvent({ id: "ad", title: "Art exhibit", start: at(0, 0), allDay: true });
    expect(bucketOf(allDay, NOW)).toBe("today");
    const allDayTomorrow = mkEvent({
      id: "adt",
      title: "Club fair",
      start: at(0, 0, 1),
      allDay: true,
    });
    expect(bucketOf(allDayTomorrow, NOW)).toBe("tomorrow");
  });

  it("sorts within a bucket by start time", () => {
    const groups = groupEventsByTime(
      [
        mkEvent({ id: "b", title: "B", start: at(19, 30) }),
        mkEvent({ id: "a", title: "A", start: at(18, 0) }),
      ],
      NOW,
    );
    expect(groups[0]?.events.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("labels cover every bucket id", () => {
    expect(Object.keys(BUCKET_LABELS).sort()).toEqual(
      ["next-hour", "now", "today", "tomorrow", "tonight", "week"].sort(),
    );
  });
});

describe("isLive (§6.4 — the one ambient pulse)", () => {
  it("is true only in the 30 min before start", () => {
    expect(isLive(mkEvent({ id: "a", title: "A", start: at(15, 20) }), NOW)).toBe(true);
    expect(isLive(mkEvent({ id: "b", title: "B", start: at(15, 45) }), NOW)).toBe(false);
    expect(isLive(mkEvent({ id: "c", title: "C", start: at(14, 55) }), NOW)).toBe(false);
  });
});

describe("format (§6.4 mono timestamps)", () => {
  it("formats the clock 24h zero-padded", () => {
    expect(formatClock(new Date(2026, 6, 28, 19, 4))).toBe("19:04");
    expect(formatClock(new Date(2026, 6, 28, 9, 0))).toBe("09:00");
  });

  it("formats terse relatives", () => {
    expect(formatRelative(NOW, new Date(2026, 6, 28, 15, 26))).toBe("in 26 min");
    expect(formatRelative(NOW, new Date(2026, 6, 28, 18, 0))).toBe("in 3 h");
    expect(formatRelative(NOW, new Date(2026, 6, 28, 14, 48))).toBe("12 min ago");
    expect(formatRelative(NOW, NOW)).toBe("now");
  });

  it("labels days relative to now", () => {
    expect(formatDayLabel(new Date(2026, 6, 28, 19, 0), NOW)).toBe("Today");
    expect(formatDayLabel(new Date(2026, 6, 29, 10, 0), NOW)).toBe("Tomorrow");
    expect(formatDayLabel(new Date(2026, 6, 31, 10, 0), NOW)).toBe("Fri Jul 31");
  });

  it("composes day + clock for palette metadata", () => {
    expect(formatDayTime(new Date(2026, 6, 28, 19, 0).toISOString(), NOW)).toBe("Today 19:00");
  });
});
