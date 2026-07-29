import type { EventOut } from "@brownsync/contract";
import { CATEGORY_IDS } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import {
  CLUSTER_MAX_ZOOM,
  categoryColorExpression,
  EVENT_LAYER_IDS,
  eventClusterCountsLayer,
  eventClustersLayer,
  eventDotsLayer,
  eventIconsLayer,
  eventsInWindow,
  eventsToGeoJSON,
  filterByToggles,
  ICON_MIN_ZOOM,
  imminence,
  isStartingSoon,
  pulsePositions,
} from "../src/map/eventsLayer";

const CURSOR = new Date("2026-10-01T22:38:00Z");
const MIN = 60_000;

let seq = 0;
function ev(overrides: Partial<EventOut>): EventOut {
  seq += 1;
  return {
    id: `e-${seq}`,
    title: `Event ${seq}`,
    description: null,
    start: CURSOR.toISOString(),
    end: null,
    allDay: false,
    lat: 41.826,
    lng: -71.403,
    placeId: null,
    placeName: null,
    locationRaw: null,
    orgId: null,
    orgName: null,
    category: "club",
    tags: [],
    url: null,
    cost: null,
    source: "livewhale",
    confidence: 1,
    isCanceled: false,
    ...overrides,
  };
}

const at = (offsetMin: number): string =>
  new Date(CURSOR.getTime() + offsetMin * MIN).toISOString();

describe("eventsInWindow (time pass)", () => {
  it("keeps in-progress and ≤2h-upcoming events with coords", () => {
    const keep = [
      ev({ start: at(-40), end: at(50) }),
      ev({ start: at(18), end: at(78) }),
      ev({ start: at(120), end: at(180) }),
    ];
    const drop = [
      ev({ start: at(121), end: at(180) }), // beyond lookahead
      ev({ start: at(-200), end: at(-10) }), // over
      ev({ start: at(-120), end: null }), // open-ended, 90-min default elapsed
      ev({ start: at(10), end: at(60), isCanceled: true }),
      ev({ start: at(10), end: at(60), lat: null, lng: null }),
    ];
    const visible = eventsInWindow([...keep, ...drop], CURSOR);
    expect(visible.map((e) => e.id)).toEqual(keep.map((e) => e.id));
  });
});

describe("filterByToggles (rail split)", () => {
  const club = ev({ category: "club" });
  const game = ev({ category: "athletics" });
  it("routes athletics through its own toggle", () => {
    const all = { events: true, classes: true, athletics: true };
    expect(filterByToggles([club, game], all)).toHaveLength(2);
    expect(filterByToggles([club, game], { ...all, athletics: false })).toEqual([club]);
    expect(filterByToggles([club, game], { ...all, events: false })).toEqual([game]);
  });
});

describe("imminence (radius driver)", () => {
  it("is 1 in progress and through the 30-min soon window", () => {
    expect(imminence(ev({ start: at(-30), end: at(30) }), CURSOR.getTime())).toBe(1);
    expect(imminence(ev({ start: at(20) }), CURSOR.getTime())).toBe(1);
    expect(imminence(ev({ start: at(30) }), CURSOR.getTime())).toBe(1);
  });
  it("tapers to 0 at the 2 h lookahead", () => {
    expect(imminence(ev({ start: at(75) }), CURSOR.getTime())).toBeCloseTo(0.5, 5);
    expect(imminence(ev({ start: at(120) }), CURSOR.getTime())).toBe(0);
  });
});

describe("isStartingSoon / pulsePositions (the ≤30-min pulse set)", () => {
  it("only events starting in (0, 30] pulse — never in-progress ones", () => {
    const soon = ev({ start: at(18), lng: -71.4, lat: 41.83 });
    const started = ev({ start: at(-1), end: at(60) });
    const later = ev({ start: at(31) });
    expect(isStartingSoon(soon, CURSOR.getTime())).toBe(true);
    expect(isStartingSoon(started, CURSOR.getTime())).toBe(false);
    expect(isStartingSoon(later, CURSOR.getTime())).toBe(false);
    expect(pulsePositions([soon, started, later], CURSOR)).toEqual([[-71.4, 41.83]]);
  });
});

describe("eventsToGeoJSON", () => {
  it("emits minimal GPU-side props keyed back to events by id", () => {
    const e = ev({ start: at(18), category: "food", lng: -71.41, lat: 41.82 });
    const fc = eventsToGeoJSON([e], CURSOR);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f?.geometry.coordinates).toEqual([-71.41, 41.82]);
    expect(f?.properties).toEqual({ id: e.id, category: "food", imminence: 1, soon: 1 });
  });

  it("skips coordless events", () => {
    expect(eventsToGeoJSON([ev({ lat: null, lng: null })], CURSOR).features).toHaveLength(0);
  });
});

describe("layer specs", () => {
  it("category color match covers all 10 contract categories", () => {
    const expr = categoryColorExpression() as unknown as unknown[];
    for (const id of CATEGORY_IDS) {
      expect(expr).toContain(id);
    }
    // match + input + 10 pairs + fallback
    expect(expr).toHaveLength(2 + CATEGORY_IDS.length * 2 + 1);
  });

  it("clusters hand off exactly where glyphs take over", () => {
    expect(CLUSTER_MAX_ZOOM).toBeLessThan(ICON_MIN_ZOOM);
    expect(eventIconsLayer.minzoom).toBe(ICON_MIN_ZOOM);
  });

  it("cluster layers filter on point_count; event layers filter it out", () => {
    expect(eventClustersLayer.filter).toEqual(["has", "point_count"]);
    expect(eventClusterCountsLayer.filter).toEqual(["has", "point_count"]);
    expect(eventDotsLayer.filter).toEqual(["!", ["has", "point_count"]]);
    expect(eventIconsLayer.filter).toEqual(["!", ["has", "point_count"]]);
  });

  it("icon layer references the contract icon slugs", () => {
    expect(eventIconsLayer.layout?.["icon-image"]).toEqual([
      "concat",
      "icon-",
      ["get", "category"],
    ]);
  });

  it("layer ids are stable (integration surface)", () => {
    expect(Object.values(EVENT_LAYER_IDS)).toEqual([
      "bs-event-clusters",
      "bs-event-cluster-counts",
      "bs-event-dots",
      "bs-event-icons",
    ]);
  });
});
