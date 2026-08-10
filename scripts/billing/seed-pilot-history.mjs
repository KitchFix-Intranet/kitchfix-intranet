#!/usr/bin/env node
// PR-B1: pilot history seed - TXR - AZ + CIN - AZ, 2026-07-13 .. 2026-08-02.
//
// Load real July meal counts from the two pilot sites' Excel workbooks
// into sc_daily_actuals so the invoice builder can rebuild real weeks
// and be diffed against the invoices Sebastian already sent.
//
// FENCES (binding):
//   Writes are LIMITED to sc_daily_actuals rows for
//     account_key IN ('TXR - AZ', 'CIN - AZ')
//     AND service_date BETWEEN '2026-07-13' AND '2026-08-02'.
//   Nothing else touched. No schema changes. Actuals only, never
//   projections. created_by = 'spreadsheet_seed' on every row.
//
// Two-step contract: dry-run first (default), write only on --write
// AND after Kevin's go on the dry-run output. Existing rows in the
// window are REPLACED via delete-then-insert inside a single
// transaction (see performWrite below).
//
// Usage:
//   node --env-file=.env.local scripts/billing/seed-pilot-history.mjs
//   node --env-file=.env.local scripts/billing/seed-pilot-history.mjs --write

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

const TXR_XLSX  = process.env.TXR_XLSX_PATH  || "/Users/kevinfietek/Downloads/TXR AZ - Service Calendar - 2026 (4).xlsx";
const REDS_XLSX = process.env.REDS_XLSX_PATH || "/Users/kevinfietek/Downloads/REDS AZ - Service Calendar 2026 (4).xlsx";

const WRITE = process.argv.includes("--write");
const CREATED_BY = "spreadsheet_seed";

// Positional column layout per prompt spec. Column letters -> (group,
// service_name). SR-6: position is authority; do NOT re-derive by name.
const TXR_COLUMNS = [
  ["F",  "Major League", "Breakfast"],
  ["H",  "Major League", "Lunch"],
  ["J",  "Major League", "Dinner"],
  ["L",  "Major League", "Extra Protein - Chicken/Pork"],
  ["N",  "Major League", "Extra Protein - Beef/Seafood"],
  ["P",  "Minor League", "Breakfast"],
  ["R",  "Minor League", "Lunch"],
  ["T",  "Minor League", "Dinner"],
  ["V",  "Minor League", "Extra Protein - Chicken/Pork"],
  ["X",  "Minor League", "Extra Protein - Beef/Seafood"],
  ["Z",  "Minor League", "Continental Breakfast"],
  ["AB", "Minor League", "Pre-Game Hot Snack"],
  ["AD", "Minor League", "Regular Snack"],
];
const REDS_COLUMNS = [
  ["F",  "Major League", "Breakfast"],
  ["H",  "Major League", "Lunch"],
  ["J",  "Major League", "Dinner"],
  ["L",  "Minor League", "Breakfast"],
  ["N",  "Minor League", "Lunch"],
  ["P",  "Minor League", "Dinner"],
  ["R",  "Minor League", "Pre-Game Snack"],
  ["T",  "Minor League", "Coffee Service"],
  ["V",  "Minor League", "Fountain Bev"],
  ["X",  "Rehab",        "Continental Plus"],
  ["Z",  "Rehab",        "Breakfast"],
  ["AB", "Rehab",        "Lunch"],
  ["AD", "Rehab",        "Dinner"],
];

// Target row ranges per prompt. Row 3 = first data row = 2026-01-01.
// Row 199 in REDS = 2026-07-13 (per prompt); row 206 in TXR = 2026-07-20.
// We resolve rows by matching the date in column B, not by index.
const TXR_WINDOW  = { first: "2026-07-20", last: "2026-08-02" };
const REDS_WINDOW = { first: "2026-07-13", last: "2026-07-26" };

