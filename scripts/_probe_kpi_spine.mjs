// ─────────────────────────────────────────────────────────────────
// _probe_kpi_spine.mjs
//
// PR 1 gate probe. Kevin applies kpi-1-spine.sql in Studio, then runs
// this probe and pastes the output. The probe is the evidence; CC
// does not self-certify.
//
// Six checks per the PR 1 prompt:
//   1. kpi_lines = 34; exactly one visibility_tier='site_leader'
//      and it is 3100.2.
//   2. kpi_line_activation = 374 rows for FY2026 (11 x 34);
//      exactly 22 with active=false matching the Part 2 table.
//   3. accounts.pnl_tab_name populated for all 11 client accounts,
//      NULL for CORP, no duplicates.
//   4. gl_codes has zero rows with account_key='TBJ - BUF'; TBJ - NY
//      now carries the 16 rows that moved.
//   5. sc_day_metadata integrity across 2026 for all 11 accounts:
//      zero NULL periods; each account's period set is contiguous
//      1..13; each account's P13 MAX(service_date) reported so the
//      TBR-FL divergence is visible rather than assumed.
//   6. periodForDate round-trip: sampled date per period per account
//      returns the period sc_day_metadata holds. Includes 2026-12-22
//      explicitly (inside TBR-FL's P13, outside every other account's).
//
// Usage:
//   node --import ./scripts/_setup/register-aliases.mjs --env-file=.env.local scripts/_probe_kpi_spine.mjs
//
// Read-only. No writes.
// ─────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { periodForDate } from "@/lib/dataStore/kpi";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Canonical 11 client account keys (CORP excluded per playbook D17).
const CLIENT_ACCOUNTS = [
  "CIN - AZ", "CIN - KY", "CIN - OH",
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY",
  "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];

// Expected 24 inactive (account, line) pairs per Ruling 1 (2026-08-03)
// + D26 single-employee-account ruling (2026-08-03).
const INACTIVE_EXPECTED = [
  // 3500.1 Delivery Mileage - active on TBR-FL only; 10 inactive
  ["CIN - AZ", "3500.1"], ["CIN - KY", "3500.1"], ["CIN - OH", "3500.1"],
  ["STL - FL", "3500.1"], ["STL - MO", "3500.1"],
  ["TBJ - FL", "3500.1"], ["TBJ - NY", "3500.1"],
  ["TXR - AZ", "3500.1"], ["TXR - TX - H", "3500.1"], ["TXR - TX - V", "3500.1"],
  // 3500.2 Vehicle Insurance - inactive on TBR-FL only; 1 inactive
  ["TBR - FL", "3500.2"],
  // 5012.3 General Utilities - inactive on CIN-AZ and TXR-TX-H; 2 inactive
  ["CIN - AZ", "5012.3"], ["TXR - TX - H", "5012.3"],
  // 5012.5 Computer Hardware - active on CIN-AZ and TXR-TX-H only; 9 inactive
  ["CIN - KY", "5012.5"], ["CIN - OH", "5012.5"],
  ["STL - FL", "5012.5"], ["STL - MO", "5012.5"],
  ["TBJ - FL", "5012.5"], ["TBJ - NY", "5012.5"],
  ["TBR - FL", "5012.5"], ["TXR - AZ", "5012.5"], ["TXR - TX - V", "5012.5"],
  // 3100.1 Hourly - inactive on CIN-KY and TBJ-NY (D26: single-employee salaried accounts); 2 inactive
  ["CIN - KY", "3100.1"], ["TBJ - NY", "3100.1"],
];

let passCount = 0;
let failCount = 0;
function pass(msg) { console.log("  ✓ PASS  " + msg); passCount++; }
function fail(msg) { console.log("  ✗ FAIL  " + msg); failCount++; process.exitCode = 1; }
function h(msg) { console.log("\n" + "─".repeat(72) + "\n" + msg + "\n" + "─".repeat(72)); }

async function check1_kpi_lines() {
  h("Check 1: kpi_lines shape");
  const { data: rows, error } = await supa.from("kpi_lines").select("line_code, visibility_tier, section, sort_order").order("sort_order");
  if (error) { fail("kpi_lines query error: " + error.message); return; }
  if (rows.length !== 34) fail(`kpi_lines row count = ${rows.length}, expected 34`);
  else pass(`kpi_lines row count = 34`);

  const slt = rows.filter(r => r.visibility_tier === "site_leader");
  if (slt.length !== 1) fail(`visibility_tier='site_leader' count = ${slt.length}, expected 1`);
  else if (slt[0].line_code !== "3100.2") fail(`site_leader tier is on ${slt[0].line_code}, expected 3100.2`);
  else pass(`visibility_tier='site_leader' is exactly {3100.2}`);

  const sections = rows.reduce((m, r) => { m[r.section] = (m[r.section]||0)+1; return m; }, {});
  console.log("  sections breakdown: " + JSON.stringify(sections));
}

async function check2_activation() {
  h("Check 2: kpi_line_activation shape");
  const { count, error: cErr } = await supa.from("kpi_line_activation").select("*", { count: "exact", head: true }).eq("fiscal_year", 2026);
  if (cErr) { fail("kpi_line_activation count error: " + cErr.message); return; }
  if (count !== 374) fail(`FY2026 activation rows = ${count}, expected 374 (11 x 34)`);
  else pass(`FY2026 activation rows = 374`);

  // Fetch inactive rows and compare to expected set.
  const { data: inact, error: iErr } = await supa.from("kpi_line_activation").select("account_key, line_code").eq("fiscal_year", 2026).eq("active", false).order("line_code").order("account_key");
  if (iErr) { fail("inactive fetch error: " + iErr.message); return; }
  if (inact.length !== 24) fail(`inactive rows = ${inact.length}, expected 24`);
  else pass(`inactive rows = 24`);

  const got = new Set(inact.map(r => `${r.account_key}||${r.line_code}`));
  const exp = new Set(INACTIVE_EXPECTED.map(([a, l]) => `${a}||${l}`));
  const missing = [...exp].filter(k => !got.has(k));
  const extra = [...got].filter(k => !exp.has(k));
  if (missing.length === 0 && extra.length === 0) pass(`inactive set matches Ruling 1 + D26 table exactly`);
  else {
    if (missing.length) fail(`inactive missing: ${missing.join(", ")}`);
    if (extra.length) fail(`inactive extra: ${extra.join(", ")}`);
  }

  // Per-line inactive counts. Independent check - restates the intent
  // line by line rather than restating the CASE that generated the set.
  const expectedPerLine = { "3500.1": 10, "3500.2": 1, "5012.3": 2, "5012.5": 9, "3100.1": 2 };
  const gotPerLine = inact.reduce((m, r) => { m[r.line_code] = (m[r.line_code] || 0) + 1; return m; }, {});
  for (const [code, expected] of Object.entries(expectedPerLine)) {
    const actual = gotPerLine[code] || 0;
    if (actual !== expected) fail(`per-line inactive: ${code} = ${actual}, expected ${expected}`);
    else pass(`per-line inactive: ${code} = ${expected}`);
  }
}

async function check3_pnl_tab_name() {
  h("Check 3: accounts.pnl_tab_name");
  const { data: rows, error } = await supa.from("accounts").select("team_key, pnl_tab_name").order("team_key");
  if (error) { fail("accounts query error: " + error.message); return; }
  const nullClients = rows.filter(r => r.team_key !== "CORP" && r.pnl_tab_name == null);
  if (nullClients.length) fail(`clients with NULL pnl_tab_name: ${nullClients.map(r => r.team_key).join(", ")}`);
  else pass(`all 11 client accounts have pnl_tab_name populated`);
  const corp = rows.find(r => r.team_key === "CORP");
  if (corp?.pnl_tab_name != null) fail(`CORP.pnl_tab_name = ${JSON.stringify(corp.pnl_tab_name)}, expected NULL`);
  else pass(`CORP.pnl_tab_name is NULL (out of KPI scope)`);
  const tabs = rows.map(r => r.pnl_tab_name).filter(v => v != null);
  if (new Set(tabs).size !== tabs.length) fail(`pnl_tab_name has duplicates`);
  else pass(`pnl_tab_name has no duplicates (${tabs.length} unique values)`);
  console.log("  full mapping:");
  for (const r of rows) console.log(`    ${r.team_key.padEnd(14)} -> ${JSON.stringify(r.pnl_tab_name)}`);
}

async function check4_gl_codes_tbj() {
  h("Check 4: gl_codes TBJ - BUF -> TBJ - NY");
  const { count: buf, error: e1 } = await supa.from("gl_codes").select("*", { count: "exact", head: true }).eq("account_key", "TBJ - BUF");
  if (e1) { fail("gl_codes TBJ - BUF count error: " + e1.message); return; }
  if (buf !== 0) fail(`gl_codes TBJ - BUF has ${buf} rows, expected 0`);
  else pass(`gl_codes TBJ - BUF = 0 rows`);
  const { count: ny, error: e2 } = await supa.from("gl_codes").select("*", { count: "exact", head: true }).eq("account_key", "TBJ - NY");
  if (e2) { fail("gl_codes TBJ - NY count error: " + e2.message); return; }
  if (ny < 16) fail(`gl_codes TBJ - NY has ${ny} rows, expected >= 16`);
  else pass(`gl_codes TBJ - NY = ${ny} rows (>= 16 expected)`);
}

async function check5_day_metadata() {
  h("Check 5: sc_day_metadata integrity across 2026");
  const window = { from: "2025-12-29", to: "2026-12-29" };
  console.log(`  window: ${window.from} .. ${window.to}`);
  for (const acct of CLIENT_ACCOUNTS) {
    // Paginate to defeat the 1000-row PostgREST default (accounts have ~357-366 rows).
    let all = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supa.from("sc_day_metadata").select("service_date, period").eq("account_key", acct).gte("service_date", window.from).lte("service_date", window.to).order("service_date").range(offset, offset + 999);
      if (error) { fail(`${acct}: sc_day_metadata query error: ${error.message}`); break; }
      all = all.concat(data || []);
      if ((data || []).length < 1000) break;
      offset += 1000;
    }
    const nullPeriods = all.filter(r => r.period == null);
    const periods = [...new Set(all.map(r => r.period).filter(p => p != null))].sort((a, b) => Number(a) - Number(b));
    const p13Rows = all.filter(r => r.period === "13");
    const p13Max = p13Rows.length ? p13Rows[p13Rows.length - 1].service_date : "(none)";
    const label = acct.padEnd(14);
    if (nullPeriods.length) fail(`${label} ${nullPeriods.length} NULL period rows in window`);
    // Contiguous 1..13 check
    const expected = ["1","2","3","4","5","6","7","8","9","10","11","12","13"];
    const contig = JSON.stringify(periods) === JSON.stringify(expected);
    if (!contig) fail(`${label} period set = [${periods.join(",")}] (expected contiguous 1..13)`);
    console.log(`  ${label} rows=${all.length.toString().padStart(3)}  periods=[${periods.join(",")}]  P13.MAX(service_date)=${p13Max}`);
  }
  if (failCount === 0 || failCount === 1) {
    // If everything above logged inline without a fail, mark the summary pass.
    // We can't easily count per-account fails here; just report the overall.
  }
}

