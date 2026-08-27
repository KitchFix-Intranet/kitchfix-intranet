// Homestand transition-stability probe. Kevin audit 2026-08-21:
//
//   "But during the fetch after clicking a stand, .kpi-hs-rail and
//    .kpi-hs-board BOTH unmount for about a second. The entire page
//    goes blank, then returns. Measured: sampling at 380ms after a
//    click catches three stands with no rail and no board at all.
//    That flash is the clunkiness."
//
//   "Probe: click each stand and assert .kpi-hs-rail is present
//    continuously through the transition, sampled at 100ms - not just
//    after settle. A settle-only assertion passes on a board that
//    blinks."
//
// This test drives a real click on a real stand in the homestand rail
// and samples DOM presence of `.kpi-hs-rail` every 100ms for ~1.5s.
// The API response is delayed via a Playwright route intercept so the
// transition window is observable (a fast dev server can resolve in
// under one sample tick otherwise, letting a regression pass silently).
//
// The route intercept only delays; the response body is passthrough
// so the intercepted response is real server truth. The probe is
// asserting a CLIENT behavior (that the rail stays mounted while
// loadState === "loading"), not shape of the response.

import { test, expect, type Page } from '@playwright/test';
import { assertBoardLoaded } from './lib/board-loaded';

const ACCOUNT = 'CIN - OH';
const FETCH_DELAY_MS = 800;

async function openHomestandView(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/kpi/labor?account=${encodeURIComponent(ACCOUNT)}&view=homestand`);
  await assertBoardLoaded(page, '.kpi-hs-rail', { context: `homestand on ${ACCOUNT}` });
  await page.waitForSelector('.kpi-hs-rail-stand:not([disabled])', { timeout: 15_000 });
}

// Delay every /api/kpi/labor response (after the first cold-load) by
// FETCH_DELAY_MS so the loading window is long enough to sample. The
// first fetch (cold page load) is NOT delayed so setup doesn't time
// out.
async function armSlowLaborApi(page: Page) {
  let seen = 0;
  await page.route('**/api/kpi/labor?**', async (route) => {
    seen += 1;
    if (seen > 1) await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
    await route.continue();
  });
}

// Sample a DOM selector's presence every 100ms for `durationMs`. Runs
// in the page context so timing is not perturbed by test-runner IPC.
// Returns { samples, absentCount, absentAt } where absentAt is the
// ms-offset from start of the first absent sample (null if none).
async function sampleSelectorPresence(page: Page, selector: string, durationMs: number) {
  return page.evaluate(async ({ sel, dur }) => {
    const start = performance.now();
    const marks: Array<{ t: number; present: boolean }> = [];
    while (performance.now() - start < dur) {
      const present = document.querySelector(sel) != null;
      marks.push({ t: performance.now() - start, present });
      await new Promise((r) => setTimeout(r, 100));
    }
    const absent = marks.filter((m) => !m.present);
    return {
      samples: marks.length,
      absentCount: absent.length,
      absentAt: absent.length ? absent[0].t : null,
      marks,
    };
  }, { sel: selector, dur: durationMs });
}

test.setTimeout(90_000);

test.describe('KPI homestand transition stability', () => {
  test.beforeEach(async ({ page }) => {
    await armSlowLaborApi(page);
    await openHomestandView(page);
  });

  test('rail stays mounted continuously through a stand-click transition', async ({ page }) => {
    const rail = page.locator('.kpi-hs-rail');
    await expect(rail).toBeVisible();

    // Pick a stand OTHER than whichever is currently selected (or the
    // first non-pre-floor stand if none is selected). Clicking the
    // already-selected stand does not fire a refetch.
    const stands = page.locator('.kpi-hs-rail-stand:not([disabled]):not(.on)');
    await expect(stands.first()).toBeVisible();
    const target = stands.first();
    const targetGameStart = await target.getAttribute('data-game-start');
    expect(targetGameStart).toBeTruthy();

    // Start sampling BEFORE clicking so we capture the moment the
    // fetch fires and the client transitions to loadState=loading.
    // 1500ms window covers the FETCH_DELAY_MS + settle + a margin.
    const samplerPromise = sampleSelectorPresence(page, '.kpi-hs-rail', 1500);
    await target.click();
    const result = await samplerPromise;

    // Diagnostic: dump the tick trace on failure so the mode is legible.
    if (result.absentCount > 0) {
      console.log(
        `[HS-TRANS] rail absent for ${result.absentCount}/${result.samples} sample(s), ` +
        `first absent at t=${result.absentAt}ms. Trace:\n` +
        result.marks
          .map((m) => `  t=${Math.round(m.t)}ms  ${m.present ? 'present' : 'ABSENT'}`)
          .join('\n')
      );
    }

    expect.soft(result.absentCount, '.kpi-hs-rail must be present at every 100ms sample through the transition').toBe(0);
    expect(result.samples).toBeGreaterThan(10); // sampler actually ran

    // After settle the URL must reflect the new stand, and the rail
    // is still there. This is the belt-and-suspenders end-state check
    // Kevin flagged as insufficient on its own.
    await page.waitForLoadState('networkidle');
    await expect(rail).toBeVisible();
    expect(page.url()).toContain(`homestand=${encodeURIComponent(targetGameStart!)}`);
  });

  test('stand-region skeleton appears during the pending transition', async ({ page }) => {
    // Complement to the rail-continuity assertion: while the fetch is
    // in flight and the URL has moved on from what data shows, the
    // stand region must render a skeleton (not the prior stand's
    // content, which would be lying, and not blank, which is the bug).
    const stands = page.locator('.kpi-hs-rail-stand:not([disabled]):not(.on)');
    const target = stands.first();

    const skelPromise = page.waitForSelector('[data-hs-skel]', { timeout: 1500 });
    await target.click();
    const skel = await skelPromise;
    expect(skel).toBeTruthy();
  });

  test('branch mutex holds through the transition (no double board)', async ({ page }) => {
    // Regression net for #754's PR-2 audit fix 6: only ONE board
    // subtree renders at any moment. Was previously fooled by the
    // period-view fall-through under source='daily'; now gated with
    // !inHomestandView, and this transition-stability change must
    // not resurrect that path either.
    const stands = page.locator('.kpi-hs-rail-stand:not([disabled]):not(.on)');
    const target = stands.first();

    const samplerPromise = page.evaluate(async () => {
      const start = performance.now();
      const marks: number[] = [];
      while (performance.now() - start < 1500) {
        const hsBoard = document.querySelectorAll('.kpi-hs-board').length;
        const dayRange = document.querySelectorAll('.kpi-day-range').length;
        const perBoard = document.querySelectorAll('.kpi-board:not(.kpi-board-skel)').length;
        marks.push(hsBoard + dayRange + perBoard);
        await new Promise((r) => setTimeout(r, 100));
      }
      return marks;
    });
    await target.click();
    const boardCounts = await samplerPromise;

    const overOne = boardCounts.filter((n) => n > 1);
    expect.soft(overOne.length, 'never more than one board subtree at once').toBe(0);
    expect(boardCounts.length).toBeGreaterThan(10);
  });
});
