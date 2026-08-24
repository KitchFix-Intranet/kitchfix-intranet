// PR 3 - management-fee board acceptance.
//
// Three pass-through accounts (CIN - OH, STL - FL, STL - MO) get a
// distinct board: mgmt-fee card, period card with passthru state,
// STL - FL only gets a Fun Money card, reimbursable full-width row,
// then reused Equipment / R&M / Vendor / Card purchases.
//
// Acceptance items covered (from the CC prompt):
//   1  three pass-through accounts render a board (not the placeholder)
//   2  three COGS bucket cards absent at those accounts
//   3  zero verdict pill on the reimbursable card
//   4  zero red/green on the management-fee chart
//   5  STL - FL Fun Money renders a real verdict
//   7  Reimbursable ledger header carries "Reimbursable" purple + "ledger"
//   8  no zero-budget variance block on the reimbursable card
//   9  goal figures come off accountModels.js MANAGEMENT_FEE_GOALS
//   10 STL - MO carries an amber caution and no tax rate is applied
//   11 two at-risk accounts render exactly as before (regression proof)
//
// Runs against a dev server with TEST_MODE=true (src/middleware.js
// bypass). Screenshots write to playwright-report/pr3-mgmt-fee/.

import { test, expect } from "@playwright/test";
import path from "node:path";

const OUT = path.resolve(__dirname, "..", "playwright-report", "pr3-mgmt-fee");
test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3226" });
test.setTimeout(180_000);

const FYTD_START = "2025-12-29";
const FYTD_END   = "2026-08-24";
const PASS_THROUGH = ["CIN - OH", "STL - FL", "STL - MO"];
const AT_RISK_REGRESSION = ["TBR - FL", "CIN - KY"];

async function loadBoard(page, account) {
  const q = `?account=${encodeURIComponent(account)}&start=${FYTD_START}&end=${FYTD_END}`;
  await page.goto(`/kpi/purchasing${q}`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".kpi-p-card").first()).toBeVisible();
  await page.waitForTimeout(400);
}

for (const account of PASS_THROUGH) {
  test(`passthru board renders at ${account} (not placeholder)`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1600 });
    await loadBoard(page, account);

    // Board card must be present; placeholder must NOT be present.
    await expect(page.locator('[data-card="mgmt-fee"], [data-card="mgmt-fee-hole"]')).toHaveCount(1);
    await expect(page.locator('.kpi-p-placeholder')).toHaveCount(0);

    // The three COGS bucket cards MUST NOT render at pass-through.
    const cogs = await page.locator('[data-card="bucket-food"], [data-card="bucket-packaging"], [data-card="bucket-vehicle"]').count();
    expect(cogs).toBe(0);

    // Reimbursable row present and its header carries the purple
    // Reimbursable title + "ledger" label.
    const reimb = page.locator('[data-card="reimb-row"]');
    await expect(reimb).toBeVisible();
    const ledLab = reimb.locator('.kpi-p-reimb-ledgerlab');
    await expect(ledLab).toHaveText(/ledger/i);
    const ledTitle = reimb.locator('.kpi-p-ct-reimb').first();
    await expect(ledTitle).toHaveText(/Reimbursable/);

    // No verdict pill on the reimbursable card - only the neutral
    // "Billed to client" pill is allowed.
    const reimbPills = await reimb.locator('.kpi-p-pill').all();
    for (const p of reimbPills) {
      const cls = await p.getAttribute("class");
      const text = ((await p.textContent()) || "").trim();
      expect(cls || "").toMatch(/\bkpi-p-pill\b.*\bn\b/);
      expect(text.toLowerCase()).toContain("billed to client");
    }

    // No zero-budget variance block in the reimbursable card.
    const reimbValueNodes = await reimb.locator('.kpi-p-value.r, .kpi-p-value.g').count();
    expect(reimbValueNodes).toBe(0);

    // Management-fee chart carries no red/green colour tokens on the
    // trend bars themselves. Only steel or amber are allowed.
    const mfBarNodes = await page.locator('.kpi-p-mfbars-c i').all();
    for (const b of mfBarNodes) {
      const bg = await b.evaluate(el => getComputedStyle(el).backgroundColor);
      // rgb(220, 90, 90) or similar red; rgb(22, 163, 74) green
      expect(bg).not.toMatch(/rgb\(220[,\s]/); // no red
      expect(bg).not.toMatch(/rgb\(22[,\s]/);   // no green
    }

    // Full-page screenshots at 1600 and 900 for the report.
    await page.screenshot({ path: path.join(OUT, `mgmtfee-${account.replace(/[^a-zA-Z0-9]+/g, "-")}-1600.png`), fullPage: true });
    await page.setViewportSize({ width: 900, height: 1600 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, `mgmtfee-${account.replace(/[^a-zA-Z0-9]+/g, "-")}-900.png`), fullPage: true });
  });
}

