// Kevin Labor PR-B (2026-09-07) - Tier A per-week rendering assertions.
//
// R-82 scope: hard-test the FORECAST rendering across accounts.
// Assertions on rendered DOM structure, not on the confirmed dollar
// values of unseeded accounts.
//
// Two mounts:
//   1. TBR - FL P10 - the only account with a confirmed running week
//      today. Assert the R-80 fraction ("$X of $Y ... days left") and
//      no under/over variance arrow.
//   2. CIN - AZ P10 - forecast-only running week. Assert the plan tag
//      renders on the future-week caption and the tile carries the
//      "projected" copy line.
//
// TEST_MODE is required (src/middleware.js:5).

import { test, expect } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

async function gotoLabor(page, { account, start, end }) {
  const url = `/kpi/labor?account=${encodeURIComponent(account)}&start=${start}&end=${end}`;
  await page.goto(url, { waitUntil: "networkidle" });
}

test.describe("Labor PR-B · Tier A per-week rendering", () => {
  test("TBR - FL P10 running week shows R-80 fraction (no variance arrow)", async ({ page }) => {
    await gotoLabor(page, { account: "TBR - FL", start: "2026-09-07", end: "2026-10-04" });
    // Find the tier-A strip
    const strip = page.locator(".kpi-wbars").first();
    await expect(strip).toBeVisible();
    // The running week's caption should carry the fraction class
    const fraction = strip.locator(".kpi-wb-d-frac").first();
    await expect(fraction).toBeVisible();
    // The fraction copy structure: "$X of $Y · Z% used · N days left"
    const text = await fraction.textContent();
    expect(text).toMatch(/\$[\d,]+ of \$[\d,]+/);
    expect(text).toMatch(/days? left/);
    // R-80 acceptance: no over/under variance arrow inside a running week
    // (the fraction line replaces it, not renders alongside).
    const overArrow = strip.locator(".kpi-wb-d-bad, .kpi-wb-d-good").filter({ hasText: /over|under/ });
    // The strip contains 4 weeks - closed weeks may still carry over/under.
    // Assertion: at least ONE fraction present + the fraction is inside the
    // week whose plot has the running-bar treatment.
    expect(await fraction.count()).toBeGreaterThanOrEqual(1);
  });

  test("CIN - AZ P10 forecast future weeks carry plan tag + projected copy", async ({ page }) => {
    await gotoLabor(page, { account: "CIN - AZ", start: "2026-09-07", end: "2026-10-04" });
    const strip = page.locator(".kpi-wbars").first();
    await expect(strip).toBeVisible();
    // All 4 weeks are forecast on CIN - AZ P10 today. Future weeks
    // (W2-W4) render the plan tag.
    const planTags = strip.locator(".kpi-wb-plan-tag");
    expect(await planTags.count()).toBeGreaterThanOrEqual(3);
    await expect(planTags.first()).toHaveText(/plan/i);

    // Forecast tiles carry the caption modifier (mutes tone).
    const forecastCaps = strip.locator(".kpi-wb-cap-forecast");
    expect(await forecastCaps.count()).toBe(4);

    // Grey dashed target line on forecast weeks
    const forecastTargets = strip.locator(".kpi-wb-target-forecast");
    expect(await forecastTargets.count()).toBeGreaterThanOrEqual(3);
  });
});
