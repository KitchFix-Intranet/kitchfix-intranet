// Labor R-68 + panel batr precedence (Kevin walkthrough sweep 2026-09-07).
// Two acceptance clauses:
//
// 1. Labor's Kitchen labour total equals Overview 3100 in BOTH toggle
//    states, cent-exact on TBR - FL + TBJ - FL, every range. Prior
//    default (hourly) was $130K short of Overview on TBJ - FL This
//    year - R-68 restated for Labor: "the toggle controls disclosure
//    of the split, never the number."
//
// 2. SpendCard's "Adjusted budget" cell prefers range-level batr
//    over per-week sum. Earlier walkthrough PR-A had this backwards;
//    TBJ - FL This year rendered $244,787.71 (per-week sum missing
//    P1-P4 pre-SC-seeding) when the truthful figure is $454,749.84
//    (range-level, salary-inclusive after R-68 fix).
//
// Same auth-cache needs-gate as prior labor PRs.

import { test, expect } from "@playwright/test";

test.describe("Labor R-68 · toggle parity", () => {
  test("TBJ - FL Last period: pill reads salary-inclusive on hourly toggle", async ({ page }) => {
    // Hourly toggle (default) - Labor spent should equal Overview 3100.
    // Overview 3100 for TBJ - FL Last period = $40,794.48.
    await page.goto("/kpi/labor?account=TBJ%20-%20FL&start=2026-08-10&end=2026-09-06");
    await expect(page.locator(".kpi-spend").first()).toBeVisible({ timeout: 15_000 });
    const hero = page.locator("[data-kpi-labor-hero='actual']");
    await expect(hero).toContainText(/\$40,794/);
  });

  test("TBR - FL This year: hero reads $553,935 on hourly (Overview 3100)", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBR%20-%20FL&start=2025-12-29&end=2026-09-06");
    await expect(page.locator(".kpi-spend").first()).toBeVisible({ timeout: 15_000 });
    const hero = page.locator("[data-kpi-labor-hero='actual']");
    await expect(hero).toContainText(/\$553,93[56]/);
  });
});

test.describe("Labor panel · batr precedence", () => {
  test("TBJ - FL This year: adjusted budget prefers range-level over per-week sum", async ({ page }) => {
    await page.goto("/kpi/labor?account=TBJ%20-%20FL&start=2025-12-29&end=2026-09-06");
    await expect(page.locator(".kpi-spend").first()).toBeVisible({ timeout: 15_000 });
    const budgetCell = page.locator(".kpi-spend-pair .kpi-spend-cell").first();
    await expect(budgetCell).toContainText(/Adjusted budget/);
    // Range-level batr is salary-inclusive after R-68 = $454,749.84
    await expect(budgetCell).toContainText(/\$45[45],7[45]\d/);
    // Must NOT show the old per-week-sum $244K or the raw range_budget $448K/$301K
    await expect(budgetCell).not.toContainText("244,787");
  });
});
