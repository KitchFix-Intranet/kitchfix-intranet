#!/usr/bin/env node
// Per-tab service catalog probe for the historical SC load.
// Verifies parseStandard's new numeric-rate requirement is not
// excluding legitimate flat-fee services (a service name paired
// with a non-numeric or empty rate, e.g. TBJ Fun Money).
//
// Emits per tab: accepted services + any REJECTED column past
// the stop point that has a text name (candidate for widening
// the rule if it looks like a real service).
//
// USAGE:
//   node --env-file=.env.local scripts/probes/_probe_historical_sc_services.mjs

import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const STAGE = path.join(REPO, "scripts/billing/inputs/historical-sc");
const MANIFEST = path.join(REPO, "scripts/billing/inputs/KF_Historical_SC_Manifest.xlsx");

function unwrap(v) {
  if (v && typeof v === "object" && !(v instanceof Date) && "result" in v) return v.result;
  return v;
}
function isDate(v) { const u = unwrap(v); return u instanceof Date && !isNaN(u.getTime()); }
function asNum(v) {
  const u = unwrap(v);
  if (typeof u === "number") return u;
  if (u == null || u === "") return null;
  const n = Number(u);
  return Number.isFinite(n) ? n : null;
}
function asText(v) { const u = unwrap(v); return u == null ? null : String(u); }

function firstDataRow(ws) {
  for (let r = 1; r <= Math.min(ws.rowCount, 12); r++) {
    if (isDate(ws.getCell(r, 2).value)) return r;
  }
  return null;
}
function lastColOn(ws, row) {
  let last = ws.columnCount;
  for (let c = ws.columnCount; c >= 1; c--) {
    const v = ws.getCell(row, c).value;
    if (v !== null && v !== "" && v !== undefined) { last = c; break; }
  }
  return last;
}
function classifyFamily(ws) {
  const fdr = firstDataRow(ws); if (!fdr) return "NO-DATE";
  const hr = fdr - 1; const last = lastColOn(ws, hr);
  const colD = (asText(ws.getCell(hr, 4).value) ?? "").trim();
  const colE = (asText(ws.getCell(hr, 5).value) ?? "").trim();
  if (colD.toLowerCase() === "lunch") return "BG-SINGLE";
  const bands = [];
  for (let c = 6; c <= last; c++) {
    const v = asText(ws.getCell(1, c).value);
    if (v != null && v.trim() !== "") bands.push(v);
  }
  if (bands.length >= 1 && colE === "Week") return "TBR-STD";
  if (bands.length >= 1) return "STANDARD";
  return "UNKNOWN";
}
function findSheet(wb, wanted) {
  for (const s of wb.worksheets) if (s.name === wanted) return s;
  for (const s of wb.worksheets) if (s.name.trim() === wanted.trim()) return s;
  for (const s of wb.worksheets) if (s.name.startsWith(wanted)) return s;
  for (const s of wb.worksheets) if (s.name.trim().startsWith(wanted.trim().replace(/-\s*$/, "").trim())) return s;
  return null;
}

