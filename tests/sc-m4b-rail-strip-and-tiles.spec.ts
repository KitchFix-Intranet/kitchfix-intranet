// M-4b permanent coverage. Locks in the states that took multiple
// rail passes + one drill-overlay z-index find to get right. The
// tests below are what a future refactor will quietly break, in
// the order the M-4b rail rebuild + strip simplification landed.
//
// Every fixture is a stub because a real payload requires
// Supabase credentials that CI does not carry. Owner ruling on
// stubs (M-4a review): fixtures shape the payload but the
// assertions target CODE PATHS - presence/absence of specific
// classes and behaviours - rather than data the fixture itself
// planted.
//
// Session identity is k.fietek@kitchfix.com to satisfy SC_ADMINS
// (page-level gate). Extending SC_ADMINS to a synthetic identity
// was ruled out in Round 1 §7B; the stub is client-side only and
// no NextAuth cookie is minted, so no server write ever fires and
// no audit trail entry is created.

import { test, expect, type Page } from '@playwright/test';
import { assertBoardLoaded } from './lib/board-loaded';

// SC page's real-board markers - one of these is present whenever
// the authed service-calendar view mounts. Unauthenticated state
// renders a bare "Please sign in" panel with none of these.
const SC_BOARD = '.sc-season-grid, .sc-ribbon, .sc-chrome-bar';

const ACCOUNTS = [
  { key: 'CIN - OH',      category: 'MLB',  hasHomestandSchedule: true,  billingModel: 'flat_fee' },
  { key: 'STL - MO',      category: 'MLB',  hasHomestandSchedule: true,  billingModel: 'flat_fee' },
  { key: 'TXR - TX - H',  category: 'MLB',  hasHomestandSchedule: true,  billingModel: 'flat_fee' },
  { key: 'TXR - TX - V',  category: 'MLB',  hasHomestandSchedule: true,  billingModel: 'flat_fee' },
  { key: 'CIN - KY',      category: 'MiLB', hasHomestandSchedule: true,  billingModel: 'actuals_drive_invoice' },
  { key: 'TBJ - NY',      category: 'MiLB', hasHomestandSchedule: true,  billingModel: 'actuals_drive_invoice' },
  { key: 'CIN - AZ',      category: 'PDC',  hasHomestandSchedule: false, billingModel: 'actuals_drive_invoice' },
  { key: 'STL - FL',      category: 'PDC',  hasHomestandSchedule: false, billingModel: 'flat_fee' },
];

// Six homestands on CIN - OH covering every payload status:
//   HS1 closed-out (with laborActual + budgetSnapshotAtCloseout)
//   HS2 closed-out (second one so the group renders a count > 1)
//   HS3 actuals-due (earliest due -> becomes card default)
//   HS4 actuals-due (second due -> more waiting)
//   HS9 in-progress (today Jul 11 falls inside)
//   HS10 upcoming (Jul 27 - Aug 6, Monday-start 11-day; used for
//     the payroll-week divider assertion)
const CIN_OH_SEED = [
  { key: '2026-03-26', ordinal: 'HS1', status: 'closed-out', laborActual: 12900,
    budgetSnapshotAtCloseout: 13053, startDate: '2026-03-26', endDate: '2026-04-01',
    gameCount: 6, opponents: ['BOS','PIT'], budget: { amount: 13053, breakdown: [] } },
  { key: '2026-04-10', ordinal: 'HS2', status: 'closed-out', laborActual: 10000,
    startDate: '2026-04-10', endDate: '2026-04-16',
    gameCount: 6, opponents: ['LAA','SF'], budget: { amount: 12000, breakdown: [] } },
  { key: '2026-04-24', ordinal: 'HS3', status: 'actuals-due',
    startDate: '2026-04-24', endDate: '2026-04-30',
    gameCount: 6, opponents: ['DET','COL'], budget: { amount: 11000, breakdown: [] } },
  { key: '2026-05-22', ordinal: 'HS4', status: 'actuals-due',
    startDate: '2026-05-22', endDate: '2026-05-24',
    gameCount: 3, opponents: ['STL'], budget: { amount: 8355, breakdown: [] } },
  { key: '2026-07-03', ordinal: 'HS9', status: 'in-progress',
    startDate: '2026-07-03', endDate: '2026-07-12',
    gameCount: 9, opponents: ['BAL','PHI','CHC'], budget: { amount: 13053, breakdown: [] } },
  { key: '2026-07-27', ordinal: 'HS10', status: 'upcoming',
    startDate: '2026-07-27', endDate: '2026-08-06',
    gameCount: 10, opponents: ['CLE','PIT','ATH'], budget: { amount: 15000, breakdown: [] } },
];

