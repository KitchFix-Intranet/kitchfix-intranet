#!/usr/bin/env node
// PR-S: season replace of TBR - FL + TBJ - FL sc_daily_actuals
// from the two v5 spreadsheets (hash-pinned inputs).
//
// Kevin trains both sites next week and they stop maintaining the
// spreadsheet after that; whatever this loads becomes the record.
// Full season replace under created_by='spreadsheet_seed', per
// Kevin ruling 2026-09-02: spreadsheet is source of truth,
// import-script and k.fietek@ rows in the span are superseded.
//
// FENCES (binding):
//   Writes are LIMITED to sc_daily_actuals for
//     account_key IN ('TBR - FL', 'TBJ - FL')
//     within the per-account span computed from workbook dates.
//   No schema changes, no projections, no prices, no services.
//   Every column must resolve to a live sc_services row; unmapped
//   or archived-service resolutions are a hard fail.
//   created_by = updated_by = 'spreadsheet_seed' on every row.
//   Position is authority; column maps are fixed constants.
//   File integrity: sha256 gate at startup halts on mismatch.
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

// ─────────────────────────────────────────────────────────────────────
// Pinned inputs (sanitized names in scripts/billing/inputs/).
// Hashes recorded after Kevin's 2026-09-02 blanking of Y/Z + AA/AB
// on TBR Projections. TBJ was not edited; hash matches recon-era.
// ─────────────────────────────────────────────────────────────────────
const INPUTS = {
  TBJ: {
    path: path.join(__dirname, "inputs", "tbj-fl-sc-2026-v5.xlsx"),
    sha256: "d153c4c6f52ec408185693d4b4489efe7a5df857d2ad45c573b7c50ee581e15a",
  },
  TBR: {
    path: path.join(__dirname, "inputs", "tbr-fl-sc-2026-v5.xlsx"),
    // Bumped 2026-09-02 from c3466de8... after Kevin renamed the
    // Projections TBR-2026 headers Y2 "Breakfast - MiLB" (was ST) at
    // price 17.8275 and AA2 "Lunch - MiLB" (was ST) at 21.675 - the
    // header rename that made the projections tab feed the live non-ST
    // service ids instead of resurrecting archived twins. The bytes
    // changed; the file is correct. This is the hash of the correct file.
    sha256: "540b9b7839c385a1dc1d1aa615251fcab1ba47b5d6f66734e4dbed55f1820fc5",
  },
};

const WRITE = process.argv.includes("--write");
const CREATED_BY = "spreadsheet_seed";

// ─────────────────────────────────────────────────────────────────────
// TBJ - FL / TBJ - Actuals - 2026
//   Two-row header, data from row 3, dateCol = B.
// Value columns: F H J L N P (MLB), R T V (MiLB), AD AF AH (Single A
// Jays), AJ AL (SSM), AN AP AR AT AV AX AZ (Other).
// Skip X Z AB (Blank placeholders) and BB-BF (totals).
// ─────────────────────────────────────────────────────────────────────
const TBJ_TAB = {
  sheetName: "TBJ - Actuals - 2026",
  headerRows: 2,
  dateColLetter: "B",
  columns: [
    ["F",  "Major League - PDC",  "Breakfast"],
    ["H",  "Major League - PDC",  "Lunch"],
    ["J",  "Major League - PDC",  "Dinner"],
    ["L",  "Major League - PDC",  "Umpire"],
    ["N",  "Major League - PDC",  "Post Game Meal"],
    ["P",  "Major League - PDC",  "Snack"],
    ["R",  "Minor League - PDC",  "Breakfast"],
    ["T",  "Minor League - PDC",  "Lunch"],
    ["V",  "Minor League - PDC",  "Dinner"],
    ["AD", "Single A Jays",       "Breakfast"],
    ["AF", "Single A Jays",       "Pre-Game"],
    ["AH", "Single A Jays",       "Post-Game"],
    ["AJ", "SSM",                 "Stadium Staff Meals"],
    ["AL", "SSM",                 "Florida Ops - PDC"],
    ["AN", "Other",               "Fun $$$$ Allocated"],
    ["AP", "Other",               "Scout Meals"],
    ["AR", "Other",               "Media Meals"],
    ["AT", "Other",               "MLB G&G - Pantry"],
    ["AV", "Other",               "MiLB G&G - Pantry"],
    ["AX", "Other",               "MLB - Catering"],
    ["AZ", "Other",               "Team Canada"],
  ],
};

