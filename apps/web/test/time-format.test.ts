import { describe, expect, it } from "vitest";
import { formatClock, formatCursor, formatRelative } from "../src/time/format";

describe("formatClock", () => {
  it("renders 24-h campus wall clock with zero padding", () => {
    expect(formatClock(new Date("2026-07-28T23:04:00Z"))).toBe("19:04"); // EDT
    expect(formatClock(new Date("2026-07-28T13:05:00Z"))).toBe("09:05");
    expect(formatClock(new Date("2026-07-28T04:00:00Z"))).toBe("00:00");
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-07-28T22:38:00Z");

  it("says now inside a minute", () => {
    expect(formatRelative(now, now)).toBe("now");
    expect(formatRelative(now + 59_000, now)).toBe("now");
  });

  it("uses minutes under an hour", () => {
    expect(formatRelative(now + 26 * 60_000, now)).toBe("in 26 min");
    expect(formatRelative(now - 26 * 60_000, now)).toBe("26 min ago");
  });

  it("uses hours and minutes under a day", () => {
    expect(formatRelative(now + 2 * 3_600_000, now)).toBe("in 2 h");
    expect(formatRelative(now - (3 * 3_600_000 + 20 * 60_000), now)).toBe("3 h 20 min ago");
  });

  it("uses days and hours beyond a day", () => {
    expect(formatRelative(now + 98 * 3_600_000, now)).toBe("in 4 d 2 h");
    expect(formatRelative(now - 72 * 3_600_000, now)).toBe("3 d ago");
  });
});

describe("formatCursor", () => {
  it("renders the §6.4 readout for the same local day", () => {
    const now = new Date("2026-07-28T22:38:00Z");
    const at = new Date("2026-07-28T23:04:00Z");
    expect(formatCursor(at, now)).toBe("19:04 · in 26 min");
  });

  it("prefixes the weekday once the cursor leaves today", () => {
    const now = new Date("2026-07-28T14:00:00Z"); // Tue 10:00 EDT
    const at = new Date("2026-08-02T00:00:00Z"); // Sat 20:00 EDT
    expect(formatCursor(at, now)).toBe("Sat 20:00 · in 4 d 10 h");
  });

  it("keeps the relative part honest across fall-back (25 h between 20:00s)", () => {
    const now = new Date("2026-11-01T00:00:00Z"); // Sat Oct 31, 20:00 EDT
    const at = new Date("2026-11-02T01:00:00Z"); // Sun Nov 1, 20:00 EST
    expect(formatCursor(at, now)).toBe("Sun 20:00 · in 1 d 1 h");
  });
});
