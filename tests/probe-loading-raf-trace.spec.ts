import { test, type Page } from '@playwright/test';

/**
 * PR (gate-fix) RAF trace probe (2026-09-08).
 *
 * Instruments requestAnimationFrame sampling to capture the sequence
 * of loading-treatment states visible on each of the five nav paths
 * Kevin named. Emits one line per RAF tick where the visible-
 * treatment set CHANGED, using the same trace vocabulary Chat-Claude
 * used on production:
 *
 *   pageSpinner  - page.js .oh-spinner (auth-loading full-page)
 *   skeleton     - SkeletonSurface (structural shimmer body)
 *   shimmer      - Ribbon .sc-skel-shimmer (per-stat bars)
 *   wsSkel       - PeriodWorkspace WorkspaceSkeleton
 *   selectPh     - AccountDropdown placeholder "Select..."
 *   pickPeriod   - "Pick a period from the Season grid" empty state
 *   dashStats    - "TODAY -" / "PERIOD -" dash placeholders in ribbon
 *   zeroEntered  - hero showing "$0.00 ENTERED" mid-load
 *   grid         - real day grid visible
 *   blank        - no known treatment + no grid
 *
 * The bad states this probe is watching for:
 *   dashStats | selectPh | pickPeriod | zeroEntered - the "wrong-real-value"
 *     empty states from Kevin's report. These indicate isAccountLoading
 *     gated on !!selectedAccount and returned false during the
 *     pre-URL-hydration window.
 *   shimmer + skeleton co-occurring - two skeleton treatments in
 *     different regions. Not a bug per se (same primitive), but the
 *     visual read that produced Chat-Claude's "two systems unaware of
 *     each other" finding.
 *
 * Stubs the SC APIs with realistic delays so the load window mirrors
 * production timing.
 */

const ACCOUNT_A = 'TBJ - FL';
const ACCOUNT_B = 'TBR - FL';

const DELAY_ACCOUNTS   = 120;
const DELAY_SC_LOAD    = 320;
const DELAY_YEAR_SUM   = 180;
const DELAY_FIN_STATES = 60;
const DELAY_HERO       = 20;

async function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function stubSC(page: Page) {
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        user: { email: 'k.fietek@kitchfix.com', name: 'Kevin Fietek' },
        expires: '2099-01-01T00:00:00.000Z',
      }),
    });
  });
  await page.route(/\/api\/service-calendar(\?|$)/, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    let posted: any = null;
    if (method === 'POST') { try { posted = req.postDataJSON(); } catch {} }
    const action = posted?.action || (url.match(/[?&]action=([^&]+)/)?.[1] || '');
    if (action === 'sc-hero') {
      await delay(DELAY_HERO);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ heroImage: '' }) });
    }
    if (action === 'sc-accounts') {
      await delay(DELAY_ACCOUNTS);
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          accounts: [
            { key: ACCOUNT_A, category: 'MiLB', accountName: 'Dunedin', billingModel: 'per_meal' },
            { key: ACCOUNT_B, category: 'MiLB', accountName: 'Tampa Bay', billingModel: 'per_meal' },
          ],
          defaultAccount: ACCOUNT_A,
          roles: ['floor'],
        }),
      });
    }
    if (action === 'sc-year-summary') {
      await delay(DELAY_YEAR_SUM);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, months: [], defaultAccount: ACCOUNT_A }) });
    }
    if (action === 'sc-load') {
      const acctMatch = url.match(/account=([^&]+)/);
      const acct = acctMatch ? decodeURIComponent(acctMatch[1]) : ACCOUNT_A;
      await delay(DELAY_SC_LOAD);
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          account: { key: acct, category: 'MiLB', billingModel: 'per_meal', name: acct },
          days: [],
          services: [],
          homestandMap: {},
          scheduleOverlay: null,
          periodRanges: [{ period: 'P9', start: '2026-08-31', end: '2026-09-27' }, { period: 'P10', start: '2026-09-28', end: '2026-10-25' }],
          periodMetrics: {},
          today: '2026-09-08',
        }),
      });
    }
    if (action === 'sc-finalize-states') {
      await delay(DELAY_FIN_STATES);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [], weeks: {}, cadence: 'weekly' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.route(/\/api\/ops(\?|$)/, async (route) => {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.route(/\/api\/dashboard(\?|$)/, async (route) => {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ heroImage: '' }) });
  });
}

// Sampler installed via addInitScript so it runs on EVERY page mount
// (survives client-side and hard navigation). Sampler resets its
// origin to performance.now() at install time; each navigation gets
// a fresh trace starting from 0.
const SAMPLER = `
(function() {
  if (window.__rafInstalled) return;
  window.__rafInstalled = true;
  window.__rafTrace = { samples: [], startedAt: performance.now() };
  var last = '';
  function scan() {
    var found = [];
    var spinners = document.querySelectorAll('.oh-spinner');
    for (var i = 0; i < spinners.length; i++) {
      var s = spinners[i];
      if (!s.closest('button, .oh-btn')) { found.push('pageSpinner'); break; }
    }
    if (document.querySelector('.sc-skel-surface')) found.push('skeleton');
    if (document.querySelector('.sc-ribbon-meta .sc-skel-shimmer, .sc-skel-bar-ribbon')) found.push('shimmer');
    if (document.querySelector('.sc-workspace-skel')) found.push('wsSkel');
    var textAll = (document.body && document.body.innerText) || '';
    if (/Select\\.\\.\\./.test(textAll)) found.push('selectPh');
    if (/Pick a period from the Season grid/.test(textAll)) found.push('pickPeriod');
    if (/TODAY\\s*-/.test(textAll) || /PERIOD\\s*-/.test(textAll)) found.push('dashStats');
    if (/\\\$0\\.00\\s+ENTERED/.test(textAll)) found.push('zeroEntered');
    if (document.querySelector('.sc-workspace-grid-row .sc-daysq, .sc-yeargrid-cell')) found.push('grid');
    var key = found.sort().join(',') || 'blank';
    if (key !== last) {
      window.__rafTrace.samples.push({
        t: Math.round(performance.now() - window.__rafTrace.startedAt),
        state: key === 'blank' ? [] : key.split(',')
      });
      last = key;
    }
    requestAnimationFrame(scan);
  }
  requestAnimationFrame(scan);
})();
`;

