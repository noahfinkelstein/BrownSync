import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  campusDate,
  type DiningDocument,
  type DiningLocation,
  type DiningService,
  dietaryIcons,
  formatServiceTime,
  isServing,
  servicesOn,
  sortByAvailability,
  statusAt,
} from "../src/dining/model";

const artifact = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../db/seeds/dining_menus.json"), "utf8"),
) as DiningDocument;

const MIN = 60_000;

function service(over: Partial<DiningService> = {}): DiningService {
  return {
    date: "2026-07-29",
    meal: "Lunch",
    name: "Blue Room",
    start: "2026-07-29T11:00:00-04:00",
    end: "2026-07-29T15:00:00-04:00",
    stations: [{ name: "Pastry", items: [{ name: "Muffin" }] }],
    ...over,
  };
}

function location(over: Partial<DiningLocation> = {}): DiningLocation {
  return {
    locationId: "BR",
    name: "Blue Room",
    address: "75 Waterman St.",
    placeId: "blue-room",
    services: [service()],
    ...over,
  };
}

const at = (iso: string): number => Date.parse(iso);

describe("the published artifact matches the model's shape", () => {
  it("carries all seven halls with a place id each", () => {
    expect(artifact.schema_version).toBe(1);
    expect(artifact.locations).toHaveLength(7);
    for (const hall of artifact.locations) {
      expect(hall.placeId, hall.locationId).toBeTruthy();
      expect(hall.name).toBeTruthy();
    }
  });

  it("keeps closed halls present rather than dropping them", () => {
    // Four are shut all summer. Dropping them turns "is the Ratty open?" from
    // answerable-no into unanswerable.
    const shut = artifact.locations.filter((hall) => hall.services.length === 0);
    expect(shut.length).toBeGreaterThan(0);
    expect(shut.length).toBeLessThan(artifact.locations.length);
  });

  it("publishes offset-bearing timestamps, not bare local times", () => {
    // A bare "2026-07-29T07:30:00" would be parsed as the READER's local time,
    // so the Blue Room would appear to open at 07:30 in Berlin.
    let checked = 0;
    for (const hall of artifact.locations) {
      for (const svc of hall.services) {
        for (const stamp of [svc.start, svc.end]) {
          if (!stamp) continue;
          expect(stamp).toMatch(/[+-]\d{2}:\d{2}$/);
          expect(Number.isFinite(Date.parse(stamp))).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe("isServing", () => {
  it("is true inside the window", () => {
    expect(isServing(service(), at("2026-07-29T12:00:00-04:00"))).toBe(true);
  });

  it("is true at the opening instant and FALSE at the closing instant", () => {
    // Half-open on purpose. Reporting "open" at exactly 15:00 sends someone
    // across campus to a locked door.
    expect(isServing(service(), at("2026-07-29T11:00:00-04:00"))).toBe(true);
    expect(isServing(service(), at("2026-07-29T15:00:00-04:00"))).toBe(false);
    expect(isServing(service(), at("2026-07-29T14:59:59-04:00"))).toBe(true);
  });

  it("is false before opening", () => {
    expect(isServing(service(), at("2026-07-29T10:59:59-04:00"))).toBe(false);
  });

  it("treats a missing end as still open", () => {
    // The source leaves `end` null occasionally. Hiding a menu that exists is
    // worse than showing one whose closing time we do not know.
    expect(isServing(service({ end: null }), at("2026-07-29T23:00:00-04:00"))).toBe(true);
  });

  it("is false when the start is missing or unparseable", () => {
    expect(isServing(service({ start: null }), at("2026-07-29T12:00:00-04:00"))).toBe(false);
    expect(isServing(service({ start: "soon" }), at("2026-07-29T12:00:00-04:00"))).toBe(false);
  });
});

describe("statusAt", () => {
  it("reports open with a countdown to closing", () => {
    const status = statusAt(location(), at("2026-07-29T14:30:00-04:00"));
    expect(status.kind).toBe("open");
    if (status.kind === "open") expect(status.closesInMs).toBe(30 * MIN);
  });

  it("reports the next opening when shut right now", () => {
    const status = statusAt(location(), at("2026-07-29T09:00:00-04:00"));
    expect(status.kind).toBe("opens-later");
    if (status.kind === "opens-later") expect(status.opensInMs).toBe(120 * MIN);
  });

  it("picks the SOONEST future service, not the first in the list", () => {
    const hall = location({
      services: [
        service({ meal: "Dinner", start: "2026-07-29T17:00:00-04:00", end: null }),
        service({ meal: "Lunch", start: "2026-07-29T11:00:00-04:00", end: null }),
      ],
    });
    const status = statusAt(hall, at("2026-07-29T09:00:00-04:00"));
    expect(status.kind).toBe("opens-later");
    if (status.kind === "opens-later") expect(status.service.meal).toBe("Lunch");
  });

  it("reports closed for a hall with no services at all", () => {
    expect(statusAt(location({ services: [] }), Date.now()).kind).toBe("closed");
  });

  it("reports closed once every service is in the past", () => {
    expect(statusAt(location(), at("2026-07-30T12:00:00-04:00")).kind).toBe("closed");
  });

  it("null end means open with an unknown closing time, not a zero countdown", () => {
    const status = statusAt(
      location({ services: [service({ end: null })] }),
      at("2026-07-29T23:00:00-04:00"),
    );
    expect(status.kind).toBe("open");
    if (status.kind === "open") expect(status.closesInMs).toBeNull();
  });
});

describe("campusDate", () => {
  it("uses CAMPUS-local dates, not UTC", () => {
    // THE bug this exists to avoid. 21:00 EDT on the 29th is 01:00 UTC on the
    // 30th, so `toISOString().slice(0,10)` shows tomorrow's breakfast while
    // the user is standing in tonight's dinner queue.
    const evening = at("2026-07-29T21:00:00-04:00");
    expect(new Date(evening).toISOString().slice(0, 10)).toBe("2026-07-30");
    expect(campusDate(evening)).toBe("2026-07-29");
  });

  it("rolls over at campus midnight", () => {
    expect(campusDate(at("2026-07-29T23:59:00-04:00"))).toBe("2026-07-29");
    expect(campusDate(at("2026-07-30T00:01:00-04:00"))).toBe("2026-07-30");
  });
});

describe("formatServiceTime", () => {
  it("renders campus wall-clock regardless of the reader's zone", () => {
    expect(formatServiceTime("2026-07-29T07:30:00-04:00")).toBe("7:30 AM");
    expect(formatServiceTime("2026-07-29T15:00:00-04:00")).toBe("3:00 PM");
  });

  it("returns null for missing or junk input", () => {
    expect(formatServiceTime(null)).toBeNull();
    expect(formatServiceTime("whenever")).toBeNull();
  });
});

describe("servicesOn", () => {
  it("filters to one calendar date and orders by start", () => {
    const hall = location({
      services: [
        service({ meal: "Dinner", start: "2026-07-29T17:00:00-04:00" }),
        service({ meal: "Breakfast", start: "2026-07-29T07:30:00-04:00" }),
        service({ date: "2026-07-30", meal: "Lunch" }),
      ],
    });
    expect(servicesOn(hall, "2026-07-29").map((s) => s.meal)).toEqual(["Breakfast", "Dinner"]);
  });
});

describe("sortByAvailability", () => {
  it("puts open halls first, then soonest-opening, then closed", () => {
    const now = at("2026-07-29T12:00:00-04:00");
    const open = location({ locationId: "BR", name: "Blue Room" });
    const later = location({
      locationId: "VW",
      name: "Verney-Woolley",
      services: [service({ start: "2026-07-29T17:00:00-04:00", end: null })],
    });
    const shut = location({ locationId: "SHRP", name: "Sharpe Refectory", services: [] });
    expect(sortByAvailability([shut, later, open], now).map((l) => l.locationId)).toEqual([
      "BR",
      "VW",
      "SHRP",
    ]);
  });

  it("is stable by name within a tier", () => {
    const now = at("2026-07-29T12:00:00-04:00");
    const b = location({ locationId: "B", name: "Bravo", services: [] });
    const a = location({ locationId: "A", name: "Alpha", services: [] });
    expect(sortByAvailability([b, a], now).map((l) => l.name)).toEqual(["Alpha", "Bravo"]);
  });
});

describe("dietaryIcons", () => {
  it("collects and dedupes across every station", () => {
    const svc = service({
      stations: [
        {
          name: "A",
          items: [
            { name: "x", icons: ["VGN"] },
            { name: "y", icons: ["VGTN"] },
          ],
        },
        { name: "B", items: [{ name: "z", icons: ["VGN", "HL"] }] },
      ],
    });
    expect(dietaryIcons(svc)).toEqual(["HL", "VGN", "VGTN"]);
  });

  it("uses only codes the artifact actually defines labels for", () => {
    const defined = new Set(Object.keys(artifact.icon_labels));
    for (const hall of artifact.locations) {
      for (const svc of hall.services) {
        for (const icon of dietaryIcons(svc)) {
          expect(defined.has(icon), `${icon} has no label`).toBe(true);
        }
      }
    }
  });
});
