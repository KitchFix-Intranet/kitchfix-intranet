#!/usr/bin/env node
// Kevin ruling 2026-09-17. Closed · unaudited DOM assertions.
//
// Checks per surface:
//   - Last Period (LP · single closed_awaiting P9, spend_settled=true):
//       status pill copy = "Period closed · on target" | "Period closed · off target"
//       Provisional pill on cost + margin cards = ABSENT
//       Awaiting pill on the second status pill = ABSENT
//       SettlingStrip = ABSENT
//       Overdue nudge = PRESENT with copy "P9 closed 10 days ago · no finance P&L loaded"
//   - This year (CY):
//       Awaiting pill = ABSENT (r93ExcludedPeriodNo returns null past settle)
//       Overdue nudge = PRESENT with the same copy
//
// USAGE
//   node scripts/probes/_probe_closed_unaudited_dom.mjs

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3000";
const ACCOUNTS = ["TBR - FL", "TBJ - FL"];

function must(cond, msg) {
  if (!cond) { console.log("  FAIL:", msg); return false; }
  console.log("  pass:", msg); return true;
}

async function run() {
  const b = await chromium.launch();
  const ctx = await b.newContext({
    extraHTTPHeaders: { "x-test-user": "kevin@kitchfix.com" },
    viewport: { width: 1600, height: 1200 },
  });
  let allOk = true;
  for (const acct of ACCOUNTS) {
    console.log(`\n=== ${acct} · LAST PERIOD (P9) ===`);
    const p = await ctx.newPage();
    // Force explicit range for P9 (aug 10 → sep 6)
    await p.goto(`${BASE}/kpi/overview?account=${encodeURIComponent(acct)}&start=2026-08-10&end=2026-09-06`, {
      waitUntil: "networkidle",
    });
    await p.waitForSelector('[data-kpi-ov="status-line"]', { timeout: 15_000 });

    const statusCopy = await p.locator('[data-kpi-ov="status-state"]').first().textContent();
    allOk &= must(/period closed · (on|off) target/i.test(statusCopy || ""), `status pill = "${statusCopy}"`);
    const awaitingPillCount = await p.locator('[data-kpi-ov="status-awaiting-pill"]').count();
    allOk &= must(awaitingPillCount === 0, `awaiting pill absent (count=${awaitingPillCount})`);
    const settlingCount = await p.locator('[data-kpi-ov="settling-strip"]').count();
    allOk &= must(settlingCount === 0, `settling strip absent (count=${settlingCount})`);
    const nudgeCount = await p.locator('[data-kpi-ov="overdue-nudge"]').count();
    allOk &= must(nudgeCount === 1, `overdue nudge present (count=${nudgeCount})`);
    if (nudgeCount === 1) {
      const nudgeText = await p.locator('[data-kpi-ov="overdue-nudge"]').first().textContent();
      allOk &= must(/P9.*closed.*days ago.*no finance P&L loaded/i.test(nudgeText || ""), `nudge copy = "${nudgeText}"`);
    }
    const provisionalCount = await p.locator('[data-kpi-ov="pill"][data-kpi-ov-tone="wait"]').count();
    allOk &= must(provisionalCount === 0, `Provisional pill absent (count=${provisionalCount})`);

    await p.screenshot({ path: `/tmp/closed-unaudited-${acct.replace(/[^A-Z0-9]/gi, "_")}-lp.png`, fullPage: true });
    await p.close();

    console.log(`\n=== ${acct} · THIS YEAR (CY) ===`);
    const q = await ctx.newPage();
    await q.goto(`${BASE}/kpi/overview?account=${encodeURIComponent(acct)}&preset=fytd`, {
      waitUntil: "networkidle",
    });
    await q.waitForSelector('[data-kpi-ov="status-line"]', { timeout: 15_000 });
    const cyStatus = await q.locator('[data-kpi-ov="status-state"]').first().textContent();
    console.log(`  info: CY status pill = "${cyStatus}"`);
    const cyAwaitingCount = await q.locator('[data-kpi-ov="status-awaiting-pill"]').count();
    allOk &= must(cyAwaitingCount === 0, `CY awaiting pill absent (count=${cyAwaitingCount})`);
    const cyNudgeCount = await q.locator('[data-kpi-ov="overdue-nudge"]').count();
    allOk &= must(cyNudgeCount === 1, `CY overdue nudge present (count=${cyNudgeCount})`);
    if (cyNudgeCount === 1) {
      const cyNudgeText = await q.locator('[data-kpi-ov="overdue-nudge"]').first().textContent();
      allOk &= must(/P9.*closed.*days ago.*no finance P&L loaded/i.test(cyNudgeText || ""), `CY nudge copy = "${cyNudgeText}"`);
    }
    await q.screenshot({ path: `/tmp/closed-unaudited-${acct.replace(/[^A-Z0-9]/gi, "_")}-cy.png`, fullPage: true });
    await q.close();
  }
  await b.close();
  if (!allOk) { process.exit(1); }
  console.log("\n=== ALL DOM ASSERTIONS PASS ===");
}

run().catch(e => { console.error(e); process.exit(1); });