async function installSampler(page: Page) {
  await page.addInitScript({ content: SAMPLER });
}

async function resetSampler(page: Page) {
  // For within-a-single-navigation resets (used to isolate the trace
  // for a same-tab navigation like SPA route change).
  await page.evaluate(() => {
    if ((window as any).__rafTrace) {
      (window as any).__rafTrace.samples = [];
      (window as any).__rafTrace.startedAt = performance.now();
    }
  });
}

async function collectTrace(page: Page, label: string): Promise<string> {
  const trace = await page.evaluate(() => (window as any).__rafTrace || { samples: [] });
  const samples = trace.samples || [];
  const rows = samples.map((s: any) =>
    `  ${String(s.t).padStart(5)}ms  ${s.state.length === 0 ? '(blank)' : s.state.join(' | ')}`
  );
  return `[${label}]  ${samples.length} state changes\n${rows.join('\n')}`;
}

async function waitForSettle(page: Page, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const settled = await page.evaluate(() => {
      // Consider settled when: no oh-spinner + no skel-surface + no
      // shimmer bars AND the sc-root scv2 body is present. That's the
      // grid state.
      const spinner = document.querySelector('.oh-spinner:not(.oh-btn *)');
      const skel = document.querySelector('.sc-skel-surface');
      const ribShim = document.querySelector('.sc-ribbon-meta .sc-skel-shimmer, .sc-skel-bar-ribbon');
      const root = document.querySelector('.sc-root.scv2');
      return !spinner && !skel && !ribShim && !!root;
    }).catch(() => false);
    if (settled) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 250));
}

test.setTimeout(180_000);
test.describe.configure({ mode: 'serial' });

test('trace: hard-refresh cold mount', async ({ page }) => {
  await stubSC(page);
  await installSampler(page);
  await page.goto('/service-calendar');
  await waitForSettle(page);
  console.log('\n' + await collectTrace(page, 'HARD REFRESH') + '\n');
});

test('trace: Ops -> SC', async ({ page }) => {
  await stubSC(page);
  await installSampler(page);
  await page.goto('/ops');
  await page.waitForTimeout(300);
  // /service-calendar goto fires the sampler afresh via addInitScript.
  await page.goto('/service-calendar');
  await waitForSettle(page);
  console.log('\n' + await collectTrace(page, 'OPS -> SC') + '\n');
});

test('trace: SC -> Ops', async ({ page }) => {
  await stubSC(page);
  await installSampler(page);
  await page.goto('/service-calendar');
  await waitForSettle(page);
  await page.goto('/ops');
  await page.waitForTimeout(1200);
  console.log('\n' + await collectTrace(page, 'SC -> OPS') + '\n');
});

test('trace: period switch (client-side, via router.replace)', async ({ page }) => {
  await stubSC(page);
  await installSampler(page);
  await page.goto(`/service-calendar?account=${encodeURIComponent(ACCOUNT_A)}&period=9`);
  await waitForSettle(page);
  await resetSampler(page);
  // In-page URL update (mimics the PeriodHeaderNav stepper's
  // router.replace call). page.goto would be a hard-refresh
  // equivalent; we specifically want the client-side path.
  const nextBtn = page.locator('button[aria-label="Next period"]');
  if (await nextBtn.count() > 0 && await nextBtn.isEnabled()) {
    await nextBtn.click();
  } else {
    // Fallback: dispatch a client-side URL change directly.
    await page.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('period', '10');
      window.history.replaceState({}, '', url.toString());
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
  }
  await waitForSettle(page);
  console.log('\n' + await collectTrace(page, 'PERIOD SWITCH') + '\n');
});

test('trace: account switch (client-side, via dropdown click)', async ({ page }) => {
  await stubSC(page);
  await installSampler(page);
  await page.goto(`/service-calendar?account=${encodeURIComponent(ACCOUNT_A)}`);
  await waitForSettle(page);
  await resetSampler(page);
  // Open the AccountDropdown, click the other account. This is the
  // real click path production users take.
  const trigger = page.locator('.sc-dropdown-trigger');
  if (await trigger.count() > 0) {
    await trigger.first().click();
    const item = page.locator(`.sc-dropdown-item:has-text("${ACCOUNT_B}")`);
    await item.first().click();
  } else {
    // Fallback: same PopState trick as period-switch.
    await page.evaluate((acct) => {
      const url = new URL(window.location.href);
      url.searchParams.set('account', acct);
      window.history.replaceState({}, '', url.toString());
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, ACCOUNT_B);
  }
  await waitForSettle(page);
  console.log('\n' + await collectTrace(page, 'ACCOUNT SWITCH') + '\n');
});
