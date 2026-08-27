// tests/kpi-ot-chip-three-level.spec.ts
//
// PR-E acceptance for the OT chip on portfolio views. Owner ruling
// 2026-08-24 after PR-C and PR-D each deferred a DOM assertion:
//
//   "The deployed-URL probe should assert, on a known-OT week in a
//    portfolio view: chip present at band, week, and account level.
//    That is the only check that would have caught what Kevin
//    reported."
//
// Property probes covered the grouping (PR-C's _probe_kpi_ot_chip.mjs
// asserted L1-L5 field pipelines) but nothing walked the DOM. This
// spec closes that gap. It runs against whatever URL PLAYWRIGHT_BASE_URL
// points at - localhost:3000 by default, prod when a CI job sets the
// env - because the fix is a render-shape guarantee that should hold
// wherever the code runs.
//
// Known-OT week: 2026-07-27 (period containing Kevin's live trace of
// seven accounts with OT hours 77.90, 128.04, 39.42, 31.45, 29.30,
// 18.90, 0.68). Range picked slightly wider so the band containing
// this week is present even if period boundaries shift.

import { test, expect, type Page } from '@playwright/test';
import { assertBoardLoaded } from './lib/board-loaded';

const PORTFOLIO_ACCOUNT = 'ALL';
const RANGE_START = '2026-07-13';
const RANGE_END = '2026-08-09';
// PR-C property probe used this week; live browser 2026-08-24 showed
// seven account rows with OT on this week.
const KNOWN_OT_WEEK_START = '2026-07-27';

async function openPortfolioBoard(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const url = `/kpi/labor?account=${encodeURIComponent(PORTFOLIO_ACCOUNT)}&start=${RANGE_START}&end=${RANGE_END}`;
  await page.goto(url);
  await assertBoardLoaded(page, '.kpi-tbl', { context: `portfolio table on ${PORTFOLIO_ACCOUNT}` });
}

test.setTimeout(90_000);

