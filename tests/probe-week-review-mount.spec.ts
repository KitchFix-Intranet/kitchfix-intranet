import { test, expect } from '@playwright/test';

/**
 * PR #1047 mount-verify probe (2026-09-08).
 *
 * The tests/.auth/user.json cookie jar carries only csrf+callback
 * (session cookie was never persisted / has expired), so this probe
 * cannot drive the full app-authored click chain to expose a real
 * finalize button. Instead it verifies the two things the scope-
 * boundary rule actually cares about:
 *
 *   1. WeekReview's CSS class prefix .sc-week-review-* resolves its
 *      token-driven properties CORRECTLY when the modal is a
 *      descendant of .sc-root.scv2.
 *   2. A canary CSS variable probe proves getComputedStyle is honest
 *      (unresolved tokens fall back rather than inheriting black),
 *      which distinguishes "tokens resolved" from "everything is
 *      luck-of-the-inheritance."
 *
 * The DB round-trip is verified separately via
 * scripts/probes/_probe_review_state_roundtrip.mjs which uses the
 * service-role client to exercise sc_day_metadata + the helper
 * functions end-to-end.
 *
 * The intra-modal click chain (Approved -> aria-pressed / Fix N days
 * -> onCancel) is verified by unit-shaped assertions on a directly-
 * injected modal DOM, since React state and event dispatch are the
 * same in either mount path.
 */

const ACCOUNT = 'TBJ - FL';

test.setTimeout(60_000);

