// tests/kpi-hs-future-state.spec.ts
//
// HS PR-A DOM assertion. Owner ruling 2026-08-24 after Chat-Claude's
// homestand audit found #798's is_future_range flag never firing on
// homestand view (start param falls back to FY default when only
// ?homestand=... is set) and plan mode keying off window_start instead
// of game_start (HS 12: window opened for prep, games ahead, rendered
// "$0 spent · under budget" green).
//
// Same twelve-class assertion #798 shipped for the period board,
// plus five plan cards on future stands, plus a straddling stand's
// spent-to-date fact, plus a played-stand guard that catches
// over-suppression.
//
// Kevin-supplied stand IDs on CIN - OH:
//   2026-09-14  fully future    plan mode, no spent_to_date fact
//   2026-08-31  straddling      plan mode + Spent to date $359.58
//   2026-08-14  closed          actuals, verdict classes PRESENT
//   2026-03-26  pre-floor       plan mode, estimated basis

import { test, expect, type Page } from '@playwright/test';

const ACCOUNT = 'CIN - OH';

// Verdict-state classes from #798 + homestand-specific verdict/edge
// classes surfaced by Chat-Claude's audit. Any present on a plan-mode
// stand means a card slipped through without checking planMode.
const VERDICT_STATE_CLASSES = [
  '.kpi-vpill-good', '.kpi-vpill-warn', '.kpi-vpill-bad',
  '.kpi-sig-state-good', '.kpi-sig-state-warn', '.kpi-sig-state-bad',
  '.kpi-spend-cell-over', '.kpi-spend-cell-under',
  '.kpi-sig-arrfig-good', '.kpi-sig-arrfig-bad',
  '.kpi-sig-hero-bad', '.kpi-sig-hero-warn',
  '.kpi-hs-pill-good', '.kpi-hs-pill-bad',
  '.kpi-hs-good', '.kpi-hs-bad',
  '.kpi-hs-edge-good', '.kpi-hs-edge-bad',
];

async function openStand(page: Page, gameStart: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/kpi/labor?account=${encodeURIComponent(ACCOUNT)}&view=homestand&homestand=${gameStart}`);
  await page.waitForSelector('.kpi-hs-board', { timeout: 30_000 });
}

async function verdictClassCount(page: Page, scope = '.kpi-hs-board') {
  return page.evaluate(({ scope, sels }) => {
    const root = document.querySelector(scope);
    if (!root) return { total: 0, detail: [] as string[] };
    const detail: string[] = [];
    let total = 0;
    for (const sel of sels) {
      const found = root.querySelectorAll(sel);
      if (found.length) { detail.push(`${sel} × ${found.length}`); total += found.length; }
    }
    return { total, detail };
  }, { scope, sels: VERDICT_STATE_CLASSES });
}

test.setTimeout(90_000);

test.describe('KPI homestand future-range state', () => {
  test('fully-future stand (2026-09-14) renders plan, no verdict-state classes, no spent_to_date fact', async ({ page }) => {
    await openStand(page, '2026-09-14');
    // PlanCards render (data-card="plan" is the HS X budget plan card).
    await expect(page.locator('[data-card="plan"]')).toBeVisible();
    // Zero verdict-state classes under .kpi-hs-board.
    const v = await verdictClassCount(page);
    expect(v.total, `future stand must render 0 verdict-state classes, saw ${v.detail.join(', ')}`).toBe(0);
    // spent_to_date fact absent (nothing spent yet on a fully-future stand).
    await expect(page.locator('[data-fact="spent_to_date"]')).toHaveCount(0);
  });

  test('straddling stand (2026-08-31) renders plan AND spent_to_date fact', async ({ page }) => {
    await openStand(page, '2026-08-31');
    await expect(page.locator('[data-card="plan"]')).toBeVisible();
    const v = await verdictClassCount(page);
    expect(v.total, `straddling plan-mode stand must render 0 verdict-state classes, saw ${v.detail.join(', ')}`).toBe(0);
    // Spent to date fact present (prep-day spend inside the open window).
    const spentFact = page.locator('[data-fact="spent_to_date"]');
    await expect(spentFact).toBeVisible();
    // Owner-supplied number: $359.58 on CIN - OH HS 12 prep days.
    // Format is fmt$ ($NNN.NN with commas), so this reads as "$359.58".
    await expect(spentFact).toContainText(/\$359\.58/);
  });

  test('closed stand (2026-08-14) KEEPS its verdict classes (over-suppression guard)', async ({ page }) => {
    await openStand(page, '2026-08-14');
    // Played stand still renders actuals + verdict; assert AT LEAST
    // one verdict-state class shows so the plan-mode gate cannot
    // silence the board everywhere.
    const v = await verdictClassCount(page);
    expect(v.total, `played stand must carry at least one verdict-state class (guards against over-suppressing plan mode)`).toBeGreaterThan(0);
    // No plan card - actuals path only.
    await expect(page.locator('[data-card="plan"]')).toHaveCount(0);
  });

  test('pre-floor stand (2026-03-26) renders plan with estimated basis', async ({ page }) => {
    await openStand(page, '2026-03-26');
    await expect(page.locator('[data-card="plan"]')).toBeVisible();
    // Pre-floor stands carry the `est.` pill on the plan card.
    await expect(page.locator('[data-est-pill]')).toBeVisible();
    const v = await verdictClassCount(page);
    expect(v.total, `pre-floor plan-mode stand must render 0 verdict-state classes, saw ${v.detail.join(', ')}`).toBe(0);
  });
});
