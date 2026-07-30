import type { EventOut } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import { DEFAULT_DURATION_MS, isEventLive, SOON_MS } from "../src/map/eventsLayer";
import { EMPTY_SUMMARY, formatCountdown, summarizeNow } from "../src/panels/nowSummary";

const AT = new Date("2026-09-10T18:00:00Z");
const AT_MS = AT.getTime();
const MIN = 60_000;

function event(over: Partial<EventOut> & { start: string }): EventOut {
  return {
    id: `e-${over.start}-${over.title ?? ""}`,
    title: "Untitled",
    description: null,
    end: null,
    allDay: false,
    lat: 41.8268,
    lng: -71.4025,
    category: "academic",
    isCanceled: false,
    placeId: null,
    orgId: null,
    url: null,
    sourceId: "test",
    ...over,
  } as EventOut;
}

const iso = (offsetMs: number): string => new Date(AT_MS + offsetMs).toISOString();

describe("summarizeNow counts what is actually happening", () => {
  it("counts an event that spans the cursor", () => {
    const e = event({ start: iso(-30 * MIN), end: iso(30 * MIN) });
    expect(summarizeNow([e], 0, AT).live).toBe(1);
  });

  it("does NOT count an event that is merely within the 2 h lookahead", () => {
    // THE bug this module exists to avoid. eventsLayer.isEventLive is
    // `start <= cursor + LOOKAHEAD`, i.e. "draw this on the map" — it is true
    // for an event 90 minutes away. Reusing it here would have reported a
    // 7:30 p.m. lecture as in progress at 6 p.m.
    const later = event({ start: iso(90 * MIN), end: iso(150 * MIN) });
    expect(isEventLive(later, AT_MS)).toBe(true); // map: yes, draw it
    expect(summarizeNow([later], 0, AT).live).toBe(0); // bar: not happening
  });

  it("treats an event with no end as the default duration", () => {
    const open = event({ start: iso(-DEFAULT_DURATION_MS + MIN) });
    const done = event({ start: iso(-DEFAULT_DURATION_MS - MIN) });
    expect(summarizeNow([open], 0, AT).live).toBe(1);
    expect(summarizeNow([done], 0, AT).live).toBe(0);
  });

  it("includes both endpoints — an event ending exactly now is still live", () => {
    const ending = event({ start: iso(-60 * MIN), end: iso(0) });
    const starting = event({ start: iso(0), end: iso(60 * MIN) });
    expect(summarizeNow([ending, starting], 0, AT).live).toBe(2);
  });

  it("never counts a canceled event as live or soon", () => {
    const canceled = event({ start: iso(-MIN), end: iso(MIN), isCanceled: true });
    const summary = summarizeNow([canceled], 0, AT);
    expect(summary.live).toBe(0);
    expect(summary.soon).toBe(0);
  });
});

describe("the soon window drives the header's live dot", () => {
  it("is (0, 30 min] — exclusive at the cursor, inclusive at the edge", () => {
    const atCursor = event({ start: iso(0) });
    const edge = event({ start: iso(SOON_MS) });
    const past = event({ start: iso(SOON_MS + MIN) });
    expect(summarizeNow([atCursor], 0, AT).soon).toBe(0);
    expect(summarizeNow([edge], 0, AT).soon).toBe(1);
    expect(summarizeNow([past], 0, AT).soon).toBe(0);
  });

  it("excludes a canceled event from the pulse", () => {
    // eventsLayer.isStartingSoon has no isCanceled check; this module adds it,
    // so a canceled 6:15 p.m. talk cannot make the header dot pulse.
    const canceled = event({ start: iso(15 * MIN), isCanceled: true });
    expect(summarizeNow([canceled], 0, AT).soon).toBe(0);
  });
});

describe("the next slot", () => {
  it("picks the earliest event strictly after the cursor", () => {
    const events = [
      event({ start: iso(120 * MIN), title: "Later" }),
      event({ start: iso(20 * MIN), title: "Next" }),
      event({ start: iso(-10 * MIN), title: "Already started" }),
    ];
    const summary = summarizeNow(events, 0, AT);
    expect(summary.next?.title).toBe("Next");
    expect(summary.nextInMs).toBe(20 * MIN);
  });

  it("does not name an event that starts exactly at the cursor", () => {
    // It is already counted in `live`; naming it as "next" double-reports it.
    const summary = summarizeNow([event({ start: iso(0), title: "Now" })], 0, AT);
    expect(summary.next).toBeNull();
    expect(summary.live).toBe(1);
  });

  it("does not name a canceled event", () => {
    const events = [
      event({ start: iso(10 * MIN), title: "Canceled", isCanceled: true }),
      event({ start: iso(40 * MIN), title: "Real" }),
    ];
    expect(summarizeNow(events, 0, AT).next?.title).toBe("Real");
  });

  it("survives an unparseable start date", () => {
    const summary = summarizeNow([event({ start: "not a date" })], 0, AT);
    expect(summary).toEqual({ ...EMPTY_SUMMARY, classes: 0 });
  });

  it("returns nothing when the cursor is past everything", () => {
    const summary = summarizeNow([event({ start: iso(-5 * 60 * MIN) })], 7, AT);
    expect(summary.next).toBeNull();
    expect(summary.nextInMs).toBeNull();
    expect(summary.classes).toBe(7);
  });
});

describe("formatCountdown", () => {
  it.each([
    [30_000, "in <1 min"],
    [26 * MIN, "in 26 min"],
    [59 * MIN, "in 59 min"],
    [3 * 60 * MIN, "in 3 h"],
    [50 * 60 * MIN, "in 2 d"],
  ])("%i ms → %s", (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});
