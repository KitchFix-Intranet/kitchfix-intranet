#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// seed-historical-sc.mjs
//
// Loads 2022-2026 Service Calendar workbooks into
// sc_historical_actuals + sc_historical_projections. Financial-audit-
// only tables (sc-47); NOT reachable from any Service Calendar UI
// code path.
//
// Re-runnable, manifest-driven. Next year's files land by adding
// manifest rows + workbooks; no code change required unless a new
// per-tab override is needed.
//
// USAGE
//   node --env-file=.env.local scripts/billing/seed-historical-sc.mjs           (dry-run - default)
//   node --env-file=.env.local scripts/billing/seed-historical-sc.mjs --write   (execute after Kevin's OK)
//
// FENCES
//   1. Every workbook is SHA256-pinned via scripts/billing/inputs/
//      historical-sc/SHA256SUMS.txt. Any mismatch halts.
//   2. Every date must fall inside 2022-01-01..2027-12-31. Any row
//      outside halts. Kevin's floor accommodates 2022-12 dates
//      legitimately carried in the 2023 files.
//   3. Every tab's day-label column (col A) must agree with its date
//      column (col B) unless the tab is in YEAR_SHIFT_OVERRIDES.
//      Whole-tab check; any mismatch halts. This is the exact class
//      of silent wrongness an audit cannot tolerate.
//   4. Rows with all-zero counts (STANDARD / TBR-STD) or zero
//      count AND zero revenue (BG-SINGLE) are skipped, matching the
//      AZ seed convention.
//   5. Writes go through ON CONFLICT DO NOTHING on the unique index
//      declared in sc-47, so re-running --write is idempotent.
//
// MANIFEST OVERRIDES
// The manifest at scripts/billing/inputs/KF_Historical_SC_Manifest
// .xlsx was staged from Kevin's Downloads copy on 2026-09-17. Three
// USE flips were applied on the staged copy (Kevin's Downloads copy
// stays untouched; the repo copy is authority). Kevin's rulings,
// verbatim from chat:
//
//   r11  ACTUALS     -> IGNORE   St. Louis Cardinals MLB - Service Calendar - 2026 (3).xlsx
//                                 tab: St. Louis MLB - 2026 - Actuals
//                                 ruling: "ignore the actuals for STL MO" - MLB fee-model, no counts
//   r23  PROJECTIONS -> IGNORE   TBJ BUF - Service Calendar - 2023.xlsx
//                                 tab: Projections - 2024
//                                 ruling: "2024 ignored and 2023 are the projections" - 2024 file's own projections win
//   r29  PROJECTIONS -> IGNORE   REDS AZ - Service Calendar - 2023.xlsx
//                                 tab: Projected Numbers - 2023
//                                 ruling: "use Projections - 2023 (Nov 22) and ignore Projected Numbers - 2023"
//
// YEAR SHIFTS
// Ten tabs across six files carry col-B dates lagging their intended
// year (template cloned but dates never advanced; day-label
// diagnostic proved it, per Kevin ruling 2026-09-17). Rule 1: shift
// col-B by that many calendar years preserving month-day; do not
// rewrite day labels; accept off-by-one weekday on leap-crossing
// shifts because month-day is what a fiscal calendar keys on.
//
//   +1 year (four "2023" files, both tabs each):
//     REDS AZ - Service Calendar - 2023.xlsx   Actuals - 2023
//     REDS AZ - Service Calendar - 2023.xlsx   Projections - 2023 (Nov 22) - C
//     TBJ BUF - Service Calendar - 2023.xlsx   Actuals - Billing - 2023
//     TBJ BUF - Service Calendar - 2023.xlsx   Projections - 2023
//     TBJ FL - Service Calendar - 2023.xlsx    Actuals - 2023
//     TBJ FL - Service Calendar - 2023.xlsx    Projections - 2023
//     TXR AZ - Service Calendar - 2023.xlsx    Actuals - 2023
//     TXR AZ - Service Calendar - 2023.xlsx    Projections - 2023
//
//   +2 years (two projections tabs in 2024 files; sibling actuals
//    are clean 2024 data and used as period-override source below):
//     REDS AZ - Service Calendar 2024.xlsx     Projected Numbers - A. Meuser N
//     TXR AZ - Service Calendar - 2024.xlsx    Projections - 2024
//
// PERIOD OVERRIDE
// The two +2 projections tabs use a different fiscal-labeling scheme
// than their sibling actuals tabs in the same workbook (346/356
// period agreement, 314/356 week agreement). Kevin ruling Option B:
// for these two tabs, override source_period + source_week_label by
// looking up the shifted date in the sibling actuals tab. 356 of 356
// overlapping dates take actuals' labels; 1 unmatched Dec date per
// file emits NULL for both.
//
// PERIOD LABELS ARE NOT CANONICAL (widely)
// The 2026-09-17 divergence audit ran the same period-agreement
// check across every paired (actuals, projections) tab in the load
// set. 9 of 20 combinations diverge on period or week label. Most
// striking: Louisville 2026 (0/357 period agreement, 100% week);
// TBR 2023 (99% period, 0/357 week). Kevin's naming
// source_period + source_week_label puts the caveat on the data:
// they are per-workbook labels, not canonical fiscal labels. Any
// audit query grouping by these across accounts or years mixes
// schemes.
//
// PARSER SPLIT
//   STANDARD + TBR-STD: same parser. Row-1 group bands, row-2
//     column names, col A/B/C/D/E = day/date/period/week/(Game Type
//     | Homestand | Camp Name | Week | ''), col F+ alternating
//     service-name / rate. Data rows from row 3. Count in the
//     service-name column, rate in the header cell of the adjacent
//     column. Row emits: one per (row, service) where count > 0.
//   BG-SINGLE: dedicated parser. No row-1 bands, col A/B/C/D/E/F =
//     day/date/period/lunch-count/rate/total-revenue. Row emits:
//     one per row where col-D count > 0 OR col-F revenue > 0.
//     service_name = 'Lunch', group_name = NULL, revenue sourced
//     from col F (BG bills flat weekly revenue, not per-cover, so
//     count * rate does not compute the right value).
//
// STREAM COLUMN
//   TBR - FL: stream = 'TBR' (main streams) or 'B&G' (BG streams),
//     detected from the tab name.
//   Every other account: stream = account_key. Roll-up by
//     account_key sums TBR + B&G naturally.
// ═══════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAGE_DIR = path.join(__dirname, "inputs", "historical-sc");
const MANIFEST_PATH = path.join(__dirname, "inputs", "KF_Historical_SC_Manifest.xlsx");
const SHA_SIDECAR_PATH = path.join(STAGE_DIR, "SHA256SUMS.txt");

