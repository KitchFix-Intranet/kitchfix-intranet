#!/usr/bin/env node
// Amount-service candidate probe for the historical SC load.
// Kevin ruling 2026-09-17: scan all 43 tabs for services whose
// header rate is implausible as a per-cover price. Kevin rules on
// which are amount-services (revenue stored as dollars in the
// count column) vs per-cover services (revenue = count * rate).
//
// Also checks whether an amount-service row exists in other years
// with a smaller allocation (rate=0 case) so an inflated total
// doesn't slip past because "the number looks about right".
//
// USAGE:
//   node --env-file=.env.local scripts/probes/_probe_historical_sc_amount_candidates.mjs

import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const STAGE = path.join(REPO, "scripts/billing/inputs/historical-sc");
const MANIFEST = path.join(REPO, "scripts/billing/inputs/KF_Historical_SC_Manifest.xlsx");

const RATE_THRESHOLD = 500;   // Kevin's ruling: implausible as per-cover

// ─── ExcelJS cell helpers (same as loader) ───────────────────────
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

// Replicate the loader's service list: dynamic start, numeric-rate required.
function detectServices(ws) {
  const fdr = firstDataRow(ws); if (!fdr) return { services: [], hr: null };
  const hr = fdr - 1; const last = lastColOn(ws, hr);
  let start = null;
  for (let c = 3; c < last; c++) {
    const n = unwrap(ws.getCell(hr, c).value);
    const rt = unwrap(ws.getCell(hr, c + 1).value);
    if (n == null || n === "") continue;
    if (typeof n === "number") continue;
    if (typeof rt === "number") { start = c; break; }
  }
  if (start == null) return { services: [], hr };
  const bandByCol = []; let cur = null;
  for (let c = 1; c <= last; c++) {
    const v = asText(ws.getCell(1, c).value);
    if (v != null && v.trim() !== "") cur = v.trim();
    bandByCol[c] = cur;
  }
  const services = [];
  for (let c = start; c <= last; c += 2) {
    const name = asText(ws.getCell(hr, c).value);
    if (name == null || name.trim() === "") continue;
    const rate = asNum(ws.getCell(hr, c + 1).value);
    if (rate == null) break;
    services.push({ col: c, name: name.trim(), rate, group: bandByCol[c] ?? null });
  }
  return { services, hr };
}

// Count non-null, non-zero data-row values in a given column for a
// tab. Also sum them so Kevin can eyeball annual totals.
function scanColumn(ws, col, hr) {
  if (hr == null) return { nonzero: 0, sum: 0, sample: null };
  let nonzero = 0, sum = 0, sample = null;
  for (let r = hr + 1; r <= ws.rowCount; r++) {
    const d = ws.getCell(r, 2).value;
    if (!isDate(d)) continue;
    const v = asNum(ws.getCell(r, col).value);
    if (v == null || v <= 0) continue;
    nonzero++;
    sum += v;
    if (sample == null) {
      const dt = unwrap(d);
      sample = { date: dt.toISOString().slice(0, 10), value: v };
    }
  }
  return { nonzero, sum, sample };
}

// ─── Manifest ────────────────────────────────────────────────────
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
  tabs.push({
    file: String(f).trim(),
    tab: String(t ?? "").trim(),
    use: u.trim(),
    account: String(row.getCell(1).value ?? "").trim(),
    year: row.getCell(2).value,
  });
});

const byFile = new Map();
for (const t of tabs) { if (!byFile.has(t.file)) byFile.set(t.file, []); byFile.get(t.file).push(t); }