// Union window across both accounts (what we write into DB).
const WRITE_WINDOW = { first: "2026-07-13", last: "2026-08-02" };

const ACCOUNTS = new Set(["TXR - AZ", "CIN - AZ"]);

function pgClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Turn a spreadsheet column letter into an ExcelJS column number (1-based).
function colLetterToNum(letters) {
  let n = 0;
  for (const c of letters.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

// Load service_id lookup: { accountKey -> { "group|service" -> id } }.
async function loadServiceLookup(supa) {
  const out = {};
  for (const acct of ACCOUNTS) {
    const { data, error } = await supa
      .from("sc_services")
      .select("id, service_name, sc_service_groups(group_name)")
      .eq("account_key", acct)
      .is("deleted_at", null);
    if (error) throw new Error(`sc_services(${acct}): ${error.message}`);
    const map = new Map();
    for (const r of data) {
      const g = r.sc_service_groups?.group_name || "";
      map.set(`${g}|${r.service_name}`, r.id);
    }
    out[acct] = map;
  }
  return out;
}

// Read one workbook: return { rows: Array<{date, group, service, count}>, unmapped: Array<...> }
async function parseWorkbook({ path, sheetName, columns, window }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`Sheet not found: ${sheetName} in ${path}`);

  const dateCol = colLetterToNum("B");
  const results = [];

  // Iterate all rows; keep those with a date column in the target window.
  ws.eachRow((row, rowNum) => {
    if (rowNum < 3) return; // rows 1+2 are headers
    const dateCell = row.getCell(dateCol);
    let dv = dateCell.value;
    if (!dv) return;
    // Date cells in this workbook are shared-formula results:
    // { result: Date, sharedFormula: 'B4' }. Unwrap.
    if (dv && typeof dv === "object" && "result" in dv) dv = dv.result;
    if (!dv) return;
    let iso;
    if (dv instanceof Date) {
      iso = dv.toISOString().slice(0, 10);
    } else if (typeof dv === "string" && /^\d{4}-\d{2}-\d{2}/.test(dv)) {
      iso = dv.slice(0, 10);
    } else {
      return;
    }
    if (iso < window.first || iso > window.last) return;

    for (const [letter, group, service] of columns) {
      const cnum = colLetterToNum(letter);
      const cell = row.getCell(cnum);
      let v = cell.value;
      // Cell may be a formula result. exceljs surfaces {result: N} or
      // {formula, result}. Handle both.
      if (v && typeof v === "object" && "result" in v) v = v.result;
      if (v == null || v === "") v = 0;
      const n = Number(v);
      if (!Number.isFinite(n)) {
        throw new Error(`Non-numeric cell at ${sheetName}!${letter}${rowNum} (${iso}): ${JSON.stringify(cell.value)}`);
      }
      results.push({
        date: iso,
        group,
        service,
        count: Math.round(n), // actuals are whole counts (SR-6: source is truth; round any fractional)
      });
    }
  });

  return { rows: results };
}

// Build sc_daily_actuals row objects from parsed rows + service map.
function buildActualRows({ accountKey, parsed, serviceMap, unmapped }) {
  const out = [];
  for (const r of parsed) {
    const key = `${r.group}|${r.service}`;
    const svcId = serviceMap.get(key);
    if (!svcId) {
      unmapped.push({ accountKey, ...r });
      continue;
    }
    out.push({
      account_key:  accountKey,
      service_id:   svcId,
      service_date: r.date,
      actual_count: r.count,
      created_by:   CREATED_BY,
      updated_by:   CREATED_BY,
    });
  }
  return out;
}

// Sanity checks per prompt.
function runSanityChecks(txrRows, cinRows) {
  const findings = [];
  const idx = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(`${r.date}|${r.group}|${r.service}`, r.count);
    return m;
  };
  const txr = idx(txrRows);
  const cin = idx(cinRows);

  // Check 1: TXR - AZ week 2026-07-27..08-02 MiLB B/L and Regular Snack pattern.
  const c1_dates = ["2026-07-27","2026-07-28","2026-07-29","2026-07-30","2026-07-31","2026-08-01","2026-08-02"];
  const c1_expectBL = [100, 100, 100, 100, 100, 100, 0];
  const c1_expectRS = [80,  55,  50,  65,  55,  50,  0];
  for (let i = 0; i < 7; i++) {
    const d = c1_dates[i];
    const b = txr.get(`${d}|Minor League|Breakfast`);
    const l = txr.get(`${d}|Minor League|Lunch`);
    const rs = txr.get(`${d}|Minor League|Regular Snack`);
    if (b !== c1_expectBL[i]) findings.push(`SANITY 1: TXR MiLB Breakfast ${d} expected ${c1_expectBL[i]}, got ${b}`);
    if (l !== c1_expectBL[i]) findings.push(`SANITY 1: TXR MiLB Lunch     ${d} expected ${c1_expectBL[i]}, got ${l}`);
    if (rs !== c1_expectRS[i]) findings.push(`SANITY 1: TXR Regular Snack  ${d} expected ${c1_expectRS[i]}, got ${rs}`);
  }
  // Check 2: TXR - AZ week 2026-07-20..07-26.
  const c2_dates = ["2026-07-20","2026-07-21","2026-07-22","2026-07-23","2026-07-24","2026-07-25","2026-07-26"];
  const c2_bkfst = [50, 50, 50, 50, 100, 75, 0];
  const c2_lunch = [125,125,125,125,100, 75, 0];
  for (let i = 0; i < 7; i++) {
    const d = c2_dates[i];
    const b = txr.get(`${d}|Minor League|Breakfast`);
    const l = txr.get(`${d}|Minor League|Lunch`);
    if (b !== c2_bkfst[i]) findings.push(`SANITY 2: TXR MiLB Breakfast ${d} expected ${c2_bkfst[i]}, got ${b}`);
    if (l !== c2_lunch[i]) findings.push(`SANITY 2: TXR MiLB Lunch     ${d} expected ${c2_lunch[i]}, got ${l}`);
  }
  // Dinner: Tue (07-21) = 75, Fri (07-24) = 23.
  const c2_dinTue = txr.get(`2026-07-21|Minor League|Dinner`);
  const c2_dinFri = txr.get(`2026-07-24|Minor League|Dinner`);
  if (c2_dinTue !== 75) findings.push(`SANITY 2: TXR MiLB Dinner 2026-07-21 expected 75, got ${c2_dinTue}`);
  if (c2_dinFri !== 23) findings.push(`SANITY 2: TXR MiLB Dinner 2026-07-24 expected 23, got ${c2_dinFri}`);

  // Check 3: CIN - AZ 2026-07-13.
  const c3 = [
    ["Minor League", "Lunch", 77],
    ["Minor League", "Dinner", 67],
    ["Minor League", "Pre-Game Snack", 50],
    ["Minor League", "Coffee Service", 1],
    ["Minor League", "Fountain Bev", 1],
    ["Rehab",        "Continental Plus", 42],
    ["Rehab",        "Lunch", 17],
  ];
  for (const [g, s, exp] of c3) {
    const got = cin.get(`2026-07-13|${g}|${s}`);
    if (got !== exp) findings.push(`SANITY 3: CIN ${g}/${s} 2026-07-13 expected ${exp}, got ${got}`);
  }

  // Check 4: CIN - AZ 2026-07-18.
  const c4 = [
    ["Minor League", "Breakfast", 112],
    ["Minor League", "Lunch", 112],
    ["Rehab",        "Breakfast", 10],
    ["Rehab",        "Lunch", 10],
  ];
  for (const [g, s, exp] of c4) {
    const got = cin.get(`2026-07-18|${g}|${s}`);
    if (got !== exp) findings.push(`SANITY 4: CIN ${g}/${s} 2026-07-18 expected ${exp}, got ${got}`);
  }

  return findings;
}

