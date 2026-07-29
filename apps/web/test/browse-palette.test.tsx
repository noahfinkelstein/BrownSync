// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SearchTrigger } from "../src/browse/SearchTrigger";
import { createServer, resetSeenRequests } from "./helpers/msw";
import { renderWithHarness, searchOf, stubScrolling } from "./helpers/render";

const server = createServer();
beforeAll(() => {
  stubScrolling();
  server.listen({ onUnhandledRequest: "error" });
});
beforeEach(() => resetSeenRequests());
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

/** Wait for the trigger to mount (RouterProvider paints async) — the global
 *  ⌘K listener only exists after that. */
async function triggerReady() {
  return await screen.findByRole("button", { name: /Search/ });
}

describe("⌘K palette keyboard flow (handoff §2 H)", () => {
  it("opens with ⌘K, searches, Enter opens the top hit (event default)", async () => {
    const user = userEvent.setup();
    const { router } = renderWithHarness(<SearchTrigger />);
    await triggerReady();

    expect(screen.queryByRole("combobox")).toBeNull();
    await user.keyboard("{Meta>}k{/Meta}");
    const input = await screen.findByRole("combobox");
    expect(document.activeElement).toBe(input);

    await user.keyboard("salomon");
    await screen.findByText("Salomon Lecture: Quantum Computing");
    await screen.findByText("Salomon Center");

    // First item auto-selected; Enter follows the default event target.
    await user.keyboard("{Enter}");
    await waitFor(() => expect(searchOf(router).event).toBe("e-salomon-lecture"));
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("arrows to a place hit and routes to /p/$id", async () => {
    const user = userEvent.setup();
    const { router } = renderWithHarness(<SearchTrigger />);
    await triggerReady();

    await user.keyboard("{Control>}k{/Control}");
    await screen.findByRole("combobox");
    await user.keyboard("salomon");
    await screen.findByText("Salomon Center");

    // Row 1 = the matching event, row 2 = the place.
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/p/salomon-center"));
    await screen.findByTestId("place-probe");
  });

  it("routes org hits to /o/$id", async () => {
    const user = userEvent.setup();
    const { router } = renderWithHarness(<SearchTrigger />);
    await triggerReady();

    await user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("combobox");
    await user.keyboard("outing club");
    // Org group hit (the event fixture "Outing Club GBM" matches q too).
    await screen.findByText("Brown Outing Club");
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/o/brown-outing-club"));
  });

  it("escape closes and clears; reopening starts fresh", async () => {
    const user = userEvent.setup();
    renderWithHarness(<SearchTrigger />);
    await triggerReady();

    await user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("combobox");
    await user.keyboard("salomon");
    await screen.findByText("Salomon Center");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());

    await user.keyboard("{Meta>}k{/Meta}");
    const input = await screen.findByRole("combobox");
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("shows the designed empty state for a miss (§6.4 real copy)", async () => {
    const user = userEvent.setup();
    renderWithHarness(<SearchTrigger />);
    await triggerReady();

    await user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("combobox");
    await user.keyboard("zzzzzz");
    await screen.findByText("No matches");
    await screen.findByText(/try a building, a club, or a course code/i);
  });

  it("opens via the trigger button too", async () => {
    const user = userEvent.setup();
    renderWithHarness(<SearchTrigger />);
    await user.click(await triggerReady());
    await screen.findByRole("combobox");
  });
});
