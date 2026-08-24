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

// HS PR-A live-verify follow-up 2026-08-24: owner ruling narrowed
// the plan-mode assertion. In plan mode "Plan is over" is honest
// arithmetic about a plan (not spend performance); Bank ▲ $3,359 is
// a real season figure; 361 hrs is availability. The rule was
// written for the actuals case, where green "under budget" on $0
// spent is a lie. Under-suppressing would ship a bug; over-
// suppressing hides legitimate state.
//
// Narrowed rule: on a stand whose games have not started, assert
// NO card claims SPEND PERFORMANCE - no "under budget", no "over
// budget", no variance-against-actuals text. Plan-arithmetic pills
// like "Plan fits" / "Plan is over" are fine.
async function spendPerformanceClaims(page: Page, scope = '.kpi-hs-board') {
  return page.evaluate((scope) => {
    const root = document.querySelector(scope);
    if (!root) return { total: 0, detail: [] as string[] };
    // Text patterns that ONLY appear when a card is claiming
    // performance against real spend. Plan pills use "Plan is over"
    // / "Plan fits" (arithmetic about a plan) - excluded.
    const patterns = [
      /\bunder budget\b/i,
      /\bover budget\b/i,
      /\bunder pro-rated\b/i,
      /\bover pro-rated\b/i,
      /\bon the pro-rated line\b/i,
      /\bspent against budget\b/i,
    ];
    const detail: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.textContent || "").trim();
      if (!t) continue;
      for (const re of patterns) {
        if (re.test(t)) {
          const el = node.parentElement;
          const tag = el?.tagName || '?';
          const cls = el?.className || '';
          detail.push(`"${t.slice(0, 80)}"  <${tag} class="${cls}">`);
          break;
        }
      }
    }
    return { total: detail.length, detail };
  }, scope);
}