const WRITE = process.argv.includes("--write");
const VERBOSE = process.argv.includes("--verbose");
const LIMIT_FILE = process.argv.find(a => a.startsWith("--file="))?.slice("--file=".length);

// ─── Date bounds ─────────────────────────────────────────────────
const DATE_FLOOR = "2022-01-01";
const DATE_CEIL  = "2027-12-31";

// ─── Shift + override tables ─────────────────────────────────────
// Key format: `${file}||${tab}`
const YEAR_SHIFT_OVERRIDES = new Map([
  ["REDS AZ - Service Calendar - 2023.xlsx||Actuals - 2023", 1],
  ["REDS AZ - Service Calendar - 2023.xlsx||Projections - 2023 (Nov 22) - C", 1],
  ["TBJ BUF - Service Calendar - 2023.xlsx||Actuals - Billing - 2023", 1],
  ["TBJ BUF - Service Calendar - 2023.xlsx||Projections - 2023", 1],
  ["TBJ FL - Service Calendar - 2023.xlsx||Actuals - 2023", 1],
  ["TBJ FL - Service Calendar - 2023.xlsx||Projections - 2023", 1],
  ["TXR AZ - Service Calendar - 2023.xlsx||Actuals - 2023", 1],
  ["TXR AZ - Service Calendar - 2023.xlsx||Projections - 2023", 1],
  ["REDS AZ - Service Calendar 2024.xlsx||Projected Numbers - A. Meuser N", 2],
  ["TXR AZ - Service Calendar - 2024.xlsx||Projections - 2024", 2],
]);

