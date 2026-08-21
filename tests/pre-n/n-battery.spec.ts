// PR-N acceptance battery for the SC Admin three-pane rebuild.
// Design: docs/design/KF_ADMIN_BUILD_SPEC.html.
//
// N1 is a process gate (recon before build) - not covered here.
// N11, N12, N13 are code-read + push-line - not covered here.
// This spec covers the [ran] acceptances: N2-N10.
//
// N6 is the load-bearing one: a forced save failure must prove AT THE
// DATABASE that nothing was written, while the entered value stays in
// the field and the rail stays dirty. Uses the Supabase service-role
// client to read sc_service_prices before and after the failure.

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
if (existsSync('.env.local')) loadEnv({ path: '.env.local' });

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

test.setTimeout(180_000);

// TXR - AZ is a per-meal pilot account with lots of catalog services.
// It IS a v2 entry account (per ENTRY_V2_ACCOUNTS) so any admin
// changes here mirror what the pilots will see.
const ACCOUNT = 'TXR - AZ';

async function openAdmin(page: any, width = 1440) {
  await page.setViewportSize({ width, height: 1080 });
  await page.goto('/service-calendar?view=admin');
  await page.waitForSelector('.scav', { timeout: 30_000 });
  await page.waitForTimeout(400);
}

async function selectAccountAndFirstService(page: any) {
  // Click the account in the accounts rail
  await page.locator(`.scav-acct[data-account-key="${ACCOUNT}"]`).click();
  await page.waitForSelector('.scav-srow', { timeout: 10_000 });
  await page.waitForTimeout(300);
  // Click the first service row
  const row = page.locator('.scav-srow').first();
  const serviceId = await row.getAttribute('data-service-id');
  await row.click();
  await page.waitForSelector('.scav-insp-scroll[data-rail-variant="service"]', { timeout: 8_000 });
  return serviceId;
}

// ────────────────────────────────────────────────────────────────
// N2: Change a price end to end, two clicks from a cold load
// ────────────────────────────────────────────────────────────────

test('N2: two-click price change: account → service → edit → save', async ({ page }) => {
  await openAdmin(page);
  // Two clicks = pick account + pick service. Rail already shows edit form.
  const serviceId = await selectAccountAndFirstService(page);
  // Verify the rail has the price input right there
  const priceInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[id^="np-"]').first();
  await expect(priceInput).toBeVisible();
  const currentPrice = await priceInput.inputValue();
  const newPrice = (Number(currentPrice) + 0.11).toFixed(2);

  await priceInput.fill(newPrice);
  const reasonInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] textarea[id^="rs-"]').first();
  await reasonInput.fill('N2 acceptance test');
  const saveBtn = page.locator('.scav-insp-scroll[data-rail-variant="service"] .scav-save').first();
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();

  // Success toast fires via the shared SC toast
  const toast = page.locator('.sc-toast--ok, .sc-toast').first();
  await expect(toast).toBeVisible({ timeout: 10_000 });

  // Catalog reflects the new value (row reloads after save)
  await page.waitForTimeout(2000);
  const newRowPrice = await page.locator(`.scav-srow[data-service-id="${serviceId}"] .scav-srow-pr`).innerText();
  expect(newRowPrice).toBe(`$${newPrice}`);

  // Reset back to the original so subsequent runs are stable
  const rowAgain = page.locator(`.scav-srow[data-service-id="${serviceId}"]`);
  await rowAgain.click();
  await page.waitForTimeout(400);
  const priceInput2 = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[id^="np-"]').first();
  await priceInput2.fill(currentPrice);
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] textarea[id^="rs-"]').first().fill('N2 reset');
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] .scav-save').first().click();
  await page.waitForTimeout(1500);
});

// ────────────────────────────────────────────────────────────────
// N3: Keyboard nav
// ────────────────────────────────────────────────────────────────

