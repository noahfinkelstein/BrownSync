// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFocusReturn } from "../src/browse/useFocusReturn";

function FocusProbe({ open, panelPresent }: { open: boolean; panelPresent: boolean }) {
  useFocusReturn(open);
  return (
    <>
      <button type="button">Invoker</button>
      {panelPresent && <button type="button">Panel control</button>}
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useFocusReturn", () => {
  it("restores focus when a loaded closing animation removes the panel late", () => {
    vi.useFakeTimers();
    const view = render(<FocusProbe open={false} panelPresent={false} />);
    const invoker = screen.getByRole("button", { name: "Invoker" });
    invoker.focus();

    view.rerender(<FocusProbe open panelPresent />);
    screen.getByRole("button", { name: "Panel control" }).focus();
    view.rerender(<FocusProbe open={false} panelPresent />);

    act(() => vi.advanceTimersByTime(350));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Panel control" }));

    view.rerender(<FocusProbe open={false} panelPresent={false} />);
    act(() => vi.advanceTimersByTime(100));

    expect(document.activeElement).toBe(invoker);
  });
});