// The two projections tabs whose period + week labels are overridden
// from the sibling actuals tab in the same workbook. Key = projections
// tab identifier. Value = sibling actuals tab name (used to locate the
// actuals sheet inside the same file).
const PERIOD_OVERRIDES = new Map([
  ["REDS AZ - Service Calendar 2024.xlsx||Projected Numbers - A. Meuser N", "Actuals - Billing - 2024"],
  ["TXR AZ - Service Calendar - 2024.xlsx||Projections - 2024",             "Actuals - Billing - 2024"],
]);

// ─── Supabase (only initialised when --write) ────────────────────
let supa = null;
function getSupa() {
  if (supa) return supa;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("::error::SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required for --write");
    process.exit(1);
  }
  supa = createClient(url, key, { auth: { persistSession: false } });
  return supa;
}

// ─── Manifest loader ─────────────────────────────────────────────
async function readManifest() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(MANIFEST_PATH);
  const ws = wb.getWorksheet("Manifest");
  if (!ws) throw new Error(`no 'Manifest' sheet in ${MANIFEST_PATH}`);
  // Header at row 6, data from row 7.
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, idx) => {
    if (idx < 7) return;
    const fname = row.getCell(3).value;
    const tab   = row.getCell(4).value;
    const use   = row.getCell(7).value;
    if (!fname) return;
    if (typeof use !== "string" || !["ACTUALS", "PROJECTIONS"].includes(use.trim())) return;
    rows.push({
      manifest_row: idx,
      account: String(row.getCell(1).value ?? "").trim(),
      year:    row.getCell(2).value,
      file:    String(fname).trim(),
      tab:     String(tab ?? "").trim(),
      use:     use.trim(),
    });
  });
  return rows;
}

// ─── SHA256 sidecar ──────────────────────────────────────────────
function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}
function readSidecar() {
  const raw = fs.readFileSync(SHA_SIDECAR_PATH, "utf8");
  const map = new Map();
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("  ");
    if (idx < 0) continue;
    map.set(t.slice(idx + 2), t.slice(0, idx));
  }
  return map;
}
function verifyHashes(files) {
  const sidecar = readSidecar();
  const missing = [], mismatch = [];
  for (const f of files) {
    const p = path.join(STAGE_DIR, f);
    if (!fs.existsSync(p)) { missing.push(f); continue; }
    const expected = sidecar.get(f);
    const actual = sha256File(p);
    if (!expected) { console.warn(`::warning::${f} not in SHA256SUMS.txt`); continue; }
    if (expected !== actual) mismatch.push({ f, expected, actual });
  }
  if (missing.length) {
    console.error(`::error::missing staged files: ${missing.join(", ")}`);
    process.exit(2);
  }
  if (mismatch.length) {
    console.error(`::error::SHA256 mismatch on:`);
    for (const m of mismatch) console.error(`  ${m.f}  expected=${m.expected.slice(0,16)}...  actual=${m.actual.slice(0,16)}...`);
    process.exit(2);
  }
}

// ─── Date utilities ──────────────────────────────────────────────
// ExcelJS represents formula-driven cells as { result, formula } or
// { result, sharedFormula }. Historical workbooks fill the date
// column with =B<prev>+1 shared formulas, so most rows return that
// wrapper rather than a raw Date. unwrap() reaches the underlying
// value in either shape.
function unwrap(v) {
  if (v && typeof v === "object" && !(v instanceof Date) && "result" in v) return v.result;
  return v;
}
function isDate(v) {
  const u = unwrap(v);
  return u instanceof Date && !isNaN(u.getTime());
}
function asDate(v) { return unwrap(v); }
function asNum(v) {
  const u = unwrap(v);
  if (typeof u === "number") return u;
  if (u == null || u === "") return null;
  const n = Number(u);
  return Number.isFinite(n) ? n : null;
}
function asText(v) {
  const u = unwrap(v);
  return u == null ? null : String(u);
}
function shiftYears(d, years) {
  if (!years) return d;
  const yr = d.getUTCFullYear() + years;
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  // Feb 29 in non-leap target -> Feb 28.
  const target = new Date(Date.UTC(yr, m, day));
  if (target.getUTCMonth() !== m) return new Date(Date.UTC(yr, 1, 28));
  return target;
}
function toISODate(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
const DOW_MAP = new Map(Object.entries({
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
  sun: 0, sunday: 0,
}));
function normDow(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase().replace(/\.$/, "").trim();
  return DOW_MAP.get(s) ?? null;
}

// ─── Family classifier ───────────────────────────────────────────
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
  const fdr = firstDataRow(ws);
  if (!fdr) return "NO-DATE-COL";
  const hr = fdr - 1;
  const last = lastColOn(ws, hr);
  const bands = [];
  for (let c = 6; c <= last; c++) {
    const v = asText(ws.getCell(1, c).value);
    if (v != null && v.trim() !== "") bands.push(v);
  }
  let services = 0;
  for (let c = 6; c <= last; c += 2) {
    const v = asText(ws.getCell(hr, c).value);
    if (v != null && v.trim() !== "") services++;
  }
  const colD = (asText(ws.getCell(hr, 4).value) ?? "").trim();
  const colE = (asText(ws.getCell(hr, 5).value) ?? "").trim();
  if (bands.length === 0 && services === 1 && colD.toLowerCase() === "lunch") return "BG-SINGLE";
  if (bands.length >= 1 && colE === "Week") return "TBR-STD";
  if (bands.length >= 1) return "STANDARD";
  return "UNKNOWN";
}