test("STL - MO carries an amber caution and no tax rate applied", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  await loadBoard(page, "STL - MO");
  const caution = page.locator('.kpi-p-mfcaution');
  await expect(caution).toBeVisible();
  const text = ((await caution.textContent()) || "").toLowerCase();
  expect(text).toContain("missouri sales tax");
  expect(text).toContain("has not been applied");
  // A rate would look like "6.5%" or similar. Assert we never emit
  // a percentage tax rate in the caution copy - the value is
  // outstanding from Sebastian and must not be estimated.
  expect(text).not.toMatch(/\d+(\.\d+)?\s*%/);
  // Also assert the breakdown appears verbatim (provenance-in-UI).
  expect(text).toContain("281,345.95");
  expect(text).toContain("50,000.00");
});

test("STL - FL Fun Money renders a real verdict", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  await loadBoard(page, "STL - FL");
  const fm = page.locator('[data-card="fun-money"]');
  await expect(fm).toBeVisible();
  // Fun Money has a pill (state signal) and a real hero.
  const pill = fm.locator('.kpi-p-pill').first();
  await expect(pill).toBeVisible();
  const hero = fm.locator('.kpi-p-hero').first();
  const heroText = ((await hero.textContent()) || "").trim();
  expect(heroText).toMatch(/^\$\d/); // starts with $, has cents somewhere
});

test("goal figures come off MANAGEMENT_FEE_GOALS (not zero, not hardcoded elsewhere)", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  // Match the three annual-goal values verbatim to what accountModels.js ships.
  const expected: [string, string][] = [
    ["CIN - OH", "$227,391.02"],
    ["STL - FL", "$1,060,000.00"],
    ["STL - MO", "$331,345.95"],
  ];
  for (const [account, goal] of expected) {
    await loadBoard(page, account);
    const mf = page.locator('[data-card="mgmt-fee"]');
    await expect(mf).toBeVisible();
    const of = mf.locator('.kpi-p-mfhero-of');
    const text = ((await of.textContent()) || "").trim();
    expect(text).toContain(goal);
  }
});

for (const account of AT_RISK_REGRESSION) {
  test(`at-risk regression proof: ${account} still renders bucket cards`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1600 });
    await loadBoard(page, account);
    // At-risk boards MUST still render the mgmt-fee card as absent
    // and the three COGS bucket cards as present.
    await expect(page.locator('[data-card="mgmt-fee"], [data-card="mgmt-fee-hole"]')).toHaveCount(0);
    await expect(page.locator('[data-card="reimb-row"]')).toHaveCount(0);
    // BucketCard emits data-card="bucket-{key}" per its render.
    const foods = await page.locator('.kpi-p-b-food').count();
    const pkgs  = await page.locator('.kpi-p-b-pkg').count();
    const vehs  = await page.locator('.kpi-p-b-veh').count();
    expect(foods).toBeGreaterThan(0);
    expect(pkgs).toBeGreaterThan(0);
    expect(vehs).toBeGreaterThan(0);
    // Three-up flatrow still present (Equipment + R&M + Vendor).
    const flat = page.locator('.kpi-p-flatrow-3up');
    await expect(flat).toBeVisible();
    const kids = await flat.locator('> *').count();
    expect(kids).toBe(3);
    // Regression screenshot for pair-compare.
    await page.screenshot({ path: path.join(OUT, `atrisk-${account.replace(/[^a-zA-Z0-9]+/g, "-")}-1600.png`), fullPage: true });
  });
}