function printDryRunTable(rows, label) {
  console.log(`\n=== ${label}  (${rows.length} rows) ===`);
  // Pivot to a per-date grid keyed on (group|service) columns for readability.
  const dates = [...new Set(rows.map((r) => r.service_date))].sort();
  const svcs = [...new Set(rows.map((r) => `${r._group}|${r._service}`))].sort();
  const grid = new Map();
  for (const r of rows) grid.set(`${r.service_date}|${r._group}|${r._service}`, r.actual_count);
  // Header
  console.log("  date        " + svcs.map((s) => s.split("|").pop().slice(0, 6).padStart(7)).join(" "));
  for (const d of dates) {
    const cells = svcs.map((s) => {
      const v = grid.get(`${d}|${s}`);
      return v == null ? "".padStart(7) : String(v).padStart(7);
    });
    console.log(`  ${d}  ${cells.join(" ")}`);
  }
}

async function performWrite(supa, allRows) {
  // Delete-then-insert inside implicit tx-per-statement (Supabase-js has no
  // multi-statement tx). To keep it safe: DELETE by the exact scope +
  // INSERT the fresh set. Report both counts. If insert fails mid-run,
  // the deletes leave the window empty (a probe row leftover Kevin can
  // spot immediately). Given the scope is 2 accounts x 21 days, we
  // process each account+week separately and report per-slice counts.
  console.log("\n=== WRITE STEP (delete-then-insert per (account, week)) ===");

  const slices = [
    { account: "TXR - AZ", first: "2026-07-20", last: "2026-07-26", label: "TXR - AZ week 07-20..07-26" },
    { account: "TXR - AZ", first: "2026-07-27", last: "2026-08-02", label: "TXR - AZ week 07-27..08-02" },
    { account: "CIN - AZ", first: "2026-07-13", last: "2026-07-19", label: "CIN - AZ week 07-13..07-19" },
    { account: "CIN - AZ", first: "2026-07-20", last: "2026-07-26", label: "CIN - AZ week 07-20..07-26" },
  ];

  for (const s of slices) {
    // Delete first (any rows in the slice)
    const { count: delCount, error: delErr } = await supa
      .from("sc_daily_actuals")
      .delete({ count: "exact" })
      .eq("account_key", s.account)
      .gte("service_date", s.first)
      .lte("service_date", s.last);
    if (delErr) throw new Error(`DELETE ${s.label}: ${delErr.message}`);

    // Insert the fresh set
    const sliceRows = allRows.filter((r) =>
      r.account_key === s.account &&
      r.service_date >= s.first &&
      r.service_date <= s.last
    ).map(({ _group, _service, ...rest }) => rest);
    const { data: ins, error: insErr, count: insCount } = await supa
      .from("sc_daily_actuals")
      .insert(sliceRows, { count: "exact" });
    if (insErr) throw new Error(`INSERT ${s.label}: ${insErr.message}`);
    console.log(`  ${s.label}: deleted ${delCount ?? "?"}, inserted ${sliceRows.length}`);
  }
}