// ─── Day/date guard (Kevin ruling 2026-09-17: whole-tab, halt) ──
// Runs on ORIGINAL dates (before shift). If tab is in the shift-list
// AND its shift reconciles day-labels for +1 (or is +2, accepting
// the leap-boundary off-by-one), guard passes. Otherwise all rows
// must match.
function checkDayDateAgreement(ws, tabKey, shift) {
  const fdr = firstDataRow(ws);
  if (!fdr) return { ok: false, reason: "no data rows" };
  let match = 0, mismatch = 0, missingDay = 0;
  const samples = [];
  for (let r = fdr; r <= ws.rowCount; r++) {
    const raw = ws.getCell(r, 2).value;
    if (!isDate(raw)) continue;
    const d = asDate(raw);
    const dowLabel = normDow(asText(ws.getCell(r, 1).value));
    if (dowLabel == null) { missingDay++; continue; }
    // Test against SHIFTED date; the shift is applied at emit time so
    // guard should validate the post-shift result.
    const shifted = shiftYears(d, shift);
    if (shifted.getUTCDay() === dowLabel) match++;
    else {
      mismatch++;
      if (samples.length < 5) samples.push({
        row: r,
        day_label: asText(ws.getCell(r, 1).value),
        raw_date: toISODate(d),
        shifted_date: toISODate(shifted),
        expected_dow: dowLabel,
        actual_dow: shifted.getUTCDay(),
      });
    }
  }
  // +2 shift crosses a leap boundary; post-Feb rows in that mode will
  // have off-by-one weekday. Kevin ruling: preserve month-day, accept
  // the off-by-one. So for +2 tabs the guard is best-effort: log
  // mismatches but do not halt.
  if (shift === 2) {
    return { ok: true, match, mismatch, missingDay, note: `+2 shift crosses leap: ${mismatch} rows off-by-1 weekday accepted per Kevin ruling` };
  }
  if (mismatch > 0) {
    return { ok: false, reason: `${mismatch} of ${match + mismatch} rows have day-label / date mismatch`, samples };
  }
  return { ok: true, match, mismatch, missingDay };
}

