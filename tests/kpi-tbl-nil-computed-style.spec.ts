// tests/kpi-tbl-nil-computed-style.spec.ts
//
// Owner ruling 2026-08-24 after the contrast-sweep PR shipped
// `.kpi-tbl-nil { color: var(--text-subtle) }` and the live inspect
// on ALL / P8 still measured the dash at var(--navy-700) weight 800:
//
//   "Check specificity - a table-cell rule is winning, which is why
//    the earlier bump had no effect. Verify with getComputedStyle
//    after the change rather than reading the CSS; the whole reason
//    this survived two passes is that the rule looked right and lost
//    at runtime."
//
// The bare `.kpi-tbl-nil` class had specificity 0,1,0. Every row rule
// on td colour is 0,1,1 (band, week, child) or 0,2,1 (band-open) and
// won. The fix bumps to `.kpi-tbl tbody td.kpi-tbl-nil` at 0,2,1 with
// source order after the row rules; total-row rule at 0,3,1 still
// wins and keeps its white dash.
//
// This spec asserts the runtime state, not the CSS text: it opens a
// portfolio period band (so band-open + band + week + child all have
// dashes on the page), reads getComputedStyle on each level's kpi
// -tbl-nil cell, and expects rgb(100,116,139) weight 400 - or, on
// the total row, rgb(255,255,255) weight 800.

import { test, expect, type Page } from '@playwright/test';
import { assertBoardLoaded } from './lib/board-loaded';

const PORTFOLIO_ACCOUNT = 'ALL';
const RANGE_START = '2025-12-29';
const RANGE_END = '2026-08-24';

// --text-subtle after 2026-08-24 sweep resolves to --n-600 = #64748B
// = rgb(100, 116, 139).
const EXPECTED_SUBTLE_RGB = 'rgb(100, 116, 139)';
const EXPECTED_TOTAL_RGB = 'rgb(255, 255, 255)';

async function openPortfolioBoard(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/kpi/labor?account=${encodeURIComponent(PORTFOLIO_ACCOUNT)}&start=${RANGE_START}&end=${RANGE_END}`);
  await assertBoardLoaded(page, '.kpi-tbl', { context: `portfolio table on ${PORTFOLIO_ACCOUNT}` });
}

test.setTimeout(90_000);

test.describe('KPI .kpi-tbl-nil computed style - specificity fix', () => {
  test('dash placeholders render at --text-subtle weight 400 across band, week, child', async ({ page }) => {
    await openPortfolioBoard(page);

    // Expand a band so week + child dashes exist alongside band dashes.
    // Pick the first band that has at least one dash cell (some periods
    // may be fully paid and carry no nil cells).
    const bandBtn = page.locator('tr.kpi-tbl-band .kpi-tbl-bandbtn').filter({
      has: page.locator('~ tr td.kpi-tbl-nil'),
    }).first();
    // Fallback: first band with any kpi-tbl-nil descendant OR just the first band.
    const bandTarget = (await bandBtn.count()) > 0
      ? bandBtn
      : page.locator('tr.kpi-tbl-band .kpi-tbl-bandbtn').first();
    await bandTarget.click();
    // Expand the first week under it too.
    const weekBtn = page.locator('tr.kpi-tbl-week .kpi-tbl-weekbtn').first();
    await weekBtn.click();

    // Sample kpi-tbl-nil at every row level and read computed style.
    const readNil = (rowSelector: string) => page.evaluate((sel) => {
      const td = document.querySelector(`${sel} td.kpi-tbl-nil`) as HTMLElement | null;
      if (!td) return null;
      const cs = window.getComputedStyle(td);
      return {
        text: td.textContent?.trim() ?? '',
        color: cs.color,
        fontWeight: cs.fontWeight,
      };
    }, rowSelector);

    // Open band row (spec 0,2,1 conflicts here - highest-risk case).
    const bandOpen = await readNil('tr.kpi-tbl-band.kpi-tbl-band-open');
    // Any band row - covers the base band case if band-open didn't fire.
    const band = await readNil('tr.kpi-tbl-band:not(.kpi-tbl-band-open)');
    const week = await readNil('tr.kpi-tbl-week');
    const child = await readNil('tr.kpi-tbl-child');
    const total = await readNil('tr.kpi-tbl-total');

    // At least ONE nil at band-or-week or child level must be present
    // for the assertion to be meaningful. The full-portfolio range
    // over an FY reliably produces some.
    const samples = [bandOpen, band, week, child].filter(Boolean);
    expect(samples.length, 'no .kpi-tbl-nil cells found in expanded band - test needs a range with at least one dash cell').toBeGreaterThan(0);

    for (const [label, s] of Object.entries({ bandOpen, band, week, child })) {
      if (!s) continue;
      expect(s.color, `${label} row .kpi-tbl-nil color must resolve to --text-subtle (${EXPECTED_SUBTLE_RGB}), saw ${s.color}`).toBe(EXPECTED_SUBTLE_RGB);
      // Some browsers report weight 400 as 'normal'. Accept both.
      expect(['400', 'normal'], `${label} row .kpi-tbl-nil font-weight must be 400 (normal), saw ${s.fontWeight}`).toContain(s.fontWeight);
      expect(s.text, `${label} row .kpi-tbl-nil must render an em-dash`).toMatch(/^[–-]$/);
    }

    // Total row is the exception - stays white weight 800 by design
    // (`.kpi-tbl tbody .kpi-tbl-total .kpi-tbl-nil` at spec 0,3,1
    // wins the color rule; total-row bulk rule at 0,3,1 wins weight).
    if (total) {
      expect(total.color, `total-row .kpi-tbl-nil must stay white`).toBe(EXPECTED_TOTAL_RGB);
      expect(['700', '800', 'bold'], `total-row .kpi-tbl-nil must stay bold`).toContain(total.fontWeight);
    }
  });
});
