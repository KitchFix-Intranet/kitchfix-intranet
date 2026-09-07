import { test, expect } from "@playwright/test";

// Runs against the shared tests/.auth/user.json - needs a fresh
// NextAuth session (25d max) because the client-side useSession
// guard on /kpi/labor still enforces auth even though the middleware
// bypasses on TEST_MODE. If the cache is stale, the setup fixture
// fails-fast with a refresh instruction; interactive Google login is
// Kevin's job (this spec is not runnable in headless catch-up mode).

// Kevin master directive PR 1 (2026-09-09). "Check the screen, not just
// the payload." Verify the Labor panel actually renders dollars-first
// (amount hero, percent as <small>) after the flip. Same figure order
// as the Overview cost card. #1055 defect class: probe reading the
// payload passed while the client render used a different field.
//
// Render of record: docs/renders/labor-panel-dollars-first.html.

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

// Fixture: TBJ - FL Last period is a closed period with a real actual
// AND a target (all four toggle-states-equivalent renders will hit
// this shape). Actual/Target rows render, and both figures should be
// dollars-first.
test("labor SpendCard renders dollars-first on TBJ - FL Last period", async ({ page }) => {
  await page.goto(`${BASE}/kpi/labor?account=${encodeURIComponent("TBJ - FL")}&start=2026-08-10&end=2026-09-06`);
  // Wait for the Actual row to appear.
  const actualRow = page.locator(".kpi-spend-pf-row").filter({ hasText: "Actual" }).first();
  await expect(actualRow).toBeVisible({ timeout: 15000 });
  const actualText = (await actualRow.locator(".v").innerText()).trim();
  // Expected shape: "$40,794.48 30.9%" (dollars-first, percent second)
  // Not: "30.9% $40,794.48" (percent-first, pre-flip)
  const dollarFirst = /^\$[\d,\.]+/.test(actualText);
  const percentFirst = /^\d+(\.\d+)?%/.test(actualText);
  console.log(`Actual row text: "${actualText}"`);
  expect(dollarFirst, `Actual row should start with dollars, got: "${actualText}"`).toBe(true);
  expect(percentFirst, `Actual row should NOT start with percent, got: "${actualText}"`).toBe(false);
  // Percent must still appear (as <small>).
  expect(actualText).toMatch(/\d+(\.\d+)?%/);

  const targetRow = page.locator(".kpi-spend-pf-row.ref").filter({ hasText: "Target" }).first();
  await expect(targetRow).toBeVisible();
  const targetText = (await targetRow.locator(".v").innerText()).trim();
  console.log(`Target row text: "${targetText}"`);
  expect(/^\$[\d,\.]+/.test(targetText), `Target row should start with dollars, got: "${targetText}"`).toBe(true);
  expect(targetText).toMatch(/\d+(\.\d+)?%/);

  // Footer should still be present with an arrow + dollar amount.
  const footer = page.locator(".kpi-spend-pf-foot").first();
  await expect(footer).toBeVisible();
  const footerText = (await footer.innerText()).trim();
  console.log(`Footer text: "${footerText}"`);
  expect(footerText).toMatch(/(▲|▼)\s*\$/);
});

// Same check on TBR - FL to catch account-specific defects.
test("labor SpendCard renders dollars-first on TBR - FL Last period", async ({ page }) => {
  await page.goto(`${BASE}/kpi/labor?account=${encodeURIComponent("TBR - FL")}&start=2026-08-10&end=2026-09-06`);
  const actualRow = page.locator(".kpi-spend-pf-row").filter({ hasText: "Actual" }).first();
  await expect(actualRow).toBeVisible({ timeout: 15000 });
  const actualText = (await actualRow.locator(".v").innerText()).trim();
  console.log(`TBR Actual row text: "${actualText}"`);
  expect(/^\$[\d,\.]+/.test(actualText)).toBe(true);
  expect(actualText).toMatch(/\d+(\.\d+)?%/);
});
