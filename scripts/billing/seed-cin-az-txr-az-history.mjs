#!/usr/bin/env node
// PR-A: season replace of CIN - AZ + TXR - AZ sc_daily_actuals from the
// two v5 spreadsheets (hash-pinned inputs).
//
// Context. Kevin's ruling 2026-09-15: the current AZ actuals in Postgres
// carry development artefacts (six Extra Protein test rows on TXR were
// the reveal). The workbooks are the source of truth. Full season
// replace under created_by='spreadsheet_seed'; import-script and
// k.fietek@ rows in the span are superseded.
//
// Reference finding (see PR body): TXR sc_daily_projections were
// written by an earlier import-script with the workbook columns
// slotted two positions off - ML Extra Protein values landed as MiL
// Breakfast / Lunch. Sum-conserved, mix fictional. Actuals are wiped
// and reseeded here on the correct column map (positional constants
// below). TXR projections reseed follows in a separate PR.
//
// FENCES (binding):
//   Writes are LIMITED to sc_daily_actuals for
//     account_key IN ('CIN - AZ', 'TXR - AZ')
//     within the per-account span computed from workbook dates.
//   No schema changes, no projections, no prices, no services.
//   Every column must resolve to a live sc_services row; unmapped or
//   archived-service resolutions are a hard fail (there are no
//   archived twins on these accounts; the guard is defensive).
//   created_by = updated_by = 'spreadsheet_seed' on every row.
//   Position is authority; column maps are fixed constants.
//   File integrity: sha256 gate at startup halts on mismatch.
//
//   Date discipline:
//     - Rows before 2026-01-01 are skipped as out-of-scope (routine).
//     - Rows after TODAY (captured at run start) are skipped as
//       not-yet-happened (routine). Reported by count and range.
//     - Rows after 2027-12-31 HALT the write - a 2029-01-07 artefact
//       was found in sc_daily_actuals_history on TXR and is the
//       exact class this guard is for.
//
// Two-step contract:
//   default          = dry-run (parse, resolve, print span + anchors
//                      + intended per-month row counts, halt)
//   --write          = separate invocation after Kevin's explicit go
//
// Write shape: per-account DELETE-then-INSERT across the full span,
// with an in-memory backup of the pre-delete rows. If any INSERT
// fails, the backup is re-inserted so the prior state is preserved.

import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// -----------------------------------------------------------------------------
// Pinned inputs (sanitized names in scripts/billing/inputs/).
// Both hashed 2026-09-15 against the (5) exports Kevin downloaded 11:15 CDT.
// -----------------------------------------------------------------------------
const INPUTS = {
  CIN: {
    path: path.join(__dirname, "inputs", "cin-az-sc-2026-v5.xlsx"),
    sha256: "cab11a66b14f6e60f33f3794a7265b2b5eb88fdde0a35ffd6940eaf9d4752dec",
  },
  TXR: {
    path: path.join(__dirname, "inputs", "txr-az-sc-2026-v5.xlsx"),
    sha256: "48ca6b93b187f0d1324557378d593cddb4e87d3a84b9c59026df52d7298a1eb8",
  },
};

const WRITE = process.argv.includes("--write");
const CREATED_BY = "spreadsheet_seed";

// -----------------------------------------------------------------------------
// Date bounds.
//   SEASON_START floor keeps stray Dec-2025 rows at the top of the sheet
//   out of scope. TODAY cap keeps future rows out of the seed. SANE_MAX
//   is the halt bound for absurd-date artefacts.
// -----------------------------------------------------------------------------
const SEASON_START = "2026-01-01";
const TODAY = new Date().toISOString().slice(0, 10);
const SANE_MAX = "2027-12-31";

