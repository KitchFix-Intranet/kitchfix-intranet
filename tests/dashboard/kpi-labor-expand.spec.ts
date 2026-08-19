import { test, expect } from '@playwright/test';

// V40 hotfix coverage. PR #720 shipped a ReferenceError: displayRate
// is not defined that white-screened the page whenever a band expanded
// (FragmentRows referenced a helper defined inside WeekTable's scope).
// No existing test exercised the expand path, which is why the P0
// shipped. This test loads the board for one account, expands a band,
// expands a week, and asserts zero page errors and that rows render.
//
// TEST_MODE=true is required for the local dev server; see
// src/middleware.js and tests/pre-k/k3-undo-probe.spec.ts for the same
// convention. CIN - AZ is the account Kevin reproduced the crash on.

test('kpi/labor: expanding a band and a week does not crash', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (err) => { pageErrors.push(String(err)); });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const acct = 'CIN - AZ';
  const url = `/kpi/labor?account=${encodeURIComponent(acct)}&start=2026-07-13&end=2026-08-09`;
  await page.goto(url);

  // Board renders when at least one band button is present. .kpi-tbl-bandbtn
  // is the FragmentRows band-header button (WeekTable.js:755).
  const band = page.locator('button.kpi-tbl-bandbtn').first();
  await expect(band).toBeVisible({ timeout: 20_000 });

  // Expand the first band. Before the hotfix this triggered the
  // "Application error: a client-side exception has occurred" screen.
  await band.click();

  // At least one week row appears after the band opens.
  const week = page.locator('button.kpi-tbl-weekbtn').first();
  await expect(week).toBeVisible({ timeout: 10_000 });

  // Expand the first week. Worker child rows appear in single mode.
  await week.click();

  // Rows still present, error boundary did not swallow the tree.
  await expect(page.locator('button.kpi-tbl-bandbtn').first()).toBeVisible();
  await expect(page.locator('button.kpi-tbl-weekbtn').first()).toBeVisible();

  // The specific crash: uncaught ReferenceError. Any pageerror is a
  // hard fail; console errors get logged so a regression that only
  // trips React's error boundary still surfaces.
  expect(pageErrors, `Uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  const displayRateErr = consoleErrors.find((e) => /displayRate is not defined/i.test(e));
  expect(displayRateErr, `V40 crash regressed: ${displayRateErr}`).toBeUndefined();
});