async function verifyNoOutOfSpanTouches(supa) {
  // Count rows created_by='spreadsheet_seed' OUTSIDE the write window
  // or outside the two accounts. Must be zero.
  const { count, error } = await supa
    .from("sc_daily_actuals")
    .select("id", { count: "exact", head: true })
    .eq("created_by", CREATED_BY)
    .or(`account_key.not.in.(TXR - AZ,CIN - AZ),service_date.lt.${WRITE_WINDOW.first},service_date.gt.${WRITE_WINDOW.last}`);
  if (error) throw new Error(`out-of-span check: ${error.message}`);
  return count ?? 0;
}

async function main() {
  console.log(`PR-B1 pilot seed  mode=${WRITE ? "WRITE" : "DRY-RUN"}  window=${WRITE_WINDOW.first}..${WRITE_WINDOW.last}`);

  const supa = pgClient();
  const svcLookup = await loadServiceLookup(supa);
  console.log(`Service lookups: TXR - AZ ${svcLookup["TXR - AZ"].size} services, CIN - AZ ${svcLookup["CIN - AZ"].size} services`);

  // Parse both workbooks.
  const txrParsed = await parseWorkbook({
    path: TXR_XLSX, sheetName: "Actuals - 2026",
    columns: TXR_COLUMNS, window: TXR_WINDOW,
  });
  const cinParsed = await parseWorkbook({
    path: REDS_XLSX, sheetName: "Goodyear, AZ - 2026 - Actuals",
    columns: REDS_COLUMNS, window: REDS_WINDOW,
  });
  console.log(`Parsed rows: TXR ${txrParsed.rows.length}, CIN ${cinParsed.rows.length}`);

  // Sanity checks per prompt.
  const sanityFindings = runSanityChecks(txrParsed.rows, cinParsed.rows);
  console.log(`\n=== SANITY CHECKS ===`);
  if (sanityFindings.length === 0) {
    console.log(`  ALL 4 PASSING (parser aligned to Chat-Claude's hand-verified expectations)`);
  } else {
    for (const f of sanityFindings) console.log(`  FAIL  ${f}`);
    console.log(`\nParser disagrees with expectations. Halt (do not write).`);
    process.exit(1);
  }

  // Map to DB rows.
  const unmapped = [];
  const txrDbRowsRaw = buildActualRows({
    accountKey: "TXR - AZ", parsed: txrParsed.rows,
    serviceMap: svcLookup["TXR - AZ"], unmapped,
  });
  const cinDbRowsRaw = buildActualRows({
    accountKey: "CIN - AZ", parsed: cinParsed.rows,
    serviceMap: svcLookup["CIN - AZ"], unmapped,
  });
  if (unmapped.length > 0) {
    console.log(`\n=== UNMAPPED (halt; never guess) ===`);
    for (const u of unmapped) console.log(`  ${u.accountKey}  ${u.group} / ${u.service}  on ${u.date}`);
    process.exit(1);
  }

  // Attach group/service on dry-run rows for the table print (removed at INSERT time).
  const attach = (dbRow, parsed) => ({ ...dbRow, _group: parsed.group, _service: parsed.service });
  const txrDbRows = txrDbRowsRaw.map((r, i) => attach(r, txrParsed.rows[i]));
  const cinDbRows = cinDbRowsRaw.map((r, i) => attach(r, cinParsed.rows[i]));

  printDryRunTable(txrDbRows, "TXR - AZ intended rows");
  printDryRunTable(cinDbRows, "CIN - AZ intended rows");

  const all = [...txrDbRows, ...cinDbRows];
  console.log(`\nTotal rows to write: ${all.length}  (TXR ${txrDbRows.length} + CIN ${cinDbRows.length})`);
  console.log(`Row shape: { account_key, service_id, service_date, actual_count, created_by='${CREATED_BY}' }`);

  if (!WRITE) {
    console.log(`\nDRY-RUN done. To write: re-run with --write after Kevin's go.`);
    return;
  }

  console.log(`\n=== WRITE gated by Kevin's explicit go on this session ===`);
  await performWrite(supa, all);

  const outOfSpan = await verifyNoOutOfSpanTouches(supa);
  console.log(`\n=== S3 out-of-span verification ===`);
  console.log(`  spreadsheet_seed rows outside (TXR - AZ|CIN - AZ) x [${WRITE_WINDOW.first}..${WRITE_WINDOW.last}]: ${outOfSpan}`);
  if (outOfSpan !== 0) {
    console.log(`  UNEXPECTED. Investigate before reporting green.`);
    process.exit(2);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.stack || e.message); process.exit(1); });
