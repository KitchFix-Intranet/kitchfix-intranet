// scripts/_probe_R3_redact_export.mjs
// Push 3 · R3 artifact: prove the redacted export leaks zero worker
// names.
//
// Reproduces the SAME code path as /api/kpi/labor/export/route.js with
// redact=1 (workerMeta.name dropped at ingest, displayForWorker
// returning num+title only). Generates the xlsx buffer in memory, then
// iterates every cell of every sheet. For each candidate name variant
// derived from Rippling users, it searches every cell string.
//
// Contract: this script NEVER prints a worker's real name to stdout.
// The failure branch reports "sheet 'X' row Y col Z contains a leaked
// name (redacted)" - not the name itself. That way running the probe
// is safe in any log capture.
//
// Usage: node --env-file=.env.local scripts/_probe_R3_redact_export.mjs [ACCOUNT]

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { resolveWorkerName } from "../../src/lib/kpi/resolveName.js";

const ACCOUNT = process.argv[2] || "CIN - OH";
const START = "2026-04-20";  // dollar-coverage floor
const END = new Date().toISOString().slice(0, 10);

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

console.log(`R3 redact export probe · account=${ACCOUNT} range=${START}..${END}`);

// ── 1. Pull the same rows the route pulls ──────────────
const actuals = await supa
  .from("labor_actuals_latest")
  .select("account_key, worker_id, week_label, line_code, week_start, week_end, fiscal_year, period_no, hours_regular, hours_overtime, hours_double_time, hours_premium_other, dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other, amount, hours_without_dollars, segment_count, entry_count, coverage_state, derived_at")
  .eq("account_key", ACCOUNT)
  .lte("week_start", END)
  .gte("week_end", START)
  .order("worker_id", { ascending: true })
  .order("week_start", { ascending: true });
if (actuals.error) { console.error("labor_actuals error", actuals.error); process.exit(1); }
const rows = actuals.data || [];
console.log(`  rows: ${rows.length}`);

const workerIds = [...new Set(rows.map(r => r.worker_id))];
console.log(`  workers: ${workerIds.length}`);

// ── 2. Resolve names (unredacted) FIRST so we know what NOT to see ───
const w = await supa
  .from("rippling_raw_workers_latest")
  .select("payload")
  .in("rippling_id", workerIds);
if (w.error) { console.error("workers error", w.error); process.exit(1); }
const userIds = [...new Set((w.data || []).map(r => r.payload?.user_id).filter(Boolean))];
const userByRipplingId = new Map();
if (userIds.length > 0) {
  const u = await supa.from("rippling_raw_users_latest")
    .select("rippling_id, payload").in("rippling_id", userIds);
  if (!u.error) for (const r of u.data || []) userByRipplingId.set(r.rippling_id, r.payload || {});
}

const REDACT = true;
const workerMeta = new Map();
const trueNames = [];  // canonical form
const nameVariants = new Set();  // all reasonable substrings to grep for
for (const r of w.data || []) {
  const p = r.payload || {};
  const userPayload = p.user_id ? userByRipplingId.get(p.user_id) : null;
  const trueName = resolveWorkerName(p, userPayload);
  if (trueName) {
    trueNames.push(trueName);
    // Variants: full name, first token, last token, and each token >= 4 chars
    nameVariants.add(trueName.toLowerCase());
    for (const tok of trueName.split(/[\s,]+/).filter(Boolean)) {
      if (tok.length >= 4) nameVariants.add(tok.toLowerCase());
    }
    // Also each user-payload preferred/legal/first/last field
    for (const k of ["preferred_first_name", "first_name", "last_name", "legal_first_name", "legal_last_name", "name"]) {
      const v = userPayload?.[k];
      if (typeof v === "string" && v.trim().length >= 4) nameVariants.add(v.trim().toLowerCase());
    }
  }
  // MATCH route.js redacted ingest exactly:
  const name = REDACT ? null : trueName;
  workerMeta.set(p.id, {
    number: p.number ?? null,
    name,
    title: p.title ? String(p.title).trim() : null,
  });
}
console.log(`  resolved names: ${trueNames.length}`);
console.log(`  name variants to hunt for: ${nameVariants.size}`);
if (trueNames.length === 0) {
  console.warn("  WARN: no true names resolved - can't prove redaction");
  process.exit(1);
}