// STL - MO: two actuals-due + one upcoming. Zero closed-out - the
// state owner named for "empty group does not render at all."
const STL_MO_SEED = [
  { key: '2026-04-10', ordinal: 'HS1', status: 'actuals-due',
    startDate: '2026-04-10', endDate: '2026-04-16',
    gameCount: 6, opponents: ['MIA'], budget: { amount: 12000, breakdown: [] } },
  { key: '2026-05-01', ordinal: 'HS2', status: 'actuals-due',
    startDate: '2026-05-01', endDate: '2026-05-06',
    gameCount: 6, opponents: ['NYY'], budget: { amount: 12000, breakdown: [] } },
  { key: '2026-06-01', ordinal: 'HS3', status: 'upcoming',
    startDate: '2026-06-01', endDate: '2026-06-06',
    gameCount: 6, opponents: ['BOS'], budget: { amount: 12000, breakdown: [] } },
];

// TXR - TX - H: no in-progress block, no due, all upcoming. The
// "gap day" state owner named - pinned card should be absent, no
// placeholder.
const TXR_TX_H_SEED = [
  { key: '2026-06-01', ordinal: 'HS1', status: 'upcoming',
    startDate: '2026-06-01', endDate: '2026-06-06',
    gameCount: 6, opponents: ['LAA'], budget: { amount: 12000, breakdown: [] } },
  { key: '2026-06-15', ordinal: 'HS2', status: 'upcoming',
    startDate: '2026-06-15', endDate: '2026-06-20',
    gameCount: 6, opponents: ['SF'], budget: { amount: 12000, breakdown: [] } },
];

// yearData seed for CIN - OH: minimal GAME/AWAY rows framing each
// seeded homestand so deriveHomestandSegments produces the six
// blocks the tests need. Structure matches loadYearSummary's
// months[].days[].
function buildYearData(seedBlocks: any[]) {
  const months: Record<string, any[]> = {};
  const push = (dateIso: string, dayType: string, opponent?: string) => {
    const monthKey = dateIso.slice(0, 7);
    if (!months[monthKey]) months[monthKey] = [];
    months[monthKey].push({ date: dateIso, dayType, opponent: opponent || '',
      status: dayType === 'GAME' ? 'entered' : undefined, actualMeals: 100 });
  };
  for (const b of seedBlocks) {
    // Leading + trailing AWAY buffer so the segment derivation
    // closes each block.
    const before = new Date(b.startDate + 'T12:00:00');
    before.setDate(before.getDate() - 1);
    push(before.toISOString().slice(0, 10), 'AWAY', 'AWAY');
    const s = new Date(b.startDate + 'T12:00:00');
    const e = new Date(b.endDate + 'T12:00:00');
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      push(d.toISOString().slice(0, 10), 'GAME', b.opponents?.[0] || 'X');
    }
    const after = new Date(b.endDate + 'T12:00:00');
    after.setDate(after.getDate() + 1);
    push(after.toISOString().slice(0, 10), 'AWAY', 'AWAY');
  }
  return Object.keys(months).sort().map((month) => ({
    month, period: '', totalDays: 30, daysWithActuals: 0,
    projectedRevenue: 0, actualRevenue: 0, projectedCovers: 0, actualCovers: 0,
    homestandSummary: { gameDays: months[month].filter(d => d.dayType === 'GAME').length,
                        gameDaysEntered: 0, prepDays: 0 },
    days: months[month],
  }));
}

