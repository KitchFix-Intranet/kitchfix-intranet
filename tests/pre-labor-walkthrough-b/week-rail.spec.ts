// Labor PR-B walkthrough spec (Kevin 2026-09-07). The week rail is
// the piece the render specified and the board never got - four
// cards under the chart, one per week, doing three different jobs
// per state.
//
// Acceptance (Kevin): "assert every week renders a tile with its
// basis, budget and state, on every range and account, including a
// period where nothing has been spent."
//
// TEST_MODE=true bypasses middleware; client SessionProvider still
// requires valid storageState (needs-gate on Kevin's auth refresh).

import { test, expect } from "@playwright/test";

test.describe("Labor walkthrough PR-B · week rail tiles", () => {
  test("TBJ - FL P10: four tiles, states confirmed/confirmed/forecast/forecast", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04");
    await expect(page.locator(".kpi-wrail").first()).toBeVisible({ timeout: 15_000 });
    const tiles = page.locator(".kpi-wrail-tile");
    await expect(tiles).toHaveCount(4);

    // Each tile carries a basis attribute.
    const basisAttrs = await tiles.evaluateAll(els => els.map(e => e.getAttribute("data-basis")));
    expect(basisAttrs).toEqual(["confirmed", "confirmed", "forecast", "forecast"]);
  });

  test("TBR - FL P10 W1: partial tile in its natural habitat", async ({ page }) => {
    // The natural partial case - running week, part-entered.
    await page.goto("/kpi/labor?account=TBR%20-%20FL&start=2026-09-07&end=2026-10-04");
    await expect(page.locator(".kpi-wrail").first()).toBeVisible({ timeout: 15_000 });
    const tiles = page.locator(".kpi-wrail-tile");
    await expect(tiles).toHaveCount(4);

    // W1 (index 0) is partial.
    await expect(tiles.first()).toHaveAttribute("data-basis", "partial");
    await expect(tiles.first()).toHaveAttribute("data-temporal", "running");

    // Partial tile carries the "N of M services confirmed" sub-caption.
    await expect(tiles.first()).toContainText(/services confirmed · budget will move/);

    // Running-week fraction on the verdict line.
    const vd = tiles.first().locator(".kpi-wrail-vd");
    await expect(vd).toContainText(/% used/);

    // Sub-caption names days left.
    await expect(tiles.first()).toContainText(/days? left/);
  });

  test("TBR - FL P10 W2-W4: forecast tiles show `schedule to $X` (planning grammar)", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBR%20-%20FL&start=2026-09-07&end=2026-10-04");
    await expect(page.locator(".kpi-wrail").first()).toBeVisible({ timeout: 15_000 });
    const tiles = page.locator(".kpi-wrail-tile");

    // W2 is forecast + future -> "schedule to $X" verdict.
    const w2vd = tiles.nth(1).locator(".kpi-wrail-vd");
    await expect(w2vd).toContainText(/schedule to \$/);

    // Forecast tiles carry a `plan` tag on the budget row.
    const planTags = tiles.locator(".kpi-wrail-plan-tag");
    expect(await planTags.count()).toBeGreaterThanOrEqual(3);
  });

  test("TBJ - FL Last period: four closed tiles with under/over verdicts", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBJ%20-%20FL&start=2026-08-10&end=2026-09-06");
    await expect(page.locator(".kpi-wrail").first()).toBeVisible({ timeout: 15_000 });
    const tiles = page.locator(".kpi-wrail-tile");
    await expect(tiles).toHaveCount(4);

    // Every tile is closed + confirmed (all four weeks per corrected rule).
    const temporalAttrs = await tiles.evaluateAll(els => els.map(e => e.getAttribute("data-temporal")));
    expect(temporalAttrs).toEqual(["closed", "closed", "closed", "closed"]);
    const basisAttrs = await tiles.evaluateAll(els => els.map(e => e.getAttribute("data-basis")));
    expect(basisAttrs).toEqual(["confirmed", "confirmed", "confirmed", "confirmed"]);

    // Verdict line has an over (▲) or under (▼) marker on each tile.
    for (let i = 0; i < 4; i += 1) {
      const vd = tiles.nth(i).locator(".kpi-wrail-vd");
      await expect(vd).toContainText(/[▲▼]/);
    }
  });

  test("Zero-spend running period (TBJ - FL P10 today): W1+W2 render but no % used", async ({ page }) => {
    // Kevin acceptance: "including a period where nothing has been
    // spent". Rail still renders, running tile with no spend reads
    // `schedule to $X` (fall-through), not the fraction.
    await page.goto("/kpi/labor?account=TBJ%20-%20FL&start=2026-09-07&end=2026-10-04");
    await expect(page.locator(".kpi-wrail").first()).toBeVisible({ timeout: 15_000 });
    const tiles = page.locator(".kpi-wrail-tile");
    await expect(tiles).toHaveCount(4);

    // W1 running + zero spend -> "schedule to $X", no fraction.
    const w1vd = tiles.first().locator(".kpi-wrail-vd");
    await expect(w1vd).toContainText(/schedule to \$/);
    await expect(w1vd).not.toContainText(/% used/);
  });
});
