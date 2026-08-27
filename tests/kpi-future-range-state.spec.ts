// tests/kpi-future-range-state.spec.ts
//
// Owner ruling 2026-08-24 after the calendar-month picker landed:
// clicking a future month (e.g. SEP today = 2026-08-24) was rendering
// $0.00 · Under pro-rated budget · $X in green - reads as an
// accomplishment when nothing has happened. Server flag
// `is_future_range` (start > today) fixed the SpendCard, DayStrip,
// and hid three signal cards (Pace / Overtime / Payroll) whose
// premise fails on a range that hasn't started. Hours available
// KEEPS its normal render - the budget exists, no hours scheduled,
// every hour is available.
//
// The probe that catches the next card someone adds without thinking
// about this state:
//
//   "on a future range, assert no element carries a verdict-state
//    class at all - not green, not amber, not red."
//
// Any of these class names appearing under the board root on a
// future range fails: kpi-vpill-good/warn/bad, kpi-sig-state-good/
// warn/bad, kpi-spend-cell-over/under, kpi-sig-arrfig-good/bad,
// kpi-sig-hero-bad/warn.

import { test, expect, type Page } from '@playwright/test';
import { assertBoardLoaded } from './lib/board-loaded';

// A month starting in the future. Adjust if the deploy target's
// clock passes this date - Sep 2026 was future as of 2026-08-24.
const FUTURE_ACCOUNT = 'CIN - OH';
const FUTURE_START   = '2026-09-01';
const FUTURE_END     = '2026-09-30';

// A month that has STARTED (straddles or is fully past). Verdict is
// honest here and must remain.
const CURRENT_ACCOUNT = 'CIN - OH';
const CURRENT_START   = '2026-07-01';
const CURRENT_END     = '2026-07-31';

// Class names that carry a verdict-state signal. Absent on future
// ranges; free to appear elsewhere.
const VERDICT_STATE_CLASSES = [
  '.kpi-vpill-good',
  '.kpi-vpill-warn',
  '.kpi-vpill-bad',
  '.kpi-sig-state-good',
  '.kpi-sig-state-warn',
  '.kpi-sig-state-bad',
  '.kpi-spend-cell-over',
  '.kpi-spend-cell-under',
  '.kpi-sig-arrfig-good',
  '.kpi-sig-arrfig-bad',
  '.kpi-sig-hero-bad',
  '.kpi-sig-hero-warn',
];

async function open(page: Page, { account, start, end }: { account: string; start: string; end: string }) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const url = `/kpi/labor?account=${encodeURIComponent(account)}&start=${start}&end=${end}`;
  await page.goto(url);
  // Board root - either day-strip (daily path) or story-block (weekly
  // path) must render. The OR-selector was the vector that let
  // #858's viewport-clip spec silently pass on the session-expired
  // state box; assertBoardLoaded catches auth-failure markers before
  // the OR can absorb them.
  await assertBoardLoaded(page, '.kpi-day-range, .kpi-story', { context: `future range on ${account}` });
}

test.setTimeout(90_000);

test.describe('KPI future-range state', () => {
  test('no verdict-state class renders anywhere under the board on a future range', async ({ page }) => {
    await open(page, { account: FUTURE_ACCOUNT, start: FUTURE_START, end: FUTURE_END });
    // Union locator across every verdict-state class. Count must be 0.
    const combined = page.locator(VERDICT_STATE_CLASSES.join(', '));
    const total = await combined.count();
    if (total > 0) {
      // Grab the classes that fired so the failure names the culprit.
      const detail = await page.evaluate((sels) => {
        const found: string[] = [];
        for (const sel of sels) {
          const els = document.querySelectorAll(sel);
          if (els.length) found.push(`${sel} × ${els.length}`);
        }
        return found;
      }, VERDICT_STATE_CLASSES);
      expect.soft(detail).toEqual([]);
    }
    expect(total, `future range must render 0 verdict-state elements, saw ${total}`).toBe(0);
  });

  test('SPENT reads "this range has not started" in muted grey on a future range', async ({ page }) => {
    await open(page, { account: FUTURE_ACCOUNT, start: FUTURE_START, end: FUTURE_END });
    // Daily path (future calendar month routes to daily): DayStrip
    // renders the SPENT card with the note in .kpi-day-range-card-sub.
    const spentSub = page.locator('.kpi-day-range-card').filter({ hasText: 'SPENT' }).locator('.kpi-day-range-card-sub');
    await expect(spentSub).toHaveText(/this range has not started/);
    // Colour: not the green under class, not the red over class.
    await expect(spentSub).not.toHaveClass(/kpi-spend-cell-over/);
    await expect(spentSub).not.toHaveClass(/kpi-spend-cell-under/);
  });

  test('BUDGET still renders on a future range (knowing next month\'s budget is useful for planning)', async ({ page }) => {
    await open(page, { account: FUTURE_ACCOUNT, start: FUTURE_START, end: FUTURE_END });
    const budgetFigure = page.locator('.kpi-day-range-card').filter({ hasText: 'BUDGET' }).locator('.kpi-day-range-card-figure');
    await expect(budgetFigure).toBeVisible();
    // Reads as a dollar figure ($X,XXX.XX). Zero is legitimate if the
    // FY plan has no budget for those weeks; the assertion is that
    // SOMETHING renders (not the card being hidden).
    await expect(budgetFigure).toHaveText(/\$[\d,.]+/);
  });

  test('current-period range KEEPS its verdict pill (straddling ranges are honest)', async ({ page }) => {
    // Straddling range - starts before today, ends after (or on) today.
    // Verdicts are honest here; the future-range suppression must not
    // fire. Assertion: at least one verdict-state class renders.
    await open(page, { account: CURRENT_ACCOUNT, start: CURRENT_START, end: CURRENT_END });
    const combined = page.locator(VERDICT_STATE_CLASSES.join(', '));
    const total = await combined.count();
    expect(total, 'a current range must carry at least one verdict-state class (this test guards against over-suppressing)').toBeGreaterThan(0);
  });
});