async function stub(page: Page, activeKey: string, seed: any[] | null, todayIso = '2026-07-11') {
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ user: { email: 'k.fietek@kitchfix.com' }, expires: '2099-01-01T00:00:00.000Z' }) }));
  await page.route(/action=sc-hero/, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ heroImage: '' }) }));
  await page.route(/action=sc-accounts/, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, accounts: ACCOUNTS.map((a) => ({
        key: a.key, category: a.category, accountName: a.key,
        billingModel: a.billingModel, hasHomestandSchedule: a.hasHomestandSchedule,
      })), defaultAccount: activeKey, roles: ['LEADERSHIP'] }) }));
  await page.route(/action=sc-year-summary/, (r) => {
    const isMlb = ['CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V'].includes(activeKey);
    const yearData = isMlb && seed ? buildYearData(seed) :
      Array.from({ length: 12 }, (_, i) => ({
        month: `2026-${String(i + 1).padStart(2, '0')}`, period: '',
        totalDays: 30, daysWithActuals: 0, projectedRevenue: 0, actualRevenue: 0,
        projectedCovers: 0, actualCovers: 0, days: [],
      }));
    const payload: Record<string, unknown> = {
      success: true, year: 2026, today: { date: todayIso },
      periodRanges: [], months: yearData,
    };
    if (isMlb && seed) payload.homestands = seed;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.route(/action=sc-load/, (r) => {
    const acct = ACCOUNTS.find((a) => a.key === activeKey)!;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true, account: { key: activeKey, category: acct.category, name: activeKey,
        billingModel: acct.billingModel, spreadsheetId: '' },
      metaColCount: 4, serviceGroups: [], days: [], overrides: [],
      accounts: ACCOUNTS.map((a) => ({ key: a.key, category: a.category })),
    })});
  });
}

