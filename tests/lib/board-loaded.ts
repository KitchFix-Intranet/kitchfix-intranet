// Shared board-loaded helper for every Playwright spec that navigates
// to /kpi/labor or /service-calendar.
//
// Owner ruling 2026-08-27. The 1280 viewport-clip spec was silently
// passing on the session-expired state box because its wait selector
// (`.kpi-sig, .kpi-statebox-body`) was satisfied by either the real
// board OR a state-box shell. Clip check ran on the state box, found
// nothing to clip, and reported all clear.
//
// The other specs in this repo do NOT have that OR-fallback vector;
// they wait for concrete board selectors and time out loudly when
// auth is stale. But their failure message is `Timeout of 30000ms
// waiting for .kpi-sig`, which does not name the root cause. Every
// spec has to rediscover that `tests/.auth/user.json` is stale.
//
// This helper races the concrete board selector against known
// auth-failure markers on both boards and throws with a message that
// names the fix. Every spec should use it as the first wait after
// `page.goto()`.
//
// Setup-time guard lives in `tests/auth.setup.ts` (file age > 25d
// fails at setup so tests never run against stale state in the first
// place). This helper is defense in depth for a session that expires
// mid-run.

import type { Page } from '@playwright/test';

// Auth-failure markers. If any of these render while we are waiting
// for the real board, the auth state is stale and the spec should
// fail immediately with the fix in the message.
//
// KPI labor board renders StateSessionExpired inside `.kpi-statebox`
// (src/app/kpi/labor/components/StateBoxes.js:181) - the state box
// title reads "Your session expired".
//
// Service calendar renders "Please sign in to access the Service
// Calendar." inside `.oh-app` when `status === "unauthenticated"`
// (src/app/service-calendar/page.js:81). No dedicated wrapper class -
// we match the text.
const AUTH_FAILURE_MARKERS = [
  { selector: '.kpi-statebox', label: 'KPI state box (likely session expired)' },
  { selector: 'text=Please sign in to access', label: 'SC unauthenticated screen' },
  { selector: 'text=Your session expired', label: 'session-expired panel' },
];

const DEFAULT_TIMEOUT_MS = 30_000;

export interface AssertBoardLoadedOpts {
  timeoutMs?: number;
  context?: string;
}

/**
 * Wait for the concrete board selector; fail loud with the auth
 * failure named in the message if a state box wins the race.
 *
 * @param page      Playwright Page
 * @param selector  Concrete board selector (`.kpi-sig`, `.kpi-hs-rail`,
 *                  `.kpi-tbl`, `.sc-closeout`, etc.). Must be the
 *                  element that only renders when the real board loaded.
 * @param opts.context   Short human label for the throw message
 *                       (e.g. `"period on STL - MO"`). Optional.
 * @param opts.timeoutMs Timeout in ms. Defaults to 30,000.
 */
export async function assertBoardLoaded(
  page: Page,
  selector: string,
  opts: AssertBoardLoadedOpts = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const context = opts.context ? `${opts.context}: ` : '';

  // Build a race: real board wins normally; any auth marker wins
  // when the session is stale. The first to become visible resolves;
  // if none resolve within the timeout, we throw a plain timeout.
  const boardPromise = page
    .locator(selector)
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => ({ kind: 'board' as const }));

  const markerPromises = AUTH_FAILURE_MARKERS.map(m =>
    page
      .locator(m.selector)
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .then(() => ({ kind: 'auth-failure' as const, label: m.label, selector: m.selector }))
      .catch(() => new Promise<never>(() => {})),   // never resolve on miss
  );

  const winner = await Promise.race([boardPromise, ...markerPromises]).catch(err => {
    throw new Error(`${context}timed out (${timeoutMs}ms) waiting for ${selector}. Original: ${err instanceof Error ? err.message : String(err)}`);
  });

  if (winner.kind === 'board') return;

  // Auth failure detected. Include the state title if we can pull
  // it - "Your session expired" makes the fix obvious.
  let title = '';
  try {
    title = (await page.locator(`${winner.selector} h3, ${winner.selector} .kpi-statebox-title`).first().textContent({ timeout: 500 })) || '';
  } catch { /* fall through */ }
  const titleFrag = title.trim() ? ` "${title.trim()}"` : '';
  throw new Error(
    `${context}expected board (${selector}) but rendered ${winner.label}${titleFrag}. ` +
    `Auth state is stale - refresh with:  npx playwright test tests/auth.setup.ts  (interactive Google login)`,
  );
}
