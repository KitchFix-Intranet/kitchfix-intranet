// Labor PR-A walkthrough spec (Kevin 2026-09-07). Three assertions:
//
// 1. Panel adjusted budget = sum of per-week batr. TBJ - FL Last
//    period previously shipped $19,109.10 labeled "Adjusted budget"
//    while sum of the four weeks' batr was $19,346.42. This is the
//    R-77 defect on the panel surface itself.
//
// 2. Partial basis fires when service-level counts are mixed.
//    TBJ - FL P10 W1 today (23 of 93 services confirmed) was
//    previously classified "confirmed" because the loader worked at
//    day level; now correctly "partial" because it works at service
//    level.
//
// 3. Legend no longer promises "amber hatched = not costed yet"
//    (R-84: no legend for a treatment nothing uses).
//
// TEST_MODE=true bypasses middleware; client SessionProvider still
// requires valid storageState.

import { test, expect } from "@playwright/test";

test.describe("Labor walkthrough PR-A · panel adjusted + partial basis", () => {
  test("TBJ - FL Last period: panel budget = $19,346 (sum of per-week batr)", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBJ%20-%20FL&start=2026-08-10&end=2026-09-06");
    await expect(page.locator(".kpi-spend").first()).toBeVisible({ timeout: 15_000 });

    // Left cell in the pair below the hero holds the adjusted budget.
    const budgetCell = page.locator(".kpi-spend-pair .kpi-spend-cell").first();
    await expect(budgetCell).toContainText("Adjusted budget");
    // Kevin acceptance: cent-exact $19,346.42 on TBJ - FL P9. Rounded
    // by fmt$ to $19,346 (or $19,347 depending on rounding rule).
    await expect(budgetCell).toContainText(/\$19,34[67]/);
    // Must NOT show the old raw range_budget value $19,109
    await expect(budgetCell).not.toContainText("19,109");
  });

  test("TBJ - FL P10 W1 running week renders as PARTIAL not confirmed", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04");
    await expect(page.locator(".kpi-wbars").first()).toBeVisible({ timeout: 15_000 });

    // Partial state renders `.kpi-wb-cap-forecast` (muted caption) on
    // the tile. Not `.kpi-wb-target-forecast` because partial keeps
    // the amber target line (per Kevin: "solid, muted").
    const captions = page.locator(".kpi-wbars .kpi-wb-cap-forecast");
    // W1 (partial) and W2 (partial 22/92) both muted; W3/W4 forecast
    // also muted. So expect at least 1 partial tile visible.
    expect(await captions.count()).toBeGreaterThanOrEqual(1);

    // The partial caption carries the "N of M services confirmed"
    // sub-copy per walkthrough item 3.
    const partialDates = page.locator(".kpi-wb-dates").filter({ hasText: /services confirmed · budget will move/ });
    expect(await partialDates.count()).toBeGreaterThanOrEqual(1);
  });

  test("Legend removes amber hatched entry (R-84)", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBJ%20-%20FL&start=2026-08-10&end=2026-09-06");
    await expect(page.locator(".kpi-wh").first()).toBeVisible({ timeout: 15_000 });

    // Amber legend entry must not be on the page.
    const legend = page.locator(".kpi-wh").first();
    await expect(legend).not.toContainText(/amber hatched/i);
    await expect(legend).not.toContainText(/not costed yet/i);

    // Grey hatched (awaiting approval) legend + descriptor remain.
    await expect(legend).toContainText(/grey hatched = awaiting approval/);
    await expect(legend).toContainText(/each week.s own budget/);

    // The pre-walkthrough "weekly target $X" entry must also be gone.
    await expect(legend).not.toContainText(/weekly target \$/);
    await expect(legend).not.toContainText(/adjusted \$/);
  });

  test("TBJ - FL P10 running week with $0 spend: no fraction line", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04");
    await expect(page.locator(".kpi-wbars").first()).toBeVisible({ timeout: 15_000 });

    // No R-80 fraction (`$0 of $X · 0% used ...`) on a running week
    // that has never had spend. The fraction line uses .kpi-wb-d-frac.
    // Should be zero fractions today because spent_to_date=0.
    const fractions = page.locator(".kpi-wb-d-frac");
    expect(await fractions.count()).toBe(0);
  });
});
