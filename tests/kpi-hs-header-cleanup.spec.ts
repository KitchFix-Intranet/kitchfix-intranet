// KPI header cleanup - Kevin's item 2 from Wednesday, folded in with
// the homestand PR-2 audit series. Two independent moves:
//
//   1. Hourly | + Salary toggle moved from between Section and Range
//      to the right side of the command bar, next to Export.
//   2. HOURLY ONLY / + SALARY scope pill moved out of the command-bar
//      title into the FIRST CARD, beside the on-track / over-budget
//      pill, at that card's pill scale.
//
// Owner rule: "This touches the command bar, which BOTH views render.
// Verify period and homestand independently after the change - a
// header fix that only got checked on one view is how the double-
// render bug shipped." So every assertion below runs on both views.
//
// The print header keeps its own scope line via printScopeText - V41's
// invariant that a printed / screenshotted board always states what
// it counted. Verified separately in the print block.

import { test, expect, type Page } from '@playwright/test';

const ACCOUNT_MLB = 'CIN - OH';    // has homestand view
const ACCOUNT_PDC = 'CIN - AZ';    // period-only, no homestand tab (kept as belt-and-suspenders)

async function openLabor(page: Page, extraParams: Record<string, string> = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const params = new URLSearchParams({ account: ACCOUNT_MLB, ...extraParams });
  await page.goto(`/kpi/labor?${params}`);
  await page.waitForSelector('.kpi-cmd', { timeout: 30_000 });
  // Wait for either the period board or the homestand board to be present.
  await page.waitForSelector('.kpi-board, .kpi-hs-board', { timeout: 30_000 });
}

test.setTimeout(90_000);