// ─────────────────────────────────────────────────────────────────────
// TBR - FL / TBR-2026 - Actuals
//   THREE-row header, data from row 4 (row 2 is a stray 2026-08-03
//   orphan per Kevin's ruling; skipped). dateCol = A (shifted layout).
// Value columns: F H J L N P R T (MLB), V X Z AB AD AF AH AJ (MiLB).
// Skip AL AN AP AR AT AV (Blank placeholders) and AX-BB (totals).
// Case normalization: 'Extended Day labor' -> 'Extended Day Labor'.
// Trailing-space rstrip on MiLB header cells.
// ─────────────────────────────────────────────────────────────────────
const TBR_TAB = {
  sheetName: "TBR-2026 - Actuals",
  headerRows: 3,
  dateColLetter: "A",
  columns: [
    ["F",  "Major League", "Breakfast"],
    ["H",  "Major League", "Lunch"],
    ["J",  "Major League", "Dinner"],
    ["L",  "Major League", "Extra Protein - Chicken/Pork"],
    ["N",  "Major League", "Extra Protein - Beef/Seafood"],
    ["P",  "Major League", "MLB - Extra MTO - Sm"],
    ["R",  "Major League", "MLB - Extra MTO - Med"],
    ["T",  "Major League", "MLB - Extra MTO - Lrg"],
    ["V",  "Minor League", "Breakfast - MiLB"],       // rstripped; ST twin is archived
    ["X",  "Minor League", "Lunch - MiLB"],           // rstripped; ST twin is archived
    ["Z",  "Minor League", "Road Sandwiches - MiLB"], // rstripped
    ["AB", "Minor League", "Dinner"],
    ["AD", "Minor League", "AFTER HOURS MEALS"],
    ["AF", "Minor League", "Extended Day Labor"],     // sheet has lowercase 'l'
    ["AH", "Minor League", "Extra Protein - Chicken/Pork"],
    ["AJ", "Minor League", "Extra Protein - Beef/Seafood"],
  ],
};

// ─────────────────────────────────────────────────────────────────────
// TBR B&G / B&G-2026 - Actuals
//   Two-row header, data from row 3, dateCol = B. Single value col D.
//   Sheet header cell reads 'Lunch'; explicit override to catalog
//   name 'B&G Lunch' under group 'Boys & Girls Club'.
// ─────────────────────────────────────────────────────────────────────
// B&G-cap 2026-09-02: Chat-Claude found the B&G tab is forward-filled
// with a flat 125 from August through 2026-11-19 after a June-July gap.
// That is a plan not a record - and it includes future dates. Kevin
// caps B&G at today so only real recorded counts land.
const TBR_BG_MAX_DATE = "2026-09-02";

const TBR_BG_TAB = {
  sheetName: "B&G-2026 - Actuals",
  headerRows: 2,
  dateColLetter: "B",
  maxDate: TBR_BG_MAX_DATE,
  columns: [
    ["D", "Boys & Girls Club", "B&G Lunch"],
  ],
};

// Archived ST twin service_ids (must never resolve).
const ARCHIVED_ST_IDS = new Set([
  "27906746-6109-4d8b-ac43-9a70f45ba966", // Breakfast - MiLB ST
  "442813d9-0203-4c76-84c4-039f601a82a6", // Lunch - MiLB ST
]);

// ─────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────
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
  // Excel dates come through as JS Date objects. Format YYYY-MM-DD in UTC to
  // avoid timezone drift (openpyxl parity: dates are stored as datetime with
  // 00:00:00 - we treat that as the wall-clock date).
  return d.toISOString().slice(0, 10);
}

function unwrapCell(v) {
  // ExcelJS surfaces formula cells as {formula, result} or shared-formula
  // cells as {sharedFormula, result}. Unwrap to the concrete value.
  if (v && typeof v === "object" && "result" in v) return v.result;
  return v;
}

// Collect all non-numeric cell findings across a run instead of throwing
// on the first. The dry-run report surfaces them so Kevin can rule once
// on the whole set of data-entry noise.
const NON_NUMERIC_FINDINGS = [];

function toNumber(v, ref) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return 0;
    // Common blank-marker typos treated as 0 with a warning.
    if (s === "." || s === "-" || s === "N/A" || s.toUpperCase() === "OFF") {
      NON_NUMERIC_FINDINGS.push({ ref, raw: v, treated: 0, kind: "blank-marker" });
      return 0;
    }
    const n = Number(s.replace(/[,$]/g, ""));
    if (Number.isFinite(n)) return n;
    // Unrecognized non-numeric: record and treat as 0, so parse
    // completes and Kevin sees the full list before ruling.
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