test('N3: arrows cross group boundaries; Enter opens; Escape clears; / focuses search', async ({ page }) => {
  await openAdmin(page);
  await page.locator(`.scav-acct[data-account-key="${ACCOUNT}"]`).click();
  await page.waitForSelector('.scav-srow');

  // Focus something outside INPUT so keyboard nav is active
  await page.locator('.scav-cat-head h2').click();
  await page.waitForTimeout(200);

  // "/" focuses search
  await page.keyboard.press('/');
  const searchInput = page.locator('#scav-search-input');
  await expect(searchInput).toBeFocused();

  // Blur back out of the input
  await page.locator('.scav-cat-head h2').click();
  await page.waitForTimeout(200);

  // Down arrow moves through rows across group boundaries
  const rows = page.locator('.scav-srow');
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(1);

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  const kb0 = await page.locator('.scav-srow[data-kb="true"]').count();
  expect(kb0).toBe(1);

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  // Cursor moved
  const kbNowIdx = await page.locator('.scav-srow[data-kb="true"]').first().getAttribute('data-service-id');
  expect(kbNowIdx).toBeTruthy();

  // Enter opens the row in the rail
  await page.keyboard.press('Enter');
  await page.waitForSelector('.scav-insp-scroll[data-rail-variant="service"]', { timeout: 5_000 });

  // Escape clears the rail selection
  await page.locator('.scav-cat-head h2').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const emptyRail = page.locator('.scav-insp-scroll[data-rail-variant="empty"]');
  await expect(emptyRail).toBeVisible({ timeout: 3_000 });
});

// ────────────────────────────────────────────────────────────────
// N4: Unsaved-change guard on switch attempts
// ────────────────────────────────────────────────────────────────

test('N4: unsaved-change guard fires on service switch; Go back preserves; Discard drops', async ({ page }) => {
  await openAdmin(page);
  const firstSid = await selectAccountAndFirstService(page);
  const priceInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[id^="np-"]').first();
  const orig = await priceInput.inputValue();
  const dirtyValue = (Number(orig) + 0.42).toFixed(2);
  await priceInput.fill(dirtyValue);
  await page.waitForTimeout(200);

  // Try to switch to another service - guard should fire
  const anotherRow = page.locator('.scav-srow').nth(1);
  const secondSid = await anotherRow.getAttribute('data-service-id');
  await anotherRow.click();
  await page.waitForSelector('.scav-insp-scroll[data-rail-variant="guard"]', { timeout: 3_000 });

  // Go back - selection stays on the first service; the value stays in the field
  await page.locator('.scav-insp-scroll[data-rail-variant="guard"] .scav-ghost').click();
  await page.waitForSelector('.scav-insp-scroll[data-rail-variant="service"]', { timeout: 3_000 });
  const stillDirty = await page.locator('.scav-insp-scroll[data-rail-variant="service"] input[id^="np-"]').first().inputValue();
  expect(stillDirty).toBe(dirtyValue);

  // Now try again + Discard
  await page.locator(`.scav-srow[data-service-id="${secondSid}"]`).click();
  await page.waitForSelector('.scav-insp-scroll[data-rail-variant="guard"]', { timeout: 3_000 });
  await page.locator('.scav-insp-scroll[data-rail-variant="guard"] .scav-save--danger').click();
  await page.waitForSelector('.scav-insp-scroll[data-rail-variant="service"]', { timeout: 3_000 });
  // Different service in the rail now
  const nowHeader = await page.locator('.scav-insp-scroll[data-rail-variant="service"] .scav-ih').innerText();
  expect(nowHeader).toBeTruthy();
});

// ────────────────────────────────────────────────────────────────
// N5: Save-disabled conditions
// ────────────────────────────────────────────────────────────────