async function openStand(page: Page, gameStart: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/kpi/labor?account=${encodeURIComponent(ACCOUNT)}&view=homestand&homestand=${gameStart}`);
  await page.waitForSelector('.kpi-hs-board', { timeout: 30_000 });
}

test.setTimeout(90_000);

test.describe('KPI homestand future-range state', () => {
  test('fully-future stand (2026-09-14) renders plan, no spend-performance claims, no spent_to_date fact', async ({ page }) => {
    await openStand(page, '2026-09-14');
    // PlanCards render (data-card="plan" is the HS X budget plan card).
    await expect(page.locator('[data-card="plan"]')).toBeVisible();
    // NO card claims spend performance (under/over budget, variance
    // against actuals). "Plan is over" is honest arithmetic and is
    // allowed - the excluded patterns are the real-spend verdicts.
    const s = await spendPerformanceClaims(page);
    expect(s.total, `future stand must claim 0 spend performance strings, saw:\n  ${s.detail.join('\n  ')}`).toBe(0);
    // spent_to_date fact absent (nothing spent yet on a fully-future stand).
    await expect(page.locator('[data-fact="spent_to_date"]')).toHaveCount(0);
  });

  test('straddling stand (2026-08-31) renders plan AND spent_to_date fact', async ({ page }) => {
    await openStand(page, '2026-08-31');
    await expect(page.locator('[data-card="plan"]')).toBeVisible();
    const s = await spendPerformanceClaims(page);
    expect(s.total, `straddling plan-mode stand must claim 0 spend performance strings, saw:\n  ${s.detail.join('\n  ')}`).toBe(0);
    // Spent to date fact present (prep-day spend inside the open window).
    const spentFact = page.locator('[data-fact="spent_to_date"]');
    await expect(spentFact).toBeVisible();
    // Owner-supplied number: $359.58 on CIN - OH HS 12 prep days.
    // Format is fmt$ ($NNN.NN with commas), so this reads as "$359.58".
    await expect(spentFact).toContainText(/\$359\.58/);
  });

  test('closed stand (2026-08-14) KEEPS its spend-performance verdict (over-suppression guard)', async ({ page }) => {
    await openStand(page, '2026-08-14');
    // Played stand still renders actuals + a real spend-performance
    // string. Assert AT LEAST one of the excluded patterns fires so
    // the plan-mode gate cannot silence the board everywhere.
    const s = await spendPerformanceClaims(page);
    expect(s.total, `played stand must claim at least one spend-performance string (guards against over-suppressing plan mode)`).toBeGreaterThan(0);
    // No plan card - actuals path only.
    await expect(page.locator('[data-card="plan"]')).toHaveCount(0);
  });

  test('pre-floor stand (2026-03-26) renders plan with estimated basis and no spend-performance claims', async ({ page }) => {
    await openStand(page, '2026-03-26');
    await expect(page.locator('[data-card="plan"]')).toBeVisible();
    // Pre-floor stands carry the `est.` pill on the plan card.
    await expect(page.locator('[data-est-pill]')).toBeVisible();
    const s = await spendPerformanceClaims(page);
    expect(s.total, `pre-floor plan-mode stand must claim 0 spend performance strings, saw:\n  ${s.detail.join('\n  ')}`).toBe(0);
  });
});

// HS PR-B - season table integrity. Two owner-named defects:
//   1. Window column showed GAME dates while Days column showed
//      window days - HS 3 read "04/24/26 - 04/30/26" (7d) beside
//      Days: 11. Fix: render window_start - window_end.
//   2. Prep & off column was `–` on every row because
//      homestand_split was only computed for the selected stand.
//      Fix: foldPerStandSplits attaches split to every stand.
test.describe('KPI homestand season table (HS PR-B)', () => {
  test('Window column reads window_start - window_end (not game dates)', async ({ page }) => {
    // Land on any played stand to render the table.
    await openStand(page, '2026-08-14');
    // Row-level assertion: for the played rows, compute the day span
    // between the Window column text and compare to the Days column.
    // If Window shows game dates, the delta will not equal Days.
    const rows = await page.$$eval('.kpi-hs-table tbody tr[data-game-start]', trs => {
      return trs.map(tr => {
        const gs = tr.getAttribute('data-game-start');
        const tds = tr.querySelectorAll('td');
        if (tds.length < 4) return null;
        return {
          gs,
          window: tds[1]?.textContent?.trim() || '',
          days: tds[2]?.textContent?.trim() || '',
        };
      }).filter(Boolean);
    });
    expect(rows.length, 'expected at least a handful of stands').toBeGreaterThan(3);
    for (const r of rows) {
      // Window text like "04/20/26 – 04/30/26" (– is en-dash U+2013).
      const m = r!.window.match(/(\d{2})\/(\d{2})\/(\d{2}).*[–—-].*?(\d{2})\/(\d{2})\/(\d{2})/);
      expect(m, `row ${r!.gs} window text does not parse: "${r!.window}"`).toBeTruthy();
      if (!m) continue;
      const toISO = (y: string, mo: string, d: string) => `20${y}-${mo}-${d}`;
      const start = new Date(toISO(m[3], m[1], m[2]) + 'T00:00:00Z');
      const end   = new Date(toISO(m[6], m[4], m[5]) + 'T00:00:00Z');
      const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
      const days = parseInt(r!.days, 10);
      expect(spanDays, `row ${r!.gs} window span ${spanDays}d vs Days column ${days}d (mismatch = Window shows game dates)`).toBe(days);
    }
  });

  test('Prep & off column populates on played rows (not `–` on every row)', async ({ page }) => {
    await openStand(page, '2026-08-14');
    // Played rows: [data-game-start] with no data-estimated="true"
    // and no kpi-hs-tr-future class. At least ONE must render a
    // dollar amount in Prep & off.
    const prepValues = await page.$$eval('.kpi-hs-table tbody tr[data-game-start]:not(.kpi-hs-tr-prefloor):not(.kpi-hs-tr-future)', trs => {
      return trs.map(tr => tr.querySelectorAll('td')[6]?.textContent?.trim() || '');
    });
    expect(prepValues.length, 'expected played rows in the table').toBeGreaterThan(0);
    const withDollar = prepValues.filter(v => /\$\d/.test(v));
    expect(withDollar.length, `expected at least one played row to render Prep & off as a dollar figure, saw: ${prepValues.join(' | ')}`).toBeGreaterThan(0);
  });
});

// HS PR-C - card headers + range chip + copy items. Same file so
// Chat-Claude runs one spec for the full HS surface.
test.describe('KPI homestand headers + chip + copy (HS PR-C)', () => {
  test('all five signal-card headers measure the same height', async ({ page }) => {
    // Played stand renders the actuals SignalCards (5 cards). Header
    // heights must all be equal - pre-fix three of five wrapped the
    // ? to a second row (45-48px) while prep + payroll fit at 21px.
    await openStand(page, '2026-08-14');
    const heights = await page.$$eval('.kpi-hs-signals .kpi-hs-card-hdr', hdrs => {
      return hdrs.map(h => Math.round((h as HTMLElement).getBoundingClientRect().height));
    });
    expect(heights.length, 'expected 5 signal-card headers').toBe(5);
    const unique = [...new Set(heights)];
    expect(unique.length, `all five header heights must match, saw: ${heights.join(', ')}`).toBe(1);
  });

  test('range chip on homestand view names the selected stand', async ({ page }) => {
    await openStand(page, '2026-08-14');
    // The chip primary text is in .kpi-rmenu-label-primary. On
    // homestand view it reads "HS N · <opponents>" instead of the
    // FYTD default.
    const chip = page.locator('.kpi-rmenu-trigger .kpi-rmenu-label-primary').first();
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(/^HS \d+ · /);
  });

  test('Payroll data card omits Will rise when no unapproved hours', async ({ page }) => {
    // 08/14 is closed and typically fully approved - "All in · every
    // shift approved". Will rise fact must be absent, not `–`.
    await openStand(page, '2026-08-14');
    const payroll = page.locator('[data-card="payroll"]');
    await expect(payroll).toBeVisible();
    // Sub reads "every shift approved" on the fully-approved path.
    await expect(payroll).toContainText(/every shift approved/);
    // Facts must NOT include "Will rise" at all when approved.
    await expect(payroll.locator('.kpi-hs-fact', { hasText: 'Will rise' })).toHaveCount(0);
  });

  test('Peak header has visible space before the ? trigger', async ({ page }) => {
    await openStand(page, '2026-08-14');
    // Structural: the qwrap has margin-left applied. Read computed
    // style and assert >= 6px so text + trigger do not collide.
    const marginLeftPx = await page.$eval('.kpi-hs-th-help .kpi-hs-qwrap', el => {
      return parseFloat(window.getComputedStyle(el).marginLeft);
    });
    expect(marginLeftPx, `Peak header trigger needs visible left margin, saw ${marginLeftPx}px`).toBeGreaterThanOrEqual(6);
  });

  test('unresolvable stand keeps rail + shows refusal panel (not blank)', async ({ page }) => {
    // Reachable by switching account with a stand selected: 08/14 is
    // a CIN - OH game start, not a Texas one. Owner ruling 2026-08-24:
    // "navigation must survive an unresolvable selection. A blank page
    // with no way back is the one outcome to avoid." Same rule as the
    // refusal handling from #754.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/kpi/labor?account=${encodeURIComponent('TXR - TX - H')}&view=homestand&homestand=2026-08-14`);
    await page.waitForSelector('.kpi-hs-board', { timeout: 30_000 });
    // Rail renders (with TXR's own stands, not CIN's).
    await expect(page.locator('.kpi-hs-rail')).toBeVisible();
    // Season card renders.
    await expect(page.locator('[data-hs-help="qSeason"]').first()).toBeVisible();
    // Refusal panel replaces the stand region.
    await expect(page.locator('[data-refusal]')).toBeVisible();
    // No plan/actuals cards for a stand that doesn't belong to the account.
    await expect(page.locator('[data-card="plan"]')).toHaveCount(0);
    await expect(page.locator('[data-card="spend"]')).toHaveCount(0);
  });
});
