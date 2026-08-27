import { test, expect, type Page } from '@playwright/test';
import { assertBoardLoaded } from './lib/board-loaded';

/**
 * SC homestand-detail render smoke (M-4a rider #1).
 *
 * The gap this spec closes:
 *   M-3 shipped a `useMemo` below an early return in
 *   `HomestandDetail`. Four CI checks passed on the commit
 *   (build, migration gate, nav-matrix, preview smoke). The
 *   nav matrix never mounts the homestand surface; the preview
 *   smoke checks compile + shell only. The client crashed on
 *   every mount with "Rendered more hooks than during the
 *   previous render." Nothing caught it before the live gate.
 *
 * Method:
 *   Stub the session + the two data endpoints so the surface
 *   mounts against real client code. Navigate to a homestand
 *   URL. Assert the close-out panel renders, no
 *   client-side-exception language appears, and no pageerror
 *   events fire during hydration.
 *
 * Ship discipline: this spec MUST fail when a hook is moved
 * below an early return in HomestandDetail. Verified by moving
 * a `useMemo` below `if (loadState === "loading" ...)` and
 * observing the "Rendered more hooks" assertion trip. Do not
 * weaken the assertions to make it green without a fix.
 *
 * Identity: session stub reads k.fietek@kitchfix.com to satisfy
 * SC_ADMINS (page-level gate at page.js:101). The email is the
 * client-side stub only; no NextAuth cookie is minted, no server
 * write ever fires, no audit trail entry is created. Extending
 * SC_ADMINS to a synthetic identity was ruled out in the Round 1
 * B ruling. Existing sc-nav-matrix.spec.ts uses the same stub
 * identity for the same reason.
 */

const ACCOUNT = 'CIN - OH';
const TEST_HS_KEY = 'test-hs-actuals-due';
const TODAY = '2026-07-11';

const PERIOD_RANGES = [
  { period: 'P1',  start: '2026-03-26', end: '2026-04-15' },
  { period: 'P2',  start: '2026-04-16', end: '2026-05-06' },
  { period: 'P3',  start: '2026-05-07', end: '2026-05-27' },
  { period: 'P4',  start: '2026-05-28', end: '2026-06-17' },
  { period: 'P5',  start: '2026-06-18', end: '2026-07-08' },
  { period: 'P6',  start: '2026-07-09', end: '2026-07-29' },
  { period: 'P7',  start: '2026-07-30', end: '2026-08-19' },
  { period: 'P8',  start: '2026-08-20', end: '2026-09-09' },
  { period: 'P9',  start: '2026-09-10', end: '2026-09-30' },
];