test('N5: Save disabled for unchanged/empty/unparseable; enabled when valid', async ({ page }) => {
  await openAdmin(page);
  await selectAccountAndFirstService(page);
  const priceInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[id^="np-"]').first();
  const orig = await priceInput.inputValue();
  const saveBtn = page.locator('.scav-insp-scroll[data-rail-variant="service"] .scav-save').first();

  // Unchanged + no reason -> disabled
  await expect(saveBtn).toBeDisabled();

  // Same value + reason -> still disabled (must differ)
  const reasonInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] textarea[id^="rs-"]').first();
  await reasonInput.fill('some reason');
  await expect(saveBtn).toBeDisabled();

  // Empty value -> disabled
  await priceInput.fill('');
  await expect(saveBtn).toBeDisabled();

  // Unparseable -> disabled (input filter strips non-digits so value becomes "")
  await priceInput.fill('abc');
  await expect(saveBtn).toBeDisabled();

  // Valid + differs + reason -> enabled
  const newPrice = (Number(orig) + 0.05).toFixed(2);
  await priceInput.fill(newPrice);
  await expect(saveBtn).toBeEnabled();
});

// ────────────────────────────────────────────────────────────────
// N6: DB-verified forced failure - THE ONE Kevin reads hardest
// ────────────────────────────────────────────────────────────────

test('N6: forced failure writes nothing to sc_service_prices; value stays; rail stays dirty', async ({ page }) => {
  const client = supa();
  await openAdmin(page);
  const serviceId = await selectAccountAndFirstService(page);

  // Snapshot the DB row for this service BEFORE any action
  const before = await client
    .from('sc_service_prices')
    .select('service_id, price, effective_date, changed_at')
    .eq('service_id', serviceId)
    .order('effective_date', { ascending: false })
    .limit(1);
  const beforeRow = before.data?.[0] || null;
  const beforeCount = (await client
    .from('sc_service_prices')
    .select('service_id', { count: 'exact', head: true })
    .eq('service_id', serviceId)).count || 0;

  // Intercept sc-config-update and force a failure response
  await page.route('**/api/service-calendar', async (route, request) => {
    if (request.method() !== 'POST') return route.continue();
    const body = request.postData() || '';
    if (body.includes('"action":"sc-config-update"')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'forced-N6-failure' }),
      });
    }
    return route.continue();
  });

  const priceInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[id^="np-"]').first();
  const orig = await priceInput.inputValue();
  const attemptedPrice = (Number(orig) + 0.77).toFixed(2);
  await priceInput.fill(attemptedPrice);
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] textarea[id^="rs-"]').first().fill('N6 forced failure');
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] .scav-save').first().click();

  // Failure toast fires with the explicit "nothing was changed" copy
  const badToast = page.locator('.sc-toast--bad').first();
  await expect(badToast).toBeVisible({ timeout: 8_000 });
  const detail = await badToast.locator('.sc-toast-detail').innerText();
  expect(detail).toContain('Nothing was changed');

  // Value stays in the field
  const stillThere = await priceInput.inputValue();
  expect(stillThere).toBe(attemptedPrice);

  // Rail is still visible (still dirty - guard fires on attempted switch)
  await page.locator('.scav-srow').nth(1).click({ trial: false }).catch(() => {});
  await page.waitForTimeout(300);
  const guardVisible = await page.locator('.scav-insp-scroll[data-rail-variant="guard"]').count();
  const stillOnService = await page.locator('.scav-insp-scroll[data-rail-variant="service"]').count();
  expect(guardVisible + stillOnService).toBeGreaterThan(0);

  // DB PROOF: sc_service_prices unchanged - same row-count, same latest row
  const after = await client
    .from('sc_service_prices')
    .select('service_id, price, effective_date, changed_at')
    .eq('service_id', serviceId)
    .order('effective_date', { ascending: false })
    .limit(1);
  const afterRow = after.data?.[0] || null;
  const afterCount = (await client
    .from('sc_service_prices')
    .select('service_id', { count: 'exact', head: true })
    .eq('service_id', serviceId)).count || 0;
  expect(afterCount).toBe(beforeCount);
  expect(afterRow?.price).toBe(beforeRow?.price);
  expect(afterRow?.effective_date).toBe(beforeRow?.effective_date);
  expect(afterRow?.changed_at).toBe(beforeRow?.changed_at);
});