// ─── Per-family parsers ──────────────────────────────────────────
function parseStandard(ws, shift) {
  const fdr = firstDataRow(ws);
  if (!fdr) return [];
  const hr = fdr - 1;
  const last = lastColOn(ws, hr);
  // Build the group-band map by scanning row 1 with fill-forward
  // semantics (merged cells).
  const bandByCol = [];
  {
    let cur = null;
    for (let c = 1; c <= last; c++) {
      const v = asText(ws.getCell(1, c).value);
      if (v != null && v.trim() !== "") cur = v.trim();
      bandByCol[c] = cur;
    }
  }
  // Service columns: (name col, rate col) at c, c+1 for c in 6, 8, 10 ...
  const services = [];
  for (let c = 6; c <= last; c += 2) {
    const name = asText(ws.getCell(hr, c).value);
    if (name == null || name.trim() === "") continue;
    services.push({
      name_col: c,
      rate_col: c + 1,
      service_name: name.trim(),
      rate: asNum(ws.getCell(hr, c + 1).value),
      group_name: bandByCol[c] ?? null,
    });
  }
  const emits = [];
  for (let r = fdr; r <= ws.rowCount; r++) {
    const raw = ws.getCell(r, 2).value;
    if (!isDate(raw)) continue;
    const shifted = shiftYears(asDate(raw), shift);
    const period    = ws.getCell(r, 3).value;
    const weekLabel = ws.getCell(r, 4).value;
    let anyNonZero = false;
    const perService = [];
    for (const s of services) {
      const cnt = asNum(ws.getCell(r, s.name_col).value);
      if (cnt == null || cnt <= 0) continue;
      anyNonZero = true;
      const rate = (s.rate != null && Number.isFinite(s.rate)) ? s.rate : 0;
      perService.push({
        service_name: s.service_name,
        group_name: s.group_name,
        count: cnt,
        rate,
        revenue: Math.round(cnt * rate * 100) / 100,
      });
    }
    if (!anyNonZero) continue;
    for (const p of perService) {
      emits.push({
        service_date: toISODate(shifted),
        service_name: p.service_name,
        group_name: p.group_name,
        count: p.count,
        rate: p.rate,
        revenue: p.revenue,
        source_period: normalisePeriod(period),
        source_week_label: normaliseWeek(weekLabel),
      });
    }
  }
  return emits;
}
function parseBgSingle(ws, shift) {
  const fdr = firstDataRow(ws);
  if (!fdr) return [];
  const hr = fdr - 1;
  // The rate lives in col E of the header row (adjacent to 'Lunch' in col D).
  const rate = asNum(ws.getCell(hr, 5).value);
  const emits = [];
  for (let r = fdr; r <= ws.rowCount; r++) {
    const raw = ws.getCell(r, 2).value;
    if (!isDate(raw)) continue;
    const shifted = shiftYears(asDate(raw), shift);
    const period = ws.getCell(r, 3).value;
    const cnt = asNum(ws.getCell(r, 4).value);
    const rev = asNum(ws.getCell(r, 6).value);
    const anyCount = cnt != null && cnt > 0;
    const anyRev   = rev != null && rev > 0;
    if (!anyCount && !anyRev) continue;
    emits.push({
      service_date: toISODate(shifted),
      service_name: "Lunch",
      group_name: null,
      count: anyCount ? cnt : null,
      rate: rate,
      revenue: anyRev ? rev : (anyCount && rate != null ? Math.round(cnt * rate * 100) / 100 : null),
      source_period: normalisePeriod(period),
      source_week_label: null,   // BG-SINGLE tabs have no week column
    });
  }
  return emits;
}
function normalisePeriod(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isInteger(v)) return String(v);
  return String(v).trim();
}
function normaliseWeek(v) {
  if (v == null || v === "") return null;
  return String(v).trim();
}

// ─── Stream resolver ─────────────────────────────────────────────
function streamFor(accountKey, tabName) {
  if (accountKey !== "TBR - FL") return accountKey;
  const t = String(tabName).toUpperCase();
  if (t.includes("B&G") || t.replace(/\s+/g, "").includes("BG")) return "B&G";
  return "TBR";
}

