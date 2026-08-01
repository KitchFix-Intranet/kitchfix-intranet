// PROBE (read-only, service-account): Job 3 - HUB + COLLECTION sheets
// facts for the four MLB accounts. Money + history + one reconciliation.
// NO WRITES. Uses readSheetSA which is the service-account helper.
//
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local scripts/_probe_sheets_labor.mjs

import { readSheetSA, SHEET_IDS } from "@/lib/sheets";

const MLB = ["STL - MO", "CIN - OH", "TXR - TX - H", "TXR - TX - V"];
const MLB_SET = new Set(MLB);

// ── HUB / labor_budgets ────────────────────────────────────────────
console.log("═══ JOB 9 - HUB / labor_budgets (4 MLB accounts, all 7 cols) ═══\n");
{
  const { headers, rows } = await readSheetSA(SHEET_IDS.HUB, "labor_budgets");
  console.log(`headers (${headers.length}): ${JSON.stringify(headers)}`);
  console.log(`total rows: ${rows.length}\n`);
  const mlbRows = rows.filter(r => MLB_SET.has(String(r[0]).trim()));
  console.log(`rows for the 4 MLB accounts: ${mlbRows.length}\n`);
  // Header labels for clarity
  const H = headers.length >= 7 ? headers : ["Account", "Period", "HourlyBudget", "SalaryBudget", "Revenue", "FoodBudget", "PackagingBudget"];
  console.log(`${H[0].padEnd(15)}  ${H[1].padEnd(6)}  ${(H[2]||"").padStart(12)}  ${(H[3]||"").padStart(12)}  ${(H[4]||"").padStart(12)}  ${(H[5]||"").padStart(12)}  ${(H[6]||"").padStart(12)}`);
  console.log("-".repeat(100));
  for (const r of mlbRows) {
    const fields = (r[0]||"").padEnd(15);
    const period = String(r[1]||"").padEnd(6);
    const hb   = String(r[2]||"").padStart(12);
    const sb   = String(r[3]||"").padStart(12);
    const rev  = String(r[4]||"").padStart(12);
    const fb   = String(r[5]||"").padStart(12);
    const pb   = String(r[6]||"").padStart(12);
    console.log(`${fields}  ${period}  ${hb}  ${sb}  ${rev}  ${fb}  ${pb}`);
  }
}

