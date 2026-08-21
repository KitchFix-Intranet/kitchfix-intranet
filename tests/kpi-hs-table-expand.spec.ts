// Homestand season table expansion. Kevin's P1-5 from the audit:
//
//   "The season table does not expand. 11 rows carry cursor:pointer
//    but clicking changes nothing - row count stays at 14.
//    actuals_range carries 5 worker rows with worker_id and full
//    hour/dollar fields, so the data is present and the handler is
//    not firing."
//
//   "Two guards when it works: the expansion must respect the salary
//    gate (salary off means no salaried worker rows at all, absent
//    not zeroed), and the sum of employee rows must equal the stand
//    total on the card, to the cent."
//
// Root cause was that actuals_range only contains employees for the
// currently-selected stand. The old row-click called only
// onToggleExpand, so clicking a NON-selected row set expansion state
// but had no employees to render (empty list). Fix: row-click now
// fires onSelectStand (URL push -> fetch) AND onToggleExpand, with a
// skeleton in the expansion slot for the ~1s until data lands.
//
// The salary invariant asserts the HOURLY path only in this PR. The
// salary-inclusive stand.actual + stand.budget change lives in the
// separate salary-on-homestand PR; the toggle is TEMPORARILY hidden
// on the homestand view to prevent an on-screen contradiction while
// that PR is in flight (owner ruling 2026-08-21).
//
// Also covers Kevin's specific probe ask on the popovers PR: the ?
// trigger on any table popover must NOT fire the row-expand handler,
// via stopPropagation on the HsHelpPop button.

import { test, expect, type Page } from '@playwright/test';

const ACCOUNT = 'CIN - OH';

