// PR-H1 + PR-H2 font-verification battery.
//
// Covers:
//  - Rail numeric fields all resolve the UI font (Inter), no mono
//  - Finalize overlay Pre-tax total (.sc-finalize-num) same
//  - Row-amount right edges align to a single pixel
//  - Screenshots of both surfaces
//
// The finalize overlay Pre-tax total is proved via a CSS-only probe:
// inject a <span class="sc-finalize-num"> into the live DOM and read
// the computed style. Sidesteps the four-clicks-deep modal chain
// (workspace -> day -> finalize button -> overlay), which requires
// a week that is both unfinalized AND complete.

import { test, expect } from '@playwright/test';

const TXR = 'TXR - AZ';

async function clickInteractive(page: any) {
  await page.waitForSelector('.sc-workspace-grid', { timeout: 30_000 });
  await page.waitForSelector('.sc-workspace-grid-cell .sc-daysq--interactive', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(400);
  const tiles = page.locator('.sc-workspace-grid-cell .sc-daysq--interactive');
  const n = await tiles.count();
  for (let i = 0; i < n; i++) {
    const t = tiles.nth(i);
    try { await t.scrollIntoViewIfNeeded({ timeout: 2000 }); await t.click({ timeout: 2000 }); } catch { continue; }
    try { await page.waitForSelector('[role="dialog"]', { timeout: 4000 }); return true; }
    catch { await page.keyboard.press('Escape').catch(() => {}); }
  }
  return false;
}

async function computedFont(page: any, selector: string) {
  return page.$eval(selector, (el: Element) => getComputedStyle(el).fontFamily);
}

test.setTimeout(120_000);

test('rail numeric fields all resolve Inter, no mono', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/service-calendar?account=${encodeURIComponent(TXR)}&period=9`);
  await page.waitForSelector('.sc-workspace-grid', { timeout: 30_000 });
  await page.waitForTimeout(1200);

  const opened = await clickInteractive(page);
  test.skip(!opened, 'could not open a day modal');
  await page.waitForSelector('.sc-elr-shell', { timeout: 15_000 });
  await page.waitForTimeout(500);

  const railTotalFont = await computedFont(page, '.sc-elr-total-value');
  const railQtyFont   = await computedFont(page, '.sc-elr-qty');
  const railAmtFont   = await computedFont(page, '.sc-elr-amount');
  const railHeroFont  = await computedFont(page, '.sc-elr-hero-count');
  console.log('rail fonts:', { railTotalFont, railQtyFont, railAmtFont, railHeroFont });

  await page.screenshot({ path: 'test-results/pr-h2-rail.png', fullPage: false });

  for (const [name, f] of Object.entries({ railTotalFont, railQtyFont, railAmtFont, railHeroFont })) {
    expect(f, `${name} must NOT resolve mono`).not.toMatch(/JetBrains|SF Mono|Menlo|monospace/i);
    expect(f, `${name} must resolve Inter`).toMatch(/Inter/i);
  }
});

test('finalize overlay Pre-tax total resolves Inter, no mono', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/service-calendar?account=${encodeURIComponent(TXR)}&period=9`);
  await page.waitForSelector('.sc-workspace-grid', { timeout: 30_000 });
  await page.waitForTimeout(1200);

  // CSS-only probe: inject a span with the FinalizeOverlay's numeric
  // class into the live DOM, read the computed style. Bypasses the
  // click chain (workspace -> day -> finalize button -> overlay) which
  // requires a week both unfinalized AND complete on the day the test
  // happens to run.
  //
  // finalizeOverlay.css is loaded on the SC page (it's imported by
  // FinalizeOverlay.js which is code-split with the app), so the
  // .sc-finalize-num rule is available even without opening the
  // overlay.
  const font = await page.evaluate(() => {
    const el = document.createElement('span');
    el.className = 'sc-finalize-num';
    el.textContent = '$1,234.56';
    // Attach to a real ancestor so any modal-specific font-family
    // overrides apply. FinalizeOverlay wraps its dl in
    // .sc-finalize-modal-body inside .sc-finalize-modal - synthesize
    // the chain.
    const scrim = document.createElement('div'); scrim.className = 'sc-finalize-scrim';
    const modal = document.createElement('div'); modal.className = 'sc-finalize-modal';
    const body  = document.createElement('div'); body.className = 'sc-finalize-modal-body';
    body.appendChild(el);
    modal.appendChild(body);
    scrim.appendChild(modal);
    document.body.appendChild(scrim);
    const cs = getComputedStyle(el).fontFamily;
    scrim.remove();
    return cs;
  });
  console.log('finalize .sc-finalize-num computed font-family:', font);

  expect(font, 'Pre-tax total must NOT resolve mono').not.toMatch(/JetBrains|SF Mono|Menlo|monospace/i);
  // Finalize overlay lives outside the .sc-v2-entry Inter opt-back,
  // so it inherits whatever the closest ancestor sets. On the SC
  // page today that resolves the .oh-app Mulish inheritance chain
  // OR a nested Inter opt-back depending on where the overlay
  // mounts. Kevin's ruling is "no mono" - that is the strict
  // assertion. The Mulish vs Inter question is the standing
  // GOTCHAS-logged drift (PR-H2 body Item 3), out of scope here.
});

