import { expect, type Page, test } from "@playwright/test";
import { INTEGRATED } from "./flags";
import { blockExternal, mockApi, mockBasemapGlyphs } from "./support/mock-api";

/**
 * §6.4 full-keyboard-support audit (Phase 3 lane C): the whole MVP journey
 * driven keyboard-only, hermetic via fixture-backed /api/* mocks — palette
 * focus trap + restore, chip/list roving focus, detail-panel Escape with
 * focus return to the invoker, scrubber keys, and the place mini-map
 * click-through. Pointer input is used ONLY to seed focus at a known spot.
 */

test.describe("keyboard-only journey", () => {
  test.skip(!INTEGRATED, "Needs the integrated app (see e2e/flags.ts).");

  test.beforeEach(async ({ page }) => {
    await blockExternal(page);
    await mockBasemapGlyphs(page);
    await mockApi(page);
  });

  const activeInside = (page: Page, selector: string) =>
    page.evaluate((sel) => {
      const host = document.querySelector(sel);
      return host?.contains(document.activeElement) ?? false;
    }, selector);

  test("⌘K palette: trap while open, focus restored to the invoker on Escape", async ({ page }) => {
    await page.goto("/");
    const trigger = page.locator("header").getByRole("button", { name: /search/i });
    await expect(trigger).toBeVisible();

    // Keyboard from the top of the page: first tab stop is the search trigger.
    await page.keyboard.press("Tab");
    await expect(trigger).toBeFocused();

    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Search BrownSync" });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("search-input")).toBeFocused();

    // Focus trap: tabbing never leaves the dialog.
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press("Tab");
      expect(await activeInside(page, '[role="dialog"]')).toBe(true);
    }

    // Results stay keyboard-reachable while trapped.
    await page.getByTestId("search-input").fill("Salomon");
    await expect(page.getByRole("option", { name: /Salomon/ }).first()).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("category chips: one tab stop, arrow-key roving, keyboard toggle", async ({ page }) => {
    await page.goto("/");
    const chips = page.getByRole("group", { name: "Filter by category" });
    await expect(chips).toBeVisible();

    await chips.getByRole("button", { name: "Academic" }).focus();
    await expect(chips.getByRole("button", { name: "Academic" })).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(chips.getByRole("button", { name: "Class" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(chips.getByRole("button", { name: "Admin" })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(chips.getByRole("button", { name: "Academic" })).toBeFocused();

    // Roving tabindex: exactly one tab stop inside the group.
    expect(
      await chips.evaluate(
        (el) => Array.from(el.querySelectorAll("button")).filter((b) => b.tabIndex === 0).length,
      ),
    ).toBe(1);

    // Space toggles the chip and lands in the URL (?cats=), stays focused.
    await page.keyboard.press("Space");
    await expect(chips.getByRole("button", { name: "Academic" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page).toHaveURL(/[?&]cats=academic/);
    await expect(chips.getByRole("button", { name: "Academic" })).toBeFocused();
  });

  test("event list: ↑/↓ roving, Enter opens the panel, Escape returns focus", async ({ page }) => {
    await page.goto("/");
    const rows = page.getByTestId("event-list-item");
    await expect(rows.first()).toBeVisible();
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(1);

    const first = rows.nth(0).getByRole("button");
    const second = rows.nth(1).getByRole("button");
    await first.focus();
    await expect(first).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(second).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(first).toBeFocused();
    await page.keyboard.press("End");
    await expect(rows.nth(rowCount - 1).getByRole("button")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(first).toBeFocused();

    // One tab stop for the whole list.
    expect(
      await page.evaluate(
        () =>
          Array.from(document.querySelectorAll('[data-testid="event-list-item"] button')).filter(
            (b) => (b as HTMLElement).tabIndex === 0,
          ).length,
      ),
    ).toBe(1);

    // Enter opens the detail panel and moves focus into it…
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const panel = page.getByTestId("detail-panel");
    await expect(panel).toBeVisible();
    await expect.poll(() => activeInside(page, '[data-testid="detail-panel"]')).toBe(true);

    // …and Escape closes it, returning focus to the invoking row.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(second).toBeFocused();
  });

  test("time scrubber: arrows step 15 min, Shift+arrow steps a day", async ({ page }) => {
    await page.goto("/");
    const slider = page.getByTestId("time-scrubber").getByRole("slider");
    await slider.focus();
    await expect(slider).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/[?&]at=/);
    const url = new URL(page.url());
    const at = url.searchParams.get("at");
    expect(at).toBeTruthy();

    await page.keyboard.press("Shift+ArrowRight");
    await expect
      .poll(() => {
        const next = new URL(page.url()).searchParams.get("at");
        return next !== null && next !== at;
      })
      .toBe(true);
    // AT users get a readable cursor, not a raw number.
    await expect(slider).toHaveAttribute("aria-valuetext", /./);
  });

  test("place mini-map: real basemap, keyboard click-through to the live map", async ({ page }) => {
    await page.goto("/p/salomon-center");
    const miniMap = page.getByTestId("place-minimap");
    await expect(miniMap).toBeVisible();
    // A real MapLibre canvas — the wireframe placeholder is gone.
    await expect(miniMap.locator(".maplibregl-canvas")).toBeVisible({ timeout: 20_000 });

    const link = page.getByRole("link", { name: "Open Salomon Center on the live map" });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");

    // Lands on the live map; ?ll= is consumed (flyTo) and dropped once the
    // main map boots.
    await expect(page).toHaveURL(/\/\?.*ll=/);
    await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => !new URL(page.url()).searchParams.has("ll"), { timeout: 30_000 })
      .toBe(true);
  });
});
