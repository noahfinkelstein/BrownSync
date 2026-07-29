import { describe, expect, it } from "vitest";
import { locationRawAddsInfo } from "../src/panels/EventDetailPanel";

/**
 * Detail panel WHERE dedupe: `location_raw` usually echoes the resolved
 * place name — the raw second line renders only when it adds information
 * (comparison normalizes whitespace and case).
 */
describe("locationRawAddsInfo", () => {
  it("suppresses an exact echo of the resolved name", () => {
    expect(locationRawAddsInfo("Salomon Center", "Salomon Center")).toBe(false);
  });

  it("suppresses case-only differences", () => {
    expect(locationRawAddsInfo("salomon center", "Salomon Center")).toBe(false);
    expect(locationRawAddsInfo("SALOMON CENTER", "Salomon Center")).toBe(false);
  });

  it("suppresses whitespace-only differences", () => {
    expect(locationRawAddsInfo("  Salomon   Center ", "Salomon Center")).toBe(false);
    expect(locationRawAddsInfo("Salomon\tCenter\n", "Salomon Center")).toBe(false);
  });

  it("keeps raw locations that carry extra detail", () => {
    expect(locationRawAddsInfo("Salomon Center, Room 101", "Salomon Center")).toBe(true);
    expect(locationRawAddsInfo("Petteruti Lounge", "Stephen Robert '62 Campus Center")).toBe(true);
  });
});
