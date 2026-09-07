// Labor empty-state fix (Kevin 2026-09-07). Regression coverage for
// the Monday-morning-of-a-new-period defect where board.applies is
// true and the payload carries a four-week plan, but actuals is
// empty and the old gate hid the whole panel behind "No labor
// derived yet".
//
// TBJ - FL P10 today is the seeded case: zero actuals, applies=true,
// four weeks each with a revenue basis and per-week batr. Before the
// fix, this account rendered StateEmptyFirstRun. After the fix,
// StoryBlock renders with the four-week strip.
//
// TEST_MODE=true bypasses middleware auth for the server routes;
// the client component's session hook still requires a valid
// storageState (see tests/auth.setup.ts for the refresh flow when
// the cookie ages out past 25 days).

import { test, expect } from "@playwright/test";

test.describe("Labor empty-state fix · board renders with zero actuals", () => {
  test("TBJ - FL P10: applies=true + zero actuals renders StoryBlock", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04");

    // Wait for the board (SpendCard renders inside .kpi-spend, the
    // StoryBlock hero panel). The old defect showed .kpi-statebox
    // "No labor derived yet" instead - see StateBoxes.StateEmptyFirstRun.
    const spendCard = page.locator(".kpi-spend").first();
    await expect(spendCard).toBeVisible({ timeout: 15_000 });

    // The old empty-state title must NOT be on the page.
    const oldEmptyTitle = page.getByText("No labor derived yet");
    await expect(oldEmptyTitle).toHaveCount(0);

    // Four per-week tiles render for a four-week period (Tier A).
    const weekBars = page.locator(".kpi-wbars .kpi-wb");
    await expect(weekBars).toHaveCount(4, { timeout: 5_000 });

    // The running week caption reads a fraction (R-80), not a variance
    // arrow, because PR-B already ships this. Assert the fraction
    // class appears at least once - proof the running-week rendering
    // fires on the empty-actuals payload.
    const fractionCap = page.locator(".kpi-wb-d-frac");
    expect(await fractionCap.count()).toBeGreaterThanOrEqual(1);
  });

  test("TBR - FL P10: confirmed running week renders the same shape", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBR%20-%20FL&start=2026-09-07&end=2026-10-04");
    const spendCard = page.locator(".kpi-spend").first();
    await expect(spendCard).toBeVisible({ timeout: 15_000 });
    const weekBars = page.locator(".kpi-wbars .kpi-wb");
    await expect(weekBars).toHaveCount(4);
  });
});
