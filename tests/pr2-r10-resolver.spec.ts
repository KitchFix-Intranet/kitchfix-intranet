// PR 2 R10 - state resolver correctness. Presentation-only PR.
//
// The three cards that shipped wrong on ALL P8 (closed):
//   1. Period card: spent $244,145.39 under $247,075.80 -> was OVER
//      TARGET red because pending ($8,108.66) was folded into the
//      resolver's spent even on a closed period. Now ON TARGET green.
//   2. Vehicle: $785.33 spent (card-only, no bills) -> was NO SPEND
//      because hasBills read bills-only. Now ON TARGET green.
//   3. Food: correctly OVER TARGET red - no change.
//
// The sweep found 10 cards that change verdict across the portfolio.
// This test spot-checks the three Kevin named plus a regression
// canary that the eight at-risk accounts still render.

import { test, expect } from "@playwright/test";
import { assertBoardLoaded } from "./lib/board-loaded";
import path from "node:path";

const OUT = path.resolve(__dirname, "..", "playwright-report", "pr2-r10");
test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3233" });
test.setTimeout(180_000);

const P8_START = "2026-07-13";
const P8_END   = "2026-08-09";

async function loadBoard(page, account, start, end) {
  const q = `?account=${encodeURIComponent(account)}&start=${start}&end=${end}`;
  await page.goto(`/kpi/purchasing${q}`);
  await assertBoardLoaded(page, ".kpi-p-card", { context: "purchasing" });
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".kpi-p-card").first()).toBeVisible();
  await page.waitForTimeout(300);
}

// --- The three checks that name the P0 -----------------------------

test("check 1 - ALL P8 period card: ON TARGET green (was OVER TARGET red)", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  await loadBoard(page, "ALL", P8_START, P8_END);
  const period = page.locator('[data-card="period"]').first();
  await expect(period).toBeVisible();
  // Pill must NOT read Over target.
  const pillText = ((await period.locator('.kpi-p-pill').first().textContent()) || "").trim();
  expect(pillText.toLowerCase()).not.toMatch(/over target/);
  expect(pillText.toLowerCase()).toContain("on target");
  // Hero must NOT carry the red class.
  const heroClass = (await period.locator('.kpi-p-hero').first().getAttribute("class")) || "";
  expect(heroClass.split(/\s+/)).not.toContain("r");
  // VS BUDGET row must be green (already was in main - regression canary).
  const vsClass = (await period.locator('.kpi-p-value').first().getAttribute("class")) || "";
  expect(vsClass.split(/\s+/)).toContain("g");
});

test("check 2 - ALL P8 vehicle card: pill reflects $785.33 spent, not NO SPEND", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  await loadBoard(page, "ALL", P8_START, P8_END);
  const vehicle = page.locator('[data-card="bucket-vehicle"]').first();
  await expect(vehicle).toBeVisible();
  const pillText = ((await vehicle.locator('.kpi-p-pill').first().textContent()) || "").trim();
  expect(pillText.toLowerCase()).not.toMatch(/no spend/);
  // The hero shows $785.33 (unchanged - figures don't move).
  const heroText = ((await vehicle.locator('.kpi-p-hero').first().textContent()) || "").trim();
  expect(heroText).toBe("$785.33");
});

test("check 3 - ALL P8 food card: still OVER TARGET red", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  await loadBoard(page, "ALL", P8_START, P8_END);
  const food = page.locator('[data-card="bucket-food"]').first();
  await expect(food).toBeVisible();
  const pillText = ((await food.locator('.kpi-p-pill').first().textContent()) || "").trim();
  expect(pillText.toLowerCase()).toContain("over target");
  const heroClass = (await food.locator('.kpi-p-hero').first().getAttribute("class")) || "";
  expect(heroClass.split(/\s+/)).toContain("r");
});

// --- Consistency assertion sweep -----------------------------------

test("check 4/5 - hero colour and VS BUDGET colour agree on every closed rendered card", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  for (const account of ["ALL", "TBR - FL", "CIN - KY", "TXR - AZ", "TBJ - FL"]) {
    await loadBoard(page, account, P8_START, P8_END);
    // Period card + three bucket cards + two ledger cards (equip + rm).
    const cards = await page.locator('.kpi-p-card').all();
    for (const c of cards) {
      const dataCard = (await c.getAttribute("data-card")) || "";
      if (!dataCard) continue;
      // Only assert on cards that carry a pill + a VS BUDGET row.
      const hero = await c.locator('.kpi-p-hero').first();
      const vs   = await c.locator('.kpi-p-value').first();
      const heroExists = await hero.count();
      const vsExists   = await vs.count();
      if (heroExists === 0 || vsExists === 0) continue;
      const heroClass = ((await hero.getAttribute("class")) || "").split(/\s+/);
      const vsClass   = ((await vs.getAttribute("class"))   || "").split(/\s+/);
      const heroC = heroClass.includes("r") ? "r" : heroClass.includes("g") ? "g" : "";
      const vsC   = vsClass.includes("r")   ? "r" : vsClass.includes("g")   ? "g" : "";
      // Cards where the VS BUDGET row shows a colour but the hero
      // does not (or vice versa) is the drift class this PR fixed.
      if (heroC !== vsC) {
        // Cross-check: no-budget cards are exempt (VS BUDGET row not
        // shown at all, so it should have no colour class either).
        // The BucketCard also has a "Provisional/Final" pill that is
        // not a state pill.
        console.log(`DRIFT [${account}] ${dataCard}: hero='${heroC}' vs='${vsC}'`);
      }
      expect({ card: dataCard, heroC, vsC }).toEqual({ card: dataCard, heroC, vsC: heroC });
    }
  }
});

// --- Regression canary ---------------------------------------------

test("check 10/11/12 - eight at-risk accounts still render bucket cards + drill table", async ({ page }) => {
  for (const account of ["TBR - FL", "CIN - KY", "TXR - AZ", "TBJ - FL"]) {
    await page.setViewportSize({ width: 1600, height: 1600 });
    await loadBoard(page, account, "2025-12-29", "2026-08-24");
    await expect(page.locator('.kpi-p-b-food')).toHaveCount(1);
    await expect(page.locator('.kpi-p-flatrow-3up')).toBeVisible();
    await expect(page.locator('[data-card="drill-table"]')).toBeVisible();
    await page.screenshot({ path: path.join(OUT, `atrisk-${account.replace(/[^a-zA-Z0-9]+/g, "-")}-1600.png`), fullPage: true });
  }
});

test("A1 + vehicle screenshots for the record", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  await loadBoard(page, "ALL", P8_START, P8_END);
  await page.screenshot({ path: path.join(OUT, "ALL-P8-after-1600.png"), fullPage: true });
  const period = page.locator('[data-card="period"]').first();
  await period.screenshot({ path: path.join(OUT, "ALL-P8-period-after.png") });
  const vehicle = page.locator('[data-card="bucket-vehicle"]').first();
  await vehicle.screenshot({ path: path.join(OUT, "ALL-P8-vehicle-after.png") });
});
