// PR 2 R8 screenshots + verification.
// Captures screenshots at 1600 and 900 for the purchasing board's:
//   - normal in-progress range (P8)
//   - future range (P10) - verifies suppression of pill / verdict
//   - popover open in the week strip
//   - popover open in the equipment ledger
import { test, expect } from "@playwright/test";
import path from "node:path";

const OUT = path.resolve(__dirname, "..", "playwright-report", "pr2-r8");
test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3221" });

// Future range: P10 (Sep 21 to Oct 18 2026 in fiscal year 2026).
const P10_START = "2026-09-21";
const P10_END = "2026-10-18";
// Current in-progress period: use the account default so the load is exercised.

test("gap4: future range shows no pill, no verdict, no projected close", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/kpi/purchasing?account=ALL&start=${P10_START}&end=${P10_END}`);
  await page.waitForLoadState("networkidle");
  // Wait for the period card to be present.
  await expect(page.locator('.kpi-p-card').first()).toBeVisible();

  // Assertion 1: header sub-text says "hasn't started" not "% elapsed"
  await expect(page.getByText("hasn't started")).toBeVisible();
  // Assertion 2: "this range has not started" note beneath second stack
  await expect(page.getByText("this range has not started").first()).toBeVisible();
  // Assertion 3: no verdict pill anywhere with tone
  // (state pills carry .kpi-p-pill--r/g/b/n class or similar; look for pill root)
  // We just verify the "No spend" / "No budget" pills are NOT rendered on the period card.
  const noSpend = page.getByText("No spend", { exact: true });
  const noBudget = page.getByText("No budget", { exact: true });
  expect(await noSpend.count() + await noBudget.count()).toBeLessThanOrEqual(0);
  // Assertion 4: no "Projected close" row
  const projClose = page.getByText("Projected close", { exact: true });
  await expect(projClose).toHaveCount(0);
  // Assertion 5: "Budget" label appears (replacing "Remaining")
  await expect(page.getByText("Budget", { exact: true }).first()).toBeVisible();

  await page.screenshot({ path: path.join(OUT, "future-range-1600.png"), fullPage: true });
});

test("gap4b: future range at 900px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1200 });
  await page.goto(`/kpi/purchasing?account=ALL&start=${P10_START}&end=${P10_END}`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.kpi-p-card').first()).toBeVisible();
  await page.screenshot({ path: path.join(OUT, "future-range-900.png"), fullPage: true });
});

test("gap1: popover escapes stacking context - week strip", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/kpi/purchasing?account=ALL");
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.kpi-p-card').first()).toBeVisible();
  // Click the week-strip help trigger
  const trigger = page.locator('[data-hs-help="qPurchWeekStrip"]');
  await expect(trigger).toBeVisible();
  await trigger.click();
  // Portalled popover: data-hs-help-for="qPurchWeekStrip" at document.body
  const pop = page.locator('[data-hs-help-for="qPurchWeekStrip"]');
  await expect(pop).toBeVisible();
  // Verify it renders as a direct child of body (portal escape)
  const parentTag = await pop.evaluate(el => el.parentElement?.tagName || "");
  expect(parentTag.toLowerCase()).toBe("body");
  await page.screenshot({ path: path.join(OUT, "popover-week-strip-1600.png"), fullPage: false });
});

test("gap1: popover escapes stacking context - equipment ledger", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1400 });
  await page.goto("/kpi/purchasing?account=ALL");
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.kpi-p-card').first()).toBeVisible();
  // Scroll to reveal the equipment card
  const eq = page.locator('[data-hs-help="qPurchEquip"]').first();
  await eq.scrollIntoViewIfNeeded();
  await eq.click();
  const pop = page.locator('[data-hs-help-for="qPurchEquip"]');
  await expect(pop).toBeVisible();
  const parentTag = await pop.evaluate(el => el.parentElement?.tagName || "");
  expect(parentTag.toLowerCase()).toBe("body");
  await page.screenshot({ path: path.join(OUT, "popover-equipment-1600.png"), fullPage: false });
});

test("normal range at 1600 + 900 for baseline screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto("/kpi/purchasing?account=ALL");
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.kpi-p-card').first()).toBeVisible();
  await page.screenshot({ path: path.join(OUT, "normal-1600.png"), fullPage: true });

  await page.setViewportSize({ width: 900, height: 1400 });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(OUT, "normal-900.png"), fullPage: true });
});
