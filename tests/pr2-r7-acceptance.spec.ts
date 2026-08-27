// PR 2 R7 - acceptance spec covering all five fixes.
//
//   Fix 1 (bug) - chart initial scroll: opens at right edge, most recent
//                 unit visible on first paint. `useLayoutEffect` in
//                 WeekChart runs synchronously before browser paint, so
//                 there is no visible jump.
//   Fix 2 (bug) - vendor VS PRIOR: `prior_has_data` gates the "new" vs
//                 "no prior" split. FYTD on FY2026 has no prior window
//                 data -> every row reads `no prior`. P8 has prior data
//                 (P7) -> real movement chips render.
//   Fix 3       - category truncation: Rippling's `**Please Select A
//                 Category**` sentinel becomes `no category` in amber.
//                 Guard against any partial "Please Sel..." leaking.
//   Fix 4       - zero-budget cards: the second stack (`Remaining` /
//                 `Over by` + variance value) disappears entirely on
//                 cards with budget=0. Reimbursable sentinel confirms.
//   Fix 5       - three-up layout: Equipment + R&M + Vendor breakdown
//                 in one flatrow at 1600px viewport. Vendor breakdown
//                 lands at ~395px wide with all four columns present
//                 and readable. Below the 1300px reflow breakpoint the
//                 row stacks (per R6 rule).
//
// Runs against a dev server on PORT 3226 with TEST_MODE=true so auth is
// bypassed via src/middleware.js.

import { test, expect } from "@playwright/test";
import path from "node:path";
import { assertBoardLoaded } from "./lib/board-loaded";

const OUT = path.resolve(__dirname, "..", "playwright-report", "pr2-r7");
test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3226" });
test.setTimeout(120_000);

const FYTD = "?account=ALL&start=2025-12-29&end=2026-08-23";
const P8 = "?account=ALL&start=2026-07-27&end=2026-08-23";

test("fix5 layout measurement + screenshot at 1600px", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  await page.goto(`/kpi/purchasing${FYTD}`);
  await assertBoardLoaded(page, ".kpi-p-card", { context: "purchasing" });
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.kpi-p-card').first()).toBeVisible();
  await page.waitForTimeout(500);
  const flatrow = page.locator('.kpi-p-flatrow-3up');
  const flatW = await flatrow.evaluate(el => el.getBoundingClientRect().width);
  console.log(`flatrow-3up width: ${flatW.toFixed(1)}px`);
  const children = await flatrow.locator('> *').all();
  expect(children.length).toBe(3);
  for (let i = 0; i < children.length; i++) {
    const r = await children[i].evaluate(el => ({
      w: el.getBoundingClientRect().width,
      dc: el.getAttribute("data-card") || "",
    }));
    console.log(`  child ${i}: data-card=${r.dc}  w=${r.w.toFixed(1)}px`);
  }
  const vbCols = await page.locator('.kpi-p-vbhead > span').all();
  console.log("Vendor breakdown column widths at 1600px three-up:");
  for (let i = 0; i < vbCols.length; i++) {
    const w = await vbCols[i].evaluate(el => el.getBoundingClientRect().width);
    const t = await vbCols[i].textContent();
    console.log(`  col ${i}: ${w.toFixed(1)}px "${t}"`);
    // Every column has a positive readable width.
    expect(w).toBeGreaterThan(50);
  }
  await page.screenshot({ path: path.join(OUT, "fix5-1600-fytd.png"), fullPage: true });
});

test("fix1 chart opens at right edge (P9-side visible) at narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 1400 });
  await page.goto(`/kpi/purchasing${FYTD}`);
  await assertBoardLoaded(page, ".kpi-p-card", { context: "purchasing" });
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.kpi-p-card').first()).toBeVisible();
  await page.waitForTimeout(500);
  const scrolls = await page.locator('.kpi-p-wks-scroll').all();
  let scrolling = 0;
  for (let i = 0; i < scrolls.length; i++) {
    const m = await scrolls[i].evaluate(el => ({
      scrollLeft: el.scrollLeft,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    const hasScroll = m.scrollWidth > m.clientWidth + 2;
    const atRight = Math.abs((m.scrollLeft + m.clientWidth) - m.scrollWidth) < 2;
    console.log(`  scroll ${i}: sw=${m.scrollWidth}, cw=${m.clientWidth}, sl=${m.scrollLeft}, hasScroll=${hasScroll}, atRight=${atRight}`);
    if (hasScroll) {
      scrolling++;
      expect(atRight).toBe(true);
    }
  }
  expect(scrolling).toBeGreaterThan(0);
});

test("fix1 scroll onset per viewport", async ({ page }) => {
  const widths = [700, 900, 1200, 1400, 1600];
  const rows: string[] = [];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 1200 });
    await page.goto(`/kpi/purchasing${FYTD}`);
    await assertBoardLoaded(page, ".kpi-p-card", { context: "purchasing" });
  await page.waitForLoadState("networkidle");
    await expect(page.locator('.kpi-p-card').first()).toBeVisible();
    await page.waitForTimeout(300);
    const scrolls = await page.locator('.kpi-p-wks-scroll').all();
    let anyScrolls = false;
    for (const s of scrolls) {
      const m = await s.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      if (m.sw > m.cw + 2) { anyScrolls = true; break; }
    }
    rows.push(`  ${w}px: any-chart-scrolls=${anyScrolls}`);
  }
  console.log("SCROLL ONSET (ALL / FYTD, tier C):");
  for (const r of rows) console.log(r);
});