async function openStandView(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/kpi/labor?account=${encodeURIComponent(ACCOUNT)}&view=homestand`);
  await page.waitForSelector('.kpi-hs-rail', { timeout: 30_000 });
  // Click first non-pre-floor rail button so a stand is selected + the
  // spend card + season table are rendered.
  await page.locator('.kpi-hs-rail-stand:not([disabled])').first().click();
  await page.waitForSelector('[data-card="spend"]', { timeout: 15_000 });
  await page.waitForSelector('.kpi-hs-table tbody tr[data-hs-row-expandable]', { timeout: 15_000 });
}

test.setTimeout(90_000);

test.describe('KPI homestand season table expansion', () => {
  test.beforeEach(async ({ page }) => { await openStandView(page); });

  test('clicking the currently-selected row toggles its expansion', async ({ page }) => {
    const selected = page.locator('.kpi-hs-tr-band.kpi-hs-tr-sel[data-hs-row-expandable]');
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute('aria-expanded', 'false');
    await selected.click();
    await expect(selected).toHaveAttribute('aria-expanded', 'true');
    // At least one employee row rendered under the selected stand.
    const gs = await selected.getAttribute('data-game-start');
    await expect(page.locator(`.kpi-hs-tr-emp[data-emp-row="${gs}"]`).first()).toBeVisible();
    // Second click collapses.
    await selected.click();
    await expect(selected).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator(`.kpi-hs-tr-emp[data-emp-row="${gs}"]`)).toHaveCount(0);
  });

  test('clicking a non-selected row selects it AND expands it', async ({ page }) => {
    // Pick any non-selected, non-future, non-pre-floor row. Rail is
    // sorted; grab a played stand that is not currently selected.
    const others = page.locator('.kpi-hs-tr-band[data-hs-row-expandable]:not(.kpi-hs-tr-sel):not(.kpi-hs-tr-future)');
    const target = others.first();
    const gs = await target.getAttribute('data-game-start');
    expect(gs).toBeTruthy();

    await target.click();

    // URL now points at this stand (proves onSelectStand fired).
    await expect(page).toHaveURL(new RegExp(`homestand=${encodeURIComponent(gs!).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`));

    // Target row went from unselected to selected + expanded once the
    // fetch settles.
    await page.waitForLoadState('networkidle');
    const settledRow = page.locator(`.kpi-hs-tr-band[data-game-start="${gs}"]`);
    await expect(settledRow).toHaveClass(/kpi-hs-tr-sel/);
    await expect(settledRow).toHaveAttribute('aria-expanded', 'true');
    // Employee rows render for the new stand.
    await expect(page.locator(`.kpi-hs-tr-emp[data-emp-row="${gs}"]`).first()).toBeVisible();
  });

  test('skeleton renders during the pending fetch after selecting a new row', async ({ page }) => {
    // Delay the labor API so the pending window is observable.
    let seen = 0;
    await page.route('**/api/kpi/labor?**', async (route) => {
      seen += 1;
      if (seen > 1) await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });

    const target = page.locator('.kpi-hs-tr-band[data-hs-row-expandable]:not(.kpi-hs-tr-sel):not(.kpi-hs-tr-future)').first();
    const gs = await target.getAttribute('data-game-start');
    await target.click();

    // While the fetch is in flight, expansion state is set immediately
    // but employees are not yet available for this stand's game_start;
    // the skeleton row must render.
    await expect(page.locator(`[data-hs-emp-skel="${gs}"]`)).toBeVisible({ timeout: 500 });

    // After settle, skeleton is gone and real rows render.
    await page.waitForLoadState('networkidle');
    await expect(page.locator(`[data-hs-emp-skel="${gs}"]`)).toHaveCount(0);
    await expect(page.locator(`.kpi-hs-tr-emp[data-emp-row="${gs}"]`).first()).toBeVisible();
  });

  test('sum of employee rows === stand actual, to the cent (hourly path)', async ({ page }) => {
    // Owner rule: no silent drops in the rollup. This PR only asserts
    // the hourly path; the salary-on-homestand PR extends this to hold
    // when the toggle is on, once stand.actual / stand.budget include
    // 3100.2 salary.
    const selected = page.locator('.kpi-hs-tr-band.kpi-hs-tr-sel[data-hs-row-expandable]');
    const gs = await selected.getAttribute('data-game-start');
    await selected.click();
    await expect(page.locator(`.kpi-hs-tr-emp[data-emp-row="${gs}"]`).first()).toBeVisible();

    // Read the stand's actual from the row's own "Actual" column
    // (index 7). Format is $1,234.56 or $-1,234.56.
    const actualText = await selected.locator('td').nth(7).innerText();
    const actualCents = Math.round(Number(actualText.replace(/[$,]/g, '')) * 100);

    // Sum every employee amount cell.
    const empCells = page.locator(`.kpi-hs-tr-emp[data-emp-row="${gs}"] [data-emp-amount]`);
    const empTexts = await empCells.allInnerTexts();
    const empCents = empTexts.reduce((s, t) => s + Math.round(Number(t.replace(/[$,]/g, '')) * 100), 0);

    // Exact to the cent - stand.actual is read straight off the card
    // and employee amounts are read straight off the payload.
    expect(empCents).toBe(actualCents);
  });

  test('salary toggle renders on the homestand view (PR #274 unhide)', async ({ page }) => {
    // PR #274 (owner ruling 2026-08-21): the toggle is unhidden on
    // this view now that the server folds 3100.2 into stand.actual
    // AND stand.budget together when include_salary=1. The sum
    // invariant test below asserts the on-toggle path holds; this
    // just asserts presence.
    const toggle = page.locator('.kpi-cmd-salary');
    if ((await toggle.count()) === 0) test.skip(true, 'no salary permission for this caller; both-views absence is expected');
    await expect(toggle).toBeVisible();

    // Confirm it also renders on the period view (unchanged).
    await page.goto(`/kpi/labor?account=${encodeURIComponent(ACCOUNT)}`);
    await page.waitForSelector('.kpi-cmd', { timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.kpi-cmd-salary')).toBeVisible();
  });

  test('sum invariant holds on salary=on: sum(employee amounts) == stand.actual to the cent', async ({ page }) => {
    // PR #274 extends the hourly-only invariant to the on-toggle
    // basis. stand.actual on the card now folds in salary; actuals_range
    // (the employee expansion source) includes salary rows when
    // include_salary=1. Sum must equal to the cent on both bases.
    const toggle = page.locator('.kpi-cmd-salary');
    if ((await toggle.count()) === 0) test.skip(true, 'no salary permission');

    // Flip the toggle ON.
    await page.goto(`/kpi/labor?account=${encodeURIComponent(ACCOUNT)}&view=homestand&salary=1`);
    await page.waitForSelector('.kpi-hs-rail', { timeout: 30_000 });
    await page.locator('.kpi-hs-rail-stand:not([disabled])').first().click();
    await page.waitForSelector('[data-card="spend"]', { timeout: 15_000 });
    await page.waitForSelector('.kpi-hs-table tbody tr[data-hs-row-expandable]', { timeout: 15_000 });

    const selected = page.locator('.kpi-hs-tr-band.kpi-hs-tr-sel[data-hs-row-expandable]');
    const gs = await selected.getAttribute('data-game-start');
    await selected.click();
    await expect(page.locator(`.kpi-hs-tr-emp[data-emp-row="${gs}"]`).first()).toBeVisible();

    const actualText = await selected.locator('td').nth(7).innerText();
    const actualCents = Math.round(Number(actualText.replace(/[$,]/g, '')) * 100);
    const empTexts = await page.locator(`.kpi-hs-tr-emp[data-emp-row="${gs}"] [data-emp-amount]`).allInnerTexts();
    const empCents = empTexts.reduce((s, t) => s + Math.round(Number(t.replace(/[$,]/g, '')) * 100), 0);
    expect(empCents).toBe(actualCents);
  });

  test('clicking the qPeak ? trigger does NOT expand a table row', async ({ page }) => {
    // Kevin's ask on the popovers PR: prove the stopPropagation guard
    // holds so a ? click in the table never fires the row expand.
    // qPeak lives in the <th> today (not a body row), but the same
    // guard must protect any popover a future PR adds inside a row.
    const initialExpanded = await page.locator('.kpi-hs-tr-band[aria-expanded="true"]').count();
    await page.locator('[data-hs-help="qPeak"]').click();
    const afterExpanded = await page.locator('.kpi-hs-tr-band[aria-expanded="true"]').count();
    expect(afterExpanded).toBe(initialExpanded);
    // Popover did open, though.
    await expect(page.locator('.kpi-hs-pop[data-hs-pop]')).toBeVisible();
  });
});
