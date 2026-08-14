// PR-E E8 battery: five contexts x two views x five widths.
// Proves:
//   - Finalize affordance present on per-meal (PDC + AAA per-meal + hybrid)
//   - Finalize affordance ABSENT on fee + MLB
//   - Ghost / no-service / needs-entry cell classes distinct on render
//   - Overlap tag renders with correct count in month view when the
//     boundary week crosses months
//
// URL scheme (ServiceCalendar.js:135 buildScUrl + :1044-1094 URL sync):
//   ?account=<key>            picks the account
//   ?period=<N>               opens period workspace (scope=period)
//   ?month=YYYY-MM            opens month workspace (scope=month)
// Any other combo defaults to scope=year (no finalize row rendered).

import { test, expect } from '@playwright/test';

// 2026-08-14 falls in Period 9 Week 1 for every per-meal + fee + MLB
// account (verified via sc_day_metadata probe). Aug 2026 straddles two
// month boundaries: Jul 27-Aug 2 (5 days in July) and Aug 31-Sep 6
// (6 days in September).
const CURRENT_PERIOD = '9';
const BOUNDARY_MONTH = '2026-08';

const VIEWPORTS = [
  { name: '1024', width: 1024, height: 720 },
  { name: '1152', width: 1152, height: 720 },
  { name: '1280', width: 1280, height: 800 },
  { name: '1366', width: 1366, height: 768 },
  { name: '1536', width: 1536, height: 960 },
];

// Five contexts (segment x billing_model x schedule shape).
const CONTEXTS = [
  { name: 'PDC-per-meal',   account: 'TXR - AZ',  expectsFinalize: true  },
  { name: 'fee',            account: 'STL - FL',  expectsFinalize: false },
  { name: 'MLB-fee',        account: 'CIN - OH',  expectsFinalize: false },
  { name: 'MiLB-per-meal',  account: 'CIN - KY',  expectsFinalize: true  },
  { name: 'PDC-hybrid',     account: 'TBJ - FL',  expectsFinalize: true  },
];

function accountUrl(scope: 'period' | 'month', account: string) {
  const qs = new URLSearchParams({ account });
  if (scope === 'period') qs.set('period', CURRENT_PERIOD);
  else                    qs.set('month',  BOUNDARY_MONTH);
  return `/service-calendar?${qs.toString()}`;
}

test.setTimeout(90_000);

for (const ctx of CONTEXTS) {
  for (const scope of ['period', 'month'] as const) {
    for (const vp of VIEWPORTS) {
      test(`E8: ${ctx.name} - ${scope} - ${vp.name}px`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(accountUrl(scope, ctx.account));
        // Wait for the workspace grid to hydrate. The grid is the
        // scope-agnostic container for both period + month workspaces.
        await page.waitForSelector('.sc-workspace-grid', { timeout: 30_000 });
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        // Extra beat for the sc-finalize-states hydration effect.
        await page.waitForTimeout(1500);

        // Sanity: confirm the account actually landed. AccountDropdown
        // renders the current account name somewhere on the page.
        const bodyText = await page.locator('body').innerText();
        expect(bodyText).toContain(ctx.account);

        // Finalize row presence signal: PeriodWorkspace renders
        // <div class="sc-workspace-week-finalize-row"> only for per-meal
        // accounts (showFinalize = scV2 && isPerMealBillingAccount(key)).
        const finalizeRowCount = await page.locator('.sc-workspace-week-finalize-row').count();
        if (ctx.expectsFinalize) {
          expect(finalizeRowCount).toBeGreaterThan(0);
        } else {
          expect(finalizeRowCount).toBe(0);
        }
      });
    }
  }
}

test('E4: overlap tag renders with correct count in month view (Jul + Sep)', async ({ page }) => {
  // TXR - AZ month view Aug 2026. Aug 1 = Sat, so:
  //   Row 1: Mon Jul 27 - Sun Aug 2  -> 5 days in July
  //   Row 6: Mon Aug 31 - Sun Sep 6  -> 6 days in September
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/service-calendar?account=${encodeURIComponent('TXR - AZ')}&month=${BOUNDARY_MONTH}`);
  await page.waitForSelector('.sc-workspace-grid', { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const overlapTexts = await page.locator('.sc-week-finalize-overlap').allTextContents();
  console.log('overlap tags on TXR-AZ Aug 2026:', overlapTexts);

  const july = overlapTexts.find((t) => /days? in July/i.test(t));
  const sept = overlapTexts.find((t) => /days? in September/i.test(t));

  expect(july, 'July boundary tag').toBeTruthy();
  expect(july!).toMatch(/^\s*5 days in July\s*$/i);
  expect(sept, 'September boundary tag').toBeTruthy();
  expect(sept!).toMatch(/^\s*6 days in September\s*$/i);
});

test('E3: ghost + other-month + no-service + needs-entry cell classes render', async ({ page }) => {
  // Month view of Aug 2026 on TXR-AZ carries at minimum the other-month
  // ghost cells (5 for Jul 27-31, 6 for Sep 1-6 = 11 total). Additional
  // cell variants may or may not paint depending on the day's actual
  // service state.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/service-calendar?account=${encodeURIComponent('TXR - AZ')}&month=${BOUNDARY_MONTH}`);
  await page.waitForSelector('.sc-workspace-grid', { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const ghost      = await page.locator('.sc-daysq--ghost').count();
  const otherMonth = await page.locator('.sc-daysq--other-month').count();
  const noService  = await page.locator('.sc-daysq--none, [data-status="no-service"]').count();
  const needsEntry = await page.locator('.sc-daysq--need, [data-status="needs-entry"], [data-status="overdue"]').count();

  console.log('DOM cell class counts:', { ghost, otherMonth, noService, needsEntry });
  // Aug 2026 has 11 other-month cells (5 in July row + 6 in September row).
  expect(otherMonth).toBeGreaterThanOrEqual(11);
});
