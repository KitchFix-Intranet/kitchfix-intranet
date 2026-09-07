import { test, expect, type Page } from '@playwright/test';

/**
 * SC landing-view instrumentation probe.
 * 2026-09-09 - PR #1059 was the second failed fix to the "SC lands on
 * Calendar" bug. Per instrument-after-second-failure, this probe
 * observes runtime rather than reasoning from code.
 *
 * Hypothesis (grep-verified, not yet observed): a third state variable
 * `seasonView` at ServiceCalendar.js:3100 defaults to `"calendar"`
 * independently of `lens`. My earlier fixes touched `lens`; the tab
 * render reads `seasonView` via the Ribbon toggle.
 *
 * What this probe measures on a clean-URL cold mount:
 *   1. URL after hydration is clean (no ?view / ?period / ?month) - proves
 *      no redirect fired that could have set state via URL.
 *   2. Which tab button carries aria-pressed="true" on the Ribbon
 *      Calendar/Period toggle. This IS the runtime seasonView value.
 *   3. Bonus: any React error boundary or console error firing during
 *      the mount.
 *
 * Stubs auth so page.js's isDev gate lets ServiceCalendar mount. Uses
 * stubbed accounts fetch so the mount completes deterministically.
 */

const ACCOUNT = 'TBJ - FL';

async function stubEverything(page: Page) {
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        user: { email: 'k.fietek@kitchfix.com', name: 'Kevin Fietek' },
        expires: '2099-01-01T00:00:00.000Z',
      }),
    });
  });
  await page.route(/\/api\/service-calendar(\?|$)/, async (route) => {
    const req = route.request();
    const url = req.url();
    let posted: any = null;
    if (req.method() === 'POST') { try { posted = req.postDataJSON(); } catch {} }
    const action = posted?.action || (url.match(/[?&]action=([^&]+)/)?.[1] || '');
    if (action === 'sc-hero') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ heroImage: '' }) });
    }
    if (action === 'sc-accounts') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          accounts: [{ key: ACCOUNT, category: 'MiLB', accountName: 'Dunedin', billingModel: 'per_meal' }],
          defaultAccount: ACCOUNT,
          roles: ['director of operations'], // leadership tier - matches Kevin's role for the bug report
        }),
      });
    }
    if (action === 'sc-year-summary') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          months: [],
          defaultAccount: ACCOUNT,
          today: { date: '2026-09-09', period: 'P9', week: 'W2' },
          periodRanges: [{ period: 'P9', start: '2026-08-31', end: '2026-09-27' }],
        }),
      });
    }
    if (action === 'sc-load') {
      const acctMatch = url.match(/account=([^&]+)/);
      const acct = acctMatch ? decodeURIComponent(acctMatch[1]) : ACCOUNT;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          account: { key: acct, category: 'MiLB', billingModel: 'per_meal', name: acct },
          days: [], services: [], homestandMap: {}, scheduleOverlay: null,
          periodRanges: [{ period: 'P9', start: '2026-08-31', end: '2026-09-27' }],
          periodMetrics: {}, today: '2026-09-09',
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
}

test.setTimeout(60_000);

test('SC clean-URL cold mount lands on Period tab, not Calendar', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await stubEverything(page);
  await page.goto('/service-calendar');
  await page.waitForSelector('.sc-root.scv2', { timeout: 15_000 });
  // Wait for the Ribbon toggle to be present.
  await page.waitForSelector('.sc-ribbon-toggle-btn', { timeout: 10_000 });
  // Give React one settle pass in case any late effect flips state.
  await page.waitForTimeout(500);

  // Observation 1: URL is clean.
  const url = new URL(page.url());
  const urlParams = Object.fromEntries(url.searchParams.entries());
  console.log(`[probe] URL params after mount: ${JSON.stringify(urlParams)}`);
  expect(urlParams.view, 'clean URL, no view param').toBeUndefined();
  expect(urlParams.period, 'clean URL, no period param').toBeUndefined();
  expect(urlParams.month, 'clean URL, no month param').toBeUndefined();

  // Observation 2: which Ribbon toggle button is aria-pressed=true?
  const toggleState = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.sc-ribbon-toggle-btn'));
    return btns.map((b) => ({
      text: (b.textContent || '').trim(),
      pressed: b.getAttribute('aria-pressed'),
      classes: b.className,
    }));
  });
  console.log(`[probe] Ribbon toggle buttons after mount:\n${JSON.stringify(toggleState, null, 2)}`);

  // Observation 3: what does the body actually render?
  const renderedShellClass = await page.evaluate(() => {
    // SeasonShell renders a data attribute or class indicating view;
    // we grep it out of the DOM.
    const shell = document.querySelector('.sc-season-shell, [data-season-view], [data-view]');
    if (!shell) return null;
    return {
      className: shell.className,
      dataView: shell.getAttribute('data-view') || shell.getAttribute('data-season-view'),
    };
  });
  console.log(`[probe] Season shell render info: ${JSON.stringify(renderedShellClass)}`);

  // Observation 4: any console errors during mount?
  console.log(`[probe] Console errors during mount: ${consoleErrors.length}`);
  for (const e of consoleErrors) console.log(`    ${e}`);

  // ASSERTION: the Period toggle button should be pressed, not Calendar.
  const periodBtn = toggleState.find((b) => b.text.toLowerCase().includes('period'));
  const calendarBtn = toggleState.find((b) => b.text.toLowerCase().includes('calendar'));
  console.log(`\n[probe] VERDICT:`);
  console.log(`    Calendar button aria-pressed = ${calendarBtn?.pressed}`);
  console.log(`    Period button aria-pressed   = ${periodBtn?.pressed}`);
  console.log(`    Bug present? ${calendarBtn?.pressed === 'true' ? 'YES (Calendar is pressed on cold mount)' : 'no'}`);

  // 2026-09-09 fix landed: seasonView default flipped from "calendar"
  // to "period" (ServiceCalendar.js:3100). Assertion enabled so this
  // probe now guards against regression - if a future change reverts
  // the default or introduces a fourth writer that sets seasonView
  // back to calendar, this test fails and prints the diagnostic
  // toggleState block above.
  expect(periodBtn?.pressed, 'Period tab must be aria-pressed=true on clean-URL cold mount').toBe('true');
  expect(calendarBtn?.pressed, 'Calendar tab must NOT be aria-pressed=true on clean-URL cold mount').toBe('false');
});
