import { expect, test } from "@playwright/test";
import { blockExternal, mockApi, mockBasemapGlyphs } from "./support/mock-api";

/**
 * In-lane smoke — passes today, before sibling lanes land. Hermetic: local
 * PMTiles from public/, glyphs answered with empty PBFs, /api/* from
 * fixtures, everything else aborted.
 */

test.beforeEach(async ({ page }) => {
  await blockExternal(page);
  await mockBasemapGlyphs(page);
  await mockApi(page);
});

test("map shell boots on the committed basemap", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 20_000 });
  // MapView fades its boot overlay (opacity-0) once the style + tiles land.
  const bootOverlay = page.getByText("Loading basemap…").locator("..");
  await expect(bootOverlay).toHaveClass(/opacity-0/, { timeout: 30_000 });
  await expect(page.getByText("Basemap unavailable")).toHaveCount(0);
});

test("index.html ships OG metadata and the PWA manifest", async ({ page, request, baseURL }) => {
  await page.goto("/");

  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Brown/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0B0E12");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /BrownSync/);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    /campus map/,
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "/og.png");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/icons/apple-touch-icon.png",
  );

  const manifestRes = await request.get(new URL("/manifest.webmanifest", baseURL).toString());
  expect(manifestRes.ok()).toBeTruthy();
  const manifest = (await manifestRes.json()) as {
    theme_color: string;
    background_color: string;
    display: string;
    icons: { src: string; type: string }[];
  };
  expect(manifest.theme_color).toBe("#0B0E12");
  expect(manifest.background_color).toBe("#0B0E12");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  for (const icon of manifest.icons) {
    const iconRes = await request.get(new URL(icon.src, baseURL).toString());
    expect(iconRes.ok(), `${icon.src} should be served`).toBeTruthy();
    expect(iconRes.headers()["content-type"]).toContain("png");
  }

  const ogRes = await request.get(new URL("/og.png", baseURL).toString());
  expect(ogRes.ok()).toBeTruthy();
  expect(ogRes.headers()["content-type"]).toContain("png");
});

test("health strip renders standalone against mocked /api/health", async ({ page }) => {
  await page.goto("/e2e/harness/health-strip.html");

  const strip = page.getByTestId("health-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("LiveWhale");
  await expect(strip).toContainText("min ago");

  const trigger = strip.getByRole("button", { name: "Source health" });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  const popover = page.getByTestId("health-popover");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("312 items");
  // The partial source surfaces its error line and stale status.
  const clubsRow = page.getByTestId("health-row-clubs");
  await expect(clubsRow).toContainText("partial");
  await expect(clubsRow).toContainText("12 org pages failed to parse");

  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("designed states render with real copy", async ({ page }) => {
  await page.goto("/e2e/harness/health-strip.html");
  const gallery = page.getByTestId("states-gallery");
  await expect(gallery.getByText("No events in view")).toBeVisible();
  await expect(gallery.getByRole("button", { name: "Widen the time window" })).toBeVisible();
  await expect(gallery.getByRole("alert")).toContainText("Couldn’t load events");
  await expect(gallery.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(gallery.getByTestId("list-skeleton")).toBeAttached();
  await expect(gallery.getByTestId("panel-skeleton")).toBeAttached();
});
