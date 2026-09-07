// Labor running-week target-line fix (Kevin 2026-09-07). The running
// week's dashed target line was suppressed when spend was zero via
// the V29-14 `isZero` gate. On day one of a new period this hid the
// line on the week a chef cares most about: TBJ - FL P10 today has
// a $4,216.81 budget and no reference line on the bar. Kevin: "the
// budget exists whether or not anything has been spent against it,
// and an empty bar with a line above it is precisely the useful
// picture on Monday morning."
//
// Assertion: every week in a range renders a target line at its own
// budget, including zero-spend running weeks. Regression coverage
// asserts closed weeks still draw their lines.

import { test, expect } from "@playwright/test";

test.describe("Labor · target line renders on zero-spend running week", () => {
  test("TBJ - FL P10: 4 target lines (running week no longer suppressed)", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04");
    await expect(page.locator(".kpi-wbars").first()).toBeVisible({ timeout: 15_000 });
    const lines = page.locator(".kpi-wbars .kpi-wb-target");
    await expect(lines).toHaveCount(4);
  });

  test("TBR - FL P10: 4 target lines (running week no longer suppressed)", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBR%20-%20FL&start=2026-09-07&end=2026-10-04");
    await expect(page.locator(".kpi-wbars").first()).toBeVisible({ timeout: 15_000 });
    const lines = page.locator(".kpi-wbars .kpi-wb-target");
    await expect(lines).toHaveCount(4);
  });

  test("TBJ - FL Last period: 4 lines still render (no regression on closed)", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBJ%20-%20FL&start=2026-08-10&end=2026-09-06");
    await expect(page.locator(".kpi-wbars").first()).toBeVisible({ timeout: 15_000 });
    const lines = page.locator(".kpi-wbars .kpi-wb-target");
    await expect(lines).toHaveCount(4);
  });

  test("TBR - FL Last period: 4 lines still render (no regression on closed)", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBR%20-%20FL&start=2026-08-10&end=2026-09-06");
    await expect(page.locator(".kpi-wbars").first()).toBeVisible({ timeout: 15_000 });
    const lines = page.locator(".kpi-wbars .kpi-wb-target");
    await expect(lines).toHaveCount(4);
  });
});
