// Labor unapproved-hours fix (Kevin 2026-09-07). Regression coverage
// for the trust defect: TBR - FL Last period showed "ON TRACK ·
// $986 under" with 86.88 unapproved hours worth ~$1,875 - nearly
// double the amount the period was under by. A chef who approves
// the weekend comes back to a different verdict and stops
// believing the board.
//
// Two assertions:
//   1. On a range with unapproved hours, the panel verdict pill is
//      accompanied by an AWAITING · N WKS · X HRS pill. Never ships
//      unqualified.
//   2. Any week with draft_hours > 0 renders a hatched grey slice
//      inside its bar (.kpi-wb-slice-unapp). The slice height is
//      proportional to the unapproved dollar share of that week's
//      spend.
//
// Zero-unapproved control: This period on TBR - FL (no shifts
// worked yet) renders neither the pill nor the slice.
//
// TEST_MODE=true bypasses middleware for server routes; client
// SessionProvider requires valid storageState (see auth.setup.ts).

import { test, expect } from "@playwright/test";

test.describe("Labor unapproved-hours visual + verdict qualification", () => {
  test("TBR - FL Last period: verdict pill carries AWAITING chip", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBR%20-%20FL&start=2026-08-10&end=2026-09-06&salary=1");
    await expect(page.locator(".kpi-spend").first()).toBeVisible({ timeout: 15_000 });

    // Verdict pill (ON TRACK) must be present
    const verdict = page.locator(".kpi-vpill.kpi-vpill-good").first();
    await expect(verdict).toBeVisible();
    await expect(verdict).toContainText(/ON TRACK/);

    // AWAITING pill must be alongside it
    const awaiting = page.locator("[data-vpill-awaiting]");
    await expect(awaiting).toBeVisible();
    await expect(awaiting).toContainText(/AWAITING/);
    // 86.88 hrs rounds to "86.9" in the copy
    await expect(awaiting).toContainText(/86\.9 HRS/);
  });

  test("TBR - FL Last period: hatched slice on week 4 (86.88 draft hrs)", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBR%20-%20FL&start=2026-08-10&end=2026-09-06&salary=1");
    await expect(page.locator(".kpi-wbars").first()).toBeVisible({ timeout: 15_000 });

    // Exactly one week has draft_hours > 0 (08/31 - 09/06). One slice.
    const slices = page.locator(".kpi-wb-slice-unapp");
    expect(await slices.count()).toBe(1);

    // Aria label carries the hour count for a screen reader.
    await expect(slices.first()).toHaveAttribute("aria-label", /86\.9 hours awaiting approval/);
  });

  test("TBR - FL This period: zero unapproved fires no pill and no slice", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBR%20-%20FL&start=2026-09-07&end=2026-10-04&salary=1");
    await expect(page.locator(".kpi-spend").first()).toBeVisible({ timeout: 15_000 });

    // No AWAITING pill
    const awaiting = page.locator("[data-vpill-awaiting]");
    await expect(awaiting).toHaveCount(0);

    // No hatched slices
    const slices = page.locator(".kpi-wb-slice-unapp");
    expect(await slices.count()).toBe(0);
  });

  test("Legend distinguishes grey (awaiting) from amber (not costed)", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBR%20-%20FL&start=2026-08-10&end=2026-09-06&salary=1");
    await expect(page.locator(".kpi-wbars").first()).toBeVisible({ timeout: 15_000 });

    const legend = page.locator(".kpi-wh").first();
    await expect(legend).toContainText(/grey hatched = awaiting approval/);
    await expect(legend).toContainText(/amber hatched = not costed yet/);
  });
});