// ─── Pass 1: header scan for high-rate services ───────────────────
console.log(`=== PASS 1: services with header rate > $${RATE_THRESHOLD} (candidates for amount-service list) ===\n`);
const highRateHits = [];   // { file, tab, account, year, use, service, rate, group, col, hr, ws }
for (const [fname, tlist] of byFile) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(STAGE, fname));
  for (const t of tlist) {
    const ws = findSheet(wb, t.tab);
    if (!ws) continue;
    const fam = classifyFamily(ws);
    if (fam !== "STANDARD" && fam !== "TBR-STD") continue;
    const { services, hr } = detectServices(ws);
    for (const s of services) {
      if (s.rate > RATE_THRESHOLD) {
        highRateHits.push({
          file: fname, tab: ws.name, account: t.account, year: t.year, use: t.use,
          service: s.name, rate: s.rate, group: s.group, col: s.col, hr, ws
        });
      }
    }
  }
}
if (highRateHits.length === 0) {
  console.log("  (none)");
} else {
  // Group by service_name for readability
  const byName = new Map();
  for (const h of highRateHits) {
    if (!byName.has(h.service)) byName.set(h.service, []);
    byName.get(h.service).push(h);
  }
  for (const [name, hits] of byName) {
    console.log(`\n  service_name: ${JSON.stringify(name)}   (${hits.length} occurrence(s))`);
    for (const h of hits) {
      const scan = scanColumn(h.ws, h.col, h.hr);
      const sampleTxt = scan.sample ? `sample ${scan.sample.date} value=${scan.sample.value}` : "no non-zero rows";
      console.log(`    ${h.account.padEnd(10)} ${String(h.year).padEnd(6)} ${h.use.padEnd(11)}  rate=$${h.rate}  group=${JSON.stringify(h.group)}`);
      console.log(`      ${h.file.slice(0,40).padEnd(40)} -> ${h.tab.slice(0,32).padEnd(32)}  col ${h.col}`);
      console.log(`      data-row scan: ${scan.nonzero} non-zero rows, sum-if-treated-as-count=${scan.sum.toFixed(2)}, ${sampleTxt}`);
    }
  }
}

// ─── Pass 2: also check any service NAMED like an amount service
//     across all rate values (catches rate=$0 case). ─────────────
console.log(`\n\n=== PASS 2: same service names, other years / rate values ===`);
console.log(`Kevin's warning: TBJ Fun Money with rate=$0 exists in 2023/2024, would inflate less visibly.`);
console.log(`For every high-rate service name observed above, scan every tab for the SAME name at any rate.\n`);
const highRateNames = new Set(highRateHits.map(h => h.service));
if (highRateNames.size === 0) {
  console.log("  (no high-rate names to scan for)");
} else {
  const nameOccurrences = new Map();   // service_name -> list of {file, tab, account, year, use, rate, col, ws, hr}
  for (const [fname, tlist] of byFile) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(STAGE, fname));
    for (const t of tlist) {
      const ws = findSheet(wb, t.tab);
      if (!ws) continue;
      const fam = classifyFamily(ws);
      if (fam !== "STANDARD" && fam !== "TBR-STD") continue;
      const { services, hr } = detectServices(ws);
      for (const s of services) {
        if (!highRateNames.has(s.name)) continue;
        if (!nameOccurrences.has(s.name)) nameOccurrences.set(s.name, []);
        nameOccurrences.get(s.name).push({
          file: fname, tab: ws.name, account: t.account, year: t.year, use: t.use,
          rate: s.rate, col: s.col, ws, hr
        });
      }
    }
  }
  for (const [name, occurrences] of nameOccurrences) {
    console.log(`\n  service_name: ${JSON.stringify(name)}`);
    for (const o of occurrences) {
      const scan = scanColumn(o.ws, o.col, o.hr);
      const revenue_if_amount = scan.sum;   // sum of values, treated as dollars
      const revenue_if_count  = scan.sum * o.rate;   // current loader behaviour
      console.log(`    ${o.account.padEnd(10)} ${String(o.year).padEnd(6)} ${o.use.padEnd(11)}  rate=$${o.rate}  ${o.file.slice(0,32).padEnd(32)} -> ${o.tab.slice(0,28)}`);
      console.log(`      ${scan.nonzero} non-zero data rows, sum=${scan.sum.toFixed(2)}`);
      console.log(`      IF amount-service (revenue = value column):     $${revenue_if_amount.toFixed(2)}`);
      console.log(`      IF per-cover (current loader: revenue = v * rate): $${revenue_if_count.toFixed(2)}`);
    }
  }
}

// ─── Pass 3: query the DB to see current in-loader emission ─────
console.log(`\n\n=== PASS 3: current DB state for these service names ===`);
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log("  (skipping DB query - SUPABASE_URL / _KEY not set)");
} else {
  const s = createClient(url, key, { auth: { persistSession: false } });
  for (const name of highRateNames) {
    console.log(`\n  service_name = ${JSON.stringify(name)}`);
    for (const t of ["sc_historical_actuals", "sc_historical_projections"]) {
      let sum = 0, count = 0, offset = 0;
      while (true) {
        const { data, error } = await s.from(t)
          .select("account_key, service_date, revenue, count").eq("service_name", name).range(offset, offset + 999);
        if (error) { console.log(`    err on ${t}:`, error.message); break; }
        for (const r of data || []) { sum += Number(r.revenue || 0); count++; }
        if (!data || data.length < 1000) break;
        offset += 1000;
      }
      console.log(`    ${t.padEnd(30)} ${count} rows currently loaded, sum(revenue) = $${sum.toFixed(2)}`);
    }
  }
}