test.describe('MLB rail (rev3 - past · now · future)', () => {
  test('CIN - OH: pinned in-progress card + three groups; Actuals due open by default', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await stub(page, 'CIN - OH', CIN_OH_SEED);
    await page.goto(`/service-calendar?account=${encodeURIComponent('CIN - OH')}`, { waitUntil: 'networkidle' });
    await assertBoardLoaded(page, SC_BOARD, { context: 'service-calendar' });
    await expect(page.locator('.sc-season-grid')).toBeVisible();

    // Pinned in-progress card renders with HS9.
    const pinned = page.locator('.sc-rail-mlb-pinned');
    await expect(pinned).toHaveCount(1);
    await expect(pinned).toContainText('In progress');
    await expect(pinned).toContainText('HS9');
    // Pinned CTA is outlined (rail border), not filled green.
    await expect(pinned.locator('.sc-rail-mlb-btn--outlined')).toBeVisible();
    await expect(pinned.locator('.sc-rail-mlb-btn--cta')).toHaveCount(0);

    // Three groups; Actuals due opens by default.
    const closedGroup = page.locator('.sc-rail-mlb-group').filter({ hasText: 'Closed out' });
    const dueGroup    = page.locator('.sc-rail-mlb-group').filter({ hasText: 'Actuals due' });
    const upGroup     = page.locator('.sc-rail-mlb-group').filter({ hasText: 'Upcoming' });
    await expect(closedGroup).toHaveAttribute('data-open', 'false');
    await expect(dueGroup).toHaveAttribute('data-open', 'true');
    await expect(upGroup).toHaveAttribute('data-open', 'false');

    // Group counts match the seed.
    await expect(closedGroup.locator('.sc-rail-mlb-group-count').first()).toContainText('2');
    await expect(dueGroup.locator('.sc-rail-mlb-group-count').first()).toContainText('2');
    await expect(upGroup.locator('.sc-rail-mlb-group-count').first()).toContainText('1');
  });

  test('Only actuals-due gets the green CTA - everything else outlined', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await stub(page, 'CIN - OH', CIN_OH_SEED);
    await page.goto(`/service-calendar?account=${encodeURIComponent('CIN - OH')}`, { waitUntil: 'networkidle' });
    await assertBoardLoaded(page, SC_BOARD, { context: 'service-calendar' });

    // Expand each group and open one row per state; assert button variant.
    const closedGroup = page.locator('.sc-rail-mlb-group').filter({ hasText: 'Closed out' });
    const dueGroup    = page.locator('.sc-rail-mlb-group').filter({ hasText: 'Actuals due' });
    const upGroup     = page.locator('.sc-rail-mlb-group').filter({ hasText: 'Upcoming' });

    // Actuals-due row -> filled CTA "Close out HS3"
    await dueGroup.locator('.sc-rail-mlb-item').first().locator('.sc-rail-mlb-item-row').click();
    await expect(dueGroup.locator('.sc-rail-mlb-btn--cta')).toContainText('Close out HS3');
    await expect(dueGroup.locator('.sc-rail-mlb-btn--outlined')).toHaveCount(0);

    // Closed-out row -> outlined "Open HS1"
    await closedGroup.locator('.sc-rail-mlb-group-header').click();
    await closedGroup.locator('.sc-rail-mlb-item').first().locator('.sc-rail-mlb-item-row').click();
    await expect(closedGroup.locator('.sc-rail-mlb-btn--outlined')).toContainText('Open HS1');
    await expect(closedGroup.locator('.sc-rail-mlb-btn--cta')).toHaveCount(0);

    // Upcoming row -> outlined "Open HS10"
    await upGroup.locator('.sc-rail-mlb-group-header').click();
    await upGroup.locator('.sc-rail-mlb-item').first().locator('.sc-rail-mlb-item-row').click();
    await expect(upGroup.locator('.sc-rail-mlb-btn--outlined')).toContainText('Open HS10');
    await expect(upGroup.locator('.sc-rail-mlb-btn--cta')).toHaveCount(0);
  });

  test('Closed-out row money reads SPEND, not budget', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await stub(page, 'CIN - OH', CIN_OH_SEED);
    await page.goto(`/service-calendar?account=${encodeURIComponent('CIN - OH')}`, { waitUntil: 'networkidle' });
    await assertBoardLoaded(page, SC_BOARD, { context: 'service-calendar' });
    const closedGroup = page.locator('.sc-rail-mlb-group').filter({ hasText: 'Closed out' });
    await closedGroup.locator('.sc-rail-mlb-group-header').click();
    // HS1 closed at $12,900 vs $13,053 budget - row must show spend.
    const money = closedGroup.locator('.sc-rail-mlb-item').first().locator('.sc-rail-mlb-item-money');
    await expect(money).toContainText('$12,900');
    await expect(money).not.toContainText('$13,053');
  });

  test('Only one row open at a time across ALL groups', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await stub(page, 'CIN - OH', CIN_OH_SEED);
    await page.goto(`/service-calendar?account=${encodeURIComponent('CIN - OH')}`, { waitUntil: 'networkidle' });
    await assertBoardLoaded(page, SC_BOARD, { context: 'service-calendar' });

    const closedGroup = page.locator('.sc-rail-mlb-group').filter({ hasText: 'Closed out' });
    const dueGroup    = page.locator('.sc-rail-mlb-group').filter({ hasText: 'Actuals due' });
    await closedGroup.locator('.sc-rail-mlb-group-header').click();

    // Open closed-out row.
    await closedGroup.locator('.sc-rail-mlb-item').first().locator('.sc-rail-mlb-item-row').click();
    await expect(page.locator('.sc-rail-mlb-item-card')).toHaveCount(1);
    // Open a due row -> closed-out card collapses; exactly one open.
    await dueGroup.locator('.sc-rail-mlb-item').first().locator('.sc-rail-mlb-item-row').click();
    await expect(page.locator('.sc-rail-mlb-item-card')).toHaveCount(1);
    await expect(closedGroup.locator('.sc-rail-mlb-item-card')).toHaveCount(0);
    await expect(dueGroup.locator('.sc-rail-mlb-item-card')).toHaveCount(1);
  });

  test('STL - MO (zero closed-out): Closed out group does NOT render', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await stub(page, 'STL - MO', STL_MO_SEED);
    await page.goto(`/service-calendar?account=${encodeURIComponent('STL - MO')}`, { waitUntil: 'networkidle' });
    await assertBoardLoaded(page, SC_BOARD, { context: 'service-calendar' });
    // Actuals due + Upcoming present; NO Closed out group.
    await expect(page.locator('.sc-rail-mlb-group').filter({ hasText: 'Closed out' })).toHaveCount(0);
    await expect(page.locator('.sc-rail-mlb-group').filter({ hasText: 'Actuals due' })).toHaveCount(1);
    await expect(page.locator('.sc-rail-mlb-group').filter({ hasText: 'Upcoming' })).toHaveCount(1);
  });

  test('TXR - TX - H (no in-progress): pinned card ABSENT - no placeholder', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await stub(page, 'TXR - TX - H', TXR_TX_H_SEED);
    await page.goto(`/service-calendar?account=${encodeURIComponent('TXR - TX - H')}`, { waitUntil: 'networkidle' });
    await assertBoardLoaded(page, SC_BOARD, { context: 'service-calendar' });
    await expect(page.locator('.sc-rail-mlb-pinned')).toHaveCount(0);
    // Upcoming group still renders (has blocks).
    await expect(page.locator('.sc-rail-mlb-group').filter({ hasText: 'Upcoming' })).toHaveCount(1);
  });
});

