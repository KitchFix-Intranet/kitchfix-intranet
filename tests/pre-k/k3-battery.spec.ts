// PR-K3 acceptance battery.
//
// PR-K2 shipped the failure copy + Try again wiring on handleSave,
// but DayEntryV2's executeConfirm passed silentFailure:true (a
// 2026-07-24 A3 decision) which suppressed the toast on all seven
// pilot v2 accounts. Save failure rendered as an inline banner with
// old copy + raw server error + no retry action.
//
// PR-K3 removes silentFailure:true + deletes the inline banner so
// the shared workspace toast is the single failure surface for save,
// mirroring reset and bulk.
//
// This battery proves: on a v2 account (TXR-AZ), a forced save
// failure surfaces the new toast with the K2 copy + Try again button,
// AND the retired inline banner does not render.

import { test, expect } from '@playwright/test';
import { assertBoardLoaded } from '../lib/board-loaded';

const TXR = 'TXR - AZ';

async function openWorkspace(page: any) {
  // Viewport must be tall enough to fit the bottom-centre toast
  // (fixed-positioned at ~44px from viewport bottom, needs ~1030px
  // of height so the toast body itself sits inside the fold).
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto(`/service-calendar?account=${encodeURIComponent(TXR)}&period=9`);
  await assertBoardLoaded(page, '.sc-workspace-grid', { context: 'sc workspace' });
  await page.waitForSelector('.sc-workspace-grid-cell .sc-daysq--interactive', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

function bodyMatches(request: any, action: string) {
  try {
    const post = request.postData() || '';
    return post.includes(`"action":"${action}"`);
  } catch {
    return false;
  }
}

async function openFirstEditableDay(page: any) {
  const tile = page.locator('.sc-workspace-grid-cell .sc-daysq--interactive').first();
  await tile.click();
  await page.waitForTimeout(500);
}

test.setTimeout(180_000);

// ────────────────────────────────────────────────────────────────
// K3-1: v2 save failure fires the shared workspace toast (K2 copy).
// K3-2: inline banner is NOT rendered.
// K3-3: Try again re-fires the save; on success, toast dismisses.
// ────────────────────────────────────────────────────────────────

test('K3: v2 save failure fires shared toast with K2 copy, no inline banner, Try again re-fires', async ({ page }) => {
  await openWorkspace(page);

  let submitHits = 0;
  await page.route('**/api/service-calendar', async (route, request) => {
    if (request.method() !== 'POST') return route.continue();
    if (bodyMatches(request, 'sc-submit-day')) {
      submitHits++;
      if (submitHits === 1) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'forced-K3-failure' }),
        });
      }
    }
    return route.continue();
  });

  await openFirstEditableDay(page);

  const anyInput = page.locator('.sc-day-input').first();
  await anyInput.waitFor({ timeout: 8_000 });
  await anyInput.fill('7');

  // v2 primary CTA is "Confirm & save" (see DayEntryV2.js:1798).
  const cta = page.locator('.sc-v2-entry-rail-cta').first();
  await cta.click();

  // K3-1: shared toast fires with K2 copy. Hover the toast body as
  // soon as it appears so pause-on-hover freezes the 5s auto-dismiss
  // timer and later assertions don't race the timer.
  const toast = page.locator('.sc-toast--bad').first();
  await toast.waitFor({ timeout: 8_000 });
  await toast.hover();
  const failTitle = toast.locator('.sc-toast-title');
  await expect(failTitle).toHaveText('Could not save');
  const failDetail = toast.locator('.sc-toast-detail');
  await expect(failDetail).toHaveText('Nothing was changed. Check your connection and try again.');
  const tryAgain = toast.locator('.sc-toast-action', { hasText: 'Try again' }).first();
  await expect(tryAgain).toBeVisible();

  // K3-2: inline banner MUST NOT render.
  const inlineBannerCount = await page.locator('.sc-v2-entry-alert, .sc-ar--danger').count();
  expect(inlineBannerCount).toBe(0);

  // K3-3: click Try again -> second submit passes through, toast
  // transitions off .sc-toast--bad. Force-click through any residual
  // viewport nudge on smaller screens (the toast is scoped to the
  // pointer that just hovered it, so it's still there).
  await tryAgain.click({ force: true });
  await expect(page.locator('.sc-toast--bad').first()).toBeHidden({ timeout: 10_000 });
  expect(submitHits).toBeGreaterThanOrEqual(2);
});
