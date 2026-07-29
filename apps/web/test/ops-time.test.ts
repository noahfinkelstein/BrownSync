import { describe, expect, it } from "vitest";
import { formatAgo } from "../src/ops/time";

const NOW = Date.parse("2026-07-28T12:00:00Z");

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("formatAgo", () => {
  it("returns 'never' for null and unparseable input", () => {
    expect(formatAgo(null, NOW)).toBe("never");
    expect(formatAgo("not-a-date", NOW)).toBe("never");
  });

  it("collapses under a minute to 'just now'", () => {
    expect(formatAgo(ago(0), NOW)).toBe("just now");
    expect(formatAgo(ago(59_000), NOW)).toBe("just now");
  });

  it("uses minutes up to an hour", () => {
    expect(formatAgo(ago(60_000), NOW)).toBe("1 min ago");
    expect(formatAgo(ago(4 * 60_000), NOW)).toBe("4 min ago");
    expect(formatAgo(ago(59 * 60_000), NOW)).toBe("59 min ago");
  });

  it("uses hours up to a day", () => {
    expect(formatAgo(ago(60 * 60_000), NOW)).toBe("1 h ago");
    expect(formatAgo(ago(23 * 60 * 60_000), NOW)).toBe("23 h ago");
  });

  it("uses days beyond that", () => {
    expect(formatAgo(ago(24 * 60 * 60_000), NOW)).toBe("1 d ago");
    expect(formatAgo(ago(3 * 24 * 60 * 60_000), NOW)).toBe("3 d ago");
  });
});
