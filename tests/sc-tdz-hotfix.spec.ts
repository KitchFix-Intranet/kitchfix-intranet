import { test, expect } from '@playwright/test';

// Runtime-proof guard for the F3 hook-declaration-order bug (2026-07-10,
// PR fix/sc-f3-tdz-hook-order). The regressed state threw
// `ReferenceError: Cannot access 'syncingKeys' before initialization`
// on the first render of ServiceCalendar - a `useMemo` at ~:695 read
// `syncingKeys` in its dep array before the `useState` declaration at
// ~:906. `next build` did not catch it (client components are not
// executed at build), and no existing Playwright spec loaded this route,
// so three merges shipped over the broken state before Kevin caught it
// in browser.
//
// This spec loads `/service-calendar` past the auth + SC_ADMINS gate by
// intercepting `/api/auth/session` and the SC data actions, forcing the
// ServiceCalendar function body to execute. The presence of
// `.sc-chrome-bar` (rendered from inside the body, past every state
// declaration) is proof the render completed without throwing.
//
// If this spec fails, do NOT weaken the assertion - the TDZ class is
// back. Fix the hook ordering in ServiceCalendar.js.
test('/service-calendar renders without TDZ on first render', async ({ page }) => {
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { email: 'k.fietek@kitchfix.com', name: 'Kevin Fietek' },
        expires: '2099-01-01T00:00:00.000Z',
      }),
    });
  });

  await page.route('**/api/service-calendar?action=sc-hero*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ heroImage: '' }),
    });
  });

  await page.route('**/api/service-calendar?action=sc-accounts*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        accounts: [
          { key: 'CIN - AZ', category: 'PDC', accountName: 'Reds AZ' },
        ],
        defaultAccount: 'CIN - AZ',
        roles: ['LEADERSHIP'],
      }),
    });
  });

  await page.route('**/api/service-calendar?action=sc-year-summary*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        year: 2026,
        today: { date: '2026-07-10', month: '2026-07' },
        months: [],
        periodRanges: [],
      }),
    });
  });

  await page.route('**/api/service-calendar*', async (route) => {
    // catch-all for any other sc-load / sc-save / etc. so the load doesn't
    // 404 into a genuine app error path (we only care about first-render
    // TDZ, not data path).
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, days: [], serviceGroups: [] }),
    });
  });

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/service-calendar', { waitUntil: 'networkidle' });

  // ChromeBar renders from inside the ServiceCalendar function body,
  // past every useState + useMemo (including the syncingDates memo
  // that was TDZ-throwing before). Its existence is the render proof.
  // The regressed state short-circuited to the global-error boundary
  // here and .sc-chrome-bar did not exist.
  await expect(page.locator('.sc-chrome-bar').first()).toBeVisible({ timeout: 10000 });

  const tdzMatches = [...consoleErrors, ...pageErrors].filter((s) =>
    /ReferenceError|Cannot access.*before initialization/.test(s),
  );
  expect(tdzMatches, `TDZ error(s) reached the browser:\n${tdzMatches.join('\n')}`).toEqual([]);
});
