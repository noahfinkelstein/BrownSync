import { expect, type Page, test } from "@playwright/test";
import { blockExternal, mockApi, mockBasemapGlyphs } from "./support/mock-api";

const CURSOR = "2026-08-01T18:00:00.000Z";
const CATEGORIES = "club,arts";
const LAYERS = "-buildings";
const SENTINEL = "survives-client-navigation";

async function expectNavigationState(page: Page, pathname: string): Promise<void> {
  const url = new URL(page.url());
  const sentinel = await page.evaluate(
    () =>
      (window as unknown as { __brownSyncNavigationSentinel?: string })
        .__brownSyncNavigationSentinel,
  );
  expect({
    pathname: url.pathname,
    at: url.searchParams.get("at"),
    cats: url.searchParams.get("cats"),
    layers: url.searchParams.get("layers"),
    sentinel,
  }).toEqual({
    pathname,
    at: CURSOR,
    cats: CATEGORIES,
    layers: LAYERS,
    sentinel: SENTINEL,
  });
}

test.beforeEach(async ({ page }) => {
  await blockExternal(page);
  await mockBasemapGlyphs(page);
  await mockApi(page);
});

test("primary navigation preserves URL state without reloading the document", async ({ page }) => {
  await page.goto(
    `/?at=${encodeURIComponent(CURSOR)}&cats=${encodeURIComponent(CATEGORIES)}&layers=${encodeURIComponent(LAYERS)}`,
  );
  await page.evaluate((sentinel) => {
    (
      window as unknown as {
        __brownSyncNavigationSentinel?: string;
      }
    ).__brownSyncNavigationSentinel = sentinel;
  }, SENTINEL);

  await page.locator("header").getByRole("link", { name: "Events" }).click();
  await expectNavigationState(page, "/events");
  await expect(page.getByRole("heading", { name: "Events", exact: true })).toBeVisible();

  await page.locator("header").getByRole("link", { name: "Clubs" }).click();
  await expectNavigationState(page, "/clubs");
  await expect(page.getByRole("heading", { name: "Clubs & organizations" })).toBeVisible();

  await page.locator("header").getByRole("link", { name: "BrownSync" }).click();
  await expectNavigationState(page, "/");
});

test("mobile header exposes both directory routes", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const header = page.locator("header");
  await header.getByRole("button", { name: "Browse directories" }).click();
  await header.getByRole("link", { name: "Events" }).click();
  await expect(page.getByRole("heading", { name: "Events", exact: true })).toBeVisible();

  await header.getByRole("button", { name: "Browse directories" }).click();
  await header.getByRole("link", { name: "Clubs" }).click();
  await expect(page.getByRole("heading", { name: "Clubs & organizations" })).toBeVisible();
});
