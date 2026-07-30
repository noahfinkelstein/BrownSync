// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createTimeCursor } from "../src/time/cursor";
import { createScrubberScale } from "../src/time/scrubberScale";
import {
  canStep,
  stepCursor,
  TIME_STEPS,
  type TimeStep,
  TimeStepper,
} from "../src/time/TimeStepper";
import { DAY_MS, HOUR_MS, localParts } from "../src/time/tz";

afterEach(cleanup);

function step(name: string): TimeStep {
  const found = TIME_STEPS.find((s) => s.name === name);
  if (!found) throw new Error(`no step named ${name}`);
  return found;
}

/**
 * DST ends Sunday 2026-11-01: 02:00 EDT becomes 01:00 EST, so that local day
 * is 25 hours long. Every day/week assertion below is anchored to it.
 */
const FALL_BACK_ANCHOR = new Date("2026-11-01T12:00:00Z");
/** Sat 2026-10-31 20:00 EDT — one local day before the transition. */
const SAT_2000_EDT = new Date("2026-11-01T00:00:00Z");

describe("hour steps are exact arithmetic", () => {
  it("moves exactly one hour", () => {
    const scale = createScrubberScale(FALL_BACK_ANCHOR);
    const from = new Date("2026-11-01T12:00:00Z");
    expect(stepCursor(scale, from, step("Forward one hour")).getTime() - from.getTime()).toBe(
      HOUR_MS,
    );
    expect(stepCursor(scale, from, step("Back one hour")).getTime() - from.getTime()).toBe(
      -HOUR_MS,
    );
  });

  it("lands on the REPEATED 01:00 when stepping into fall-back", () => {
    // 05:00Z is 01:00 EDT; 06:00Z is 01:00 EST. An hour is an hour — the wall
    // clock legitimately does not advance here, and pretending otherwise
    // (by stepping local wall-clock hours) would skip an hour of events.
    const scale = createScrubberScale(FALL_BACK_ANCHOR);
    const beforeGap = new Date("2026-11-01T05:00:00Z");
    const next = stepCursor(scale, beforeGap, step("Forward one hour"));
    expect(next.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(localParts(beforeGap).hour).toBe(1);
    expect(localParts(next).hour).toBe(1);
  });
});

describe("day steps preserve the campus wall clock across DST", () => {
  it("steps 25 hours across the 2026-11-01 EDT→EST transition, keeping 20:00", () => {
    // The concrete bug: exact 24 h arithmetic lands on 19:00 EST, so "+1d"
    // from Saturday's 20:00 concert shows Sunday at 19:00 and every event
    // between 19:00 and 20:00 appears to be the "same time tomorrow".
    const scale = createScrubberScale(FALL_BACK_ANCHOR);
    const next = stepCursor(scale, SAT_2000_EDT, step("Forward one day"));

    expect(localParts(SAT_2000_EDT).hour).toBe(20);
    expect(localParts(next).hour).toBe(20);
    expect(localParts(next).day).toBe(1);
    expect(next.getTime() - SAT_2000_EDT.getTime()).toBe(25 * HOUR_MS);
    // What a naive implementation would have produced:
    expect(localParts(SAT_2000_EDT.getTime() + DAY_MS).hour).toBe(19);
  });

  it("round-trips: forward one day then back lands on the original instant", () => {
    const scale = createScrubberScale(FALL_BACK_ANCHOR);
    const next = stepCursor(scale, SAT_2000_EDT, step("Forward one day"));
    expect(stepCursor(scale, next, step("Back one day")).getTime()).toBe(SAT_2000_EDT.getTime());
  });
});

describe("week steps are seven calendar days, not 168 hours", () => {
  it("keeps the wall clock when the week contains the DST transition", () => {
    // Seven "+1d" presses and one "+1w" press must agree; 168 h flat would
    // put "same time next Friday" an hour early.
    const scale = createScrubberScale(new Date("2026-11-03T00:00:00Z"));
    const from = new Date("2026-10-31T00:00:00Z"); // Fri Oct 30, 20:00 EDT
    const next = stepCursor(scale, from, step("Forward one week"));

    expect(localParts(next).hour).toBe(20);
    expect(localParts(next).day).toBe(6);
    expect(next.getTime() - from.getTime()).toBe(7 * DAY_MS + HOUR_MS);

    let byDay = from as Date;
    for (let i = 0; i < 7; i++) byDay = stepCursor(scale, byDay, step("Forward one day"));
    expect(byDay.getTime()).toBe(next.getTime());
  });
});

describe("stepping respects the scrubber's ±7-day rail", () => {
  const ANCHOR = new Date("2026-09-10T18:00:00Z");

  it("clamps an overshooting step to the end of the rail", () => {
    const scale = createScrubberScale(ANCHOR);
    const nearEnd = scale.toDate(scale.max - 30);
    expect(stepCursor(scale, nearEnd, step("Forward one week")).getTime()).toBe(
      scale.toDate(scale.max).getTime(),
    );
    const nearStart = scale.toDate(30);
    expect(stepCursor(scale, nearStart, step("Back one day")).getTime()).toBe(
      scale.toDate(0).getTime(),
    );
  });

  it("reports canStep=false at the rail end so the button disables", () => {
    // Clamping alone leaves a live-looking button that does nothing. The
    // disabled state is what tells the user the rail has an end.
    const scale = createScrubberScale(ANCHOR);
    const end = scale.toDate(scale.max);
    const start = scale.toDate(scale.min);
    expect(canStep(scale, end, step("Forward one hour"))).toBe(false);
    expect(canStep(scale, end, step("Forward one week"))).toBe(false);
    expect(canStep(scale, end, step("Back one hour"))).toBe(true);
    expect(canStep(scale, start, step("Back one day"))).toBe(false);
    expect(canStep(scale, start, step("Forward one day"))).toBe(true);
  });

  it("ignores stray sub-minute drift at the end of the rail", () => {
    // The live cursor carries seconds. Compared as raw instants, "+1h" at the
    // rail end differs from `from` by 30 s and the button would look live and
    // then jerk the cursor backwards. Compared in the scale's minute space it
    // is correctly dead.
    const scale = createScrubberScale(ANCHOR);
    const endish = scale.toDate(scale.max).getTime() + 30_000;
    expect(canStep(scale, endish, step("Forward one hour"))).toBe(false);
  });
});

describe("<TimeStepper/> renders real, named, keyboard-reachable buttons", () => {
  const CLOCK = Date.parse("2026-09-10T18:00:00Z");
  const mount = () => {
    const store = createTimeCursor({ clock: () => CLOCK });
    render(createElement(TimeStepper, { store }));
    return store;
  };

  it("gives every control a spelled-out accessible name", () => {
    mount();
    expect(screen.getByRole("group", { name: "Step the time cursor" })).toBeTruthy();
    for (const name of [
      "Back one week",
      "Back one day",
      "Back one hour",
      "Forward one hour",
      "Forward one day",
      "Forward one week",
    ]) {
      expect(screen.getByRole("button", { name }).tagName).toBe("BUTTON");
    }
  });

  it("moves the shared cursor store by exactly one hour", () => {
    const store = mount();
    fireEvent.click(screen.getByRole("button", { name: "Forward one hour" }));
    expect(store.now().getTime()).toBe(CLOCK + HOUR_MS);
    expect(store.isLive).toBe(false);
  });

  it("disables the forward controls once the cursor reaches the end of the rail", () => {
    const store = mount();
    fireEvent.click(screen.getByRole("button", { name: "Forward one week" }));
    // September has no DST boundary, so one week here is exactly +7 d = max.
    expect(store.now().getTime()).toBe(CLOCK + 7 * DAY_MS);

    const disabled = (name: string) =>
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
    expect(disabled("Forward one hour")).toBe(true);
    expect(disabled("Forward one day")).toBe(true);
    expect(disabled("Forward one week")).toBe(true);
    expect(disabled("Back one hour")).toBe(false);
  });
});