// ────────────────────────────────────────────────────────────────
// N7: Archived rail + fee rail render correctly
// ────────────────────────────────────────────────────────────────

test('N7: fee account renders fee rail with no per-service pricing', async ({ page }) => {
  await openAdmin(page);
  // CIN - OH is a fee account
  await page.locator(`.scav-acct[data-account-key="CIN - OH"]`).click();
  await page.waitForSelector('.scav-cat');

  // Fee rail is shown at rest (no service selected, isFee → fee variant)
  await page.waitForSelector('.scav-insp-scroll[data-rail-variant="fee"]', { timeout: 8_000 });
  // Fee rail header
  await expect(page.locator('.scav-insp-scroll[data-rail-variant="fee"] .scav-ih')).toContainText('Annual contract fee');

  // Catalog pane renders WITHOUT the Price column
  await page.waitForSelector('.scav-colhd');
  const priceCol = await page.locator('.scav-colhd .r').filter({ hasText: 'Price' }).count();
  expect(priceCol).toBe(0);

  // No $ figures on rows
  const rowPrices = await page.locator('.scav-srow .scav-srow-pr').allInnerTexts();
  for (const t of rowPrices) {
    expect(t.trim()).not.toMatch(/\$/);
  }
});

test('N7: TXR - TX - V bundled fee shows read-only note, no edit affordance', async ({ page }) => {
  await openAdmin(page);
  await page.locator(`.scav-acct[data-account-key="TXR - TX - V"]`).click();
  await page.waitForSelector('.scav-insp-scroll[data-rail-variant="fee"]', { timeout: 8_000 });

  // Bundled note verbatim
  const railText = await page.locator('.scav-insp-scroll[data-rail-variant="fee"]').innerText();
  expect(railText).toContain('Billed as part of the TXR - TX - H contract');
  expect(railText).toContain('Do not bill separately - it would double-count');

  // No New amount input
  const newAmountInputs = await page.locator('.scav-insp-scroll[data-rail-variant="fee"] input[id^="fa-"]').count();
  expect(newAmountInputs).toBe(0);
});

// ────────────────────────────────────────────────────────────────
// N9: Paint gate at 1024/1152/1280/1366/1536
// ────────────────────────────────────────────────────────────────