// ── COLLECTION / labor_plans ───────────────────────────────────────
console.log("\n═══ JOB 10 - COLLECTION / labor_plans row + duplicate census ═══\n");
{
  const { headers, rows } = await readSheetSA(SHEET_IDS.COLLECTION, "labor_plans");
  console.log(`headers (${headers.length}): ${JSON.stringify(headers)}`);
  console.log(`TOTAL row count: ${rows.length}\n`);
  // Col schema from route.js:150-167:
  //   0 planId, 1 timestamp, 2 email, 3 account, 4 homestandId, 5..14 various
  const perAcct = new Map();
  const pairCounts = new Map(); // (account|homestandId) -> row count
  for (const r of rows) {
    const acct = String(r[3]||"").trim();
    if (!acct) continue;
    perAcct.set(acct, (perAcct.get(acct) || 0) + 1);
    const hs = String(r[4]||"").trim();
    const key = `${acct}|${hs}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  console.log("row counts per account:");
  for (const a of MLB) console.log(`  ${a.padEnd(15)}  ${(perAcct.get(a) || 0)}`);
  console.log(`  other accounts total: ${[...perAcct.entries()].filter(([a]) => !MLB_SET.has(a)).reduce((s, [,c]) => s+c, 0)}`);
  // Duplicates - distinct pairs with >1 rows, MLB only
  const dupPairs = [...pairCounts.entries()].filter(([k, c]) => c > 1 && MLB_SET.has(k.split("|")[0]));
  console.log(`\n(account, homestandId) pairs with >1 rows, MLB only: ${dupPairs.length}`);
  for (const [k, c] of dupPairs.sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`  ${k}  → ${c} rows`);
  }
}

// ── COLLECTION / labor_sold_revenue ────────────────────────────────
console.log("\n═══ JOB 11a - COLLECTION / labor_sold_revenue ═══\n");
{
  const { headers, rows } = await readSheetSA(SHEET_IDS.COLLECTION, "labor_sold_revenue");
  console.log(`headers (${headers.length}): ${JSON.stringify(headers)}`);
  console.log(`total row count: ${rows.length}\n`);
  // Cols: account, homestandId, soldRevenue, enteredBy, enteredAt
  const perAcct = new Map();
  const dates = [];
  for (const r of rows) {
    const acct = String(r[0]||"").trim();
    perAcct.set(acct, (perAcct.get(acct) || 0) + 1);
    const at = String(r[4]||"").trim();
    if (at) dates.push(at.slice(0, 10));
  }
  console.log("rows per account:");
  for (const [a, c] of perAcct) console.log(`  ${a.padEnd(15)}  ${c}`);
  if (dates.length) {
    dates.sort();
    console.log(`enteredAt date range: ${dates[0]} .. ${dates[dates.length-1]}`);
  }
}

// ── COLLECTION / deep_clean_days ───────────────────────────────────
console.log("\n═══ JOB 11b - COLLECTION / deep_clean_days ═══\n");
{
  const { headers, rows } = await readSheetSA(SHEET_IDS.COLLECTION, "deep_clean_days");
  console.log(`headers (${headers.length}): ${JSON.stringify(headers)}`);
  console.log(`total row count: ${rows.length}\n`);
  // Cols: account, date, addedBy, timestamp
  const perAcct = new Map();
  const perAcctDates = new Map();
  for (const r of rows) {
    const acct = String(r[0]||"").trim();
    perAcct.set(acct, (perAcct.get(acct) || 0) + 1);
    if (!perAcctDates.has(acct)) perAcctDates.set(acct, new Set());
    const d = String(r[1]||"").trim();
    if (d) perAcctDates.get(acct).add(d);
  }
  console.log("rows per account (MLB):");
  for (const a of MLB) {
    const c = perAcct.get(a) || 0;
    const distinctD = perAcctDates.get(a) ? perAcctDates.get(a).size : 0;
    console.log(`  ${a.padEnd(15)}  rows=${c}  distinctDates=${distinctD}`);
  }
  console.log("\nrows per account (non-MLB):");
  for (const [a, c] of perAcct) {
    if (MLB_SET.has(a)) continue;
    const distinctD = perAcctDates.get(a).size;
    console.log(`  ${a.padEnd(15)}  rows=${c}  distinctDates=${distinctD}`);
  }
}

// ── HUB / homestand_schedule PREP/OPEN/CLOSE/CLEAN reconciliation ─
console.log("\n═══ JOB 12 - HUB / homestand_schedule day-type census (4 MLB accounts) ═══\n");
{
  const { headers, rows } = await readSheetSA(SHEET_IDS.HUB, "homestand_schedule");
  console.log(`headers (${headers.length}): ${JSON.stringify(headers)}`);
  console.log(`TOTAL rows in HUB sheet: ${rows.length}\n`);
  // Cols A-F: AccountKey, Date, DayOfWeek, DayType, Opponent, HomestandID
  const dtByAcct = new Map();
  for (const r of rows) {
    const acct = String(r[0]||"").trim();
    if (!MLB_SET.has(acct)) continue;
    const dt = String(r[3]||"").trim().toUpperCase();
    if (!dtByAcct.has(acct)) dtByAcct.set(acct, new Map());
    dtByAcct.get(acct).set(dt, (dtByAcct.get(acct).get(dt) || 0) + 1);
  }
  console.log("day-type distribution per MLB account:");
  console.log(`account         GAME   PREP   OPEN   CLOSE  CLEAN  OTHER  total`);
  for (const a of MLB) {
    const m = dtByAcct.get(a) || new Map();
    const g = m.get("GAME") || 0;
    const p = m.get("PREP") || 0;
    const o = m.get("OPEN") || 0;
    const c = m.get("CLOSE") || 0;
    const cl = m.get("CLEAN") || 0;
    const otherKeys = [...m.keys()].filter(k => !["GAME","PREP","OPEN","CLOSE","CLEAN"].includes(k));
    const other = otherKeys.reduce((s, k) => s + m.get(k), 0);
    const total = g + p + o + c + cl + other;
    const otherStr = other ? ` (${otherKeys.join(",")})` : "";
    console.log(`${a.padEnd(14)}  ${String(g).padStart(4)}   ${String(p).padStart(4)}   ${String(o).padStart(4)}   ${String(c).padStart(4)}   ${String(cl).padStart(4)}   ${String(other).padStart(4)}${otherStr}   ${total}`);
  }
}
