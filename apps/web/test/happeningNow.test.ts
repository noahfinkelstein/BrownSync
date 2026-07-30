import type { EventOut } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import { DEFAULT_DURATION_MS, isEventLive, SOON_MS } from "../src/map/eventsLayer";
import { EMPTY_HAPPENING, happeningNow, MAX_ROWS, placeLabel } from "../src/panels/liveNow";

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
    placeId: null,
    placeName: null,
    locationRaw: null,
    orgId: null,
    orgName: null,
    category: "academic",
    tags: [],
    url: null,
    cost: null,
    source: "test",
    confidence: 1,
    isCanceled: false,
    ...over,
  } as EventOut;
}

const iso = (offsetMs: number): string => new Date(AT_MS + offsetMs).toISOString();

describe("happeningNow counts only what is actually in progress", () => {
  it("counts an event that spans the cursor", () => {
    const e = event({ start: iso(-30 * MIN), end: iso(30 * MIN) });
    const model = happeningNow([e], AT);
    expect(model.live).toBe(1);
    expect(model.rows[0]?.inProgress).toBe(true);
    expect(model.rows[0]?.offsetMs).toBe(30 * MIN);
  });

  it("does NOT count an event that is merely inside the map's 2 h lookahead", () => {
    // THE failure this module exists to prevent. eventsLayer.isEventLive is
    // `start <= cursor + LOOKAHEAD`, i.e. "draw this dot" — true 90 minutes
    // out. A bar built on it says a 19:30 lecture is happening at 18:00.
    const later = event({ start: iso(90 * MIN), end: iso(150 * MIN) });
    expect(isEventLive(later, AT_MS)).toBe(true); // map: yes, draw it
    const model = happeningNow([later], AT);
    expect(model.live).toBe(0);
    expect(model.soon).toBe(0);
    expect(model.rows).toEqual([]);
  });

  it("treats a null end as the map's default duration, not as forever", () => {
    const open = event({ start: iso(-DEFAULT_DURATION_MS + MIN) });
    const done = event({ start: iso(-DEFAULT_DURATION_MS - MIN) });
    expect(happeningNow([open], AT).live).toBe(1);
    expect(happeningNow([done], AT).live).toBe(0);
  });

  it("falls back to the default duration when the feed's end is unparseable", () => {
    // `Date.parse("tbd")` is NaN and `NaN >= cursor` is false, so a naive
    // implementation silently drops an event that is plainly happening
    // because one upstream row shipped a malformed end timestamp.
    const junk = event({ start: iso(-10 * MIN), end: "to be announced" });
    expect(happeningNow([junk], AT).live).toBe(1);
  });

  it("includes both endpoints — an event ending exactly now is still live", () => {
    const ending = event({ start: iso(-60 * MIN), end: iso(0) });
    const starting = event({ start: iso(0), end: iso(60 * MIN) });
    expect(happeningNow([ending, starting], AT).live).toBe(2);
  });

  it("never counts a canceled event, in progress or imminent", () => {
    const running = event({ start: iso(-MIN), end: iso(MIN), isCanceled: true });
    const imminent = event({ start: iso(10 * MIN), isCanceled: true });
    const model = happeningNow([running, imminent], AT);
    expect(model).toEqual(EMPTY_HAPPENING);
  });

  it("drops an event whose start will not parse", () => {
    expect(happeningNow([event({ start: "not a date" })], AT)).toEqual(EMPTY_HAPPENING);
  });
});

describe("the soon window is (0, 30 min]", () => {
  it("is exclusive at the cursor and inclusive at the 30-minute edge", () => {
    const edge = event({ start: iso(SOON_MS) });
    const past = event({ start: iso(SOON_MS + MIN) });
    expect(happeningNow([edge], AT).soon).toBe(1);
    expect(happeningNow([past], AT).soon).toBe(0);
  });

  it("counts an event starting exactly now as live and NOT as soon", () => {
    // The two buckets must be disjoint: `live + soon` is rendered as two
    // numbers on one line, and double-counting the 18:00 event inflates both.
    const model = happeningNow([event({ start: iso(0) })], AT);
    expect(model.live).toBe(1);
    expect(model.soon).toBe(0);
    expect(model.rows).toHaveLength(1);
  });
});