async function check6_periodForDate() {
  h("Check 6: periodForDate round-trip (fiscal bucketing, not service lookup)");
  // For each account, sample one date in each of P1..P13 by pulling
  // the first row in each period from sc_day_metadata, then call the
  // helper. The helper resolves by FISCAL BOUNDARY, so an in-service
  // date must still return its correct period.
  let localFail = 0;
  for (const acct of CLIENT_ACCOUNTS) {
    for (const p of ["1","2","3","4","5","6","7","8","9","10","11","12","13"]) {
      const { data, error } = await supa.from("sc_day_metadata").select("service_date").eq("account_key", acct).eq("period", p).order("service_date").limit(1);
      if (error) { fail(`${acct} P${p} sample fetch error: ${error.message}`); localFail++; continue; }
      if (!data.length) { fail(`${acct} P${p} has zero rows in sc_day_metadata`); localFail++; continue; }
      const date = data[0].service_date;
      const roundTrip = await periodForDate(acct, date);
      if (roundTrip !== p) { fail(`${acct} ${date}: periodForDate returned ${JSON.stringify(roundTrip)}, sc_day_metadata says P${p}`); localFail++; }
    }
  }
  if (localFail === 0) pass(`periodForDate agrees with sc_day_metadata for all (11 accounts x 13 periods) = 143 samples`);

  // Load-bearing tests: dates AFTER the service window of P13 for
  // 10 accounts but INSIDE the fiscal year still resolve to P13.
  // Kevin's ruling 2026-08-04: FY2026 = P1 start + 363 days =
  // 2026-12-27. 2026-12-28 and 2026-12-29 are past FY2026 fiscally
  // even though TBR-FL's sc_day_metadata rows for those dates carry
  // period=13 (workbook artifact per docs/SC_STATUS.md fiscal-
  // calendar-generator gap).
  console.log("\n  Fiscal-bucketing: 2026-12-21 (day after 10-account P13 service end)");
  for (const acct of CLIENT_ACCOUNTS) {
    const p = await periodForDate(acct, "2026-12-21");
    const label = acct.padEnd(14);
    if (p === "13") pass(`${label} 2026-12-21 -> P${p}`);
    else fail(`${label} 2026-12-21 -> ${JSON.stringify(p)}, expected "13"`);
  }

  console.log("\n  Fiscal-bucketing: 2026-12-22 (mid-window; every account -> P13)");
  for (const acct of CLIENT_ACCOUNTS) {
    const p = await periodForDate(acct, "2026-12-22");
    const label = acct.padEnd(14);
    if (p === "13") pass(`${label} 2026-12-22 -> P${p}`);
    else fail(`${label} 2026-12-22 -> ${JSON.stringify(p)}, expected "13" (fiscal-year in-window, past service end for 10 accounts)`);
  }

  console.log("\n  Fiscal-bucketing: 2026-12-27 (fiscal year end - last day inside FY2026)");
  for (const acct of CLIENT_ACCOUNTS) {
    const p = await periodForDate(acct, "2026-12-27");
    const label = acct.padEnd(14);
    if (p === "13") pass(`${label} 2026-12-27 -> P${p}`);
    else fail(`${label} 2026-12-27 -> ${JSON.stringify(p)}, expected "13" - FY2026 ends 2026-12-27`);
  }

  console.log("\n  Fiscal-year hard end: 2026-12-28 (first day past FY2026; every account -> null)");
  console.log("  Note: TBR-FL's sc_day_metadata rows for this date carry period=13 (workbook artifact).");
  console.log("        Resolver overrules by fiscal calendar, returns null.");
  for (const acct of CLIENT_ACCOUNTS) {
    const p = await periodForDate(acct, "2026-12-28");
    const label = acct.padEnd(14);
    if (p == null) pass(`${label} 2026-12-28 -> null (post FY2026)`);
    else fail(`${label} 2026-12-28 -> ${JSON.stringify(p)}, expected null - FY2026 ends 2026-12-27`);
  }

  console.log("\n  Fiscal-year hard end: 2026-12-29 (second day past FY2026; every account -> null)");
  for (const acct of CLIENT_ACCOUNTS) {
    const p = await periodForDate(acct, "2026-12-29");
    const label = acct.padEnd(14);
    if (p == null) pass(`${label} 2026-12-29 -> null (post FY2026)`);
    else fail(`${label} 2026-12-29 -> ${JSON.stringify(p)}, expected null - FY2026 ends 2026-12-27`);
  }

  console.log("\n  Pre-fiscal-year: 2025-12-28 (day before FY2026 P1 start; every account -> null)");
  for (const acct of CLIENT_ACCOUNTS) {
    const p = await periodForDate(acct, "2025-12-28");
    const label = acct.padEnd(14);
    if (p == null) pass(`${label} 2025-12-28 -> null (pre fiscal year)`);
    else fail(`${label} 2025-12-28 -> ${JSON.stringify(p)}, expected null - FY2026 P1 starts 2025-12-29`);
  }
}

(async () => {
  console.log("KPI Spine (kpi-1) probe - 2026-08-03");
  await check1_kpi_lines();
  await check2_activation();
  await check3_pnl_tab_name();
  await check4_gl_codes_tbj();
  await check5_day_metadata();
  await check6_periodForDate();

  console.log("\n" + "═".repeat(72));
  console.log(`OVERALL: ${failCount === 0 ? "PASS" : "FAIL"}  (${passCount} pass, ${failCount} fail)`);
  console.log("═".repeat(72));
})();