test("fix2 vendor prior column - FYTD (no prior on every row)", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto(`/kpi/purchasing${FYTD}`);
  await assertBoardLoaded(page, ".kpi-p-card", { context: "purchasing" });
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.kpi-p-card').first()).toBeVisible();
  const chips = await page.locator('.kpi-p-vbrow .kpi-p-ch').all();
  let noPriorCount = 0, newCount = 0;
  for (const c of chips) {
    const t = ((await c.textContent()) || "").trim();
    if (t.includes("no prior")) noPriorCount++;
    if (t === "new") newCount++;
  }
  console.log(`FYTD VB: rows=${chips.length}, no-prior=${noPriorCount}, new=${newCount}`);
  expect(newCount).toBe(0);
  expect(noPriorCount).toBe(chips.length);
});

test("fix2 vendor prior column - P8 (movement)", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto(`/kpi/purchasing${P8}`);
  await assertBoardLoaded(page, ".kpi-p-card", { context: "purchasing" });
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.kpi-p-card').first()).toBeVisible();
  const chips = await page.locator('.kpi-p-vbrow .kpi-p-ch').all();
  let movementCount = 0, noPriorCount = 0;
  for (const c of chips) {
    const t = ((await c.textContent()) || "").trim();
    if (t.includes("%")) movementCount++;
    if (t.includes("no prior")) noPriorCount++;
  }
  console.log(`P8 VB: rows=${chips.length}, movement=${movementCount}, no-prior=${noPriorCount}`);
  expect(noPriorCount).toBe(0);
  expect(movementCount).toBeGreaterThan(0);
});

test("fix3 card-purchases category never mid-word truncation", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto("/kpi/purchasing?account=ALL");
  await assertBoardLoaded(page, ".kpi-p-card", { context: "purchasing" });
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.kpi-p-card').first()).toBeVisible();
  const rows = await page.locator('.kpi-p-cplist .kpi-p-rw').all();
  console.log(`card-purchases rows: ${rows.length}`);
  for (const r of rows) {
    const t = (await r.locator('small').textContent()) || "";
    expect(t).not.toContain("Please Sel");
    expect(t).not.toContain("Please Select A Category");
  }
});

test("fix4 zero-budget cards render no variance block", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  await page.goto("/kpi/purchasing?account=ALL");
  await assertBoardLoaded(page, ".kpi-p-card", { context: "purchasing" });
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.kpi-p-card').first()).toBeVisible();
  // Reimbursable (13xx) has no budget at ALL.
  const reimb = page.locator('[data-card="ledger-reimb"]');
  await expect(reimb).toBeVisible();
  const labels = await reimb.locator('.kpi-p-label').all();
  const values = await reimb.locator('.kpi-p-value').all();
  console.log(`reimb labels: ${labels.length}, values: ${values.length}`);
  // Only Spent stack remains -> exactly 1 .kpi-p-label + 0 .kpi-p-value.
  expect(labels.length).toBe(1);
  expect((await labels[0].textContent())?.trim()).toBe("Spent");
  expect(values.length).toBe(0);
});

test("acceptance: portfolio P9 kpi budget = $231,132.99", async ({ page }) => {
  // Data check via the API. P9 window per src/app/kpi/labor/lib/periods.js.
  const r = await page.request.get("/api/kpi/purchasing?account=ALL&start=2026-08-10&end=2026-09-06");
  expect(r.ok()).toBe(true);
  const d = await r.json();
  const bud = (d.budget?.by_gl_line_code || [])
    .filter((x: any) => x.gl_line_code.startsWith("3200") || x.gl_line_code.startsWith("3400") || x.gl_line_code.startsWith("3500"))
    .reduce((s: number, x: any) => s + Number(x.amount || 0), 0);
  console.log(`portfolio P9 kpi budget: $${bud.toFixed(2)}`);
  expect(bud).toBeCloseTo(231132.99, 1);
});

test("screenshot: 1600 P8 (movement)", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  await page.goto(`/kpi/purchasing${P8}`);
  await assertBoardLoaded(page, ".kpi-p-card", { context: "purchasing" });
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.kpi-p-card').first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "fix5-1600-p8.png"), fullPage: true });
});

test("screenshot: 900 stack (FYTD)", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1600 });
  await page.goto(`/kpi/purchasing${FYTD}`);
  await assertBoardLoaded(page, ".kpi-p-card", { context: "purchasing" });
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.kpi-p-card').first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "fix5-900-fytd.png"), fullPage: true });
});