async function stubAll(page: Page) {
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

  await page.route(/\/api\/service-calendar\?action=sc-hero/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ heroImage: '' }),
    });
  });

  // sc-accounts populates the account dropdown + defaultAccount.
  // Without it the shell renders "Select..." and no scope mounts.
  await page.route(/\/api\/service-calendar\?action=sc-accounts/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        accounts: [
          { key: ACCOUNT, category: 'MLB', accountName: 'Reds OH', billingModel: 'flat_fee' },
        ],
        defaultAccount: ACCOUNT,
        roles: ['LEADERSHIP'],
      }),
    });
  });

  // Minimal sc-load: account shape + one game day inside HS9 span.
  await page.route(/\/api\/service-calendar\?action=sc-load(?![a-z])/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        account: {
          key: ACCOUNT,
          category: 'MLB',
          name: ACCOUNT,
          billingModel: 'flat_fee',
          spreadsheetId: '',
        },
        metaColCount: 4,
        serviceGroups: [],
        days: [],
        overrides: [],
        accounts: [{ key: ACCOUNT, category: 'MLB' }],
      }),
    });
  });

  // sc-year-summary with a homestands[] payload that includes the test
  // block. The status is "actuals-due" so CloseoutPanel mounts its
  // active-confirm shape (the .sc-closeout target of the render
  // assertion below).
  await page.route(/\/api\/service-calendar\?action=sc-year-summary/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        year: 2026,
        today: { date: TODAY, period: 'P6', week: 'Wk2' },
        periodRanges: PERIOD_RANGES,
        homestands: [{
          key: TEST_HS_KEY,
          ordinal: 'HS9',
          status: 'actuals-due',
          startDate: '2026-07-03',
          endDate: '2026-07-12',
          gameCount: 9,
          dayCount: 10,
          gameEntered: 0,
          servedDays: 0,
          exceptionDays: 0,
          opponents: ['ARI'],
          prepDays: ['2026-07-02'],
          windowStart: '2026-06-18',
          windowEnd: '2026-07-08',
          budget: { amount: 13053.75, breakdown: [{ period: '6', subtotal: 13053.75 }] },
          budgetReason: null,
        }],
        months: [{
          month: '2026-07',
          period: '',
          camp: '',
          totalDays: 31,
          daysWithActuals: 0,
          projectedRevenue: 0,
          actualRevenue: 0,
          projectedCovers: 0,
          actualCovers: 0,
          homestandSummary: { gameDays: 9, gameDaysEntered: 0 },
          days: [
            { date: '2026-07-03', status: 'needs-entry', gameType: 'HOME', dayType: 'GAME', opponent: 'ARI', actualMeals: 0, hasNoteEntries: false, homestandId: 'HS9' },
            { date: '2026-07-04', status: 'needs-entry', gameType: 'HOME', dayType: 'GAME', opponent: 'ARI', actualMeals: 0, hasNoteEntries: false, homestandId: 'HS9' },
            { date: '2026-07-05', status: 'needs-entry', gameType: 'HOME', dayType: 'GAME', opponent: 'ARI', actualMeals: 0, hasNoteEntries: false, homestandId: 'HS9' },
          ],
        }],
      }),
    });
  });

  // Closeout history: empty for actuals-due; CloseoutPanel handles []
  // gracefully.
  await page.route(/\/api\/service-calendar\?action=sc-closeout-history/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, history: [] }),
    });
  });
}

test('homestand detail surface mounts without hook-order error', async ({ page }) => {
  await stubAll(page);

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(`pageerror: ${err.message}`));

  // Load. `?homestand=<key>` selects the homestand scope; the
  // client-side gate on MLB_HOMESTAND_SURFACE_ACCOUNTS lets CIN - OH
  // mount HomestandDetail. hookorder issues would surface here as
  // a client-side exception before any DOM lands.
  await page.goto(`/service-calendar?account=${encodeURIComponent(ACCOUNT)}&homestand=${TEST_HS_KEY}`, {
    waitUntil: 'networkidle',
    timeout: 15_000,
  });
  await assertBoardLoaded(page, '.sc-closeout', { context: `SC homestand ${TEST_HS_KEY} on ${ACCOUNT}` });

  const bodyText = await page.evaluate(() => document.body.innerText);
  const html = await page.content();

  // Hard fails: any React runtime error language on the surface.
  expect(bodyText, 'no Application error message').not.toContain('Application error');
  expect(bodyText, 'no client-side exception message').not.toContain('client-side exception');
  expect(html, 'no "Rendered more hooks" error text').not.toContain('Rendered more hooks');
  expect(html, 'no "change in the order of Hooks" error text').not.toContain('change in the order of Hooks');

  // Positive: the close-out panel is what a chef opens the surface to
  // reach. If HomestandDetail mounts but CloseoutPanel does not, the
  // hook order broke inside the child instead of the parent.
  await expect(page.locator('.sc-closeout'), 'close-out panel section rendered').toBeVisible();
  await expect(page.locator('.sc-homestand-title'), 'homestand title rendered').toBeVisible();

  // Hard fail on any page-level JS exception. React hook mismatches
  // fire as pageerror events even when the DOM partially renders.
  expect(pageErrors, 'no pageerror events during hydration').toEqual([]);
});