// ─────────────────────────────────────────────────────────────────────
// Load sc_services and build (group|service) -> id resolver per account.
// Only ACTIVE (active_until IS NULL) rows are returned - archived
// services (like the two ST twins) are deliberately excluded so any
// attempt to resolve to them is a hard fail.
// ─────────────────────────────────────────────────────────────────────
async function loadServiceResolver(supa) {
  const out = {};
  const nonRev = {}; // service_id -> boolean
  for (const acct of ["TBR - FL", "TBJ - FL"]) {
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
  if (ARCHIVED_ST_IDS.has(id)) {
    throw new Error(`ARCHIVED HIT: ${accountKey} / ${group} / ${service} resolves to archived ST twin ${id}`);
  }
  return id;
}

// ─────────────────────────────────────────────────────────────────────
// Parse one actuals-shaped tab into an array of {date, group, service,
// letter, cellRef, raw, value} rows. Skips rows whose date column is
// empty or non-Date, and skips rows entirely inside the header block.
// ─────────────────────────────────────────────────────────────────────
async function parseTab({ path: filepath, tab }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filepath);
  const ws = wb.getWorksheet(tab.sheetName);
  if (!ws) throw new Error(`Sheet not found: ${tab.sheetName} in ${filepath}`);
  const dc = colLetterToNum(tab.dateColLetter);
  const rows = [];
  const startRow = tab.headerRows + 1;
  ws.eachRow((row, rowNum) => {
    if (rowNum < startRow) return; // header + (for TBR) stray row 2
    const dateVal = unwrapCell(row.getCell(dc).value);
    let iso = null;
    if (dateVal instanceof Date) iso = isoDate(dateVal);
    else if (typeof dateVal === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) iso = dateVal.slice(0, 10);
    if (!iso) return;
    if (tab.maxDate && iso > tab.maxDate) return;
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

// ─────────────────────────────────────────────────────────────────────
// Build the row set to write for one account.
// Behaviour rules:
//   - Load every DATE carrying any non-zero value across value cols.
//     Dates whose row is entirely zero across value cols are skipped.
//   - Within a loaded date, every service becomes a row (empty -> 0).
//   - Round to whole numbers uniformly. sc_daily_actuals.actual_count
//     is INTEGER scale 0; fractional values are impossible per schema.
//     Kevin's prompt asked to preserve Fun $$$$ Allocated's "dollar
//     amount in count field" convention - satisfied by whole-dollar
//     rounding, which is what prior loads (_seed_sc_from_xlsx.mjs and
//     PR-B1) both did with Math.round.
// ─────────────────────────────────────────────────────────────────────
function buildAccountRowSet({ accountKey, parsed, resolver, nonRev }) {
  // Group rows by date.
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

// ─────────────────────────────────────────────────────────────────────
// Span report + per-month counts + sanity anchors.
// ─────────────────────────────────────────────────────────────────────
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
  if (rowSet.skippedZeroDates.length > 0) {
    console.log(`  skipped ${rowSet.skippedZeroDates.length} dates that were entirely zero across value cols.`);
  }
}

function printAnchor(label, rowSet, targetDate) {
  const drows = rowSet.written.filter((r) => r.service_date === targetDate);
  const nz = drows.filter((r) => r.actual_count !== 0);
  console.log(`\n--- ANCHOR: ${label}  date=${targetDate} ---`);
  if (drows.length === 0) {
    console.log(`  (no rows on this date - not in span)`);
    return;
  }
  console.log(`  ${nz.length} non-zero service(s) on this date (of ${drows.length} total services):`);
  for (const r of nz) {
    const cell = r._cellRef.padEnd(38);
    console.log(`    ${cell}  ${r._group} / ${r._service}  =  ${r.actual_count}`);
  }
}

// Choose four anchor dates (Kevin eyeballs these against the sheets):
//   TBR mid-season week (target 2026-05-06 Wed), TBR recent (2026-09-11
//   Fri), TBJ mid-season (target 2026-05-13 Wed), TBJ recent
//   (2026-09-06 Sun). Falls back to the nearest date in the span if the
//   target has no rows.
function nearestDateWithData(rowSet, target) {
  const dates = [...new Set(rowSet.written.map((r) => r.service_date))].sort();
  if (dates.includes(target)) return target;
  // find nearest by absolute distance
  const t = new Date(target).getTime();
  let best = null, bestDelta = Infinity;
  for (const d of dates) {
    const delta = Math.abs(new Date(d).getTime() - t);
    if (delta < bestDelta) { best = d; bestDelta = delta; }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────
// Write path (--write only). Per-account: DELETE all rows in scope,
// INSERT the new set. Backup taken in memory before DELETE; if any
// INSERT fails, backup is re-inserted to preserve prior state.
// ─────────────────────────────────────────────────────────────────────
async function writeAccount(supa, accountKey, rowSet) {
  console.log(`\n=== WRITE: ${accountKey} ===`);
  const rowsToInsert = rowSet.written.map(
    ({ _group, _service, _letter, _cellRef, ...rest }) => rest
  );
  if (rowsToInsert.length === 0) {
    console.log(`  no rows to write - skipping`);
    return { deleted: 0, inserted: 0 };
  }
  const dates = [...new Set(rowsToInsert.map((r) => r.service_date))].sort();
  const firstDate = dates[0];
  const lastDate  = dates[dates.length - 1];
  console.log(`  span: ${firstDate} .. ${lastDate}  (${rowsToInsert.length} rows to insert)`);

  // Backup: read all rows currently in scope BEFORE deleting.
  const backup = await readAllInScope(supa, accountKey, firstDate, lastDate);
  console.log(`  backup: read ${backup.length} existing rows in scope`);

  // DELETE all rows in scope.
  const { count: delCount, error: delErr } = await supa
    .from("sc_daily_actuals")
    .delete({ count: "exact" })
    .eq("account_key", accountKey)
    .gte("service_date", firstDate)
    .lte("service_date", lastDate);
  if (delErr) throw new Error(`DELETE ${accountKey}: ${delErr.message}`);
  console.log(`  deleted: ${delCount} rows`);

  // INSERT the new set. Chunk to 500 per request.
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
    console.error(`  ROLLBACK: clearing any partial spreadsheet_seed rows for ${accountKey} in scope, then re-inserting backup of ${backup.length} rows...`);
    // Step A: clear any partial spreadsheet_seed rows the failed INSERT
    // managed to write. Otherwise the backup re-insert collides on
    // uq_sc_daily_actuals_service_date.
    const { count: clearCount, error: clearErr } = await supa
      .from("sc_daily_actuals")
      .delete({ count: "exact" })
      .eq("account_key", accountKey)
      .eq("created_by", CREATED_BY)
      .gte("service_date", firstDate)
      .lte("service_date", lastDate);
    if (clearErr) {
      console.error(`  ROLLBACK STEP A FAILED (clear partials): ${clearErr.message}`);
      throw new Error(`INSERT failed AND rollback clear-partial failed. Backup is in memory only - halt for manual repair.`);
    }
    console.error(`  ROLLBACK step A: cleared ${clearCount} partial spreadsheet_seed rows`);
    // Step B: re-insert backup.
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
  return { deleted: delCount, inserted, backup: backup.length };
}

async function readAllInScope(supa, accountKey, firstDate, lastDate) {
  // Paginate above 1000 rows (SR: unpaginated .select() silently caps).
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

// ─────────────────────────────────────────────────────────────────────
// Post-write verifications (S3-S8).
// ─────────────────────────────────────────────────────────────────────
async function postWriteChecks(supa, results) {
  console.log(`\n=== POST-WRITE CHECKS ===`);
  // S3 per-account, per-month counts from DB.
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
  // S4: every row in scope has created_by='spreadsheet_seed'
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
  // S5: zero rows outside the two accounts or outside union span
  const allSpans = Object.values(results);
  const allFirst = allSpans.reduce((a, b) => (a < b.firstDate ? a : b.firstDate), "9999-12-31");
  const allLast  = allSpans.reduce((a, b) => (a > b.lastDate  ? a : b.lastDate ), "0000-01-01");
  const { count: outN, error: outErr } = await supa
    .from("sc_daily_actuals")
    .select("id", { count: "exact", head: true })
    .eq("created_by", CREATED_BY)
    .or(`account_key.not.in.(TBR - FL,TBJ - FL),service_date.lt.${allFirst},service_date.gt.${allLast}`);
  if (outErr) throw outErr;
  console.log(`  S5 out-of-scope '${CREATED_BY}' rows: ${outN} (expect 0)`);
  // S6: no import-script or k.fietek@ rows remain in scope
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
  // S8: catalog untouched - count of active services per account
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
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`PR-S seed  mode=${WRITE ? "WRITE" : "DRY-RUN"}  at ${new Date().toISOString()}`);

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

  // Service resolver.
  const supa = pgClient();
  console.log(`\n=== resolving services from live catalog ===`);
  const { resolver, nonRev } = await loadServiceResolver(supa);
  console.log(`  TBR - FL: ${resolver["TBR - FL"].size} active services`);
  console.log(`  TBJ - FL: ${resolver["TBJ - FL"].size} active services`);

  // Parse.
  console.log(`\n=== parsing workbooks ===`);
  const tbjParsed = await parseTab({ path: INPUTS.TBJ.path, tab: TBJ_TAB });
  console.log(`  TBJ actuals: ${tbjParsed.length} parsed cells`);
  const tbrParsed = await parseTab({ path: INPUTS.TBR.path, tab: TBR_TAB });
  console.log(`  TBR actuals: ${tbrParsed.length} parsed cells`);
  const tbrBgParsed = await parseTab({ path: INPUTS.TBR.path, tab: TBR_BG_TAB });
  console.log(`  TBR B&G actuals: ${tbrBgParsed.length} parsed cells`);

  // Resolve into per-account row sets. TBR combines main + B&G.
  const tbjSet = buildAccountRowSet({
    accountKey: "TBJ - FL", parsed: tbjParsed, resolver, nonRev,
  });
  const tbrSet = buildAccountRowSet({
    accountKey: "TBR - FL", parsed: [...tbrParsed, ...tbrBgParsed], resolver, nonRev,
  });

  // Spans + per-month.
  spanReport("TBJ - FL", tbjSet);
  spanReport("TBR - FL (main + B&G)", tbrSet);

  // Non-numeric cell findings (data-entry noise).
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
    { label: "TBR mid-season",  set: tbrSet, target: "2026-05-06" },
    { label: "TBR recent",      set: tbrSet, target: "2026-09-11" },
    { label: "TBJ mid-season",  set: tbjSet, target: "2026-05-13" },
    { label: "TBJ recent",      set: tbjSet, target: "2026-09-06" },
  ];
  for (const a of anchors) {
    const eff = nearestDateWithData(a.set, a.target);
    printAnchor(`${a.label}${eff === a.target ? "" : ` (target ${a.target}, nearest ${eff})`}`, a.set, eff);
  }

  // Dry-run halt.
  if (!WRITE) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`DRY-RUN COMPLETE`);
    console.log(`Row shape: { account_key, service_id, service_date, actual_count,`);
    console.log(`             created_by='${CREATED_BY}', updated_by='${CREATED_BY}' }`);
    console.log(`To write: re-run with --write after Kevin's explicit go.`);
    console.log(`${"=".repeat(70)}`);
    return;
  }

  // WRITE path.
  console.log(`\n${"=".repeat(70)}`);
  console.log(`WRITE STEP - Kevin's explicit go on the dry-run required`);
  console.log(`${"=".repeat(70)}`);
  const results = {};
  const tbjDates = [...new Set(tbjSet.written.map((r) => r.service_date))].sort();
  const tbrDates = [...new Set(tbrSet.written.map((r) => r.service_date))].sort();
  const rTbj = await writeAccount(supa, "TBJ - FL", tbjSet);
  results["TBJ - FL"] = { ...rTbj, firstDate: tbjDates[0], lastDate: tbjDates[tbjDates.length - 1] };
  const rTbr = await writeAccount(supa, "TBR - FL", tbrSet);
  results["TBR - FL"] = { ...rTbr, firstDate: tbrDates[0], lastDate: tbrDates[tbrDates.length - 1] };

  await postWriteChecks(supa, results);

  // S7 spot check: three random dates per account, DB counts vs workbook counts.
  console.log(`\n=== S7: post-write spot check (random dates) ===`);
  for (const [acct, set] of [["TBJ - FL", tbjSet], ["TBR - FL", tbrSet]]) {
    const dates = [...new Set(set.written.map((r) => r.service_date))].sort();
    // pick 3 evenly spaced samples
    const picks = [dates[Math.floor(dates.length * 0.15)], dates[Math.floor(dates.length * 0.5)], dates[Math.floor(dates.length * 0.85)]];
    for (const d of picks) {
      const { data, error } = await supa
        .from("sc_daily_actuals")
        .select("service_id, actual_count")
        .eq("account_key", acct)
        .eq("service_date", d);
      if (error) throw error;
      const dbSum = data.reduce((a, r) => a + Number(r.actual_count), 0);
      const wbSum = set.written.filter((r) => r.service_date === d).reduce((a, r) => a + r.actual_count, 0);
      const ok = data.length === set.written.filter((r) => r.service_date === d).length && dbSum === wbSum;
      console.log(`  ${acct}  ${d}  db_rows=${data.length}  wb_rows=${set.written.filter((r) => r.service_date === d).length}  db_sum=${dbSum}  wb_sum=${wbSum}  ${ok ? "MATCH" : "MISMATCH"}`);
    }
  }

  console.log(`\nWRITE COMPLETE.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`\nFATAL: ${e?.stack || e?.message || e}`);
  process.exit(1);
});
