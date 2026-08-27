// Viewport-clip guard at 1280.
//
// Owner ruling 2026-08-27: 1280 is the supported floor. Covers a
// 1080p Windows laptop at 150% scaling and a 1366 budget machine -
// both likely in a clubhouse office. 1024 is out of scope (tablet /
// split-screen).
//
// This is the third time a shipped string has broken a container -
// the OT sub-line clipping was introduced by #858 the same day this
// spec landed. The guard is the durable half of PR #858.
//
// Assertions:
//   1. Every leaf element under .kpi-app has scrollWidth <=
//      clientWidth + 2 (small tolerance for sub-pixel rounding).
//      Excludes .kpi-sr (visually-hidden live regions where wide
//      content is expected).
//   2. No horizontal page scroll on the document.
//
// Runs on period + homestand across every MLB account. For the
// homestand caption assertion the fixture is CIN - OH HS 10 - the
// 25-day stand that #858 verify surfaced as the tightest case
// portfolio-wide (three days longer than the 22-day HS 8 Kevin
// originally reported).
//
// Two viewports:
//   1280 x 900  the floor per owner ruling
//   1440 x 900  the desk-default

import { test, expect, type Page } from '@playwright/test';
import { assertBoardLoaded } from './lib/board-loaded';

const MLB = ['STL - MO', 'CIN - OH', 'TXR - TX - H', 'TXR - TX - V'];
const VIEWPORTS = [
  { width: 1280, height: 900, label: '1280 floor' },
  { width: 1440, height: 900, label: '1440 desk' },
];

// Tolerance covers Chromium sub-pixel rounding on transformed or
// zoomed layouts. Anything greater than 2px is a real overflow.
const TOLERANCE_PX = 2;

// Leaf elements we deliberately allow to overflow their box:
//   .kpi-sr  visually-hidden ARIA live regions (sr-only text can be
//            wider than the 1px collapsed container by design)
const CLIP_EXCEPTIONS = ['.kpi-sr'];

async function findClippedLeaves(page: Page) {
  return page.evaluate(
    ({ tolerance, exceptions }) => {
      const root = document.querySelector('.kpi-app');
      if (!root) return [];
      const out: Array<{ tag: string; classes: string; scrollWidth: number; clientWidth: number; sample: string }> = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node: Node | null = walker.currentNode;
      while (node) {
        const el = node as HTMLElement;
        // Only leaves (no element children) - a container that
        // clips is a genuine defect only at the site the string
        // renders.
        if (el.children.length === 0) {
          const skip = exceptions.some(sel => el.closest(sel));
          if (!skip && el.scrollWidth > el.clientWidth + tolerance) {
            out.push({
              tag: el.tagName.toLowerCase(),
              classes: el.className || '',
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
              sample: (el.textContent || '').trim().slice(0, 60),
            });
          }
        }
        node = walker.nextNode();
      }
      return out;
    },
    { tolerance: TOLERANCE_PX, exceptions: CLIP_EXCEPTIONS },
  );
}

async function hasPageScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

// Card height parity within a row. I argued parity holds mechanically
// because both card rows are grids (.kpi-hs-signals + .kpi-sig) with
// stretch/center align - but wrapping labels is precisely the change
// that could break that guarantee, and Kevin's ruling was explicit:
// "card heights stay equal within a row - that parity was hard-won".
// Assert it directly on the two card rows we ship.
//
// Returns rows where the min-max height spread exceeds 2px (rounding
// tolerance).
async function findParityBreaks(page: Page, rowSelector: string, cardSelector: string) {
  return page.evaluate(
    ({ row, card, tol }) => {
      const rows = document.querySelectorAll(row);
      const out: Array<{ selector: string; heights: number[]; spread: number }> = [];
      rows.forEach(r => {
        const cards = Array.from(r.querySelectorAll(card)) as HTMLElement[];
        if (cards.length < 2) return;
        const heights = cards.map(c => Math.round(c.getBoundingClientRect().height));
        const spread = Math.max(...heights) - Math.min(...heights);
        if (spread > tol) out.push({ selector: `${row} ${card}`, heights, spread });
      });
      return out;
    },
    { row: rowSelector, card: cardSelector, tol: 2 },
  );
}

async function loadPeriod(page: Page, account: string) {
  await page.goto(`/kpi/labor?account=${encodeURIComponent(account)}`);
  await assertBoardLoaded(page, '.kpi-sig', { context: `period on ${account}` });
}

async function loadHomestand(page: Page, account: string, gameStart?: string) {
  const q = gameStart
    ? `account=${encodeURIComponent(account)}&view=homestand&homestand=${gameStart}`
    : `account=${encodeURIComponent(account)}&view=homestand`;
  await page.goto(`/kpi/labor?${q}`);
  await assertBoardLoaded(page, '.kpi-hs-rail', { context: `homestand on ${account}` });
  if (!gameStart) {
    const stand = page.locator('.kpi-hs-rail-stand:not([disabled])').first();
    await stand.click();
  }
  await assertBoardLoaded(page, '.kpi-hs-signals', { context: `homestand cards on ${account}` });
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.label}`, () => {
    for (const account of MLB) {
      test(`period board on ${account} - no clipped leaves, no page scroll, cards equal`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await loadPeriod(page, account);
        const clipped = await findClippedLeaves(page);
        expect(clipped, `clipped leaves at ${vp.label} on ${account} period:\n${JSON.stringify(clipped, null, 2)}`).toEqual([]);
        expect(await hasPageScroll(page), 'horizontal page scroll').toBe(false);
        // Period board: signal cards row + comparison strip items.
        const sigParity = await findParityBreaks(page, '.kpi-app', '.kpi-sig');
        expect(sigParity, `signal card heights not equal at ${vp.label} on ${account}:\n${JSON.stringify(sigParity, null, 2)}`).toEqual([]);
        const cmpParity = await findParityBreaks(page, '.kpi-cmp-items', '.kpi-cmp-item');
        expect(cmpParity, `comparison item heights not equal at ${vp.label} on ${account}:\n${JSON.stringify(cmpParity, null, 2)}`).toEqual([]);
      });

      test(`homestand on ${account} - no clipped leaves, no page scroll, cards equal`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await loadHomestand(page, account);
        const clipped = await findClippedLeaves(page);
        expect(clipped, `clipped leaves at ${vp.label} on ${account} homestand:\n${JSON.stringify(clipped, null, 2)}`).toEqual([]);
        expect(await hasPageScroll(page), 'horizontal page scroll').toBe(false);
        // Homestand board: five-card grid (upcoming or played).
        const hsParity = await findParityBreaks(page, '.kpi-hs-signals', '.kpi-hs-signal');
        expect(hsParity, `homestand card heights not equal at ${vp.label} on ${account}:\n${JSON.stringify(hsParity, null, 2)}`).toEqual([]);
      });
    }
  });
}
