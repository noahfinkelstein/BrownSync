import type { MeetingOut } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import {
  activeBuildingColor,
  activityLevel,
  aggregateMeetingActivity,
  BUILDING_3D_BASE,
  blendHex,
  classActivityColorExpression,
  totalMeetingCount,
} from "../src/map/classesLayer";

let seq = 0;
function meeting(overrides: Partial<MeetingOut>): MeetingOut {
  seq += 1;
  return {
    id: `m-${seq}`,
    courseCode: `DEPT ${seq}`,
    title: `Course ${seq}`,
    instructor: null,
    days: "MWF",
    startTime: "10:00",
    endTime: "10:50",
    locationRaw: null,
    placeId: "salomon-center",
    placeName: "Salomon Center",
    room: null,
    lat: 41.8266,
    lng: -71.4029,
    ...overrides,
  };
}

describe("aggregateMeetingActivity", () => {
  it("groups by place, counts, and sorts descending", () => {
    const meetings = [
      meeting({}),
      meeting({}),
      meeting({
        placeId: "barus-holley",
        placeName: "Barus & Holley",
        lat: 41.8267,
        lng: -71.3999,
      }),
      meeting({}),
    ];
    const activities = aggregateMeetingActivity(meetings);
    expect(activities).toHaveLength(2);
    expect(activities[0]?.placeId).toBe("salomon-center");
    expect(activities[0]?.count).toBe(3);
    expect(activities[1]?.placeId).toBe("barus-holley");
    expect(activities[1]?.count).toBe(1);
    expect(totalMeetingCount(activities)).toBe(4);
  });

  it("drops meetings without a resolved place or coords", () => {
    const unresolved = [
      meeting({ placeId: null, placeName: null }),
      meeting({ lat: null, lng: null }),
    ];
    expect(aggregateMeetingActivity(unresolved)).toHaveLength(0);
  });
});

describe("activity → fill saturation", () => {
  it("scales counts into [0,1] with full at 5", () => {
    expect(activityLevel(0)).toBe(0);
    expect(activityLevel(1)).toBeCloseTo(0.2);
    expect(activityLevel(5)).toBe(1);
    expect(activityLevel(12)).toBe(1);
  });

  it("blends hex channels linearly and clamps t", () => {
    expect(blendHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(blendHex("#102030", "#102030", 0.7)).toBe("#102030");
    expect(blendHex("#000000", "#ffffff", 2)).toBe("#ffffff");
  });

  it("active building color stays a valid dark-tinted hex", () => {
    const active = activeBuildingColor(BUILDING_3D_BASE);
    expect(active).toMatch(/^#[0-9a-f]{6}$/);
    expect(active).not.toBe(BUILDING_3D_BASE);
  });

  it("paint expression ramps base → active on feature-state", () => {
    const expr = classActivityColorExpression(BUILDING_3D_BASE) as unknown as unknown[];
    expect(expr[0]).toBe("interpolate");
    expect(expr).toContain(BUILDING_3D_BASE);
    expect(expr).toContain(activeBuildingColor(BUILDING_3D_BASE));
    expect(JSON.stringify(expr)).toContain('"feature-state","classActivity"');
  });
});