// -----------------------------------------------------------------------------
// CIN - AZ / Goodyear, AZ - 2026 - Actuals
//   Two-row header, data from row 3, dateCol = B.
// Value columns:
//   F H J (Major League),
//   L N P R (Minor League regular meals + pre-game snack),
//   T V (Minor League bev services; workbook header text is
//        "Coffee Service (tax-free)" / "Fountain Bev (tax-free)" but
//        the DB catalog carries the bare names - positional constants
//        below use the DB names.),
//   X Z AB AD (Rehab).
// Skip odd-lettered price cols (G I K M O Q S U W Y AA AC AE) and
// AF-AJ (TOTALS).
// -----------------------------------------------------------------------------
const CIN_TAB = {
  sheetName: "Goodyear, AZ - 2026 - Actuals",
  headerRows: 2,
  dateColLetter: "B",
  columns: [
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
  ],
};

// -----------------------------------------------------------------------------
// TXR - AZ / Actuals - 2026
//   Two-row header, data from row 3, dateCol = B.
// Value columns:
//   F H J L N (Major League - Breakfast, Lunch, Dinner, Extra Protein
//              Chicken/Pork, Extra Protein Beef/Seafood),
//   P R T V X Z AB AD (Minor League - Breakfast, Lunch, Dinner, Extra
//                       Protein Chicken/Pork, Extra Protein Beef/Seafood,
//                       Continental Breakfast, Pre-Game Hot Snack,
//                       Regular Snack).
// Skip AF..AQ (all "Blank" placeholders in row 2) and AR..AV (TOTALS).
// -----------------------------------------------------------------------------
const TXR_TAB = {
  sheetName: "Actuals - 2026",
  headerRows: 2,
  dateColLetter: "B",
  columns: [
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
  ],
};

// No archived twins on CIN - AZ or TXR - AZ (verified 2026-09-15).
// Guard exists so a future catalog change cannot silently repopulate one.
const ARCHIVED_SERVICE_IDS = new Set();

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------
function pgClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in env");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function colLetterToNum(letters) {
  let n = 0;
  for (const c of letters.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

function sha256(filepath) {
  const buf = fs.readFileSync(filepath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function unwrapCell(v) {
  if (v && typeof v === "object" && "result" in v) return v.result;
  return v;
}

const NON_NUMERIC_FINDINGS = [];
const SKIPPED_BEFORE_SCOPE = [];      // { cellRef, iso }
const SKIPPED_FUTURE = [];            // { cellRef, iso }
const INSANE_DATE_FINDINGS = [];      // { cellRef, iso }

function toNumber(v, ref) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return 0;
    if (s === "." || s === "-" || s === "N/A" || s.toUpperCase() === "OFF") {
      NON_NUMERIC_FINDINGS.push({ ref, raw: v, treated: 0, kind: "blank-marker" });
      return 0;
    }
    const n = Number(s.replace(/[,$]/g, ""));
    if (Number.isFinite(n)) return n;
    NON_NUMERIC_FINDINGS.push({ ref, raw: v, treated: 0, kind: "unrecognized" });
    return 0;
  }
  if (v instanceof Date) {
    NON_NUMERIC_FINDINGS.push({ ref, raw: v.toISOString(), treated: 0, kind: "date-in-value-cell" });
    return 0;
  }
  NON_NUMERIC_FINDINGS.push({ ref, raw: JSON.stringify(v), treated: 0, kind: "unexpected-type" });
  return 0;
}

// -----------------------------------------------------------------------------
// Load sc_services and build (group|service) -> id resolver per account.
// Only ACTIVE (active_until IS NULL, deleted_at IS NULL) rows.
// -----------------------------------------------------------------------------
async function loadServiceResolver(supa) {
  const out = {};
  const nonRev = {};
  for (const acct of ["CIN - AZ", "TXR - AZ"]) {
    const { data, error } = await supa
      .from("sc_services")
      .select("id, service_name, is_non_revenue, active_until, sc_service_groups(group_name)")
      .eq("account_key", acct)
      .is("deleted_at", null)
      .is("active_until", null);
    if (error) throw new Error(`sc_services(${acct}): ${error.message}`);
    const map = new Map();
    for (const r of data) {
      const g = r.sc_service_groups?.group_name || "";
      map.set(`${g}|${r.service_name}`, r.id);
      nonRev[r.id] = !!r.is_non_revenue;
    }
    out[acct] = map;
  }
  return { resolver: out, nonRev };
}

function resolve(accountKey, group, service, resolver) {
  const key = `${group}|${service}`;
  const id = resolver[accountKey].get(key);
  if (!id) {
    throw new Error(`UNMAPPED: ${accountKey} / ${group} / ${service} - no active sc_services row`);
  }
  if (ARCHIVED_SERVICE_IDS.has(id)) {
    throw new Error(`ARCHIVED HIT: ${accountKey} / ${group} / ${service} resolves to archived id ${id}`);
  }
  return id;
}

// -----------------------------------------------------------------------------
// Parse one actuals-shaped tab into an array of {date, group, service,
// letter, cellRef, raw, value}. Applies date bounds:
//   - iso <  SEASON_START -> SKIPPED_BEFORE_SCOPE, drop
//   - iso >  TODAY & iso <= SANE_MAX -> SKIPPED_FUTURE, drop
//   - iso >  SANE_MAX -> INSANE_DATE_FINDINGS (halts --write)
// -----------------------------------------------------------------------------
async function parseTab({ path: filepath, tab }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filepath);
  const ws = wb.getWorksheet(tab.sheetName);
  if (!ws) throw new Error(`Sheet not found: ${tab.sheetName} in ${filepath}`);
  const dc = colLetterToNum(tab.dateColLetter);
  const rows = [];
  const startRow = tab.headerRows + 1;
  ws.eachRow((row, rowNum) => {
    if (rowNum < startRow) return;
    const dateVal = unwrapCell(row.getCell(dc).value);
    let iso = null;
    if (dateVal instanceof Date) iso = isoDate(dateVal);
    else if (typeof dateVal === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) iso = dateVal.slice(0, 10);
    if (!iso) return;

    const dateRef = `${tab.sheetName}!${tab.dateColLetter}${rowNum}`;
    if (iso < SEASON_START) { SKIPPED_BEFORE_SCOPE.push({ cellRef: dateRef, iso }); return; }
    if (iso > SANE_MAX)     { INSANE_DATE_FINDINGS.push({ cellRef: dateRef, iso }); return; }
    if (iso > TODAY)        { SKIPPED_FUTURE.push({ cellRef: dateRef, iso }); return; }

    for (const [letter, group, service] of tab.columns) {
      const cn = colLetterToNum(letter);
      const raw = unwrapCell(row.getCell(cn).value);
      const cellRef = `${tab.sheetName}!${letter}${rowNum}`;
      const value = toNumber(raw, cellRef);
      rows.push({ date: iso, group, service, letter, cellRef, raw, value });
    }
  });
  return rows;
}