test.describe('Season strip (slim tracker with drained palette)', () => {
  test('CIN - OH: bare numbers on every block; exactly N segments; anchors present', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await stub(page, 'CIN - OH', CIN_OH_SEED);
    await page.goto(`/service-calendar?account=${encodeURIComponent('CIN - OH')}`, { waitUntil: 'networkidle' });
    await assertBoardLoaded(page, SC_BOARD, { context: 'service-calendar' });
    const labels = page.locator('.sc-stepper-bar-segment-label');
    await expect(labels).toHaveCount(CIN_OH_SEED.length);
    for (const t of await labels.allTextContents()) {
      expect(t, `label "${t}" must be a bare number`).toMatch(/^\d+$/);
    }
    // Month anchors present, muted small text.
    await expect(page.locator('.sc-stepper-anchor--first')).toBeVisible();
    await expect(page.locator('.sc-stepper-anchor--last')).toBeVisible();
    // Deleted surfaces stay deleted.
    await expect(page.locator('.sc-stepper-caption')).toHaveCount(0);
    await expect(page.locator('.sc-stepper-spotlight')).toHaveCount(0);
    await expect(page.locator('.sc-stepper-hint')).toHaveCount(0);
    await expect(page.locator('.sc-stepper-footer')).toHaveCount(0);
  });

  test('Current block: solid blue #1e5aa8 background + white text + tallest', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await stub(page, 'CIN - OH', CIN_OH_SEED);
    await page.goto(`/service-calendar?account=${encodeURIComponent('CIN - OH')}`, { waitUntil: 'networkidle' });
    await assertBoardLoaded(page, SC_BOARD, { context: 'service-calendar' });
    const current = page.locator('.sc-stepper-bar-segment--current .sc-stepper-bar-segment-button').first();
    const style = await current.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color };
    });
    expect(style.bg).toBe('rgb(30, 90, 168)');   // #1e5aa8
    expect(style.color).toBe('rgb(255, 255, 255)');

    // Tallest: strictly greater than actuals-due AND closed-out.
    const cH = await current.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
    const dueH = await page.locator('.sc-stepper-bar-segment--actuals-due .sc-stepper-bar-segment-button')
      .first().evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
    const doneH = await page.locator('.sc-stepper-bar-segment--done .sc-stepper-bar-segment-button')
      .first().evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
    expect(cH).toBeGreaterThan(dueH);
    expect(cH).toBeGreaterThan(doneH);
  });
});