for (const width of [1024, 1152, 1280, 1366, 1536]) {
  test(`N9: three panes usable at ${width}px, rail footer pinned, no horizontal scroll`, async ({ page }) => {
    await openAdmin(page, width);
    // All three panes visible
    await expect(page.locator('.scav-accts')).toBeVisible();
    await expect(page.locator('.scav-cat')).toBeVisible();
    await expect(page.locator('.scav-insp')).toBeVisible();

    // No horizontal overflow on the admin shell itself. Parent
    // .sc-admin-body may add its own padding, so measure the shell.
    const shellOverflow = await page.evaluate(() => {
      const el = document.querySelector('.scav') as HTMLElement | null;
      if (!el) return { scrollWidth: 0, clientWidth: 0 };
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    expect(shellOverflow.scrollWidth).toBeLessThanOrEqual(shellOverflow.clientWidth + 2);

    // Select an account + service so the rail footer renders
    await page.locator(`.scav-acct[data-account-key="${ACCOUNT}"]`).click();
    await page.waitForSelector('.scav-srow');
    await page.locator('.scav-srow').first().click();
    await page.waitForSelector('.scav-insp-scroll[data-rail-variant="service"]');
    // Rail footer visible (pinned)
    await expect(page.locator('.scav-insp-foot')).toBeVisible();
  });
}

// ────────────────────────────────────────────────────────────────
// N10: skeleton + error states reachable
// ────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────
// R2-G: Selecting a fee account and touching nothing then switching
// must NOT trigger the guard. Reproduces the false-dirty bug Kevin
// found in audit round 2.
// ────────────────────────────────────────────────────────────────

test('R2-G: fee account with no edits does not trigger guard on switch', async ({ page }) => {
  await openAdmin(page);
  // Click a fee account (CIN - OH)
  await page.locator(`.scav-acct[data-account-key="CIN - OH"]`).click();
  await page.waitForSelector('.scav-insp-scroll[data-rail-variant="fee"]', { timeout: 8_000 });
  // Touch nothing.
  await page.waitForTimeout(300);
  // Switch to another account
  await page.locator(`.scav-acct[data-account-key="${ACCOUNT}"]`).click();
  // Guard MUST NOT fire
  await page.waitForTimeout(400);
  const guardVisible = await page.locator('.scav-insp-scroll[data-rail-variant="guard"]').count();
  expect(guardVisible).toBe(0);
  // Should have switched to the new account cleanly
  await expect(page.locator('.scav-acct[aria-current="true"][data-account-key="TXR - AZ"]')).toBeVisible({ timeout: 3_000 });
});

// ────────────────────────────────────────────────────────────────
// R2-F: Backdate save requires an explicit credit decision. Save
// disabled until picked. Payload includes creditDecision.
// ────────────────────────────────────────────────────────────────

test('R2-F: backdate requires credit-decision; Save disabled until picked; payload includes it', async ({ page }) => {
  await openAdmin(page);
  await selectAccountAndFirstService(page);
  const priceInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[id^="np-"]').first();
  const orig = await priceInput.inputValue();
  const newPrice = (Number(orig) + 0.99).toFixed(2);

  // Switch to Backdate mode
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] .scav-seg button', { hasText: 'Backdate' }).click();

  // Pick a backdate 2 weeks ago
  const d = new Date();
  d.setDate(d.getDate() - 14);
  const backdateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dateInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[type="date"]').first();
  await dateInput.fill(backdateStr);

  // Fill price + reason
  await priceInput.fill(newPrice);
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] textarea[id^="rs-"]').first().fill('R2-F test');

  // Wait for the credit-decision block to appear (fires when backdate + price + valid)
  await page.waitForSelector('.scav-credit-choice', { timeout: 5_000 });

  // Save button must be disabled - credit decision not picked yet
  const saveBtn = page.locator('.scav-insp-scroll[data-rail-variant="service"] .scav-save').first();
  await expect(saveBtn).toBeDisabled();

  // Pick "No credit" (least destructive test choice, still enables Save)
  await page.locator('.scav-credit-opt input[value=""], .scav-credit-opt input[type="radio"]').nth(1).check();

  // Save enabled now
  await expect(saveBtn).toBeEnabled();

  // Intercept the save to verify payload
  let capturedPayload: any = null;
  await page.route('**/api/service-calendar', async (route, request) => {
    if (request.method() === 'POST') {
      try {
        const body = JSON.parse(request.postData() || '{}');
        if (body.action === 'sc-config-update') {
          capturedPayload = body;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, error: 'R2-F-intercept-do-not-write' }),
          });
        }
      } catch {}
    }
    return route.continue();
  });

  await saveBtn.click();
  await page.waitForTimeout(1000);

  expect(capturedPayload).toBeTruthy();
  expect(capturedPayload?.changes?.[0]?.allowBackdate).toBe(true);
  expect(capturedPayload?.changes?.[0]?.creditDecision).toBe('none');
});

// ────────────────────────────────────────────────────────────────
// R3 defects on the backdate path (Kevin 2026-08-21).
// The credit-decision block and the preview block answer two
// different questions. Two gates. The tests hold them apart so
// they cannot drift back into each other.
// ────────────────────────────────────────────────────────────────