// -----------------------------------------------------------------------------
// Build the row set to write for one account.
//   - Only DATEs carrying any non-zero across value cols are loaded.
//   - Within a loaded date, every service becomes a row (empty -> 0).
//   - Round to whole numbers. actual_count is INTEGER; no fractionals.
// -----------------------------------------------------------------------------
function buildAccountRowSet({ accountKey, parsed, resolver }) {
  const byDate = new Map();
  for (const r of parsed) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  const written = [];
  const skippedZeroDates = [];
  for (const [date, drows] of [...byDate.entries()].sort()) {
    const anyNonZero = drows.some((r) => r.value !== 0);
    if (!anyNonZero) {
      skippedZeroDates.push(date);
      continue;
    }
    for (const r of drows) {
      const sid = resolve(accountKey, r.group, r.service, resolver);
      const val = Math.round(r.value);
      if (!Number.isInteger(val)) {
        throw new Error(`Non-integer post-round at ${r.cellRef}: raw=${r.raw} rounded=${val}`);
      }
      written.push({
        account_key:  accountKey,
        service_id:   sid,
        service_date: r.date,
        actual_count: val,
        created_by:   CREATED_BY,
        updated_by:   CREATED_BY,
        _group:       r.group,
        _service:     r.service,
        _letter:      r.letter,
        _cellRef:     r.cellRef,
      });
    }
  }
  return { written, skippedZeroDates };
}