test.describe('Tile navigation (step 6)', () => {
  test('CIN - OH: game-day tile routes to ?homestand=<key> WITHOUT firing month drill or entry modal', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const modalOpens = { count: 0 };
    // Any dialog-role opening would signal the entry modal fired.
    page.on('dialog', () => modalOpens.count += 1);
    await stub(page, 'CIN - OH', CIN_OH_SEED);
    await page.goto(`/service-calendar?account=${encodeURIComponent('CIN - OH')}`, { waitUntil: 'networkidle' });
    await assertBoardLoaded(page, SC_BOARD, { context: 'service-calendar' });
    // Click a Jul 3 GAME tile (HS9 first game).
    const july = page.locator('.sc-season-grid [role="gridcell"]').nth(6);
    const tile = july.locator('[aria-label*="2026-07-03"]').first();
    await expect(tile).toBeVisible();
    const cls = await tile.getAttribute('class') || '';
    expect(cls).toContain('sc-daysq--interactive');
    await tile.click();
    await page.waitForURL(/homestand=/);
    expect(page.url()).toContain('homestand=');
    // Modal must not have opened.
    expect(modalOpens.count).toBe(0);
    // Month drill URL param would show ?month= - it must not.
    expect(page.url()).not.toContain('month=');
  });

  test('CIN - OH: non-game-day tile stays inert', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await stub(page, 'CIN - OH', CIN_OH_SEED);
    await page.goto(`/service-calendar?account=${encodeURIComponent('CIN - OH')}`, { waitUntil: 'networkidle' });
    await assertBoardLoaded(page, SC_BOARD, { context: 'service-calendar' });
    // Jul 2 is AWAY (leading pre-day for HS9). Not interactive.
    const july = page.locator('.sc-season-grid [role="gridcell"]').nth(6);
    const awayTile = july.locator('[aria-label*="2026-07-02"]').first();
    const cls = await awayTile.getAttribute('class') || '';
    expect(cls).not.toContain('sc-daysq--interactive');
  });

  test('Non-MLB accounts (AAA, PDC): zero interactive tiles on the season grid', async ({ page }) => {
    for (const key of ['CIN - KY', 'TBJ - NY', 'CIN - AZ', 'STL - FL']) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await stub(page, key, null);
      await page.goto(`/service-calendar?account=${encodeURIComponent(key)}`, { waitUntil: 'networkidle' });
    await assertBoardLoaded(page, SC_BOARD, { context: 'service-calendar' });
      await expect(page.locator('.sc-season-grid')).toBeVisible();
      await expect(page.locator('.sc-season-grid .sc-daysq--interactive'), `${key} tiles`).toHaveCount(0);
    }
  });
});

test.describe('Payroll-week divider (rider)', () => {
  test('HS10 (Jul 27 - Aug 6): exactly one divider between Aug 2 and Aug 3', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await stub(page, 'CIN - OH', CIN_OH_SEED);
    await page.goto(`/service-calendar?account=${encodeURIComponent('CIN - OH')}&homestand=2026-07-27`, { waitUntil: 'networkidle' });
    await assertBoardLoaded(page, SC_BOARD, { context: 'service-calendar' });
    const strip = page.locator('.sc-daystrip');
    await expect(strip).toBeVisible();
    const weekbreaks = strip.locator('.sc-daystrip-weekbreak');
    await expect(weekbreaks).toHaveCount(1);
    const aria = await weekbreaks.first().getAttribute('aria-label');
    expect(aria).toContain('Aug 3');
    // Legend includes Payroll week entry.
    await expect(page.locator('.sc-hs-legend').getByText('Payroll week')).toBeVisible();
  });

  test('Short block (Wed - Fri): zero dividers', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    // HS4 in the seed: 2026-05-22 (Fri) - 2026-05-24 (Sun). Only
    // three days inside one payroll week (Mon-Sun), no Sunday->
    // Monday seam inside the strip domain.
    await stub(page, 'CIN - OH', CIN_OH_SEED);
    await page.goto(`/service-calendar?account=${encodeURIComponent('CIN - OH')}&homestand=2026-05-22`, { waitUntil: 'networkidle' });
    await assertBoardLoaded(page, SC_BOARD, { context: 'service-calendar' });
    const strip = page.locator('.sc-daystrip');
    await expect(strip).toBeVisible();
    await expect(strip.locator('.sc-daystrip-weekbreak')).toHaveCount(0);
  });
});
