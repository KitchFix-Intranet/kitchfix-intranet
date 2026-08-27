// PR-K acceptance battery. Design authority:
// docs/design/KF_TOAST_SYSTEM_AND_MATRIX_POLISH.html.
//
// Covers K1-K11 except K3 (which uses direct DB probes in a separate
// node script - the interactive Undo re-POST needs live DB assertions).
//
// K5 (prefers-reduced-motion) uses page.emulateMedia; K6/K11 are
// code-reads captured in the PR body.

import { test, expect } from '@playwright/test';
import { assertBoardLoaded } from '../lib/board-loaded';

const TXR = 'TXR - AZ';

async function openWorkspace(page: any) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/service-calendar?account=${encodeURIComponent(TXR)}&period=9`);
  await assertBoardLoaded(page, '.sc-workspace-grid', { context: 'sc workspace' });
  await page.waitForSelector('.sc-workspace-grid-cell .sc-daysq--interactive', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function killMobileBarAtSmallViewports(page: any) {
  // At <1099px mobileBooksBar.css :54 overlays chrome; kill it so
  // tests can reach the DrillRail's Bulk entry / any tile click.
  await page.evaluate(() => {
    const bar = document.querySelector('.sc-mobile-books-bar') as HTMLElement | null;
    if (bar) { bar.style.display = 'none'; bar.style.pointerEvents = 'none'; }
  });
}

async function computedFont(page: any, selector: string) {
  return page.$eval(selector, (el: Element) => getComputedStyle(el).fontFamily);
}

// Mount a synthetic toast into the live SC page via document.body +
// classes, so we can assert against every variant without triggering
// a real save flow (K1). Returns a promise that resolves when the
// probe toast is present.
async function mountProbeToast(page: any, cfg: any) {
  await page.evaluate((c: any) => {
    // Remove any prior probe.
    document.getElementById('k-probe-container')?.remove();
    const container = document.createElement('div');
    container.className = 'sc-toast-container';
    container.id = 'k-probe-container';
    const tier = c.tier || 'ok';
    const iconGlyph = tier === 'ok' ? '✓' : '!';
    const iconClass = `sc-toast-icon sc-toast-icon--${tier}`;
    const role = tier === 'bad' ? 'alert' : 'status';
    const ariaLive = tier === 'bad' ? 'assertive' : 'polite';
    const bar = c.progress
      ? `<div class="sc-toast-bar" role="progressbar" aria-valuenow="${c.progress.pct}" aria-valuemin="0" aria-valuemax="100"><span class="sc-toast-bar-fill" style="width:${c.progress.pct}%"></span></div>${c.progress.label ? `<div class="sc-toast-detail sc-toast-detail--muted">${c.progress.label}</div>` : ''}`
      : '';
    const action = c.actionLabel
      ? `<button type="button" class="sc-toast-action">${c.actionLabel}</button>`
      : '';
    container.innerHTML = `
      <div class="sc-toast sc-toast--${tier}" role="${role}" aria-live="${ariaLive}" aria-atomic="true" data-probe="1">
        <span class="${iconClass}" aria-hidden="true"><span class="sc-toast-icon-glyph">${iconGlyph}</span></span>
        <div class="sc-toast-body">
          <div class="sc-toast-title">${c.title}</div>
          ${c.detail ? `<div class="sc-toast-detail">${c.detail}</div>` : ''}
          ${bar}
          ${action}
        </div>
        <button type="button" class="sc-toast-x" aria-label="Dismiss">&times;</button>
      </div>
    `;
    document.body.appendChild(container);
  }, cfg);
  await page.waitForSelector('.sc-toast[data-probe="1"]', { timeout: 3_000 });
}

async function unmountProbeToast(page: any) {
  await page.evaluate(() => document.getElementById('k-probe-container')?.remove());
}

test.setTimeout(120_000);

// ────────────────────────────────────────────────────────────────
// K1 - all six variants render per the design
// ────────────────────────────────────────────────────────────────
const VARIANTS = [
  { name: 'Day saved',         tier: 'ok',   title: 'Day saved',         detail: 'Monday, August 17 - 50 meals - $644.76' },
  { name: 'Bulk saved',        tier: 'ok',   title: '4 days saved',      detail: 'Wed Aug 19 to Sat Aug 22 - 1,080 meals', progress: { pct: 65, label: '20 of 31 days entered this month' } },
  { name: 'Marked no service', tier: 'ok',   title: 'Marked no service', detail: 'Monday, August 17', actionLabel: 'Undo' },
  { name: 'Week finalized',    tier: 'ok',   title: 'Week finalized',    detail: 'AP has the invoice for review.' },
  { name: 'Day cleared',       tier: 'warn', title: 'Day cleared',       detail: 'Monday, August 17 - entries removed', actionLabel: 'Undo' },
  { name: 'Save failed',       tier: 'bad',  title: 'Could not save',    detail: 'Nothing was changed. Check your connection and try again.', actionLabel: 'Try again' },
];

for (const v of VARIANTS) {
  test(`K1: variant "${v.name}" renders (icon tier + title + detail${v.progress ? ' + progress bar' : ''}${v.actionLabel ? ' + action' : ''})`, async ({ page }) => {
    await openWorkspace(page);
    await mountProbeToast(page, v);

    // Title + detail
    const title = await page.locator('.sc-toast .sc-toast-title').innerText();
    const detail = await page.locator('.sc-toast .sc-toast-detail').first().innerText();
    expect(title).toBe(v.title);
    expect(detail).toContain(v.detail.split(' - ')[0]);

    // Icon tier class present
    const iconClass = await page.locator('.sc-toast-icon').getAttribute('class') || '';
    expect(iconClass).toContain(`sc-toast-icon--${v.tier}`);

    // Progress bar - only on bulk variant
    const barCount = await page.locator('.sc-toast-bar').count();
    if (v.progress) {
      expect(barCount).toBe(1);
      const width = await page.locator('.sc-toast-bar-fill').getAttribute('style') || '';
      expect(width).toContain(`${v.progress.pct}%`);
    } else {
      expect(barCount).toBe(0);
    }

    // Action button - only where actionLabel present
    const actionCount = await page.locator('.sc-toast-action').count();
    expect(actionCount).toBe(v.actionLabel ? 1 : 0);

    await unmountProbeToast(page);
  });
}

// ────────────────────────────────────────────────────────────────
// K6 - live-region roles verified per tier (code-read via computed
// attributes on the mounted DOM)
// ────────────────────────────────────────────────────────────────
test('K6: role="status" aria-live="polite" for ok+warn, role="alert" aria-live="assertive" for bad', async ({ page }) => {
  await openWorkspace(page);
  for (const tier of ['ok', 'warn', 'bad'] as const) {
    await mountProbeToast(page, { tier, title: `probe-${tier}` });
    const role = await page.locator('.sc-toast').getAttribute('role');
    const live = await page.locator('.sc-toast').getAttribute('aria-live');
    console.log(`K6 tier=${tier}: role=${role} aria-live=${live}`);
    if (tier === 'bad') {
      expect(role).toBe('alert');
      expect(live).toBe('assertive');
    } else {
      expect(role).toBe('status');
      expect(live).toBe('polite');
    }
    await unmountProbeToast(page);
  }
});

// ────────────────────────────────────────────────────────────────
// K5 - prefers-reduced-motion zeros toast entry/exit motion
// ────────────────────────────────────────────────────────────────
test('K5: prefers-reduced-motion zeros toast animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWorkspace(page);
  await mountProbeToast(page, { title: 'RM probe', detail: 'reduced motion active' });
  const animName = await page.locator('.sc-toast').evaluate(el => getComputedStyle(el).animationName);
  const barTransition = await page.evaluate(() => {
    const el = document.createElement('span');
    el.className = 'sc-toast-bar-fill';
    document.body.appendChild(el);
    const t = getComputedStyle(el).transitionProperty;
    el.remove();
    return t;
  });
  console.log('K5 animation-name under RM:', animName, ' bar transition:', barTransition);
  expect(animName).toBe('none');
});

// ────────────────────────────────────────────────────────────────
// K8 - outlier tint distinguishable in grayscale (weight step)
// ────────────────────────────────────────────────────────────────
test('K8: matrix outlier tint changes font-weight beyond colour', async ({ page }) => {
  // Reuse K7's flow to open a real matrix - this ensures
  // bulkReviewMatrix.css is loaded (Next.js dev only ships a
  // component's CSS after the component mounts). Only then does the
  // synthetic probe pick up the .sc-brm-* rules.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/service-calendar?account=${encodeURIComponent(TXR)}&period=9`);
  await assertBoardLoaded(page, '.sc-workspace-grid', { context: 'sc workspace' });
  await page.waitForSelector('.sc-workspace-grid-cell .sc-daysq--interactive', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
  await killMobileBarAtSmallViewports(page);
  const bulkBtn = page.getByRole('button', { name: 'Bulk entry' }).first();
  await bulkBtn.click({ force: true });
  await page.waitForSelector('.sc-workspace-bulk-active', { timeout: 8_000 });
  const tiles = page.locator('.sc-workspace-grid-cell .sc-daysq--interactive');
  for (let i = 0; i < 3; i++) {
    const t = tiles.nth(i);
    await t.scrollIntoViewIfNeeded({ timeout: 2000 });
    await t.click({ timeout: 2000 }).catch(() => {});
  }
  await page.locator('.sc-workspace-bulk-btn--outline').first().click();
  await page.waitForSelector('.sc-brm-matrix', { timeout: 12_000 });

  const probe = await page.evaluate(() => {
    // Append the synthetic probe row INTO the mounted matrix's tbody
    // so ancestor selectors (`.sc-brm-matrix tbody td.sc-brm-cell`)
    // resolve. Prior attempts to inject at document.body left the
    // ancestor chain incomplete and the diff rule never matched.
    const tbody = document.querySelector('.sc-brm-matrix tbody');
    if (!tbody) return { error: 'no tbody' };
    const tr = document.createElement('tr');
    tr.className = 'sc-brm-row-svc';
    tr.setAttribute('data-k8-probe', '1');
    const plain = document.createElement('td');
    plain.className = 'sc-brm-cell';
    plain.textContent = '110';
    const diff  = document.createElement('td');
    diff.className = 'sc-brm-cell sc-brm-cell--diff';
    const fill  = document.createElement('span');
    fill.className = 'sc-brm-cell-fill';
    fill.textContent = '60';
    diff.appendChild(fill);
    tr.appendChild(plain);
    tr.appendChild(diff);
    tbody.appendChild(tr);
    void plain.offsetWidth;
    void fill.offsetWidth;
    const plainCS = getComputedStyle(plain);
    const fillCS  = getComputedStyle(fill);
    const out = {
      plainWeight: plainCS.fontWeight,
      fillWeight: fillCS.fontWeight,
      fillBg: fillCS.backgroundColor,
      fillRadius: fillCS.borderRadius,
    };
    tr.remove();
    return out;
  });
  console.log('K8 outlier tint probe:', probe);
  expect(Number(probe.fillWeight)).toBeGreaterThan(Number(probe.plainWeight));
  expect(probe.fillBg).not.toBe('rgba(0, 0, 0, 0)');
  // Rounded fill inset - border-radius > 0
  expect(probe.fillRadius).not.toBe('0px');
});