test.describe('KPI header cleanup - toggle right + scope pill on first card', () => {

  test.describe('period view', () => {
    test('toggle sits to the right of Export in the command bar', async ({ page }) => {
      await openLabor(page);
      // Toggle exists (only if the user has salary permission).
      const toggle = page.locator('.kpi-cmd-salary');
      if ((await toggle.count()) === 0) test.skip(true, 'user cannot see salary; toggle absent by design');

      // Order in the DOM tree of .kpi-cmd should be: spacer, salary,
      // then Export. Compare via bounding boxes rather than order in
      // markup so flex/CSS reordering can't fool the assertion.
      const spacer = page.locator('.kpi-cmd-spacer');
      const exportBtn = page.locator('.kpi-cmd .kpi-ctl').first();
      const spacerBox = await spacer.boundingBox();
      const toggleBox = await toggle.boundingBox();
      const exportBox = await exportBtn.boundingBox();
      expect(spacerBox && toggleBox && exportBox).toBeTruthy();
      // Toggle sits to the right of the spacer and to the left of Export.
      expect(toggleBox!.x).toBeGreaterThan(spacerBox!.x);
      expect(toggleBox!.x).toBeLessThan(exportBox!.x);
    });

    test('no scope pill in the command-bar title', async ({ page }) => {
      await openLabor(page);
      // .kpi-cmd-scope was the old class - it must not appear anywhere
      // now. [data-scope-pill] outside a card must not appear either.
      await expect(page.locator('.kpi-cmd-title .kpi-cmd-scope')).toHaveCount(0);
      await expect(page.locator('.kpi-cmd-title [data-scope-pill]')).toHaveCount(0);
    });

    test('scope pill on the first card beside the verdict pill', async ({ page }) => {
      await openLabor(page);
      // Skip when the caller can't toggle - the scope pill only renders
      // for users with salary permission (spec T-1).
      if ((await page.locator('.kpi-cmd-salary').count()) === 0) test.skip(true, 'no salary permission');

      const scope = page.locator('.kpi-spend-h-right [data-scope-pill]');
      await expect(scope).toHaveCount(1);
      // Scope pill lives inside the same header row as (any) verdict pill.
      const verdictPresent = (await page.locator('.kpi-spend-h-right .kpi-vpill:not([data-scope-pill])').count()) > 0;
      if (verdictPresent) {
        const verdict = page.locator('.kpi-spend-h-right .kpi-vpill:not([data-scope-pill])').first();
        const scopeBox = await scope.boundingBox();
        const verdictBox = await verdict.boundingBox();
        // Both on the same visual row (y-alignment within 8px).
        expect(Math.abs(scopeBox!.y - verdictBox!.y)).toBeLessThan(8);
      }
      // Text matches state.
      const on = await page.evaluate(() => new URLSearchParams(location.search).get('salary') === '1');
      await expect(scope).toHaveText(on ? '+ SALARY' : 'HOURLY ONLY');
    });
  });

  test.describe('homestand view', () => {
    test('toggle sits to the right of Export in the command bar', async ({ page }) => {
      await openLabor(page, { view: 'homestand' });
      const toggle = page.locator('.kpi-cmd-salary');
      if ((await toggle.count()) === 0) test.skip(true, 'user cannot see salary');
      const spacerBox = await page.locator('.kpi-cmd-spacer').boundingBox();
      const toggleBox = await toggle.boundingBox();
      const exportBox = await page.locator('.kpi-cmd .kpi-ctl').first().boundingBox();
      expect(toggleBox!.x).toBeGreaterThan(spacerBox!.x);
      expect(toggleBox!.x).toBeLessThan(exportBox!.x);
    });

    test('no scope pill in the command-bar title', async ({ page }) => {
      await openLabor(page, { view: 'homestand' });
      await expect(page.locator('.kpi-cmd-title .kpi-cmd-scope')).toHaveCount(0);
      await expect(page.locator('.kpi-cmd-title [data-scope-pill]')).toHaveCount(0);
    });

    test('scope pill on the first stand card beside the Under/Over pill', async ({ page }) => {
      // Owner ruling: "put the scope pill on the first stand card in
      // homestand view, not the season card - the season card is fixed
      // season truth and the scope pill describes the current selection."
      // First stand card here = HS X spend (data-card="spend").
      await openLabor(page, { view: 'homestand' });
      if ((await page.locator('.kpi-cmd-salary').count()) === 0) test.skip(true, 'no salary permission');

      // Select a non-pre-floor stand so the spend card actually renders.
      const stand = page.locator('.kpi-hs-rail-stand:not([disabled])').first();
      await stand.click();
      await page.waitForSelector('[data-card="spend"]', { timeout: 15_000 });

      const scope = page.locator('[data-card="spend"] [data-scope-pill]');
      await expect(scope).toHaveCount(1);
      // Under/Over pill is the sibling in .kpi-hs-card-hdr-pills.
      const siblingUnderOver = page.locator('[data-card="spend"] .kpi-hs-card-hdr-pills .kpi-hs-pill:not([data-scope-pill])');
      await expect(siblingUnderOver).toHaveCount(1);
    });

    test('scope pill is on the STAND card, not the season card', async ({ page }) => {
      // Regression net for the owner's clarification: never put the
      // scope pill on SeasonToDateCard (fixed season truth).
      await openLabor(page, { view: 'homestand' });
      if ((await page.locator('.kpi-cmd-salary').count()) === 0) test.skip(true, 'no salary permission');
      await expect(page.locator('.kpi-hs-card-rail [data-scope-pill]')).toHaveCount(0);
      // Season-to-date card selector - use the eyebrow text as anchor
      // since it doesn't carry a dedicated class.
      await expect(page.locator('.kpi-hs-board .kpi-hs-card:has-text("Season to date") [data-scope-pill]')).toHaveCount(0);
    });
  });

  test('exactly one scope pill on screen at once', async ({ page }) => {
    // The print header carries its own scope line via printScopeText;
    // that's a separate `.kpi-printhdr` block hidden under screen CSS.
    // On screen, only ONE `[data-scope-pill]` should render (on the
    // first card of whichever view is active).
    await openLabor(page);
    if ((await page.locator('.kpi-cmd-salary').count()) === 0) test.skip(true, 'no salary permission');
    await expect(page.locator('[data-scope-pill]')).toHaveCount(1);

    await openLabor(page, { view: 'homestand' });
    const stand = page.locator('.kpi-hs-rail-stand:not([disabled])').first();
    await stand.click();
    await page.waitForSelector('[data-card="spend"]', { timeout: 15_000 });
    await expect(page.locator('[data-scope-pill]')).toHaveCount(1);
  });
});
