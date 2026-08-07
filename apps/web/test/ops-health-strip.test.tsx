// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HealthStrip } from "../src/ops/HealthStrip";

vi.mock("posthog-js", () => ({ default: { init: vi.fn(), capture: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function healthPayload() {
  const now = Date.now();
  const minAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  return {
    sources: [
      {
        source: "livewhale",
        status: "ok",
        lastRunAt: minAgo(4),
        lastOkAt: minAgo(4),
        itemsUpserted: 312,
        error: null,
      },
      {
        source: "clubs",
        status: "partial",
        lastRunAt: minAgo(31),
        lastOkAt: minAgo(60 * 24),
        itemsUpserted: 401,
        error: "12 org pages failed to parse",
      },
    ],
  };
}

function stubFetchOk(payload: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("HealthStrip", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders per-source dots with mono staleness readouts", async () => {
    const fetchMock = stubFetchOk(healthPayload());
    render(<HealthStrip />);

    expect(await screen.findByText("LiveWhale")).toBeTruthy();
    expect(screen.getByText("4 min ago")).toBeTruthy();
    expect(screen.getByText("Clubs")).toBeTruthy();
    // VITE_API_URL may or may not be set in the runner's env — only the path is contractual.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/health"),
      expect.anything(),
    );
  });

  it("opens a detail popover with per-source rows, closes on Escape", async () => {
    stubFetchOk(healthPayload());
    render(<HealthStrip />);
    await screen.findByText("LiveWhale");

    const trigger = screen.getByRole("button", { name: "Source health" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const popover = screen.getByRole("dialog", { name: "Source health detail" });
    expect(popover.textContent).toContain("312 items");
    expect(popover.textContent).toContain("partial");
    expect(popover.textContent).toContain("12 org pages failed to parse");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the popover on outside pointerdown", async () => {
    stubFetchOk(healthPayload());
    render(<HealthStrip />);
    await screen.findByText("LiveWhale");

    fireEvent.click(screen.getByRole("button", { name: "Source health" }));
    expect(screen.getByRole("dialog", { name: "Source health detail" })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the unreachable state when the health endpoint fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    render(<HealthStrip />);

    expect(await screen.findByText("unreachable")).toBeTruthy();
    expect(screen.getByText("sources")).toBeTruthy();
  });

  it("rests as a bare status dot in compact mode — no ambient text", async () => {
    // UI audit: the header chip read "5 sources · 4 min ago" with a red dot
    // at rest, which alarmed users who never asked about ops. The trigger is
    // dot-only; every readout moved behind the click.
    stubFetchOk(healthPayload());
    render(<HealthStrip compact />);

    const trigger = await screen.findByRole("button", { name: "Source health" });
    expect(trigger.textContent).not.toMatch(/sources|ago|error/);
    expect(screen.queryByText("LiveWhale")).toBeNull();
  });

  it("keeps the aggregate readout reachable inside the compact popover", async () => {
    stubFetchOk(healthPayload());
    render(<HealthStrip compact />);

    fireEvent.click(await screen.findByRole("button", { name: "Source health" }));
    const popover = screen.getByRole("dialog", { name: "Source health detail" });
    expect(popover.textContent).toContain("2 sources");
    expect(popover.textContent).toContain("LiveWhale");
  });
});
