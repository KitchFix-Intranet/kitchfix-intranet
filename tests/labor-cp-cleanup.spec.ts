import { test, expect } from "@playwright/test";

// Kevin CC prompt 2026-09-10 CP cleanup - 10 display items.
// This spec verifies the CP surface reads as Kevin specified, and
// asserts the shared surfaces (LP) remain unchanged - the "must
// not move" clause of items 4 / 6 / 8 / 9.

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const CP_URL = (acct: string, salary = false) =>
  `${BASE}/kpi/labor?account=${encodeURIComponent(acct)}&start=2026-09-07&end=2026-10-04${salary ? "&include_salary=1" : ""}`;
const LP_URL = (acct: string) =>
  `${BASE}/kpi/labor?account=${encodeURIComponent(acct)}&start=2026-08-10&end=2026-09-06`;

test("CP TBJ · pill removed, panel note removed, PENDING APPROVALS copy", async ({ page }) => {
  await page.goto(CP_URL("TBJ - FL"));
  await page.waitForSelector(".kpi-spend", { timeout: 15000 });

  // Item 1: no "Nothing earned yet" pill.
  await expect(page.locator("text=Nothing earned yet")).toHaveCount(0);

  // Item 2: no "No percentage yet" panel note.
  await expect(page.locator("text=No percentage yet")).toHaveCount(0);
  await expect(page.locator("text=needs revenue")).toHaveCount(0);

  // Item 2: percent inline beside Spent so far.
  const spentRow = page.locator(".kpi-spend-pf-row").filter({ hasText: "Spent so far" }).first();
  await expect(spentRow).toBeVisible();
  const spentText = (await spentRow.locator(".v").innerText()).trim();
  expect(spentText).toMatch(/^\$[\d,\.]+/);      // dollars first
  expect(spentText).toMatch(/\d+(\.\d+)?%/);     // percent inline

  // Item 7: pill reads PENDING APPROVALS, not AWAITING · N WK ...
  const awaitingPill = page.locator("[data-vpill-awaiting]");
  if (await awaitingPill.count() > 0) {
    const txt = (await awaitingPill.first().innerText()).trim();
    expect(txt).toBe("PENDING APPROVALS");
    expect(txt).not.toMatch(/AWAITING · /);
    expect(txt).not.toMatch(/HRS/);
  }

  // Item 8: panel says Labor Budget.
  await expect(page.locator(".kpi-spend-pf-row.ref").filter({ hasText: "Labor Budget" })).toHaveCount(1);

  // Item 4: legend does not carry the dashed-line entry.
  await expect(page.locator("text=each week's own budget")).toHaveCount(0);
  await expect(page.locator("text=each week’s own budget")).toHaveCount(0);

  // Item 6: WeekTable toolbar has no Expand/Collapse/Names/Numbers.
  await expect(page.locator(".kpi-tbar-btn", { hasText: "Expand all" })).toHaveCount(0);
  await expect(page.locator(".kpi-tbar-btn", { hasText: "Collapse all" })).toHaveCount(0);
  await expect(page.locator(".kpi-empdisp")).toHaveCount(0);
});

test("CP TBJ · running week card reads X% actual · Y% target coloured", async ({ page }) => {
  await page.goto(CP_URL("TBJ - FL"));
  await page.waitForSelector(".kpi-wrail-tile", { timeout: 15000 });

  // The running week card should NOT show "X% used".
  const runningTile = page.locator(".kpi-wrail-tile[data-verdict=running]").first();
  if (await runningTile.count() > 0) {
    const vd = (await runningTile.locator(".kpi-wrail-vd").innerText()).trim();
    expect(vd).toMatch(/\d+(\.\d+)?% actual · \d+(\.\d+)?% target/);
    expect(vd).not.toMatch(/% used/);
    // Colour class present (vd-bad OR vd-good).
    const cls = await runningTile.locator(".kpi-wrail-vd").getAttribute("class");
    expect(cls === null ? "" : cls).toMatch(/kpi-wrail-vd-(bad|good)/);
  }

  // The running week card's Budget row reads Labor Budget on CP.
  const cardBudget = page.locator(".kpi-wrail-row-k").filter({ hasText: "Labor Budget" });
  await expect(cardBudget).toHaveCount((await page.locator(".kpi-wrail-tile").count()));
});

test("LP TBJ · unchanged (approved surface)", async ({ page }) => {
  await page.goto(LP_URL("TBJ - FL"));
  await page.waitForSelector(".kpi-spend", { timeout: 15000 });

  // LP week card Budget label still reads "Budget", not "Labor Budget".
  await expect(page.locator(".kpi-wrail-row-k").filter({ hasText: /^Budget$/ }).first()).toBeVisible();
  await expect(page.locator(".kpi-wrail-row-k").filter({ hasText: "Labor Budget" })).toHaveCount(0);

  // LP still shows the dashed legend entry.
  await expect(page.locator("text=each week’s own budget")).toHaveCount(1);

  // LP still shows the WeekTable toolbar.
  await expect(page.locator(".kpi-tbar-btn", { hasText: "Expand all" })).toHaveCount(1);
});