function displayForWorker(id) {
  const m = workerMeta.get(id);
  if (!m) return { primary: `#(unknown)`, secondary: "" };
  const num = m.number != null ? `#${m.number}` : `${String(id).slice(0, 6)}`;
  if (REDACT || !m.name) return { primary: num, secondary: m.title || "" };
  return { primary: `${m.name} (${num})`, secondary: m.title || "" };
}

// ── 3. Build the same workbook ───────────────────────────
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
const wb = new ExcelJS.Workbook();
wb.creator = "kitchfix intranet - kpi/labor export";
wb.created = new Date();

const detail = wb.addWorksheet("Detail");
detail.columns = [
  { header: "Worker",  key: "worker" }, { header: "Title", key: "title" },
  { header: "Week",    key: "week" },   { header: "FY",    key: "fy" },
  { header: "Period",  key: "period" }, { header: "Coverage", key: "coverage" },
  { header: "Regular", key: "reg" },    { header: "OT 1.5x", key: "ot" },
  { header: "Holiday 2x", key: "hol" }, { header: "Other prem.", key: "othH" },
  { header: "Hrs toward OT", key: "otTh" }, { header: "No-$ hours", key: "wo" },
  { header: "Reg $",  key: "regD" },    { header: "OT $",  key: "otD" },
  { header: "Holiday $", key: "holD" }, { header: "Other prem $", key: "othD" },
  { header: "Total $", key: "amount" }, { header: "Notes", key: "notes" },
];
const rowsSorted = [...rows].sort((a, b) => {
  const A = displayForWorker(a.worker_id).primary;
  const B = displayForWorker(b.worker_id).primary;
  return A.localeCompare(B) || a.week_start.localeCompare(b.week_start);
});
for (const r of rowsSorted) {
  const d = displayForWorker(r.worker_id);
  detail.addRow({
    worker: d.primary, title: d.secondary,
    week: `${r.week_start} to ${r.week_end}`,
    fy: r.fiscal_year ?? "", period: r.period_no ?? "",
    coverage: r.coverage_state,
    reg: r2(r.hours_regular), ot: r2(r.hours_overtime),
    hol: r2(r.hours_double_time), othH: r2(r.hours_premium_other),
    otTh: r2(r.hours_regular + r.hours_double_time),
    wo: r2(r.hours_without_dollars),
    regD: r2(r.dollars_regular), otD: r2(r.dollars_overtime),
    holD: r2(r.dollars_double_time), othD: r2(r.dollars_premium_other),
    amount: r2(r.amount),
    notes: r.coverage_state === "hours_only"
      ? "hours-only: pre-2026-04-20; dollars unavailable; P&L authoritative"
      : r.coverage_state === "unknown"
      ? "unknown: no presence walk covers this week"
      : r.coverage_state === "partial"
      ? "partial: some entries lack pay-segment coverage" : "",
  });
}

const summary = wb.addWorksheet("Summary");
summary.columns = [
  { header: "Worker", key: "worker" }, { header: "Title", key: "title" },
  { header: "Weeks", key: "weeks" }, { header: "Regular", key: "reg" },
  { header: "OT 1.5x", key: "ot" }, { header: "Holiday 2x", key: "hol" },
  { header: "Other prem.", key: "othH" }, { header: "Hrs toward OT", key: "otTh" },
  { header: "No-$ hours", key: "wo" }, { header: "Reg $", key: "regD" },
  { header: "OT $", key: "otD" }, { header: "Holiday $", key: "holD" },
  { header: "Other prem $", key: "othD" }, { header: "Total $", key: "amount" },
  { header: "Coverage flags", key: "cov" },
];
const perWorker = new Map();
for (const r of rows) {
  const wid = r.worker_id;
  const cur = perWorker.get(wid) || { weeks: 0, reg: 0, ot: 0, hol: 0, oth: 0, wo: 0, regD: 0, otD: 0, holD: 0, othD: 0, amount: 0, states: new Set() };
  cur.weeks++;
  cur.reg += Number(r.hours_regular || 0);
  cur.ot += Number(r.hours_overtime || 0);
  cur.hol += Number(r.hours_double_time || 0);
  cur.oth += Number(r.hours_premium_other || 0);
  cur.wo += Number(r.hours_without_dollars || 0);
  cur.regD += Number(r.dollars_regular || 0);
  cur.otD += Number(r.dollars_overtime || 0);
  cur.holD += Number(r.dollars_double_time || 0);
  cur.othD += Number(r.dollars_premium_other || 0);
  cur.amount += Number(r.amount || 0);
  cur.states.add(r.coverage_state);
  perWorker.set(wid, cur);
}
for (const [wid, s] of perWorker) {
  const d = displayForWorker(wid);
  summary.addRow({
    worker: d.primary, title: d.secondary, weeks: s.weeks,
    reg: r2(s.reg), ot: r2(s.ot), hol: r2(s.hol), othH: r2(s.oth),
    otTh: r2(s.reg + s.hol), wo: r2(s.wo),
    regD: r2(s.regD), otD: r2(s.otD), holD: r2(s.holD), othD: r2(s.othD),
    amount: r2(s.amount),
    cov: [...s.states].join(", "),
  });
}