// -----------------------------------------------------------------------------
// Span report + per-month counts + sanity anchors.
// -----------------------------------------------------------------------------
function spanReport(label, rowSet) {
  const rows = rowSet.written;
  const dates = [...new Set(rows.map((r) => r.service_date))].sort();
  const first = dates[0] || "(no rows)";
  const last  = dates[dates.length - 1] || "(no rows)";
  const perMonth = {};
  for (const r of rows) {
    const ym = r.service_date.slice(0, 7);
    perMonth[ym] = (perMonth[ym] || 0) + 1;
  }
  console.log(`\n=== SPAN: ${label} ===`);
  console.log(`  first date: ${first}`);
  console.log(`  last  date: ${last}`);
  console.log(`  total intended rows: ${rows.length}   (from ${dates.length} dates)`);
  console.log(`  per-month row counts:`);
  for (const ym of Object.keys(perMonth).sort()) {
    console.log(`    ${ym}   ${String(perMonth[ym]).padStart(4)}`);
  }
  console.log(`  skipped zero-value dates (dropped): ${rowSet.skippedZeroDates.length}`);
}

function nearestDateWithData(rowSet, target) {
  const dates = [...new Set(rowSet.written.map((r) => r.service_date))].sort();
  if (dates.length === 0) return null;
  if (dates.includes(target)) return target;
  let best = dates[0], bestDiff = Math.abs(new Date(dates[0]) - new Date(target));
  for (const d of dates) {
    const diff = Math.abs(new Date(d) - new Date(target));
    if (diff < bestDiff) { best = d; bestDiff = diff; }
  }
  return best;
}

function printAnchor(label, rowSet, date) {
  if (!date) { console.log(`  ${label}  (no data)`); return; }
  const rows = rowSet.written.filter((r) => r.service_date === date);
  const total = rows.reduce((a, r) => a + r.actual_count, 0);
  console.log(`  ${label}  ${date}  rows=${rows.length}  total_units=${total}`);
  for (const r of rows) {
    if (r.actual_count === 0) continue;
    console.log(`      ${r._letter.padEnd(3)}  ${r._group.padEnd(14)}  ${r._service.padEnd(38)}  ${r.actual_count}`);
  }
}

// -----------------------------------------------------------------------------
// WRITE - per-account DELETE-then-INSERT with in-memory backup rollback.
//
// Delete range is the FIXED ruling scope (SEASON_START .. TODAY), NOT
// the workbook's populated span. Kevin's ruling was wipe-and-replace,
// not merge - any DB row on a date the workbook leaves entirely zero
// (or that falls outside the workbook's non-zero span) must still be
// wiped, because that is exactly the class of dev-artefact this reseed
// exists to remove.
// -----------------------------------------------------------------------------
async function writeAccount(supa, accountKey, rowSet) {
  const rowsToInsert = rowSet.written.map((r) => {
    const { _group, _service, _letter, _cellRef, ...clean } = r;
    return clean;
  });

  const DELETE_FROM = SEASON_START;   // 2026-01-01
  const DELETE_TO   = TODAY;          // captured at run start

  console.log(`\n=== WRITE: ${accountKey} ===`);
  console.log(`  delete range (ruling scope): ${DELETE_FROM} .. ${DELETE_TO}`);
  console.log(`  intended rows to insert:     ${rowsToInsert.length}`);

  // Backup covers the full ruling scope so a rollback restores everything
  // the DELETE removes, not just the workbook-populated span.
  const backup = await readAllInScope(supa, accountKey, DELETE_FROM, DELETE_TO);
  console.log(`  backup captured: ${backup.length} pre-existing rows in ruling scope`);

  // DELETE all rows for this account in the full ruling scope.
  const { count: delCount, error: delErr } = await supa
    .from("sc_daily_actuals")
    .delete({ count: "exact" })
    .eq("account_key", accountKey)
    .gte("service_date", DELETE_FROM)
    .lte("service_date", DELETE_TO);
  if (delErr) throw new Error(`DELETE ${accountKey}: ${delErr.message}`);
  console.log(`  deleted: ${delCount} rows`);

  const CHUNK = 500;
  let inserted = 0;
  try {
    for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
      const chunk = rowsToInsert.slice(i, i + CHUNK);
      const { error: insErr } = await supa.from("sc_daily_actuals").insert(chunk);
      if (insErr) throw new Error(`INSERT chunk ${i}: ${insErr.message}`);
      inserted += chunk.length;
    }
    console.log(`  inserted: ${inserted} rows`);
  } catch (e) {
    console.error(`  ${e.message}`);
    console.error(`  ROLLBACK: clearing any partial ${CREATED_BY} rows for ${accountKey} in scope, then re-inserting backup of ${backup.length} rows...`);
    const { count: clearCount, error: clearErr } = await supa
      .from("sc_daily_actuals")
      .delete({ count: "exact" })
      .eq("account_key", accountKey)
      .eq("created_by", CREATED_BY)
      .gte("service_date", DELETE_FROM)
      .lte("service_date", DELETE_TO);
    if (clearErr) {
      console.error(`  ROLLBACK STEP A FAILED (clear partials): ${clearErr.message}`);
      throw new Error(`INSERT failed AND rollback clear-partial failed. Backup is in memory only - halt for manual repair.`);
    }
    console.error(`  ROLLBACK step A: cleared ${clearCount} partial ${CREATED_BY} rows`);
    for (let i = 0; i < backup.length; i += CHUNK) {
      const chunk = backup.slice(i, i + CHUNK);
      const { error: rbErr } = await supa.from("sc_daily_actuals").insert(chunk);
      if (rbErr) {
        console.error(`  ROLLBACK STEP B FAILED at chunk ${i}: ${rbErr.message}`);
        throw new Error(`INSERT failed AND backup re-insert failed. Backup is in memory only - halt for manual repair.`);
      }
    }
    console.error(`  ROLLBACK complete: ${backup.length} prior rows restored.`);
    throw e;
  }
  return { deleted: delCount, inserted, backup: backup.length, firstDate: DELETE_FROM, lastDate: DELETE_TO };
}