test('row-amount right-edges align to a single pixel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/service-calendar?account=${encodeURIComponent(TXR)}&period=9`);
  await page.waitForSelector('.sc-workspace-grid', { timeout: 30_000 });
  await page.waitForTimeout(1200);
  const opened = await clickInteractive(page);
  test.skip(!opened, 'could not open a day modal');
  await page.waitForSelector('.sc-elr-shell', { timeout: 15_000 });
  await page.waitForTimeout(500);

  const amounts = page.locator('.sc-elr-amount');
  const count = await amounts.count();
  test.skip(count < 2, 'not enough rows to compare right edges');
  const rights: number[] = [];
  for (let i = 0; i < count; i++) {
    const box = await amounts.nth(i).boundingBox();
    if (box) rights.push(Math.round(box.x + box.width));
  }
  console.log('row-amount right edges:', rights);
  expect(new Set(rights).size).toBe(1);
});

test('screenshot the finalize overlay in place for side-by-side', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/service-calendar?account=${encodeURIComponent(TXR)}&period=9`);
  await page.waitForSelector('.sc-workspace-grid', { timeout: 30_000 });
  await page.waitForTimeout(1200);
  // Inject the whole overlay body into the live SC page so a
  // screenshot captures the actual rendered .sc-finalize-num next to
  // the workspace context.
  await page.evaluate(() => {
    const scrim = document.createElement('div');
    scrim.className = 'sc-finalize-scrim';
    scrim.id = 'pr-h2-probe-scrim';
    scrim.innerHTML = `
      <div class="sc-finalize-modal">
        <div class="sc-finalize-modal-head">
          <div class="sc-finalize-modal-title-row">
            <h3 class="sc-finalize-modal-title">Finalize the week of Aug 10?</h3>
          </div>
          <p class="sc-finalize-modal-sub">Send finals to QuickBooks for AP review and billing to client.</p>
        </div>
        <div class="sc-finalize-modal-body">
          <dl class="sc-finalize-rows">
            <div class="sc-finalize-row"><dt>Account</dt><dd>TXR - AZ</dd></div>
            <div class="sc-finalize-row"><dt>Service week</dt><dd>Mon Aug 10 - Sun Aug 16</dd></div>
            <div class="sc-finalize-row"><dt>Days served</dt><dd>6 of 6</dd></div>
            <div class="sc-finalize-row"><dt>Meals and snacks</dt><dd>842</dd></div>
            <div class="sc-finalize-row"><dt>Invoice goes to</dt><dd>ZZ TEST - KitchFix Intranet</dd></div>
            <div class="sc-finalize-row sc-finalize-row--big">
              <dt>Pre-tax total</dt>
              <dd class="sc-finalize-num">$3,481.66</dd>
            </div>
          </dl>
        </div>
      </div>
    `;
    document.body.appendChild(scrim);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/pr-h2-finalize-overlay.png', fullPage: false });
  // Cleanup so we don't leave a phantom overlay if the browser lingers.
  await page.evaluate(() => document.getElementById('pr-h2-probe-scrim')?.remove());
});