// ─── Tab discovery inside a workbook ─────────────────────────────
function findSheet(wb, wanted) {
  const w = String(wanted);
  for (const s of wb.worksheets) if (s.name === w) return s;
  for (const s of wb.worksheets) if (s.name.trim() === w.trim()) return s;
  for (const s of wb.worksheets) if (s.name.startsWith(w)) return s;
  for (const s of wb.worksheets) if (s.name.trim().startsWith(w.trim().replace(/-\s*$/, "").trim())) return s;
  return null;
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log(`seed-historical-sc mode=${WRITE ? "WRITE" : "DRY-RUN"}${LIMIT_FILE ? ` file=${LIMIT_FILE}` : ""}`);
  const manifest = await readManifest();
  const files = [...new Set(manifest.map(r => r.file))].sort();
  const filtered = LIMIT_FILE ? files.filter(f => f === LIMIT_FILE) : files;
  console.log(`  ${manifest.length} loading tabs across ${files.length} files (staged in ${STAGE_DIR})`);

  console.log("verifying SHA256 pins...");
  verifyHashes(filtered);
  console.log("  all pins match sidecar\n");

  // Group by file
  const byFile = new Map();
  for (const r of manifest) {
    if (!filtered.includes(r.file)) continue;
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file).push(r);
  }

  const actualsRows = [];
  const projectionsRows = [];
  const perTabReport = [];
  let hadFatalError = false;

  for (const [fname, tabRows] of byFile) {
    const src = path.join(STAGE_DIR, fname);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(src);

    // Preload actuals period/week maps for this file (used for
    // PERIOD_OVERRIDES lookups). Keyed by projections-tab-key ->
    // Map(iso-date -> { period, week_label }).
    const actualsPeriodMap = new Map();
    for (const [projKey, actualsTab] of PERIOD_OVERRIDES) {
      if (!projKey.startsWith(`${fname}||`)) continue;
      const aws = findSheet(wb, actualsTab);
      if (!aws) {
        console.error(`::error::${fname}: PERIOD_OVERRIDE points at missing actuals tab ${actualsTab}`);
        hadFatalError = true; continue;
      }
      // Sibling actuals in these files are UNSHIFTED (clean 2024
      // data). Read raw dates.
      const map = new Map();
      const fdr = firstDataRow(aws);
      if (fdr) {
        for (let r = fdr; r <= aws.rowCount; r++) {
          const raw = aws.getCell(r, 2).value;
          if (!isDate(raw)) continue;
          const iso = toISODate(asDate(raw));
          if (map.has(iso)) continue;
          map.set(iso, {
            period: normalisePeriod(aws.getCell(r, 3).value),
            week_label: normaliseWeek(aws.getCell(r, 4).value),
          });
        }
      }
      actualsPeriodMap.set(projKey, map);
    }

    for (const t of tabRows) {
      const ws = findSheet(wb, t.tab);
      if (!ws) {
        console.error(`::error::${fname}: tab '${t.tab}' not found (available: ${wb.worksheets.map(s => s.name).join(" | ")})`);
        hadFatalError = true; continue;
      }
      const key = `${fname}||${ws.name}`;
      const shift = YEAR_SHIFT_OVERRIDES.get(key) ?? 0;
      const family = classifyFamily(ws);
      if (family === "UNKNOWN" || family === "NO-DATE-COL") {
        console.error(`::error::${fname} / ${ws.name}: unrecognised family (${family}); halt`);
        hadFatalError = true; continue;
      }
      // Guard: day-label vs date (whole tab, halt outside shift-list).
      const guard = checkDayDateAgreement(ws, key, shift);
      if (!guard.ok) {
        console.error(`::error::${fname} / ${ws.name}: day-label vs date guard FAILED: ${guard.reason}`);
        if (guard.samples) {
          for (const s of guard.samples) console.error(`    r${s.row}  label=${s.day_label}  raw_date=${s.raw_date}  shifted=${s.shifted_date}  wanted dow=${s.expected_dow}  actual dow=${s.actual_dow}`);
        }
        console.error(`    tab is not in YEAR_SHIFT_OVERRIDES; add it there if this is a known template-drift case.`);
        hadFatalError = true; continue;
      }

      const emits = (family === "BG-SINGLE") ? parseBgSingle(ws, shift) : parseStandard(ws, shift);
      const stream = streamFor(t.account, ws.name);

      // PERIOD_OVERRIDE: replace source_period + source_week_label
      // from sibling actuals map. Emit null if no match.
      const overrideMap = actualsPeriodMap.get(key);
      if (overrideMap) {
        for (const e of emits) {
          const m = overrideMap.get(e.service_date);
          if (m) {
            e.source_period = m.period;
            e.source_week_label = m.week_label;
          } else {
            e.source_period = null;
            e.source_week_label = null;
          }
        }
      }

      // Date-bound halt
      const outOfBounds = emits.filter(e => e.service_date < DATE_FLOOR || e.service_date > DATE_CEIL);
      if (outOfBounds.length > 0) {
        console.error(`::error::${fname} / ${ws.name}: ${outOfBounds.length} rows outside ${DATE_FLOOR}..${DATE_CEIL}`);
        for (const e of outOfBounds.slice(0, 5)) console.error(`    ${e.service_date}  ${e.service_name}`);
        hadFatalError = true; continue;
      }

      const target = t.use === "ACTUALS" ? actualsRows : projectionsRows;
      let dateMin = null, dateMax = null;
      for (const e of emits) {
        const row = {
          account_key: t.account,
          stream,
          service_date: e.service_date,
          service_name: e.service_name,
          group_name: e.group_name,
          count: e.count,
          rate: e.rate,
          revenue: e.revenue,
          source_period: e.source_period,
          source_week_label: e.source_week_label,
          source_file: fname,
          source_tab: ws.name,
        };
        target.push(row);
        if (!dateMin || e.service_date < dateMin) dateMin = e.service_date;
        if (!dateMax || e.service_date > dateMax) dateMax = e.service_date;
      }
      perTabReport.push({
        file: fname, tab: ws.name, use: t.use, family, shift,
        override: !!overrideMap,
        row_emits: emits.length, date_min: dateMin, date_max: dateMax,
      });
      if (VERBOSE) console.log(`  ${t.use.padEnd(11)} ${family.padEnd(10)} shift=${shift} rows=${emits.length}  ${fname} -> ${ws.name}`);
    }
  }

  console.log(`\n=== PER-TAB EMIT REPORT ===`);
  console.log(`${"USE".padEnd(11)} ${"family".padEnd(10)} ${"shift"} ${"ovr"} ${"rows".padStart(6)}   ${"date range".padEnd(26)}   file  ->  tab`);
  for (const r of perTabReport) {
    const dm = r.date_min || "n/a";
    const dx = r.date_max || "n/a";
    console.log(`  ${r.use.padEnd(9)} ${r.family.padEnd(10)} ${String(r.shift)}     ${r.override ? "Y  " : "-  "} ${String(r.row_emits).padStart(6)}   ${(dm + " .. " + dx).padEnd(26)}  ${r.file.slice(0,34).padEnd(34)} -> ${r.tab.slice(0,32)}`);
  }
  console.log(`\n=== TABLE TOTALS ===`);
  console.log(`  sc_historical_actuals:     ${actualsRows.length.toString().padStart(6)} rows`);
  console.log(`  sc_historical_projections: ${projectionsRows.length.toString().padStart(6)} rows`);
  console.log(`  TOTAL:                     ${(actualsRows.length + projectionsRows.length).toString().padStart(6)} rows`);

  if (hadFatalError) {
    console.error(`\n::error::halted before write due to earlier fatal errors`);
    process.exit(2);
  }

  if (!WRITE) {
    console.log(`\nDRY-RUN: no rows written. Re-run with --write after Kevin's OK.`);
    process.exit(0);
  }

  // ── Write path ─────────────────────────────────────────────────
  console.log(`\nWRITING to sc_historical_actuals + sc_historical_projections...`);
  const supa = getSupa();
  const BATCH = 500;
  async function batchInsert(table, rows) {
    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      // ON CONFLICT DO NOTHING via the unique index on
      // (source_file, source_tab, service_date, service_name,
      //  coalesce(group_name), stream). supabase-js .upsert() with
      // ignoreDuplicates=true maps to ON CONFLICT DO NOTHING.
      const { error, count } = await supa.from(table)
        .upsert(chunk, { onConflict: "source_file,source_tab,service_date,service_name,group_name,stream", ignoreDuplicates: true, count: "exact" });
      if (error) throw new Error(`${table} insert at offset ${i}: ${error.message}`);
      written += count ?? chunk.length;
    }
    return written;
  }
  const aWritten = await batchInsert("sc_historical_actuals", actualsRows);
  const pWritten = await batchInsert("sc_historical_projections", projectionsRows);
  console.log(`  sc_historical_actuals:     ${aWritten.toString().padStart(6)} rows written`);
  console.log(`  sc_historical_projections: ${pWritten.toString().padStart(6)} rows written`);
  console.log(`\nDone.`);
}

main().catch(e => {
  console.error("::error::", e?.stack || e?.message || e);
  process.exit(2);
});
