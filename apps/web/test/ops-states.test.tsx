// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyEvents, EmptyPlaceDay, EmptySearch } from "../src/ops/states/empty";
import { ErrorState } from "../src/ops/states/error";
import { ListSkeleton, PanelSkeleton } from "../src/ops/states/skeletons";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

describe("empty states (§6.4 — real copy + a way forward)", () => {
  it("EmptyEvents names the fix and wires the action", () => {
    const widen = vi.fn();
    render(<EmptyEvents onWidenWindow={widen} />);
    expect(screen.getByText("No events in view")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Widen the time window" }));
    expect(widen).toHaveBeenCalledTimes(1);
  });

  it("EmptyEvents renders no dead button without a handler", () => {
    render(<EmptyEvents />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("EmptySearch echoes the query and clears it", () => {
    const clear = vi.fn();
    render(<EmptySearch query="salomn" onClear={clear} />);
    expect(screen.getByText("No matches for “salomn”")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("EmptyPlaceDay names the place", () => {
    render(<EmptyPlaceDay placeName="Sayles Hall" />);
    expect(screen.getByText("Nothing scheduled at Sayles Hall today")).toBeTruthy();
  });
});

describe("ErrorState", () => {
  it("announces via role=alert with retry and mono detail", () => {
    const retry = vi.fn();
    render(<ErrorState what="events" detail="GET /api/events 503" onRetry={retry} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Couldn’t load events");
    expect(alert.textContent).toContain("GET /api/events 503");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("acknowledges kept-last-good data in the copy", () => {
    render(<ErrorState keptLastGood />);
    expect(screen.getByRole("alert").textContent).toContain("showing the last good data");
  });
});

describe("skeletons", () => {
  it("are aria-hidden placeholders shaped like their content", () => {
    const { container } = render(
      <div>
        <ListSkeleton />
        <PanelSkeleton />
      </div>,
    );
    const list = container.querySelector('[data-testid="list-skeleton"]');
    const panel = container.querySelector('[data-testid="panel-skeleton"]');
    expect(list?.getAttribute("aria-hidden")).toBe("true");
    expect(panel?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll(".bs-skeleton").length).toBeGreaterThan(8);
  });
});
