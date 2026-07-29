// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useRovingFocus } from "../src/browse/rovingFocus";

/**
 * §6.4 keyboard support: the roving-tabindex hook that backs the event list
 * (↑/↓) and the category chips (←/→) — one tab stop per group, arrows move
 * focus, Home/End jump, Enter stays native button activation.
 */

afterEach(cleanup);

function Rows({ labels }: { labels: string[] }) {
  const roving = useRovingFocus<HTMLFieldSetElement>("button", "vertical");
  const [pressed, setPressed] = useState<string | null>(null);
  return (
    // fieldset = implicit group role, same shape as the chips container.
    <fieldset
      ref={roving.containerRef}
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
      data-testid="group"
    >
      {labels.map((label) => (
        <button key={label} type="button" onClick={() => setPressed(label)}>
          {label}
        </button>
      ))}
      {pressed && <output>pressed:{pressed}</output>}
    </fieldset>
  );
}

const btn = (name: string) => screen.getByRole("button", { name });

describe("useRovingFocus", () => {
  it("collapses the group to ONE tab stop (first item by default)", () => {
    render(<Rows labels={["a", "b", "c"]} />);
    expect(btn("a").tabIndex).toBe(0);
    expect(btn("b").tabIndex).toBe(-1);
    expect(btn("c").tabIndex).toBe(-1);
  });

  it("ArrowDown/ArrowUp move focus and the tab stop; edges clamp", async () => {
    const user = userEvent.setup();
    render(<Rows labels={["a", "b", "c"]} />);
    await user.tab();
    expect(document.activeElement).toBe(btn("a"));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(btn("b"));
    expect(btn("b").tabIndex).toBe(0);
    expect(btn("a").tabIndex).toBe(-1);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement).toBe(btn("c")); // clamped at the end
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(btn("b"));
  });

  it("Home/End jump to the edges", async () => {
    const user = userEvent.setup();
    render(<Rows labels={["a", "b", "c"]} />);
    await user.tab();
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(btn("c"));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(btn("a"));
  });

  it("Enter activates the focused item (native button semantics)", async () => {
    const user = userEvent.setup();
    render(<Rows labels={["a", "b", "c"]} />);
    await user.tab();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByText("pressed:b")).toBeDefined();
  });

  it("remembers the roved item as the tab stop after focus leaves", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Rows labels={["a", "b", "c"]} />
        <button type="button">outside</button>
      </>,
    );
    await user.tab();
    await user.keyboard("{ArrowDown}");
    await user.tab(); // leaves the group…
    expect(document.activeElement).toBe(btn("outside"));
    await user.tab({ shift: true }); // …and returns to the roved item, not "a"
    expect(document.activeElement).toBe(btn("b"));
  });

  it("horizontal orientation uses ArrowLeft/ArrowRight", async () => {
    function Chips() {
      const roving = useRovingFocus<HTMLFieldSetElement>("button", "horizontal");
      return (
        <fieldset ref={roving.containerRef} onKeyDown={roving.onKeyDown} onFocus={roving.onFocus}>
          <button type="button">x</button>
          <button type="button">y</button>
        </fieldset>
      );
    }
    const user = userEvent.setup();
    render(<Chips />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(btn("y"));
    await user.keyboard("{ArrowDown}"); // wrong axis: ignored
    expect(document.activeElement).toBe(btn("y"));
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(btn("x"));
  });

  it("adapts when items unmount: tab stop falls back into the list", async () => {
    function Shrinking() {
      const [labels, setLabels] = useState(["a", "b"]);
      const roving = useRovingFocus<HTMLFieldSetElement>("button", "vertical");
      return (
        <div>
          <fieldset ref={roving.containerRef} onKeyDown={roving.onKeyDown} onFocus={roving.onFocus}>
            {labels.map((label) => (
              <button key={label} type="button">
                {label}
              </button>
            ))}
          </fieldset>
          <button type="button" onClick={() => setLabels(["a"])}>
            shrink
          </button>
        </div>
      );
    }
    const user = userEvent.setup();
    render(<Shrinking />);
    await user.tab();
    await user.keyboard("{ArrowDown}"); // roved to "b"
    await user.click(btn("shrink")); // "b" unmounts
    expect(btn("a").tabIndex).toBe(0); // stop returns to a live item
  });
});