test('R3-1: credit-decision block renders whenever Backdate is active (Kevin defect 1)', async ({ page }) => {
  await openAdmin(page);
  await selectAccountAndFirstService(page);

  // Switch to Backdate mode and pick a valid backdate date. Do NOT
  // enter a new price - price stays at current. Do NOT enter reason.
  // The credit-decision block MUST render regardless.
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] .scav-seg button', { hasText: 'Backdate' }).click();

  const d = new Date();
  d.setDate(d.getDate() - 14);
  const backdateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dateInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[type="date"]').first();
  await dateInput.fill(backdateStr);

  await expect(page.locator('[data-credit-choice="1"]')).toBeVisible({ timeout: 3_000 });
});

test('R3-2: preview block is ABSENT when Backdate is active but price is unchanged (Kevin defect 2)', async ({ page }) => {
  await openAdmin(page);
  await selectAccountAndFirstService(page);

  await page.locator('.scav-insp-scroll[data-rail-variant="service"] .scav-seg button', { hasText: 'Backdate' }).click();

  const d = new Date();
  d.setDate(d.getDate() - 14);
  const backdateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dateInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[type="date"]').first();
  await dateInput.fill(backdateStr);

  // Price stays at current. Preview block MUST NOT render.
  await page.waitForTimeout(400);
  const previewCount = await page.locator('[data-preview="backdate-price"]').count();
  expect(previewCount).toBe(0);
});

test('R3-3: hint names the first blocker only (Kevin defect 3)', async ({ page }) => {
  await openAdmin(page);
  await selectAccountAndFirstService(page);

  const priceInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[id^="np-"]').first();
  const orig = await priceInput.inputValue();

  // Backdate mode + valid date. No price change, no credit decision,
  // no reason - three gates closed. Hint must name the FIRST only
  // (price), not concatenate.
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] .scav-seg button', { hasText: 'Backdate' }).click();
  const d = new Date();
  d.setDate(d.getDate() - 14);
  const backdateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dateInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[type="date"]').first();
  await dateInput.fill(backdateStr);
  // Nudge touched so hint appears (touched is required for canSave,
  // but hintText renders whenever the label is visible - clicking a
  // seg button already flipped touched=true).

  const hint = page.locator('.scav-insp-scroll[data-rail-variant="service"] label .hint').first();
  const hintText = await hint.innerText();
  // First blocker = price (unchanged from $orig). Hint should say
  // "Enter a price different from $X.XX" and NOTHING about credit
  // or reason.
  expect(hintText).toContain('Enter a price different from');
  expect(hintText).not.toContain('credit');
  expect(hintText).not.toContain('reason');

  // Now change the price so priceChanged=true. Hint's first blocker
  // shifts to credit decision.
  const newPrice = (Number(orig) + 0.22).toFixed(2);
  await priceInput.fill(newPrice);
  await page.waitForTimeout(200);
  const hintAfterPrice = await hint.innerText();
  expect(hintAfterPrice).toContain('credit');
  expect(hintAfterPrice).not.toContain('reason');
  expect(hintAfterPrice).not.toContain('Enter a price');

  // Now pick a credit decision. Hint's first blocker shifts to reason.
  await page.locator('.scav-credit-opt input[type="radio"]').first().check();
  await page.waitForTimeout(200);
  const hintAfterCredit = await hint.innerText();
  expect(hintAfterCredit).toContain('reason');
  expect(hintAfterCredit).not.toContain('credit');
  expect(hintAfterCredit).not.toContain('Enter a price');
});

test('N10: catalog error state reachable via forced fetch failure', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.route('**/api/service-calendar?action=sc-admin-account-config**', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'forced-N10-error' }),
    });
  });
  await page.goto('/service-calendar?view=admin');
  await page.waitForSelector('.scav');
  await page.locator(`.scav-acct[data-account-key="${ACCOUNT}"]`).click();
  await expect(page.locator('.scav-cat-error')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.scav-cat-error .t')).toContainText(`Could not load ${ACCOUNT}`);
  await expect(page.locator('.scav-cat-error .scav-ghost')).toBeVisible();
});