describe("row order puts the most imminent first", () => {
  it("lists in-progress rows before imminent ones", () => {
    const rows = happeningNow(
      [
        event({ start: iso(2 * MIN), title: "Soon", id: "soon" }),
        event({ start: iso(-5 * MIN), title: "Running", id: "running" }),
      ],
      AT,
    ).rows;
    expect(rows.map((r) => r.event.id)).toEqual(["running", "soon"]);
  });

  it("orders in-progress rows most-recently-started first", () => {
    // The one that just started is the one you can still catch from the top;
    // a talk that began 90 minutes ago is nearly over and ranks last.
    const rows = happeningNow(
      [
        event({ start: iso(-80 * MIN), end: iso(20 * MIN), id: "old" }),
        event({ start: iso(-3 * MIN), end: iso(60 * MIN), id: "fresh" }),
        event({ start: iso(-30 * MIN), end: iso(30 * MIN), id: "middle" }),
      ],
      AT,
    ).rows;
    expect(rows.map((r) => r.event.id)).toEqual(["fresh", "middle", "old"]);
  });

  it("orders imminent rows soonest-first", () => {
    const rows = happeningNow(
      [event({ start: iso(25 * MIN), id: "late" }), event({ start: iso(4 * MIN), id: "early" })],
      AT,
    ).rows;
    expect(rows.map((r) => r.event.id)).toEqual(["early", "late"]);
  });

  it("breaks same-minute ties by id so the 60 s refetch cannot reshuffle rows", () => {
    // Array#sort is not required to be stable across engines for equal keys,
    // and the live refetch re-sorts identical data every 60 s. Without the
    // tiebreak, rows swap places under the pointer mid-click (§6.4: nothing
    // moves unless the cursor moved).
    const a = event({ start: iso(5 * MIN), id: "a-event" });
    const z = event({ start: iso(5 * MIN), id: "z-event" });
    expect(happeningNow([z, a], AT).rows.map((r) => r.event.id)).toEqual(["a-event", "z-event"]);
    expect(happeningNow([a, z], AT).rows.map((r) => r.event.id)).toEqual(["a-event", "z-event"]);
  });
});

describe("the list is capped but the counts are not", () => {
  it("returns at most MAX_ROWS rows while still counting every live event", () => {
    // The header number is the truth; the rows are a preview. Capping the
    // count instead would put "5 happening now" over a map drawing eleven.
    const events = Array.from({ length: 11 }, (_, i) =>
      event({ start: iso(-(i + 1) * MIN), end: iso(60 * MIN), id: `e${i}` }),
    );
    const model = happeningNow(events, AT);
    expect(model.live).toBe(11);
    expect(model.rows).toHaveLength(MAX_ROWS);
  });

  it("honours an explicit limit and treats a nonsense limit as empty", () => {
    const events = [event({ start: iso(-MIN), id: "a" }), event({ start: iso(-2 * MIN), id: "b" })];
    expect(happeningNow(events, AT, 1).rows.map((r) => r.event.id)).toEqual(["a"]);
    expect(happeningNow(events, AT, -3).rows).toEqual([]);
  });
});

describe("placeLabel", () => {
  it("prefers the resolved place name over the feed's raw location", () => {
    expect(
      placeLabel(event({ start: iso(0), placeName: "Salomon Center", locationRaw: "Salomon 101" })),
    ).toBe("Salomon Center");
  });

  it("falls back to the raw location when nothing resolved", () => {
    expect(placeLabel(event({ start: iso(0), locationRaw: "Main Green" }))).toBe("Main Green");
  });

  it("returns null for missing or whitespace-only locations", () => {
    // An empty string would render a dangling "19:04 · " separator.
    expect(placeLabel(event({ start: iso(0) }))).toBeNull();
    expect(placeLabel(event({ start: iso(0), locationRaw: "   " }))).toBeNull();
  });
});