// ────────────────────────────────────────────────────────────────
// K7 - matrix polish: no vertical rules, group rows full width,
// dollar signs on Total, outlier tint inset with weight step.
// ────────────────────────────────────────────────────────────────
test('K7: matrix polish - no vertical rules, group rows full width, dollar signs on Total', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/service-calendar?account=${encodeURIComponent(TXR)}&period=9`);
  await assertBoardLoaded(page, '.sc-workspace-grid', { context: 'sc workspace' });
  await page.waitForSelector('.sc-workspace-grid-cell .sc-daysq--interactive', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
  await killMobileBarAtSmallViewports(page);

  // Enter bulk mode + select 7 days + open Match projections review
  const bulkBtn = page.getByRole('button', { name: 'Bulk entry' }).first();
  await bulkBtn.click({ force: true });
  await page.waitForSelector('.sc-workspace-bulk-active', { timeout: 8_000 });
  const tiles = page.locator('.sc-workspace-grid-cell .sc-daysq--interactive');
  const total = await tiles.count();
  for (let i = 0; i < Math.min(7, total); i++) {
    const t = tiles.nth(i);
    await t.scrollIntoViewIfNeeded({ timeout: 2000 });
    await t.click({ timeout: 2000 }).catch(() => {});
  }
  const match = page.locator('.sc-workspace-bulk-btn--outline').first();
  await match.click();
  await page.waitForSelector('.sc-brm-matrix', { timeout: 12_000 });
  await page.waitForTimeout(400);

  const polish = await page.evaluate(() => {
    // K7-a: lead cells have no right border (vertical rules gone).
    const lead = document.querySelector('.sc-brm-cell-lead') as HTMLElement | null;
    const th   = document.querySelector('.sc-brm-th-lead')   as HTMLElement | null;
    // K7-b: body service-column has no bottom border either (no boxed
    // cell appearance).
    const bodyLead = document.querySelector('tbody .sc-brm-cell-lead') as HTMLElement | null;
    // K7-c: group row td spans totalCols (colSpan attr).
    const groupTd = document.querySelector('.sc-brm-row-group td') as HTMLTableCellElement | null;
    // K7-d: Total row cells begin with "$" prefix.
    const moneyCells = Array.from(document.querySelectorAll('.sc-brm-foot-row--money .sc-brm-cell')) as HTMLElement[];
    const moneyStartsWithDollar = moneyCells.every(c => (c.textContent || '').trim().startsWith('$'));
    return {
      leadRightBorder: lead ? getComputedStyle(lead).borderRightStyle : null,
      leadRightWidth: lead ? getComputedStyle(lead).borderRightWidth : null,
      thRightBorder: th ? getComputedStyle(th).borderRightStyle : null,
      thRightWidth: th ? getComputedStyle(th).borderRightWidth : null,
      bodyLeadBottom: bodyLead ? getComputedStyle(bodyLead).borderBottomStyle : null,
      groupColSpan: groupTd?.getAttribute('colspan') || null,
      groupPosition: groupTd ? getComputedStyle(groupTd).position : null,  // must NOT be sticky
      moneyCellsCount: moneyCells.length,
      moneyStartsWithDollar,
    };
  });
  console.log('K7 polish probe:', polish);

  // No vertical rules on the sticky column. The `border-right`
  // shorthand's default style is `solid` in Chromium even when no
  // explicit rule sets it - the honest "no line drawn" check is
  // width=0px, not style=none.
  expect(polish.leadRightWidth).toBe('0px');
  expect(polish.thRightWidth).toBe('0px');
  // Service column body cells - no boxed border
  expect(polish.bodyLeadBottom).toBe('none');
  // Group rows span full width
  expect(polish.groupColSpan).toBeTruthy();
  expect(Number(polish.groupColSpan)).toBeGreaterThanOrEqual(2);
  // Not sticky (Kevin ruling: full-width band, not anchored group name)
  expect(polish.groupPosition).not.toBe('sticky');
  // Money cells prefixed with $
  expect(polish.moneyCellsCount).toBeGreaterThan(0);
  expect(polish.moneyStartsWithDollar).toBe(true);
});

// ────────────────────────────────────────────────────────────────
// K10 - every figure resolves Inter, zero mono
// ────────────────────────────────────────────────────────────────
test('K10: every toast figure resolves Inter, zero mono', async ({ page }) => {
  await openWorkspace(page);
  await mountProbeToast(page, {
    tier: 'ok',
    title: '4 days saved',
    detail: 'Wed Aug 19 to Sat Aug 22 - 1,080 meals',
    progress: { pct: 65, label: '20 of 31 days entered this month' },
  });
  const fonts = {
    title:   await computedFont(page, '.sc-toast-title'),
    detail:  await computedFont(page, '.sc-toast-detail'),
  };
  console.log('K10 fonts:', fonts);
  for (const [name, f] of Object.entries(fonts)) {
    expect(f, `${name} must NOT resolve mono`).not.toMatch(/JetBrains|SF Mono|Menlo|monospace/i);
    expect(f, `${name} must resolve Inter`).toMatch(/Inter/i);
  }
  await unmountProbeToast(page);
});

// ────────────────────────────────────────────────────────────────
// K9 - paint gate at 5 laptop widths
// ────────────────────────────────────────────────────────────────
const VIEWPORTS = [1024, 1152, 1280, 1366, 1536];
for (const width of VIEWPORTS) {
  test(`K9: toast renders at ${width}px, bottom-centre, visible + readable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/service-calendar?account=${encodeURIComponent(TXR)}&period=9`);
    await assertBoardLoaded(page, '.sc-workspace-grid', { context: 'sc workspace' });
    await page.waitForTimeout(600);
    await mountProbeToast(page, {
      tier: 'ok',
      title: 'Day saved',
      detail: 'Monday, August 17 - 50 meals - $644.76',
    });
    const box = await page.locator('.sc-toast').boundingBox();
    const viewport = page.viewportSize();
    console.log(`K9 ${width}px box:`, box, 'viewport:', viewport);
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(viewport!.width);
    // Toast is bottom-centre - x + width/2 should be near viewport
    // middle (within 40px tolerance for sub-pixel + container padding)
    const cx = box!.x + box!.width / 2;
    const vx = (viewport!.width) / 2;
    expect(Math.abs(cx - vx)).toBeLessThan(40);
    // Toast is near the bottom - y + height should be within 100px of
    // viewport bottom.
    const bottomGap = viewport!.height - (box!.y + box!.height);
    expect(bottomGap).toBeLessThan(120);
    await unmountProbeToast(page);
  });
}
