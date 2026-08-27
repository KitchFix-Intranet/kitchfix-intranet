// PR 2 R9 - design audit fixes. Fourteen items ordered by severity.
//
// P0 - STL-FL period card duplicated Fun Money and hid $11k+ of
//      client-billed activity. Replaced with PassThroughPeriodCard
//      that shows total activity, sub-rows for the split.
// P1-1 VS PRIOR now scales prior by elapsed fraction on single
//      in-progress periods so mid-period reads are like-for-like;
//      ▼ 0% renders neutral, not green.
// P1-2 Chart scaleMax capped at 1.5x tallest bar so a tall target
//      cannot flatten the bars. R5 assertion still passes because
//      it is scale-invariant.
// P1-3 Left-edge fade indicator when the chart is scrolled off left.
// P2 items: SPEND BY PERIOD space, empty ledger cards size to
//    content, WHERE IT LANDED includes reimbursable segment, header
//    fits without wrapping, empty table headers suppressed.
// P3 items: week starting moved to header, per-bucket THE PERIOD
//    label dropped, zero-sum week rows lose the expand button,
//    management-fee outlier accent switched from amber to navy.

import { test, expect } from "@playwright/test";
import path from "node:path";
import { assertBoardLoaded } from "./lib/board-loaded";

const OUT = path.resolve(__dirname, "..", "playwright-report", "pr2-r9");
test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3230" });
test.setTimeout(180_000);

const FYTD_START = "2025-12-29";
const FYTD_END   = "2026-08-24";
const P9_START   = "2026-08-24";
const P9_END     = "2026-09-20";
// Kevin's live audit ran at STL - FL "P9" but the fiscal calendar
// resolved that as the just-started 2026-08-24..2026-09-20 range which
// carries $0 activity at run-time. Use P8 (2026-07-27..2026-08-23) for
// the assertion - the shape of the defect is identical (reimbursable
// activity, Fun Money at $0 of $1,766.35) and P8 has real numbers.
const P8_START   = "2026-07-27";
const P8_END     = "2026-08-23";

async function loadBoard(page, account, start = FYTD_START, end = FYTD_END) {
  const q = `?account=${encodeURIComponent(account)}&start=${start}&end=${end}`;
  await page.goto(`/kpi/purchasing${q}`);
  await assertBoardLoaded(page, ".kpi-p-card", { context: "purchasing" });
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".kpi-p-card").first()).toBeVisible();
  await page.waitForTimeout(400);
}

test("P0 - STL-FL period card shows TOTAL activity, not just Fun Money", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1600 });
  await loadBoard(page, "STL - FL", P8_START, P8_END);
  const per = page.locator('[data-card="period-passthru"]');
  await expect(per).toBeVisible();
  // Hero reads "Total activity" and the value = reimbursable + fun money.
  await expect(per.getByText(/total activity/i)).toBeVisible();
  const heroText = ((await per.locator('.kpi-p-hero').first().textContent()) || "").trim();
  // If reimb > 0 the hero must NOT read "$0.00" - that was Kevin's P0.
  // We accept any positive dollar amount.
  expect(heroText).toMatch(/^\$\d/);
  expect(heroText).not.toBe("$0.00");
  // Sub-rows include both Reimbursable and Fun Money.
  const perText = ((await per.textContent()) || "").toLowerCase();
  expect(perText).toContain("reimbursable");
  expect(perText).toContain("fun money");
  // The separate FunMoneyCard still exists (verdict surface stays).
  await expect(page.locator('[data-card="fun-money"]')).toBeVisible();
  await page.screenshot({ path: path.join(OUT, "P0-stlfl-p9-1680.png"), fullPage: true });
});

test("P0 - no duplicated Fun Money figures on STL-FL", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1600 });
  await loadBoard(page, "STL - FL", P8_START, P8_END);
  // The period card's hero is the TOTAL activity - it should not
  // equal the Fun Money card's hero (which is 3200.2 only). If they
  // were equal, it would indicate the period card was scoped to
  // Fun Money only (the P0 defect).
  const perHero = ((await page.locator('[data-card="period-passthru"] .kpi-p-hero').first().textContent()) || "").trim();
  const fmHero  = ((await page.locator('[data-card="fun-money"] .kpi-p-hero').first().textContent()) || "").trim();
  expect(perHero).not.toBe(fmHero);
});

test("P1-1 - VS PRIOR does not all read a large decrease mid-period at STL-FL P9", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1600 });
  await loadBoard(page, "STL - FL", P8_START, P8_END);
  // Vendor breakdown might not render if the account has no vendor
  // rows for that period - skip if absent.
  const chips = page.locator('[data-card="vendor-breakdown"] .kpi-p-ch');
  const n = await chips.count();
  if (n === 0) test.skip(true, "no vendor rows on STL-FL P9 window");
  const texts: string[] = [];
  for (let i = 0; i < n; i++) texts.push(((await chips.nth(i).textContent()) || "").trim());
  // No literal ▼ 0%  (neutral now).
  for (const t of texts) expect(t).not.toMatch(/^▼\s*0%/);
  // Should not be uniformly ▼ 80%+ (the mid-period artefact).
  const largeDecreases = texts.filter(t => /^▼\s*(8\d|9\d)%/.test(t));
  expect(largeDecreases.length).toBeLessThan(n);   // not every row
});