// Replicate the loader's serviceStart + service-list detection with
// EXTRA reporting: accepted services + any post-stop column with a
// text-name candidate.
function catalogTab(ws) {
  const fdr = firstDataRow(ws); if (!fdr) return null;
  const hr = fdr - 1; const last = lastColOn(ws, hr);

  // service start: first (text, number) pair
  let start = null;
  for (let c = 3; c < last; c++) {
    const n = unwrap(ws.getCell(hr, c).value);
    const rt = unwrap(ws.getCell(hr, c + 1).value);
    if (n == null || n === "") continue;
    if (typeof n === "number") continue;
    if (typeof rt === "number") { start = c; break; }
  }
  if (start == null) return { start: null, accepted: [], rejected: [] };

  const bandByCol = []; let cur = null;
  for (let c = 1; c <= last; c++) {
    const v = asText(ws.getCell(1, c).value);
    if (v != null && v.trim() !== "") cur = v.trim();
    bandByCol[c] = cur;
  }

  const accepted = [];
  const rejected = [];
  let stopped = false;
  for (let c = start; c <= last; c += 2) {
    const nameRaw = ws.getCell(hr, c).value;
    const name = asText(nameRaw);
    if (name == null || name.trim() === "") continue;
    const rateRaw = ws.getCell(hr, c + 1).value;
    const rate = asNum(rateRaw);
    if (rate == null) {
      // Would have been accepted by old rule, rejected by new rule.
      // Report ANY text-name column with rate == null, whether the
      // loader has already stopped or not. That way Kevin sees the
      // full trailing block.
      rejected.push({
        col: c,
        name: name.trim(),
        rate_col: c + 1,
        rate_raw: rateRaw === undefined ? null : (typeof rateRaw === "object" ? JSON.stringify(rateRaw).slice(0, 60) : String(rateRaw)),
        group: bandByCol[c] ?? null,
        would_stop_loader: !stopped,   // first rejection is where loader breaks
      });
      stopped = true;
      continue;   // keep scanning to show the full trailing tail
    }
    if (stopped) {
      // loader has already broken by our rule, but there's a text-name
      // with a numeric rate PAST the stop point. Very unusual - flag.
      rejected.push({
        col: c, name: name.trim(), rate_col: c + 1,
        rate_raw: String(rate),
        group: bandByCol[c] ?? null,
        would_stop_loader: false, note: "orphaned service PAST loader stop"
      });
      continue;
    }
    accepted.push({ col: c, name: name.trim(), rate, group: bandByCol[c] ?? null });
  }
  return { start, accepted, rejected };
}

// Manifest
const wbm = new ExcelJS.Workbook();
await wbm.xlsx.readFile(MANIFEST);
const wsm = wbm.getWorksheet("Manifest");
const tabs = [];
wsm.eachRow({ includeEmpty: false }, (row, idx) => {
  if (idx < 7) return;
  const f = row.getCell(3).value;
  const t = row.getCell(4).value;
  const u = row.getCell(7).value;
  if (!f) return;
  if (typeof u !== "string" || !["ACTUALS", "PROJECTIONS"].includes(u.trim())) return;
  tabs.push({ file: String(f).trim(), tab: String(t ?? "").trim(), use: u.trim(), account: String(row.getCell(1).value ?? "").trim() });
});

const byFile = new Map();
for (const t of tabs) { if (!byFile.has(t.file)) byFile.set(t.file, []); byFile.get(t.file).push(t); }

const SUMMARY_TELLS = new Set([
  "Total Revenue", "Total Meals", "Total Snacks",
  "Total Charged Items", "Average $/Item", "Total Charged Meals",
]);

let allRejected = [];
for (const [fname, tlist] of byFile) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(STAGE, fname));
  for (const t of tlist) {
    const ws = findSheet(wb, t.tab);
    if (!ws) continue;
    const fam = classifyFamily(ws);
    if (fam !== "STANDARD" && fam !== "TBR-STD") continue;
    const cat = catalogTab(ws);
    if (!cat) continue;
    console.log(`\n${fname}  ->  ${ws.name}  [${fam}]  ${cat.accepted.length} accepted, ${cat.rejected.length} rejected`);
    // Group accepted by band for readability
    const grouped = {};
    for (const s of cat.accepted) {
      const g = s.group || "(no group)";
      if (!grouped[g]) grouped[g] = [];
      grouped[g].push(`${s.name}($${s.rate})`);
    }
    for (const g of Object.keys(grouped)) {
      console.log(`  ${g}:  ${grouped[g].join(", ")}`);
    }
    if (cat.rejected.length > 0) {
      console.log(`  REJECTED past stop:`);
      for (const r of cat.rejected) {
        const isSummary = SUMMARY_TELLS.has(r.name);
        const marker = isSummary ? "" : "  <-- REAL-SERVICE CANDIDATE";
        console.log(`    col ${r.col} name=${JSON.stringify(r.name)}  rate_raw=${r.rate_raw}${marker}`);
        if (!isSummary) allRejected.push({ file: fname, tab: ws.name, ...r });
      }
    }
  }
}

console.log(`\n${"=".repeat(72)}`);
console.log(`SUMMARY: rejected columns that are NOT known summary tells`);
console.log("=".repeat(72));
if (allRejected.length === 0) {
  console.log("  (none - every rejected column is a known summary tell)");
} else {
  for (const r of allRejected) {
    console.log(`  ${r.file}  ${r.tab}  col ${r.col}  name=${JSON.stringify(r.name)}  rate_raw=${r.rate_raw}`);
  }
}
