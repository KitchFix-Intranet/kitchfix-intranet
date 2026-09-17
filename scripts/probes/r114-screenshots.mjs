// R-114 · full-page screenshots at 1440 · 2 accounts × 4 ranges
//
// Requires local dev at http://localhost:3000 with TEST_MODE=true.
// Writes PNGs to docs/renders/2026-09-17-r114/ in the current worktree.

import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "/Users/kevinfietek/dev/kf-r114-pr1/docs/renders/2026-09-17-r114";
fs.mkdirSync(OUT, { recursive: true });

const ACCOUNTS = ["TBJ - FL", "TBR - FL"];

// FY2026 period date helpers (see src/app/kpi/labor/lib/periods.js).
// FY starts 2025-12-29; 28-day periods.
function pStart(n) {
  const d = new Date(Date.UTC(2025, 11, 29));
  d.setUTCDate(d.getUTCDate() + (n - 1) * 28);
  return d.toISOString().slice(0, 10);
}
function pEnd(n) {
  const d = new Date(Date.UTC(2025, 11, 29));
  d.setUTCDate(d.getUTCDate() + n * 28 - 1);
  return d.toISOString().slice(0, 10);
}
// Today is 2026-09-17: P10 running, P1-P9 closed (R-93 8-day grace passed).
const CY_END = pEnd(9);  // FYTD through P9 (P1-P9)
const CY_START = pStart(1);
const LP_START = pStart(9);   // P9
const LP_END   = pEnd(9);
const CP_START = pStart(10);  // P10 running
const CP_END   = pEnd(10);
const NP_START = pStart(11);  // P11 planned
const NP_END   = pEnd(11);

const RANGES = [
  { key: "CY_p1-p9",  start: CY_START, end: CY_END },
  { key: "LP_p9",     start: LP_START, end: LP_END },
  { key: "CP_p10",    start: CP_START, end: CP_END },
  { key: "NP_p11",    start: NP_START, end: NP_END },
];

async function shot(page, account, range) {
  const acctSafe = account.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_-]/g, "");
  const url = `${BASE}/kpi/overview?account=${encodeURIComponent(account)}&start=${range.start}&end=${range.end}`;
  await page.goto(url, { waitUntil: "networkidle" });
  // Give the client fetch loop a moment to settle.
  await page.waitForTimeout(1500);
  const file = `${OUT}/${acctSafe}__${range.key}.png`;
  await page.screenshot({ path: file, fullPage: true });
  const size = fs.statSync(file).size;
  console.log(`  ${account} · ${range.key} → ${file} (${size} bytes)`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
for (const account of ACCOUNTS) {
  for (const range of RANGES) {
    try {
      await shot(page, account, range);
    } catch (e) {
      console.error(`FAIL ${account} ${range.key}: ${e.message}`);
    }
  }
}
await browser.close();
console.log("\ndone.");
