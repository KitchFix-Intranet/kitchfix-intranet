import { test, expect } from '@playwright/test';
import { assertBoardLoaded } from './lib/board-loaded';

// Runtime-proof guard for F3-era ReferenceError bugs in the Service
// Calendar client bundle (SC-079 free-variable class + hook-declaration-
// order class). Both surface only under real render execution: `next
// build` never runs client components, and CI stays green if no spec
// touches the render path.
//
// Coverage expanded across two incidents (2026-07-10):
//   1. `fix/sc-f3-tdz-hook-order` (#382): first-render TDZ - a `useMemo`
//      at ServiceCalendar.js:~695 read `syncingKeys` in its dep array
//      before the `useState` declaration was hoisted below it. Guard:
//      chrome bar visible = render past every state declaration.
//   2. `fix/sc-daygrid-syncing-thread` (this PR): drill-in
//      ReferenceError - F3 (#378) added `syncingDates` to
//      PeriodWorkspace's prop list and used it inside the DayGrid
//      callsite, but never threaded it into DayGrid's own destructure.
//      The identifier was a free variable that crashed the first time
//      a REAL day cell rendered - masked by #1 until #382 unmasked it.
//      Guard: click a MonthCard drill and assert the workspace grid
//      row appears without a `ReferenceError` accumulating.
//
// Rule from GOTCHAS.md: the guard spec must exercise every render
// depth a change touches. First render was never sufficient; the
// drill click is now part of the guard.
//
// Stubs pattern: intercept the SC data actions in specificity order so
// the catch-all fallback does not swallow a request that needs a
// tailored payload. If this spec fails, do NOT weaken the assertions -
// the ReferenceError class is back. Fix the source.
test('/service-calendar renders + drills without ReferenceError', async ({ page }) => {
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

  await page.route(/\/api\/service-calendar\?action=sc-accounts/, async (route) => {
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

  // sc-year-summary: return ONE month (July 2026) with a totalDays >
  // 0 so the MonthCard renders as a real drill target rather than the
  // muted off-season shell. `today.date` matches the July month so
  // MonthCard picks up isCurrentMonth.
  await page.route(/\/api\/service-calendar\?action=sc-year-summary/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        year: 2026,
        today: { date: '2026-07-10', month: '2026-07' },
        periodRanges: [],
        months: [
          {
            month: '2026-07',
            period: '',
            camp: '',
            totalDays: 3,
            daysWithActuals: 1,
            projectedRevenue: 3000,
            actualRevenue: 1000,
            projectedCovers: 300,
            actualCovers: 100,
            days: [
              { date: '2026-07-01', status: 'entered',     gameType: '', actualMeals: 100, hasNoteEntries: false },
              { date: '2026-07-10', status: 'needs-entry', gameType: '', actualMeals: 0,   hasNoteEntries: false },
              { date: '2026-07-15', status: 'upcoming',    gameType: '', actualMeals: 0,   hasNoteEntries: false },
            ],
          },
        ],
      }),
    });
  });

  // sc-load (month drill target): the drill click flows through
  // ServiceCalendar's month effect, which fetches sc-load and stashes
  // the payload in monthCache. PeriodWorkspace consumes
  // monthDays = payload.days || [].
  //
  // CRITICAL: `days` MUST include at least one REAL entry (date +
  // status + hasActuals + isPast + isLocked + totals). An empty or
  // all-ghost payload never runs the REAL-day cell branch inside
  // DayGrid at PeriodWorkspace.js:~834 where the free-variable
  // `syncingDates` crash lived. Simplifying this stub into
  // `{ days: [] }` would silently pass over the live bug. Do NOT
  // shrink it without proving the DayGrid REAL-day path still fires.
  await page.route(/\/api\/service-calendar\?action=sc-load/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        account: {
          key: 'CIN - AZ',
          category: 'PDC',
          name: 'CIN - AZ',
          billingModel: 'per_meal',
          spreadsheetId: '',
        },
        metaColCount: 4,
        serviceGroups: [],
        days: [
          {
            date: '2026-07-01',
            status: 'entered',
            hasActuals: true,
            isPast: true,
            isLocked: false,
            projectedRevenue: 1000,
            actualRevenue: 1050,
            priceAtDate: {},
            noteEntries: [],
            historyEntries: [],
            totals: { projectedRevenue: 1000, actualRevenue: 1050 },
          },
          {
            date: '2026-07-10',
            status: 'needs-entry',
            hasActuals: false,
            isPast: false,
            isLocked: false,
            projectedRevenue: 1000,
            actualRevenue: 0,
            priceAtDate: {},
            noteEntries: [],
            historyEntries: [],
            totals: { projectedRevenue: 1000, actualRevenue: 0 },
          },
        ],
        overrides: [],
        accounts: [{ key: 'CIN - AZ', category: 'PDC' }],
      }),
    });
  });

  // No catch-all: Playwright dispatches route handlers in reverse
  // registration order, so a late catch-all shadows the specific
  // matchers above. The four handlers cover this spec's traffic
  // (sc-hero, sc-accounts, sc-year-summary, sc-load). Any additional
  // action fires against the real dev server and fails predictably
  // - which is what we want if a future scope creep adds a request.

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/service-calendar', { waitUntil: 'networkidle' });
  await assertBoardLoaded(page, '.sc-chrome-bar', { context: 'service-calendar tdz probe', timeoutMs: 10_000 });

  // Depth 1: ChromeBar renders from inside the ServiceCalendar
  // function body, past every useState + useMemo (including the
  // syncingDates memo that was TDZ-throwing before #382). Its
  // existence is the first-render proof.
  await expect(page.locator('.sc-chrome-bar').first()).toBeVisible({ timeout: 10000 });

  // Depth 2: drill into the JULY MonthCard specifically. The
  // sc-load stub above returns two REAL days in July (2026-07-01 +
  // 2026-07-10); clicking a different month would drill into a
  // window where those dates fall out of range, all cells render
  // as empty ghosts, and the DayGrid REAL-cell branch (the one
  // that carried the free-variable crash) never executes. The
  // stub / click month MUST agree. The drill target is a stretched
  // invisible <button aria-label="Open July"> rendered as the
  // article's last child when the card is expanded (desktop default).
  await page.locator('button[aria-label="Open July"]').click();

  // Give the drill re-render + potential crash a beat to settle
  // before asserting. The free-variable ReferenceError fires on the
  // POST-cache-hydration render (drillLoadState -> "loaded" +
  // monthCache populated), not on the initial skeleton render. A
  // bare toBeVisible() would poll the pre-crash tree too, so a
  // stability wait is required. 1.5s covers the state settle
  // (fetch is intercepted synchronously by the route handler above,
  // so the async gap is only the microtask queue drain).
  await page.waitForTimeout(1500);

  // Depth 2 proof: workspace grid rows appear once PeriodWorkspace
  // mounts and DayGrid maps its cells. This is exactly the render
  // depth the free-variable ReferenceError fired at.
  await expect(page.locator('.sc-workspace-grid-row').first()).toBeVisible({ timeout: 10000 });

  // Match both hook-declaration-order TDZ ("Cannot access X before
  // initialization") and free-variable ReferenceError ("X is not
  // defined") since browser page-error messages come in without the
  // "ReferenceError:" name prefix. Do not narrow the regex - both
  // shapes have historically shipped and the filter must catch each.
  const referenceErrors = [...consoleErrors, ...pageErrors].filter((s) =>
    /ReferenceError|is not defined|Cannot access.*before initialization/.test(s),
  );
  expect(
    referenceErrors,
    `ReferenceError(s) reached the browser:\n${referenceErrors.join('\n')}`,
  ).toEqual([]);
});
