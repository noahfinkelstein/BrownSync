// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CategoryChips } from "../src/browse/CategoryChips";
import { parseCats, serializeCats } from "../src/browse/filter";
import { renderWithHarness, searchOf, stubScrolling } from "./helpers/render";

beforeAll(() => stubScrolling());
afterEach(() => cleanup());

describe("parseCats / serializeCats (URL round-trip)", () => {
  it("parses comma-joined ids, dropping junk, in taxonomy order", () => {
    expect(parseCats("arts,club")).toEqual(["club", "arts"]);
    expect(parseCats("club,definitely-not-a-cat,club")).toEqual(["club"]);
    expect(parseCats(undefined)).toEqual([]);
    expect(parseCats(42)).toEqual([]);
  });

  it("serializes to taxonomy order; empty selection removes the param", () => {
    expect(serializeCats(["arts", "club"])).toBe("club,arts");
    expect(serializeCats([])).toBeUndefined();
  });
});

describe("CategoryChips (filter state shared via URL)", () => {
  it("renders all 10 taxonomy chips", async () => {
    renderWithHarness(<CategoryChips />);
    const group = await screen.findByRole("group", { name: "Filter by category" });
    expect(group.querySelectorAll("button[aria-pressed]")).toHaveLength(10);
  });

  it("initializes selection from ?cats= and toggles into the URL", async () => {
    const user = userEvent.setup();
    const { router } = renderWithHarness(<CategoryChips />, {
      path: "/?at=2026-07-30T22:00:00Z&cats=arts",
    });

    const arts = await screen.findByRole("button", { name: "Arts" });
    await waitFor(() => expect(arts.getAttribute("aria-pressed")).toBe("true"));

    await user.click(screen.getByRole("button", { name: "Club" }));
    await waitFor(() => expect(searchOf(router).cats).toBe("club,arts"));
    // Sibling params (lane G's ?at=) survive the functional search update.
    expect(searchOf(router).at).toBe("2026-07-30T22:00:00Z");
  });

  it("deselecting the last chip removes the param; clear wipes all", async () => {
    const user = userEvent.setup();
    const { router } = renderWithHarness(<CategoryChips />, { path: "/?cats=arts" });

    await user.click(await screen.findByRole("button", { name: "Arts" }));
    await waitFor(() => expect("cats" in searchOf(router)).toBe(false));
    expect(screen.queryByRole("button", { name: "clear" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Club" }));
    await user.click(screen.getByRole("button", { name: "Food" }));
    await waitFor(() => expect(searchOf(router).cats).toBe("club,food"));

    await user.click(screen.getByRole("button", { name: "clear" }));
    await waitFor(() => expect("cats" in searchOf(router)).toBe(false));
  });
});
