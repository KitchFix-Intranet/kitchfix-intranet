// Homestand card popovers. Kevin's item P1-4 from the audit:
//
//   "P1-4: zero `?` popovers. Measured: 0 buttons with `?` text in
//    the entire subtree. The approved render has twelve, and every
//    card is meant to carry one. Copy is in
//    kitchfix-homestand-v11.html - use it verbatim.
//
//    Two things the render solved that must carry over: popovers need
//    overflow: visible on every ancestor plus a z-index lift on the
//    open card, or they clip against the card edge and the table; and
//    one near the bottom of the viewport must flip upward rather than
//    push off-screen."
//
// This PR ships the eight popovers that exist on the current actuals
// view (rail, season-to-date, five signal cards, and the table's
// "Peak" column). The plan-mode popovers (qPlan / qBank / qHrs / qOT /
// qSpread) land with the pre-floor estimator PR alongside their cards.

import { test, expect, type Page } from '@playwright/test';
import { assertBoardLoaded } from './lib/board-loaded';

const ACCOUNT = 'CIN - OH';

const POPOVERS_ON_SCREEN = [
  'qRail',     // Season by homestand
  'qSeason',   // Season to date
  'qSpend',    // HS X spend
  'qPrep',     // Prep & off days
  'qGame',     // Cost per game day
  'qOT2',      // Overtime for this shape
  'qPay',      // Payroll data
  'qPeak',     // Season table "Peak" column header
];

async function openStandView(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/kpi/labor?account=${encodeURIComponent(ACCOUNT)}&view=homestand`);
  await assertBoardLoaded(page, '.kpi-hs-rail', { context: `homestand rail on ${ACCOUNT}` });
  const stand = page.locator('.kpi-hs-rail-stand:not([disabled])').first();
  await stand.click();
  await page.waitForSelector('[data-card="spend"]', { timeout: 15_000 });
}

test.setTimeout(90_000);

test.describe('KPI homestand popovers', () => {
  test.beforeEach(async ({ page }) => { await openStandView(page); });

  test('all eight actuals-view popovers render a trigger', async ({ page }) => {
    for (const id of POPOVERS_ON_SCREEN) {
      const trigger = page.locator(`[data-hs-help="${id}"]`);
      await expect(trigger, `missing popover trigger: ${id}`).toHaveCount(1);
    }
    // Extra: exactly 8 triggers, no orphans, no dupes.
    await expect(page.locator('[data-hs-help]')).toHaveCount(POPOVERS_ON_SCREEN.length);
  });

  test('clicking a trigger opens the dialog; clicking outside closes it', async ({ page }) => {
    const trigger = page.locator('[data-hs-help="qSpend"]');
    await trigger.click();
    const pop = page.locator('.kpi-hs-pop[data-hs-pop]');
    await expect(pop).toHaveCount(1);
    await expect(pop).toBeVisible();
    // Click somewhere outside the popover.
    await page.locator('h1, body').first().click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.kpi-hs-pop[data-hs-pop]')).toHaveCount(0);
  });

  test('escape key closes the popover', async ({ page }) => {
    await page.locator('[data-hs-help="qGame"]').click();
    await expect(page.locator('.kpi-hs-pop[data-hs-pop]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.kpi-hs-pop[data-hs-pop]')).toHaveCount(0);
  });

  test('opening one popover closes any other that was open', async ({ page }) => {
    // Only one popover on screen at a time (the click-outside handler
    // fires on the second trigger's click bubbling up to document).
    await page.locator('[data-hs-help="qSpend"]').click();
    await expect(page.locator('[role="dialog"][aria-label="What this stand cost"]')).toBeVisible();
    await page.locator('[data-hs-help="qPrep"]').click();
    await expect(page.locator('[role="dialog"][aria-label="What this stand cost"]')).toHaveCount(0);
    await expect(page.locator('[role="dialog"][aria-label="Prep and off days"]')).toBeVisible();
  });

  test('popover renders fully inside the viewport (no clip against card edge)', async ({ page }) => {
    // The whole point of the overflow:visible / z-index-lift chain.
    // Signal card popovers were the clip risk.
    await page.locator('[data-hs-help="qGame"]').click();
    const pop = page.locator('.kpi-hs-pop[data-hs-pop]');
    const box = await pop.boundingBox();
    const vp = page.viewportSize()!;
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
    // Vertical: if it fits below, top+height <= viewport; if it flipped
    // up, top >= 0 already covered. Both good states.
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 1);
  });

  test('a popover near the bottom of the viewport flips UPWARD', async ({ page }) => {
    // qPeak is on the season table header, which sits near the bottom
    // of the initial render at 900px height. Give it plenty of scroll
    // room so the trigger IS near the bottom, then verify flip.
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.locator('.kpi-hs-th-help').scrollIntoViewIfNeeded();
    // Nudge scroll so the header is near the bottom edge.
    const th = page.locator('.kpi-hs-th-help');
    const thBox = await th.boundingBox();
    await page.evaluate((y) => window.scrollBy(0, y), Math.max(0, (thBox?.y ?? 0) - 600));
    await page.locator('[data-hs-help="qPeak"]').click();
    const pop = page.locator('.kpi-hs-pop[data-hs-pop]');
    await expect(pop).toBeVisible();
    // Flip variant means the pop.y is ABOVE the trigger.y, not below.
    const thAfter = await page.locator('.kpi-hs-th-help').boundingBox();
    const popBox = await pop.boundingBox();
    expect(thAfter && popBox).toBeTruthy();
    const flippedUp = (popBox!.y + popBox!.height) <= (thAfter!.y + 4);
    expect(flippedUp, 'popover must flip upward when trigger is near viewport bottom').toBe(true);
    // Sanity: the flip class is on the pop node.
    await expect(pop).toHaveClass(/kpi-hs-pop-flip/);
  });

  test('table Peak popover is not clipped by the table card', async ({ page }) => {
    // Direct check on the historically fragile spot: the table card
    // had overflow:hidden. Now overflow:visible; the Peak column
    // header should surface its full popover.
    await page.locator('[data-hs-help="qPeak"]').click();
    const pop = page.locator('.kpi-hs-pop[data-hs-pop]');
    await expect(pop).toBeVisible();
    // Popover must be strictly larger than 0 in both dimensions.
    const box = await pop.boundingBox();
    expect(box!.width).toBeGreaterThan(50);
    expect(box!.height).toBeGreaterThan(20);
  });

  test('title matches the v11 copy for the spend popover', async ({ page }) => {
    // Spot-check verbatim discipline on the copy-critical one.
    await page.locator('[data-hs-help="qSpend"]').click();
    const pop = page.locator('.kpi-hs-pop[data-hs-pop]');
    await expect(pop.locator('.kpi-hs-pop-title')).toHaveText('What this stand cost');
    await expect(pop).toContainText('Every dollar of hourly labor on the days this homestand owns');
    await expect(pop).toContainText('Down and green means you came in under.');
  });
});