async function readAllInScope(supa, accountKey, firstDate, lastDate) {
  const PAGE = 1000;
  let from = 0;
  const out = [];
  while (true) {
    const { data, error } = await supa
      .from("sc_daily_actuals")
      .select("account_key, service_id, service_date, actual_count, created_by, updated_by")
      .eq("account_key", accountKey)
      .gte("service_date", firstDate)
      .lte("service_date", lastDate)
      .order("service_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`readAllInScope ${accountKey}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// -----------------------------------------------------------------------------
// Post-write verifications.
// -----------------------------------------------------------------------------
async function postWriteChecks(supa, results) {
  console.log(`\n=== POST-WRITE CHECKS ===`);
  // Per-account, per-month counts from DB.
  for (const [acct, res] of Object.entries(results)) {
    if (!res) continue;
    const rows = await readAllInScope(supa, acct, res.firstDate, res.lastDate);
    const byMonth = {};
    for (const r of rows) {
      const ym = r.service_date.slice(0, 7);
      byMonth[ym] = (byMonth[ym] || 0) + 1;
    }
    console.log(`  S3 ${acct}: ${rows.length} rows in scope`);
    for (const ym of Object.keys(byMonth).sort()) {
      console.log(`    ${ym}   ${String(byMonth[ym]).padStart(4)}`);
    }
  }
  // S4: every row in scope has created_by = spreadsheet_seed.
  for (const acct of Object.keys(results)) {
    const { count, error } = await supa
      .from("sc_daily_actuals")
      .select("id", { count: "exact", head: true })
      .eq("account_key", acct)
      .gte("service_date", results[acct].firstDate)
      .lte("service_date", results[acct].lastDate)
      .neq("created_by", CREATED_BY);
    if (error) throw error;
    console.log(`  S4 ${acct}: rows in scope with created_by != '${CREATED_BY}' = ${count} (expect 0)`);
  }
  // S6: no import-script or k.fietek@ rows remain in scope.
  for (const acct of Object.keys(results)) {
    const { count, error } = await supa
      .from("sc_daily_actuals")
      .select("id", { count: "exact", head: true })
      .eq("account_key", acct)
      .gte("service_date", results[acct].firstDate)
      .lte("service_date", results[acct].lastDate)
      .in("created_by", ["import-script", "k.fietek@kitchfix.com"]);
    if (error) throw error;
    console.log(`  S6 ${acct}: import-script/k.fietek@ rows in scope = ${count} (expect 0)`);
  }
  // S8: catalog untouched.
  for (const acct of Object.keys(results)) {
    const { count, error } = await supa
      .from("sc_services")
      .select("id", { count: "exact", head: true })
      .eq("account_key", acct)
      .is("deleted_at", null)
      .is("active_until", null);
    if (error) throw error;
    console.log(`  S8 ${acct}: active service count = ${count}`);
  }

  // S9: contamination assertion.
  //   Positive: rows with created_by = 'spreadsheet_seed' in ruling scope
  //             equals the intended insert count for that account. If they
  //             disagree, the DELETE-then-INSERT did not land what the
  //             seeder said it wrote.
  //   Negative: rows with created_by != 'spreadsheet_seed' in ruling scope
  //             must be zero. Any positive count is the exact contamination
  //             this reseed exists to remove; enumerate up to 20 offenders
  //             (account_key, service_date, created_by, service_name,
  //             actual_count) with detail so it's actionable rather than
  //             just a number.
  for (const [acct, res] of Object.entries(results)) {
    const { count: seedRows, error: seedErr } = await supa
      .from("sc_daily_actuals")
      .select("id", { count: "exact", head: true })
      .eq("account_key", acct)
      .eq("created_by", CREATED_BY)
      .gte("service_date", res.firstDate)
      .lte("service_date", res.lastDate);
    if (seedErr) throw seedErr;
    const intended = res.inserted;
    const match = seedRows === intended ? "MATCH" : "MISMATCH";
    console.log(`  S9 ${acct}: seed-authored rows in scope = ${seedRows}  intended = ${intended}  ${match}`);

    const { data: offenders, error: offErr } = await supa
      .from("sc_daily_actuals")
      .select("service_date, created_by, actual_count, sc_services(service_name)")
      .eq("account_key", acct)
      .neq("created_by", CREATED_BY)
      .gte("service_date", res.firstDate)
      .lte("service_date", res.lastDate)
      .order("service_date", { ascending: true })
      .limit(20);
    if (offErr) throw offErr;
    console.log(`  S9 ${acct}: non-seed rows in scope = ${offenders.length}${offenders.length === 20 ? " (capped; more may exist)" : ""} (expect 0)`);
    for (const o of offenders) {
      const svc = o.sc_services?.service_name ?? "(unknown)";
      console.log(`      ${o.service_date}  ${o.created_by.padEnd(28)}  ${svc.padEnd(38)}  count=${o.actual_count}`);
    }
  }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
async function main() {
  console.log(`PR-A seed  mode=${WRITE ? "WRITE" : "DRY-RUN"}  at ${new Date().toISOString()}`);
  console.log(`  SEASON_START=${SEASON_START}  TODAY=${TODAY}  SANE_MAX=${SANE_MAX}`);

  // S1: hash gate.
  console.log(`\n=== S1: file integrity ===`);
  for (const [label, spec] of Object.entries(INPUTS)) {
    if (!fs.existsSync(spec.path)) throw new Error(`INPUT MISSING: ${spec.path}`);
    const actual = sha256(spec.path);
    if (actual !== spec.sha256) {
      throw new Error(`SHA256 MISMATCH ${label}\n  file:     ${spec.path}\n  expected: ${spec.sha256}\n  actual:   ${actual}`);
    }
    console.log(`  ${label}  ${actual}  OK  ${path.basename(spec.path)}`);
  }

  const supa = pgClient();
  console.log(`\n=== resolving services from live catalog ===`);
  const { resolver } = await loadServiceResolver(supa);
  console.log(`  CIN - AZ: ${resolver["CIN - AZ"].size} active services`);
  console.log(`  TXR - AZ: ${resolver["TXR - AZ"].size} active services`);

  console.log(`\n=== parsing workbooks ===`);
  const cinParsed = await parseTab({ path: INPUTS.CIN.path, tab: CIN_TAB });
  console.log(`  CIN actuals: ${cinParsed.length} parsed cells`);
  const txrParsed = await parseTab({ path: INPUTS.TXR.path, tab: TXR_TAB });
  console.log(`  TXR actuals: ${txrParsed.length} parsed cells`);

  // Date-bound report (routine skips are informational).
  console.log(`\n=== date bounds ===`);
  console.log(`  skipped before ${SEASON_START}: ${SKIPPED_BEFORE_SCOPE.length}`);
  if (SKIPPED_BEFORE_SCOPE.length > 0) {
    const first = SKIPPED_BEFORE_SCOPE[0].iso;
    const last = SKIPPED_BEFORE_SCOPE[SKIPPED_BEFORE_SCOPE.length - 1].iso;
    console.log(`    range: ${first} .. ${last}`);
  }
  console.log(`  skipped after  ${TODAY}: ${SKIPPED_FUTURE.length}`);
  if (SKIPPED_FUTURE.length > 0) {
    const first = SKIPPED_FUTURE[0].iso;
    const last = SKIPPED_FUTURE[SKIPPED_FUTURE.length - 1].iso;
    console.log(`    range: ${first} .. ${last}`);
  }
  console.log(`  insane-date findings (> ${SANE_MAX}): ${INSANE_DATE_FINDINGS.length}`);
  if (INSANE_DATE_FINDINGS.length > 0) {
    for (const f of INSANE_DATE_FINDINGS) console.log(`    ${f.cellRef}  ${f.iso}`);
  }

  const cinSet = buildAccountRowSet({ accountKey: "CIN - AZ", parsed: cinParsed, resolver });
  const txrSet = buildAccountRowSet({ accountKey: "TXR - AZ", parsed: txrParsed, resolver });

  spanReport("CIN - AZ", cinSet);
  spanReport("TXR - AZ", txrSet);

  if (NON_NUMERIC_FINDINGS.length > 0) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`NON-NUMERIC CELL FINDINGS  (${NON_NUMERIC_FINDINGS.length} total)`);
    console.log(`${"=".repeat(70)}`);
    const byKind = {};
    for (const f of NON_NUMERIC_FINDINGS) {
      (byKind[f.kind] = byKind[f.kind] || []).push(f);
    }
    for (const kind of Object.keys(byKind).sort()) {
      console.log(`\n  [${kind}]  ${byKind[kind].length} cell(s), all treated as 0:`);
      for (const f of byKind[kind]) {
        console.log(`    ${f.ref.padEnd(38)}  raw=${JSON.stringify(f.raw)}`);
      }
    }
    const unrecognized = (byKind.unrecognized || []).length + (byKind["unexpected-type"] || []).length + (byKind["date-in-value-cell"] || []).length;
    if (unrecognized > 0 && WRITE) {
      throw new Error(`WRITE HALTED: ${unrecognized} unrecognized non-numeric cell(s) found. Kevin must rule (fix workbook + rehash, or accept coerce-to-0) before --write.`);
    }
  }

  // Sanity anchors.
  console.log(`\n${"=".repeat(70)}`);
  console.log(`SANITY ANCHORS  (Kevin eyeballs these against the sheets)`);
  console.log(`${"=".repeat(70)}`);
  const anchors = [
    { label: "CIN spring peak",      set: cinSet, target: "2026-03-09" },
    { label: "CIN ACL mid",          set: cinSet, target: "2026-07-01" },
    { label: "CIN recent",           set: cinSet, target: "2026-09-01" },
    { label: "TXR spring peak",      set: txrSet, target: "2026-03-09" },
    { label: "TXR extended mid",     set: txrSet, target: "2026-05-15" },
    { label: "TXR ACL mid",          set: txrSet, target: "2026-07-15" },
    { label: "TXR recent",           set: txrSet, target: "2026-09-01" },
  ];
  for (const a of anchors) {
    const eff = nearestDateWithData(a.set, a.target);
    printAnchor(`${a.label}${eff === a.target ? "" : ` (target ${a.target}, nearest ${eff ?? "(none)"})`}`, a.set, eff);
  }

  // Delete-scope preview: what the --write step's DELETE will remove,
  // grouped by created_by so Kevin can see the dev artefacts before
  // authorising. Range is the fixed ruling scope, not the workbook span.
  // Paginated at 1000/page (Supabase silently caps unpaginated .select()).
  console.log(`\n${"=".repeat(70)}`);
  console.log(`DELETE-SCOPE PREVIEW  (--write range: ${SEASON_START} .. ${TODAY})`);
  console.log(`${"=".repeat(70)}`);
  for (const [acct, set] of [["CIN - AZ", cinSet], ["TXR - AZ", txrSet]]) {
    const PAGE = 1000;
    let from = 0;
    const rows = [];
    while (true) {
      const { data, error } = await supa
        .from("sc_daily_actuals")
        .select("created_by, actual_count")
        .eq("account_key", acct)
        .gte("service_date", SEASON_START)
        .lte("service_date", TODAY)
        .order("service_date", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    const byAuthor = {};
    for (const r of rows) {
      const a = byAuthor[r.created_by] = byAuthor[r.created_by] || { rows: 0, nonZero: 0 };
      a.rows += 1;
      if (Number(r.actual_count) > 0) a.nonZero += 1;
    }
    const total = rows.length;
    const intended = set.written.length;
    console.log(`  ${acct}: existing rows in scope = ${total}   intended inserts = ${intended}`);
    for (const author of Object.keys(byAuthor).sort()) {
      const a = byAuthor[author];
      console.log(`    ${author.padEnd(28)}  rows=${String(a.rows).padStart(5)}  non_zero=${String(a.nonZero).padStart(4)}`);
    }
  }

  // Halt on insane dates before write.
  if (INSANE_DATE_FINDINGS.length > 0 && WRITE) {
    throw new Error(`WRITE HALTED: ${INSANE_DATE_FINDINGS.length} row(s) with date > ${SANE_MAX}. Fix the workbook (or the parse) and rehash before --write.`);
  }

  if (!WRITE) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`DRY-RUN COMPLETE`);
    console.log(`Row shape: { account_key, service_id, service_date, actual_count,`);
    console.log(`             created_by='${CREATED_BY}', updated_by='${CREATED_BY}' }`);
    console.log(`To write: re-run with --write after Kevin's explicit go.`);
    console.log(`${"=".repeat(70)}`);
    return;
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`WRITE STEP - Kevin's explicit go on the dry-run required`);
  console.log(`${"=".repeat(70)}`);
  const results = {};
  const rCin = await writeAccount(supa, "CIN - AZ", cinSet);
  results["CIN - AZ"] = rCin;
  const rTxr = await writeAccount(supa, "TXR - AZ", txrSet);
  results["TXR - AZ"] = rTxr;

  await postWriteChecks(supa, results);

  // Spot-check three evenly-spaced dates per account against the parsed set.
  console.log(`\n=== S7: post-write spot check (random dates) ===`);
  for (const [acct, set] of [["CIN - AZ", cinSet], ["TXR - AZ", txrSet]]) {
    const dates = [...new Set(set.written.map((r) => r.service_date))].sort();
    if (dates.length === 0) continue;
    const picks = [dates[Math.floor(dates.length * 0.15)], dates[Math.floor(dates.length * 0.5)], dates[Math.floor(dates.length * 0.85)]];
    for (const d of picks) {
      const { data, error } = await supa
        .from("sc_daily_actuals")
        .select("service_id, actual_count")
        .eq("account_key", acct)
        .eq("service_date", d);
      if (error) throw error;
      const dbSum = data.reduce((a, r) => a + Number(r.actual_count), 0);
      const wbRowsForDate = set.written.filter((r) => r.service_date === d);
      const wbSum = wbRowsForDate.reduce((a, r) => a + r.actual_count, 0);
      const ok = data.length === wbRowsForDate.length && dbSum === wbSum;
      console.log(`  ${acct}  ${d}  db_rows=${data.length}  wb_rows=${wbRowsForDate.length}  db_sum=${dbSum}  wb_sum=${wbSum}  ${ok ? "MATCH" : "MISMATCH"}`);
    }
  }

  console.log(`\nWRITE COMPLETE.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`\nFATAL: ${e?.stack || e?.message || e}`);
  process.exit(1);
});
