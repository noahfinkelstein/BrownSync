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

    // Tab order from the top of the page. This used to read "first tab stop
    // is the search trigger", which was true only while the wordmark was a
    // <span> and the header had no navigation. It now leads with the
    // wordmark and the two directory links — correct order for a header, and
    // pinned here explicitly so a future reshuffle is a deliberate edit
    // rather than a silently different keyboard experience.
    for (const name of ["BrownSync", "Events", "Clubs"]) {
      await page.keyboard.press("Tab");
      await expect(page.locator("header").getByRole("link", { name })).toBeFocused();
    }
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
    await openEventsTab(page);
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
    await openEventsTab(page);
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
    // Identify the invoking row by its TEXT, not its index. The list mounts
    // when the Events tab is selected rather than at page load, so a late
    // arrival from useBrowseEvents can still shift indices here — and this
    // test is about focus returning to the row you opened, not about that row
    // happening to be second.
    const invokerText = await page.evaluate(() => document.activeElement?.textContent ?? "");
    expect(invokerText).not.toBe("");
    await page.keyboard.press("Enter");
    const panel = page.getByTestId("detail-panel");
    await expect(panel).toBeVisible();
    await expect.poll(() => activeInside(page, '[data-testid="detail-panel"]')).toBe(true);

    // …and Escape closes it, returning focus to the invoking row.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() => ({
          text: document.activeElement?.textContent ?? "",
          isRow: !!document.activeElement?.closest('[data-testid="event-list-item"]'),
        })),
      )
      .toEqual({ text: invokerText, isRow: true });
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

  test("map canvases: deck's overlay canvas is no tab stop; only labeled canvases take focus", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 20_000 });

    // deck's input manager force-sets tabIndex=0 on its overlay canvas when
    // its async device init completes — MapView's onLoad override pulls it
    // back out of the tab order + accessibility tree (DeckOverlay). The
    // invariant must hold in EVERY init state (this harness's software GL
    // may never finish deck init, and dev StrictMode double-mounts can leave
    // an extra pre-init canvas): no overlay canvas is ever focusable —
    // pre-init it has no tabindex at all; post-init it must be -1 with
    // aria-hidden, never mjolnir's 0.
    const deckCanvases = page.locator("canvas#deckgl-overlay");
    await expect.poll(() => deckCanvases.count(), { timeout: 20_000 }).toBeGreaterThan(0);
    const overlayStates = await page.evaluate(() =>
      Array.from(document.querySelectorAll("canvas#deckgl-overlay")).map((el) => ({
        tabindex: el.getAttribute("tabindex"),
        ariaHidden: el.getAttribute("aria-hidden"),
      })),
    );
    for (const state of overlayStates) {
      expect(state.tabindex, "deck canvas must never be a tab stop").not.toBe("0");
      if (state.tabindex === "-1") {
        expect(state.ariaHidden, "initialized deck canvas must be aria-hidden").toBe("true");
      }
    }
    // The labeled MapLibre canvas stays keyboard-reachable, unchanged.
    await expect(page.locator(".maplibregl-canvas").first()).toHaveAttribute("aria-label", /./);

    // Tab-walk the whole screen: every canvas that takes focus must carry an
    // accessible name — a bare unlabeled canvas stop is the regression.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    let focusedCanvases = 0;
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press("Tab");
      const active = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? { tag: el.tagName.toLowerCase(), label: el.getAttribute("aria-label") } : null;
      });
      if (!active || active.tag === "body") break;
      if (active.tag === "canvas") {
        focusedCanvases += 1;
        expect(active.label, "canvas tab stops must be labeled").toBeTruthy();
      }
    }
    // Exactly the labeled map canvas — the bare deck overlay stop is gone.
    expect(focusedCanvases).toBeLessThanOrEqual(1);
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