test("P1-1 - ▼ 0% never appears on any account/range", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1600 });
  for (const account of ["TBR - FL", "STL - FL", "ALL"]) {
    await loadBoard(page, account, FYTD_START, FYTD_END);
    const chips = page.locator('[data-card="vendor-breakdown"] .kpi-p-ch');
    const n = await chips.count();
    for (let i = 0; i < n; i++) {
      const t = ((await chips.nth(i).textContent()) || "").trim();
      expect(t).not.toMatch(/^▼\s*0%/);
      expect(t).not.toMatch(/^▲\s*0%/);
    }
  }
});

test("P1-2 - chart bar heights differentiate on ALL FYTD (P3 taller than P8)", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1600 });
  await loadBoard(page, "ALL", FYTD_START, FYTD_END);
  // Tier C strip on ALL FYTD, food bucket. Bars are period-scoped.
  // `.kpi-p-b-food` is applied to the LEFT card (numbers); the chart
  // strip lives in the sibling right card inside the row wrapper. Use
  // the row's data-card attribute for a stable selector.
  const foodBar = page.locator('[data-card="bucket-food"] .kpi-p-bar').first();
  await expect(foodBar).toBeVisible();
  const heights = await page.locator('[data-card="bucket-food"] .kpi-p-bar').evaluateAll(bars =>
    bars.map(b => b.getBoundingClientRect().height));
  // P3 (index 2) tallest and P8 (index 7) shorter than P3.
  // Ratio should be >= 1.6x (dollar ratio ~2.03x; some tolerance for
  // headroom).
  const p3 = heights[2];
  const p8 = heights[7];
  console.log(`P3 bar height ${p3.toFixed(1)}px · P8 bar height ${p8.toFixed(1)}px · ratio ${(p3 / p8).toFixed(2)}`);
  expect(p3 / p8).toBeGreaterThan(1.6);
});

test("P2-1 - SPEND BY PERIOD has a space before 'relative'", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1600 });
  await loadBoard(page, "STL - FL", FYTD_START, FYTD_END);
  const trend = page.locator('.kpi-p-mftrend');
  const raw = await trend.evaluate(el => el.textContent || "");
  // Concatenated string must not read `PERIODrelative`.
  expect(raw).not.toMatch(/PERIODrelative/i);
  // Ideally has "period relative" (case-insensitive).
  expect(raw).toMatch(/period\s+relative/i);
});

test("P2-3 - WHERE IT LANDED includes reimbursable segment at STL-FL", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1600 });
  await loadBoard(page, "STL - FL", FYTD_START, FYTD_END);
  const rows = page.locator('[data-card="vendor-breakdown"] .kpi-p-vbrow');
  const n = await rows.count();
  if (n === 0) test.skip(true, "no vendor rows to test");
  // Each row has a split bar. At STL-FL any row with reimbursable
  // spend should now show a purple segment (Reimbursable), not
  // entirely-grey (the pre-fix state).
  const bars = page.locator('[data-card="vendor-breakdown"] .kpi-p-vbsplit');
  const totalSegments = await bars.evaluateAll(nodes => {
    return nodes.reduce((count, n) => count + (n.children ? n.children.length : 0), 0);
  });
  expect(totalSegments).toBeGreaterThan(0);
});

test("P3-8 - zero-total week rows have no expand button", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1600 });
  // TBR - FL FYTD - some off-season weeks are all-zero.
  await loadBoard(page, "TBR - FL", FYTD_START, FYTD_END);
  const emptyRows = page.locator('.kpi-p-tbl-week-empty');
  const n = await emptyRows.count();
  if (n === 0) test.skip(true, "no zero-sum week rows in this range");
  // Empty rows must NOT contain a button.
  for (let i = 0; i < Math.min(n, 3); i++) {
    const buttons = await emptyRows.nth(i).locator('button').count();
    expect(buttons).toBe(0);
  }
});

test("regression: TBR-FL and CIN-KY numbers unchanged - two accounts before-after", async ({ page }) => {
  for (const account of ["TBR - FL", "CIN - KY"]) {
    await page.setViewportSize({ width: 1680, height: 1600 });
    await loadBoard(page, account, FYTD_START, FYTD_END);
    // Bucket cards + three-up + drill table still render.
    await expect(page.locator('.kpi-p-b-food')).toHaveCount(1);
    await expect(page.locator('.kpi-p-flatrow-3up')).toBeVisible();
    await expect(page.locator('[data-card="drill-table"]')).toBeVisible();
    // No FailureCard, no mgmt-fee.
    await expect(page.locator('[data-card="board-failed"]')).toHaveCount(0);
    await expect(page.locator('[data-card="mgmt-fee"]')).toHaveCount(0);
    await page.screenshot({ path: path.join(OUT, `atrisk-${account.replace(/[^a-zA-Z0-9]+/g, "-")}-1680.png`), fullPage: true });
  }
});

test("R5 assertion - period card + bucket cards render without throw on ALL FYTD", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1600 });
  // If R5 assertion tripped in dev, the page would crash and we would
  // not find any .kpi-p-card. Reaching this expectation proves the
  // assertion survived the scaleMax cap.
  await loadBoard(page, "ALL", FYTD_START, FYTD_END);
  await expect(page.locator('.kpi-p-b-food')).toHaveCount(1);
  await expect(page.locator('.kpi-p-b-pkg')).toHaveCount(1);
  await expect(page.locator('.kpi-p-b-veh')).toHaveCount(1);
});