test.describe('KPI portfolio OT chip - three-level DOM assertion', () => {
  test.beforeEach(async ({ page }) => { await openPortfolioBoard(page); });

  test('band, week, and account rows each render an OT chip on a known-OT week', async ({ page }) => {
    // ── L1: BAND level ─────────────────────────────────────────
    // At least one period band in the range covers a week that
    // rolls up to more than 0.004 OT hours. Assert the chip
    // exists inside a `tr.kpi-tbl-band` label cell.
    const bandOtChips = page.locator('tr.kpi-tbl-band .kpi-tbl-bandbtn .kpi-tbl-otflag');
    await expect(bandOtChips.first(), 'BAND row must render an OT chip when the period totals cross the threshold').toBeVisible();

    // Pick the first band with an OT chip to drill into.
    const bandBtn = page.locator('tr.kpi-tbl-band .kpi-tbl-bandbtn').filter({ has: page.locator('.kpi-tbl-otflag') }).first();
    await expect(bandBtn).toBeVisible();
    const bandAria = await bandBtn.getAttribute('aria-expanded');
    if (bandAria !== 'true') await bandBtn.click();

    // ── L2: WEEK level ─────────────────────────────────────────
    // The known-OT week (07/27) should be inside the expanded band.
    // If it isn't (period boundaries surprise), fall back to any
    // week row with a chip.
    const weekBtnSelector = `tr.kpi-tbl-week .kpi-tbl-weekbtn[data-wk="${KNOWN_OT_WEEK_START}"]`;
    const weekBtn = page.locator(weekBtnSelector).first();
    let targetWeekBtn = weekBtn;
    if (await weekBtn.count() === 0) {
      targetWeekBtn = page.locator('tr.kpi-tbl-week .kpi-tbl-weekbtn').filter({ has: page.locator('.kpi-tbl-otflag') }).first();
    }
    await expect(targetWeekBtn, 'a WEEK row inside the OT band must be present').toBeVisible();
    const weekOtChip = targetWeekBtn.locator('.kpi-tbl-otflag');
    await expect(weekOtChip, 'WEEK row must render an OT chip when its total crosses the threshold').toBeVisible();

    // Expand the week to reveal account child rows.
    const weekAria = await targetWeekBtn.getAttribute('aria-expanded');
    if (weekAria !== 'true') await targetWeekBtn.click();

    // ── L3: ACCOUNT level ──────────────────────────────────────
    // At least one account child row under the expanded week must
    // render the OT chip. This is the render PR-D fixed - the
    // account-button branch of ChildRow was missing the OTTag while
    // the OT column beside it rendered a value. If this assertion
    // ever fails, we have regressed to the state Kevin reported.
    const accountOtChips = page.locator('tr.kpi-tbl-child .kpi-tbl-accountbtn .kpi-tbl-otflag');
    await expect(accountOtChips.first(), 'ACCOUNT row must render an OT chip beside the account key when the row carries OT (PR-D fix)').toBeVisible();

    // Extra confidence: multiple account rows have OT chips on a
    // known-OT week in a portfolio view. Kevin's 2026-08-24 live
    // trace saw seven; conservative floor is two so this survives
    // day-to-day OT variance.
    const count = await accountOtChips.count();
    expect(count, `expected at least 2 account rows with OT chips (Kevin saw 7 on ${KNOWN_OT_WEEK_START})`).toBeGreaterThanOrEqual(2);
  });

  test('OT chip is a span with the label "OT" and the accessible name reads as overtime', async ({ page }) => {
    // Belt + suspenders. If the CSS class ever renames, this catches
    // the label drift; if the label stays but the class renames,
    // the first test still fires. Both dimensions ought to move
    // together deliberately.
    const anyOtChip = page.locator('.kpi-tbl-otflag').first();
    await expect(anyOtChip).toBeVisible();
    await expect(anyOtChip).toHaveText('OT');
    await expect(anyOtChip).toHaveAttribute('aria-label', /overtime/i);
  });

  test('an open HelpPop paints ABOVE the table (portal escapes card stacking context)', async ({ page }) => {
    // Owner ruling 2026-08-24: the popover-behind-sticky-column bug
    // was traced to `.kpi-sig { z-index: 20; position: relative }`
    // creating a stacking context that scoped the popover's z-index
    // inside it - the table's sticky first column at z-index 20 then
    // won on DOM order. Fix: render the popover in a portal at
    // document.body so it lives outside every card's stacking context.
    //
    // This test asserts what the eye sees rather than what the CSS
    // says: document.elementFromPoint at the popover's centre must
    // return an element INSIDE the popover, not a table cell hiding
    // it. Choose a popover whose bounding box overlaps the table -
    // qPayrollData sits low in the signal-card row and overhangs the
    // week table on standard viewport heights.
    const trigger = page.locator('[data-hs-help="qPayrollData"]').first();
    // The signal cards are gated on non-portfolio views having a real
    // period board; use a single account so the cards mount reliably.
    await page.goto(`/kpi/labor?account=${encodeURIComponent('CIN - OH')}`);
    await assertBoardLoaded(page, '.kpi-sigs .kpi-sig', { context: 'single-account signals on CIN - OH' });
    await page.waitForSelector('.kpi-tbl', { timeout: 30_000 });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const pop = page.locator('[data-hs-pop][data-hs-help-for="qPayrollData"]');
    await expect(pop).toBeVisible();
    const popBox = await pop.boundingBox();
    expect(popBox, 'popover must have a measurable bounding box').toBeTruthy();
    const centre = { x: popBox!.x + popBox!.width / 2, y: popBox!.y + popBox!.height / 2 };
    // Sanity: pick a point where the popover overlaps the table below
    // it. If it doesn't overlap on this viewport, the test still
    // asserts the popover-at-its-own-centre invariant (weaker but
    // still catches a regression to non-portal placement).
    const top = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return {
        tag: el?.tagName,
        classes: el?.className ?? '',
        insidePop: !!el?.closest('[data-hs-pop]'),
        insideTable: !!el?.closest('.kpi-tbl'),
        insideSig: !!el?.closest('.kpi-sig'),
      };
    }, centre);
    expect(
      top.insidePop,
      `topmost element at popover centre must be inside the popover, not a card/table underneath. saw: tag=${top.tag} classes="${top.classes}" insideTable=${top.insideTable} insideSig=${top.insideSig}`,
    ).toBe(true);
    // Direct check the portal placement worked: the popover DOM node
    // is a direct child of body, not nested inside a card. If a
    // future refactor drops createPortal, this fails first.
    const isBodyChild = await pop.evaluate(el => el.parentElement === document.body);
    expect(isBodyChild, 'popover must be portalled to document.body').toBe(true);
  });
});
