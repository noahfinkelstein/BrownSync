import { CATEGORY_IDS, EventOutSchema, MeetingOutSchema, NowOutSchema } from "@brownsync/contract";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_IDS,
  getEventDetail,
  makeFixtureData,
  meetingsAt,
  nowSnapshot,
  queryEvents,
} from "../src/mocks";

// Thursday 18:38 ET (22:38Z, EDT).
const BASE = new Date("2026-10-01T22:38:00Z");
const data = makeFixtureData(BASE);

describe("fixture dataset", () => {
  it("is contract-shaped (Zod-parses clean)", () => {
    for (const e of data.events) EventOutSchema.parse(e);
    for (const m of data.meetings) MeetingOutSchema.parse(m);
  });

  it("is deterministic relative to base", () => {
    const again = makeFixtureData(BASE);
    expect(again.events).toEqual(data.events);
    expect(again.meetings).toEqual(data.meetings);
  });
});

describe("queryEvents (contract §3 semantics)", () => {
  it("applies overlap semantics over [from, to]", () => {
    const events = queryEvents(data, {
      from: BASE.toISOString(),
      to: new Date(BASE.getTime() + 2 * 3_600_000).toISOString(),
    });
    const ids = events.map((e) => e.id);
    expect(ids).toContain(FIXTURE_IDS.inProgressColloquium); // overlaps from
    expect(ids).toContain(FIXTURE_IDS.startingSoonGbm);
    expect(ids).not.toContain(FIXTURE_IDS.athleticsVolleyball); // starts at +320 min
    // sorted by start
    const starts = events.map((e) => Date.parse(e.start));
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("filters by category and q", () => {
    const athletics = queryEvents(data, { category: "athletics" });
    expect(athletics.every((e) => e.category === "athletics")).toBe(true);
    expect(athletics.length).toBeGreaterThan(0);
    const trivia = queryEvents(data, { q: "trivia" });
    expect(trivia).toHaveLength(1);
    expect(trivia[0]?.title).toContain("Trivia");
  });
});

describe("getEventDetail", () => {
  it("expands org and place", () => {
    const detail = getEventDetail(data, FIXTURE_IDS.startingSoonGbm);
    expect(detail?.org?.id).toBe("brown-outing-club");
    expect(detail?.place?.id).toBe("faunce-house");
  });
  it("returns null for unknown ids", () => {
    expect(getEventDetail(data, "nope")).toBeNull();
  });
});

describe("meetingsAt (campus wall-clock expansion)", () => {
  it("returns the synthetic in-session sections at base", () => {
    const meetings = meetingsAt(data, BASE.toISOString());
    expect(meetings.length).toBe(3);
    expect(meetings.every((m) => m.days.includes("Th"))).toBe(true);
  });

  it("honors day tokens: MUSC 0550 meets Wednesday 19:00–21:00 ET only", () => {
    // Wednesday 19:30 ET = 23:30Z (EDT).
    const wed = meetingsAt(data, "2026-09-30T23:30:00Z");
    expect(wed.map((m) => m.courseCode)).toEqual(["MUSC 0550"]);
    // Same wall time on Thursday: no MUSC, no MWF morning sections.
    const thu = meetingsAt(data, "2026-10-01T23:30:00Z");
    expect(thu.map((m) => m.courseCode)).not.toContain("MUSC 0550");
  });

  it("MWF morning sections are in session Monday 10:15 ET", () => {
    // Monday 2026-10-05 10:15 ET = 14:15Z.
    const mon = meetingsAt(data, "2026-10-05T14:15:00Z");
    const codes = mon.map((m) => m.courseCode);
    expect(codes).toContain("MATH 0100");
    expect(codes).toContain("ECON 0110");
    expect(codes).not.toContain("CSCI 0150"); // 09:00–09:50 already over
  });
});

describe("nowSnapshot", () => {
  const snapshot = nowSnapshot(data, BASE.toISOString());

  it("is contract-shaped with all 10 category keys", () => {
    NowOutSchema.parse(snapshot);
    expect(Object.keys(snapshot.countsByCategory).sort()).toEqual([...CATEGORY_IDS].sort());
  });

  it("includes in-progress + ≤2h events, excludes canceled", () => {
    const ids = snapshot.events.map((e) => e.id);
    expect(ids).toContain(FIXTURE_IDS.inProgressColloquium);
    expect(ids).toContain(FIXTURE_IDS.startingSoonLateNight);
    expect(ids).not.toContain(FIXTURE_IDS.canceledPumpkins);
    expect(ids).not.toContain(FIXTURE_IDS.athleticsVolleyball);
  });

  it("counts meetings under the class category", () => {
    expect(snapshot.countsByCategory.class).toBe(snapshot.meetings.length);
  });
});
