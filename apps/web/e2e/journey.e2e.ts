import { expect, type Page, test } from "@playwright/test";
import { INTEGRATED } from "./flags";
import { blockExternal, mockApi, mockBasemapGlyphs } from "./support/mock-api";

/**
 * The MVP journey: load map → scrub time → open event → search. Written
 * against the INTEGRATED app; hermetic via fixture-backed /api/* mocks.
 *
 * Test-hook contract for sibling lanes (add these data-testids, or update
 * the selectors here at integration):
 *   G  [data-testid="time-scrubber"]    — the scrubber's slider (role=slider)
 *   H  [data-testid="event-list-item"]  — one row in the viewport-synced list
 *   F  [data-testid="detail-panel"]     — the right slide-over (role=dialog)
 *   H  [data-testid="search-input"]     — ⌘K palette input (cmdk renders
 *                                         role=combobox + role=option rows)
 */

/**
 * Select the right pane's Events tab.
 *
 * The pane defaults to the unified **Feed** — the "everything happening at
 * Brown" list is what the site is for, so it leads. The event list and the
 * category chips are one click behind it, which is why every spec that drives
 * them starts here rather than at `/`.
 */
async function openEventsTab(page: Page): Promise<void> {
  const tab = page.locator("aside").getByRole("radio", { name: "Events" });
  await expect(tab).toBeVisible();
  await tab.click();
}

test.describe("full journey (integrated app)", () => {
  test.skip(
    !INTEGRATED,
    "Needs sibling-lane UI (F/G/H) — flip e2e/flags.ts DEFAULT_INTEGRATED or run INTEGRATED=true pnpm e2e at integration.",
  );

  test("load map → scrub time → open event → search", async ({ page }) => {
    await blockExternal(page);
    await mockBasemapGlyphs(page);
    const calls = await mockApi(page);

    // 1 — load map: canvas up, boot overlay gone, event data requested.
    await page.goto("/");
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 20_000 });
    const bootOverlay = page.getByText("Loading basemap…").locator("..");
    await expect(bootOverlay).toHaveClass(/opacity-0/, { timeout: 30_000 });
    await expect
      .poll(() => calls.some((c) => c.path === "/api/events" || c.path === "/api/now"))
      .toBeTruthy();

    // 2 — scrub time: keyboard on the slider (full keyboard support, §6.4);
    // the cursor is URL-synced as ?at=.
    const scrubber = page.getByTestId("time-scrubber");
    await expect(scrubber).toBeVisible();
    await scrubber.getByRole("slider").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/[?&]at=/);

    // 3 — open event. The right pane defaults to the unified Feed, so the
    // event list is one tab click away.
    await openEventsTab(page);
    const firstRow = page.getByTestId("event-list-item").first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    const panel = page.getByTestId("detail-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/Salomon Center|Mapping Living Campuses/);

    // 4 — search: ⌘K palette, query from fixtures, result navigates.
    await page.keyboard.press("ControlOrMeta+k");
    const search = page.getByTestId("search-input");
    await expect(search).toBeVisible();
    await search.fill("Salomon");
    await expect(page.getByRole("option", { name: /Salomon/ }).first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("search-input")).toBeHidden();
  });
});