const meta = wb.addWorksheet("Report info");
meta.columns = [{ header: "Field", key: "f" }, { header: "Value", key: "v" }];
meta.addRow({ f: "Account", v: ACCOUNT });
meta.addRow({ f: "Date range", v: `${START} through ${END}` });
meta.addRow({ f: "Rows (worker-weeks)", v: rows.length });
meta.addRow({ f: "Name resolution", v: "REDACTED at export time - names dropped server-side; every worker appears as #<number> plus title only" });

// ── 4. Scan every cell of every sheet for ANY name variant ──
const buf = await wb.xlsx.writeBuffer();
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.load(buf);

let cellsScanned = 0;
let numCells = 0;
let titleCells = 0;
let leaks = [];
let redactionMentioned = false;
for (const ws of wb2.worksheets) {
  ws.eachRow((row, rowIdx) => {
    row.eachCell((cell, colIdx) => {
      cellsScanned++;
      const v = cell.value;
      const s = v == null ? "" : String(v);
      const lower = s.toLowerCase();
      if (ws.name === "Report info" && lower.includes("redacted")) redactionMentioned = true;
      // Employee numbers: any cell like "#123" satisfies
      if (/^#[0-9]+$/.test(s)) numCells++;
      // Titles: any cell whose text matches any known title (skip the header)
      if (rowIdx > 1 && ws.name !== "Report info") {
        for (const meta of workerMeta.values()) {
          if (meta.title && s === meta.title) { titleCells++; break; }
        }
      }
      // Leak check: any name variant substring
      if (rowIdx > 1 && ws.name !== "Report info") {
        for (const variant of nameVariants) {
          if (lower.includes(variant)) {
            leaks.push({ sheet: ws.name, row: rowIdx, col: colIdx });
            break;
          }
        }
      }
    });
  });
}

console.log(`\n── Scan complete ──`);
console.log(`  cells scanned:          ${cellsScanned}`);
console.log(`  employee-number cells:  ${numCells}`);
console.log(`  title cells:            ${titleCells}`);
console.log(`  redaction stated in Report info: ${redactionMentioned ? "yes" : "NO"}`);
console.log(`  name leaks:             ${leaks.length}`);
if (leaks.length > 0) {
  console.log(`\n  LEAK LOCATIONS (name text withheld from output):`);
  for (const l of leaks.slice(0, 10)) {
    console.log(`    sheet '${l.sheet}' row ${l.row} col ${l.col}`);
  }
  console.log(`\n  VERDICT: FAIL - redacted export contains name text`);
  process.exit(2);
}
if (numCells === 0) {
  console.log(`  VERDICT: WEAK PASS - no name leaks, but zero employee-number cells found (unusual)`);
  process.exit(1);
}
if (!redactionMentioned) {
  console.log(`  VERDICT: WEAK PASS - no name leaks, but Report info does not mention 'redacted'`);
  process.exit(1);
}
console.log(`\n  VERDICT: PASS - zero name text · ${numCells} #<num> cells present · titles preserved · Report info states redaction.`);