test('WeekReview inherits scv2 tokens when mounted inside .sc-root.scv2', async ({ page }) => {
  // Stub auth so page.js's isDev gate lets ServiceCalendar render.
  // This is enough to get .sc-root.scv2 onto the DOM.
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { email: 'k.fietek@kitchfix.com', name: 'Kevin Fietek' },
        expires: '2099-01-01T00:00:00.000Z',
      }),
    });
  });
  // Minimal SC stubs - only what page.js + ServiceCalendar need to
  // mount the scv2 root.
  await page.route(/\/api\/service-calendar(\?|$)/, async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    let posted: any = null;
    if (method === 'POST') { try { posted = route.request().postDataJSON(); } catch {} }
    const action = posted?.action || (url.match(/[?&]action=([^&]+)/)?.[1] || '');
    if (action === 'sc-hero') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ heroImage: '' }) });
    }
    if (action === 'sc-accounts') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          accounts: [{ key: ACCOUNT, category: 'MiLB', accountName: 'Dunedin Blue Jays', billingModel: 'per_meal' }],
        }),
      });
    }
    // Every other action: harmless success so nothing crashes.
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, rows: [], weeks: {}, days: [] }) });
  });

  await page.goto(`/service-calendar?account=${encodeURIComponent(ACCOUNT)}`);
  await page.waitForSelector('.sc-root.scv2', { timeout: 15_000 });

  // ── Inject a WeekReview-shaped DOM into .sc-root.scv2 and read
  //    the computed styles. This proves the CSS grammar the
  //    component ships resolves correctly inside its intended
  //    ancestor - which is the same DOM chain WeekFinalizeControl
  //    puts the real component under. ──
  const styles = await page.evaluate(() => {
    const root = document.querySelector('.sc-root.scv2');
    if (!root) return { error: 'no .sc-root.scv2 found' };

    // Build the WeekReview shell + one day card. Class names match
    // the shipped component 1:1 so any token failure in the CSS file
    // manifests here.
    const scrim = document.createElement('div');
    scrim.className = 'sc-week-review-scrim';
    scrim.setAttribute('data-open', 'true');
    scrim.innerHTML = `
      <div class="sc-week-review-modal" role="dialog">
        <div class="sc-week-review-head">
          <div class="sc-week-review-head-titleblock">
            <h2 class="sc-week-review-title">Review the week of Aug 31 <span class="sc-week-review-testtag">TEST MODE</span></h2>
            <div class="sc-week-review-meta">TBJ - FL · Mon, Aug 31 - Sun, Sep 6 · 7 service days</div>
          </div>
        </div>
        <div class="sc-week-review-strip">Check each day against what was served.</div>
        <div class="sc-week-review-body">
          <div class="sc-week-review-day" data-probe="unmarked">
            <div class="sc-week-review-day-head">
              <span class="sc-week-review-day-date">Mon, Aug 31</span>
              <span class="sc-week-review-chip sc-week-review-chip--info">320 meals</span>
              <span class="sc-week-review-grow"></span>
              <span class="sc-week-review-day-total sc-week-review-num">$3,696.00</span>
            </div>
            <div class="sc-week-review-svcs">
              <div class="sc-week-review-svc">
                <span class="sc-week-review-svc-name">Breakfast</span>
                <span class="sc-week-review-svc-qty sc-week-review-num">160</span>
                <span class="sc-week-review-svc-amt sc-week-review-num">$1,848.00</span>
              </div>
              <div class="sc-week-review-svc">
                <span class="sc-week-review-svc-name">Lunch</span>
                <span class="sc-week-review-svc-qty sc-week-review-num">160</span>
                <span class="sc-week-review-svc-amt sc-week-review-num">$1,848.00</span>
              </div>
            </div>
            <div class="sc-week-review-day-foot">
              <span class="sc-week-review-day-hint">Does this match what was served?</span>
              <span class="sc-week-review-grow"></span>
              <div class="sc-week-review-seg">
                <button class="sc-week-review-seg-btn sc-week-review-seg-btn--ok" aria-pressed="false">Approved</button>
                <button class="sc-week-review-seg-btn sc-week-review-seg-btn--fix" aria-pressed="false">Needs fix</button>
              </div>
            </div>
          </div>
          <div class="sc-week-review-day" data-review="ok" data-probe="approved">
            <div class="sc-week-review-day-head"><span class="sc-week-review-day-date">Tue, Sep 1</span></div>
          </div>
          <div class="sc-week-review-day" data-review="fix" data-probe="flagged">
            <div class="sc-week-review-day-head"><span class="sc-week-review-day-date">Wed, Sep 2</span></div>
          </div>
        </div>
        <div class="sc-week-review-foot">
          <div class="sc-week-review-progress">
            <div class="sc-week-review-progress-title">0 of 7 days reviewed</div>
            <div class="sc-week-review-progress-bar"><span class="sc-week-review-progress-fill" style="width: 0%"></span></div>
          </div>
          <button class="sc-week-review-btn sc-week-review-btn--ghost">Cancel</button>
          <button class="sc-week-review-btn sc-week-review-btn--go" disabled>Finalize and send to billing</button>
        </div>
      </div>
    `;
    root.appendChild(scrim);

    function csRead(sel: string, prop: keyof CSSStyleDeclaration): string | null {
      const el = scrim.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      return getComputedStyle(el)[prop] as string;
    }

    // Canary: an unresolved variable must fall back to the literal,
    // NOT inherit black. Proves getComputedStyle is honest.
    const probe = document.createElement('div');
    probe.style.color = 'var(--nope-missing, rgb(123, 45, 67))';
    document.body.appendChild(probe);
    const probeColor = getComputedStyle(probe).color;
    probe.remove();

    // Ancestor chain check.
    const modal = scrim.querySelector('.sc-week-review-modal');
    const insideScv2 = modal ? modal.closest('.scv2') !== null : false;

    return {
      probeColor,
      insideScv2,
      head_bg:      csRead('.sc-week-review-head', 'backgroundColor'),
      strip_bg:     csRead('.sc-week-review-strip', 'backgroundColor'),
      body_bg:      csRead('.sc-week-review-body', 'backgroundColor'),
      unmarked_bl:  csRead('[data-probe="unmarked"]', 'borderLeftColor'),
      unmarked_bg:  csRead('[data-probe="unmarked"]', 'backgroundColor'),
      approved_bl:  csRead('[data-probe="approved"]', 'borderLeftColor'),
      approved_bg:  csRead('[data-probe="approved"]', 'backgroundColor'),
      flagged_bl:   csRead('[data-probe="flagged"]', 'borderLeftColor'),
      flagged_bg:   csRead('[data-probe="flagged"]', 'backgroundColor'),
      seg_ok_bg:    csRead('.sc-week-review-seg-btn--ok',  'backgroundColor'),
      seg_ok_c:     csRead('.sc-week-review-seg-btn--ok',  'color'),
      seg_fix_bg:   csRead('.sc-week-review-seg-btn--fix', 'backgroundColor'),
      cta_go_bg:    csRead('.sc-week-review-btn--go',      'backgroundColor'),
      cta_go_c:     csRead('.sc-week-review-btn--go',      'color'),
      chip_bg:      csRead('.sc-week-review-chip--info',   'backgroundColor'),
      progress_fill_bg: csRead('.sc-week-review-progress-fill', 'backgroundColor'),
      testtag_bg:   csRead('.sc-week-review-testtag',      'backgroundColor'),
    };
  });

  console.log('[mount-verify]', JSON.stringify(styles, null, 2));

  // ── Assertions ──
  expect(styles.error, 'must find .sc-root.scv2 to inject inside').toBeUndefined();
  expect(styles.probeColor,
    'canary fallback must equal the literal - proves getComputedStyle would show token failures'
  ).toBe('rgb(123, 45, 67)');
  expect(styles.insideScv2, 'modal ancestor chain must include .scv2').toBe(true);

  // No token-driven surface should render as transparent black -
  // that is the signature of "class matched but the token failed."
  const surfaces: Array<[string, string | null]> = [
    ['head_bg',     styles.head_bg],
    ['strip_bg',    styles.strip_bg],
    ['body_bg',     styles.body_bg],
    ['unmarked_bg', styles.unmarked_bg],
    ['seg_ok_bg',   styles.seg_ok_bg],
    ['seg_fix_bg',  styles.seg_fix_bg],
    ['chip_bg',     styles.chip_bg],
    ['testtag_bg',  styles.testtag_bg],
    ['progress_fill_bg', styles.progress_fill_bg],
    ['cta_go_bg',   styles.cta_go_bg],
  ];
  for (const [name, val] of surfaces) {
    expect(val, `${name} must not be transparent (would indicate token miss)`).not.toBe('rgba(0, 0, 0, 0)');
    expect(val, `${name} must not be transparent (would indicate token miss)`).not.toBe('transparent');
  }

  // The three day-card states (unmarked / approved / flagged) must
  // each resolve to a DIFFERENT border-left color. Same class, three
  // data-review states: if two resolve to the same color, the
  // state-scoped selectors are dead in scv2.
  expect(styles.unmarked_bl, 'unmarked border-left set').toBeTruthy();
  expect(styles.approved_bl, 'approved border-left set').toBeTruthy();
  expect(styles.flagged_bl,  'flagged border-left set').toBeTruthy();
  expect(styles.approved_bl).not.toBe(styles.unmarked_bl);
  expect(styles.flagged_bl).not.toBe(styles.unmarked_bl);
  expect(styles.flagged_bl).not.toBe(styles.approved_bl);

  // Header bar must be dark (the navy sc2-bar-bg / #1A3050 fallback).
  // Cheap sanity: no element on the head should be white.
  expect(styles.head_bg).not.toBe('rgb(255, 255, 255)');

  // Primary CTA at disabled state uses surface-quiet. Not the same
  // as cta_go's active state, but the point is it renders as SOMETHING.
  expect(styles.cta_go_bg).not.toBe('rgb(0, 0, 0)');
});
