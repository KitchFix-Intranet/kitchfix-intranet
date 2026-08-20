// scripts/_build_auth_pair_exclusions_workbook.mjs
//
// Builds the auth_pair_exclusions_<YYYY-MM-DD>.xlsx workbook per Ruling 4/5
// spec, sheets 1-5. Local artifact only - NOT committed. Contains merchant
// names and dollars.
//
// The workbook is a READ-ONLY projection of what the derive would apply
// (with the same pair-detection + report-arbitration logic as the sync).
// It reads:
//   - purchasing_actuals (current fact table, rippling_spend source)
//   - rippling_raw_spend_lines_latest (parent + date resolution)
//   - rippling_report_seen_txns (report arbitration - empty if not seeded yet)
//   - the unfiltered custom-report CSV (for reason-column arbitration)
//
// Two shapes on Sheet 1 ("What moved"): "before" = the current fact-table
// state, sums by bucket. "after" = the projected state after applying
// Ruling 4 + Ruling 5 exclusions in-memory (nothing is written to the DB).
//
// CLI:
//   node --env-file=/Users/kevinfietek/dev/kitchfix-intranet/.env.local \
//     scripts/_build_auth_pair_exclusions_workbook.mjs \
//     --csv=/Users/kevinfietek/Downloads/Custom_report-<hash>.csv \
//     --out=/Users/kevinfietek/Downloads/auth_pair_exclusions_2026-08-20.xlsx
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from "node:fs";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
  const args = { csv: null, out: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--csv=")) args.csv = a.slice("--csv=".length);
    else if (a.startsWith("--out=")) args.out = a.slice("--out=".length);
    else { console.error("unknown arg: " + a); process.exit(1); }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.csv || !args.out) { console.error("--csv and --out are required"); process.exit(1); }
if (!fs.existsSync(args.csv)) { console.error(`csv not found: ${args.csv}`); process.exit(1); }

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }

const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const WINDOW_DAYS = 5;
const HEX24 = /^[a-f0-9]{24}$/;
const RULING_1_CALIBRATION_DAYS = -1;

function parentIdFromExternalId(ext) {
  if (!ext || typeof ext !== "string") return null;
  const idx = ext.indexOf("__");
  if (idx <= 0) return null;
  const tok = ext.slice(0, idx).toLowerCase();
  return HEX24.test(tok) ? tok : null;
}

function objectIdToTxnDate(hex24) {
  if (!hex24 || !HEX24.test(hex24)) return null;
  const secs = parseInt(hex24.slice(0, 8), 16);
  if (!Number.isFinite(secs)) return null;
  const ms = (secs + RULING_1_CALIBRATION_DAYS * 86400) * 1000;
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

// ─── CSV parse (RFC-4180-ish) ────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") { field += "\""; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++;
    } else {
      if (ch === "\"") { inQuotes = true; i++; }
      else if (ch === ",") { row.push(field); field = ""; i++; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
      else if (ch === "\r") { i++; }
      else { field += ch; i++; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ─── Load current fact table (rippling_spend) ───────────────────────
async function loadActuals() {
  const PAGE = 1000;
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supa
      .from("purchasing_actuals")
      .select("id, source_line_id, source_bill_id, account_key, excluded, gl_line_code, gl_bucket, txn_date, amount, vendor_or_merchant")
      .eq("source", "rippling_spend")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`actuals: ${error.message}`);
    const batch = data || [];
    for (const r of batch) rows.push(r);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function loadRawLines() {
  const PAGE = 1000;
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supa
      .from("rippling_raw_spend_lines_latest")
      .select("rippling_id, external_id, amount, currency, department_label, work_location_label, merchant_name, parent_txn_id")
      .order("rippling_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`raw: ${error.message}`);
    const batch = data || [];
    for (const r of batch) rows.push(r);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// ─── Bucket resolver ────────────────────────────────────────────────
// Uses account_key + gl_line_code + gl_bucket to bin each row into one of
// the operator-facing buckets. Multiple sinks aggregate for Sheet 1:
//   Food                     -> gl_line_code startsWith "32" or "34" (kitchen COGS)
//   Packaging & supplies     -> gl_line_code startsWith "35" (packaging COGS)
//   Vehicle                  -> gl_line_code startsWith "5" and matches vehicle
//   Equipment                -> gl_line_code startsWith "5" and matches equipment
//   Repair & maintenance     -> gl_line_code startsWith "5" and matches R&M
//   Reimbursable             -> gl_bucket = 'reimbursable' (13xx)
//   Pending                  -> excluded = FALSE and gl_line_code IS NULL (unlabelled)
// The kitchen-COGS buckets aren't split by lookup here because the exact
// gl_line_code -> operator label mapping lives in KPI_PURCHASING_MASTER.
// We use prefix rules as a coarse proxy; that's enough for Sheet 1's
// "did the numbers move sensibly" ask.
function bucketOf(row) {
  const code = row.gl_line_code || "";
  const bucket = row.gl_bucket || "";
  // Pending: not excluded, no code
  if (row.excluded === false && !code) return "Pending";
  if (row.excluded === true) return null;  // excluded doesn't contribute
  if (bucket === "reimbursable") return "Reimbursable";
  // pl_cogs (32/34/35) breakdown by prefix
  if (code.startsWith("35")) return "Packaging & supplies";
  if (code.startsWith("32") || code.startsWith("34")) return "Food";
  // sga (5xxxx) - crude label match on code text
  const lower = code.toLowerCase();
  if (lower.includes("vehicle") || /^50[0-9]{2}\.4/.test(code)) return "Vehicle";
  if (lower.includes("equipment") || /^50[0-9]{2}\.5/.test(code)) return "Equipment";
  if (lower.includes("repair") || lower.includes("maintenance")) return "Repair & maintenance";
  return "Other";
}

const BUCKET_ORDER = [
  "Food",
  "Packaging & supplies",
  "Vehicle",
  "Equipment",
  "Repair & maintenance",
  "Reimbursable",
  "Pending",
  "Other",
];

// ─── Main build ─────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  console.log("loading unfiltered report CSV...");
  const raw = fs.readFileSync(args.csv, "utf8");
  const csvRows = parseCSV(raw);
  const csvHeader = csvRows[0];
  const txnIdx = csvHeader.indexOf("Transaction ID");
  if (txnIdx < 0) throw new Error("CSV missing Transaction ID column");
  const csvParents = new Set();
  for (let i = 1; i < csvRows.length; i++) {
    const id = csvRows[i][txnIdx];
    if (id) csvParents.add(id);
  }
  console.log(`  csv distinct parents: ${csvParents.size}`);

  console.log("loading fact table (purchasing_actuals, rippling_spend)...");
  const actuals = await loadActuals();
  console.log(`  actuals rows: ${actuals.length}`);

  console.log("loading raw spend lines (for parent + department + work_location)...");
  const rawLines = await loadRawLines();
  console.log(`  raw rows: ${rawLines.length}`);

  // rid -> { parent, department, work_location, merchant, currency }
  const rawByRid = new Map();
  for (const r of rawLines) {
    const parent = parentIdFromExternalId(r.external_id);
    rawByRid.set(r.rippling_id, {
      parent,
      department: r.department_label || "",
      work_location: r.work_location_label || "",
      merchant: r.merchant_name || "",
      currency: r.currency,
      parent_txn_id: r.parent_txn_id,
    });
  }

  // ─── Try loading rippling_report_seen_txns; if absent, fall back to CSV parents ─
  let reportSeen = new Set();
  {
    try {
      const { data, error } = await supa
        .from("rippling_report_seen_txns")
        .select("parent_txn_id")
        .limit(10000);
      if (!error) {
        for (const r of data || []) reportSeen.add(r.parent_txn_id);
      }
    } catch (_e) { /* table absent - fall back */ }
    if (reportSeen.size === 0) {
      console.log("  rippling_report_seen_txns absent or empty; falling back to CSV parents for report-arbitration in the workbook");
      reportSeen = csvParents;
    } else {
      console.log(`  report-seen loaded: ${reportSeen.size}`);
    }
  }

  // ─── Aggregate parents from actuals (rippling_spend). ────────────────
  // parent -> { cents, merchant, txn_date, lineIds:[], department, work_location }
  const parentAgg = new Map();
  for (const a of actuals) {
    const rid = a.source_line_id.startsWith("rippling_spend:") ? a.source_line_id.slice("rippling_spend:".length) : null;
    if (!rid) continue;
    const raw = rawByRid.get(rid);
    if (!raw) continue;
    const parent = raw.parent;
    if (!parent) continue;
    if (!parentAgg.has(parent)) {
      parentAgg.set(parent, {
        parent,
        merchant: raw.merchant || a.vendor_or_merchant || "",
        cents: 0,
        txn_date: a.txn_date,
        lineIds: [],
        department: raw.department,
        work_location: raw.work_location,
        alreadyExcluded: true,
        anyNonUSD: false,
      });
    }
    const p = parentAgg.get(parent);
    p.lineIds.push({ id: a.id, cents: Math.round(Number(a.amount || 0) * 100), excluded: a.excluded, source_line_id: a.source_line_id });
    if (!a.excluded) p.alreadyExcluded = false;
    // parent-level USD sum uses ONLY non-excluded USD lines. Non-USD
    // lines are already excluded upstream (Ruling 3); they don't add.
    const ccy = String(raw.currency || "").toUpperCase();
    if (ccy && ccy !== "USD") p.anyNonUSD = true;
    else if (!a.excluded) p.cents += Math.round(Number(a.amount || 0) * 100);
  }

  // ─── Ruling 4 pair-detection (parent level, report-arbitrated) ──────
  const authPairEarlierParents = new Set();
  const authPairLaterParentExcluded = new Set();
  const authPairKeptEarlierParents = new Set();
  const authPairSummary = [];  // for Sheet 2

  const byKey = new Map();
  for (const p of parentAgg.values()) {
    if (p.alreadyExcluded) continue;   // no non-excluded lines to pair off
    if (p.anyNonUSD) continue;
    if (p.cents === 0) continue;       // handled by Ruling 5
    if (!p.merchant || !p.txn_date) continue;
    const key = JSON.stringify([p.merchant.trim(), p.cents]);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => {
      if (a.txn_date < b.txn_date) return -1;
      if (a.txn_date > b.txn_date) return 1;
      return a.parent < b.parent ? -1 : a.parent > b.parent ? 1 : 0;
    });
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i], b = arr[i + 1];
      const da = new Date(a.txn_date + "T00:00:00Z").getTime();
      const db = new Date(b.txn_date + "T00:00:00Z").getTime();
      const days = Math.round((db - da) / 86400000);
      if (days < 0 || days > WINDOW_DAYS) continue;
      const aIn = reportSeen.has(a.parent);
      const bIn = reportSeen.has(b.parent);
      let excludedParent = null, keptPartner = null, decision;
      if (aIn && bIn)      { decision = "both_in_report_kept";    authPairKeptEarlierParents.add(a.parent); }
      else if (aIn && !bIn) { decision = "earlier_in_report_later_excluded"; authPairLaterParentExcluded.add(b.parent); excludedParent = b.parent; keptPartner = a; }
      else                 { decision = "keep_later";              authPairEarlierParents.add(a.parent); excludedParent = a.parent; keptPartner = b; }
      authPairSummary.push({
        earlier_parent: a.parent, later_parent: b.parent,
        earlier_date: a.txn_date, later_date: b.txn_date,
        days, merchant: a.merchant, amount: a.cents / 100,
        department: (excludedParent === a.parent ? a.department : b.department) || "",
        work_location: (excludedParent === a.parent ? a.work_location : b.work_location) || "",
        earlier_in_report: aIn, later_in_report: bIn,
        decision, excludedParent, keptPartner,
      });
    }
  }
  console.log(`ruling-4: earlier_excluded=${authPairEarlierParents.size} later_excluded_via_report=${authPairLaterParentExcluded.size} both_kept=${authPairKeptEarlierParents.size}`);

  // ─── Ruling 5 zero-amount parents (in-window) ───────────────────────
  const zeroAmountParents = new Set();
  for (const p of parentAgg.values()) {
    if (p.cents === 0 && !p.alreadyExcluded && !p.anyNonUSD) zeroAmountParents.add(p.parent);
  }
  console.log(`ruling-5: zero_amount_parents=${zeroAmountParents.size}`);

  // ─── Project the "after" fact table ─────────────────────────────────
  // For each actuals row: if its parent is auth-pair-excluded or zero-amount,
  // the row transitions from non-excluded to excluded (contribution -> 0).
  const projectedExcluded = new Set();  // actuals.id set
  for (const a of actuals) {
    if (a.excluded) continue;
    const rid = a.source_line_id.startsWith("rippling_spend:") ? a.source_line_id.slice("rippling_spend:".length) : null;
    const raw = rid ? rawByRid.get(rid) : null;
    const parent = raw?.parent;
    if (!parent) continue;
    if (authPairEarlierParents.has(parent) || authPairLaterParentExcluded.has(parent)) {
      projectedExcluded.add(`${a.id}|auth_pair`);
    } else if (zeroAmountParents.has(parent)) {
      projectedExcluded.add(`${a.id}|zero_amount`);
    }
  }

  // ─── Sheet 1: What moved (per-bucket before/after) ───────────────────
  const beforeByBucket = new Map();
  const afterByBucket = new Map();
  for (const a of actuals) {
    if (a.excluded) continue;
    const bkt = bucketOf(a);
    if (!bkt) continue;
    beforeByBucket.set(bkt, (beforeByBucket.get(bkt) || 0) + Number(a.amount || 0));
    const wasProjected = projectedExcluded.has(`${a.id}|auth_pair`) || projectedExcluded.has(`${a.id}|zero_amount`);
    if (!wasProjected) afterByBucket.set(bkt, (afterByBucket.get(bkt) || 0) + Number(a.amount || 0));
  }
  const beforeCardTotal = [...beforeByBucket.values()].reduce((s, v) => s + v, 0);
  const afterCardTotal  = [...afterByBucket.values()].reduce((s, v) => s + v, 0);

  // ─── Sheet 4: Kept but unpaired (~14%) ───────────────────────────────
  const pairedParents = new Set();
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    for (const p of arr) {
      // only mark parents adjacent to a within-window partner
    }
  }
  // Rebuild pairedParents properly - only parents that appear in any within-window pair
  for (const s of authPairSummary) {
    pairedParents.add(s.earlier_parent);
    pairedParents.add(s.later_parent);
  }
  // "Unpaired kept" = non-excluded parent with no in-window partner and non-zero USD.
  const unpaired = [];
  for (const p of parentAgg.values()) {
    if (p.alreadyExcluded) continue;
    if (p.anyNonUSD) continue;
    if (p.cents === 0) continue;
    if (pairedParents.has(p.parent)) continue;
    unpaired.push({
      parent: p.parent, txn_date: p.txn_date, merchant: p.merchant, amount: p.cents / 100,
      department: p.department,
    });
  }
  unpaired.sort((a, b) => b.amount - a.amount);

  // ─── Sheet 3: Zero-amount excluded parents ──────────────────────────
  const zeroList = [];
  for (const parent of zeroAmountParents) {
    const p = parentAgg.get(parent);
    if (!p) continue;
    zeroList.push({
      parent, txn_date: p.txn_date, merchant: p.merchant,
      department: p.department, work_location: p.work_location,
      in_report: reportSeen.has(parent),
    });
  }

  // ─── Build workbook ──────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "auth_pair_exclusions_builder";
  wb.created = new Date();

  // Sheet 1 - What moved
  const ws1 = wb.addWorksheet("What moved");
  ws1.columns = [
    { header: "Bucket", key: "bucket", width: 28 },
    { header: "Before ($)", key: "before", width: 18, style: { numFmt: '"$"#,##0.00' } },
    { header: "After ($)", key: "after", width: 18, style: { numFmt: '"$"#,##0.00' } },
    { header: "Delta ($)", key: "delta", width: 18, style: { numFmt: '"$"#,##0.00' } },
    { header: "Delta %", key: "deltapct", width: 12, style: { numFmt: "0.00%" } },
  ];
  for (const bkt of BUCKET_ORDER) {
    const before = beforeByBucket.get(bkt) || 0;
    const after = afterByBucket.get(bkt) || 0;
    if (before === 0 && after === 0) continue;
    const delta = after - before;
    const deltapct = before === 0 ? 0 : delta / before;
    ws1.addRow({ bucket: bkt, before, after, delta, deltapct });
  }
  const totalDelta = afterCardTotal - beforeCardTotal;
  const totalDeltaPct = beforeCardTotal === 0 ? 0 : totalDelta / beforeCardTotal;
  ws1.addRow({ bucket: "PORTFOLIO TOTAL", before: beforeCardTotal, after: afterCardTotal, delta: totalDelta, deltapct: totalDeltaPct });
  ws1.getRow(1).font = { bold: true };
  ws1.lastRow.font = { bold: true };

  // Sheet 2 - Excluded auth half (cap 600 by amount desc)
  const ws2 = wb.addWorksheet("Excluded - auth half");
  ws2.columns = [
    { header: "Date (excluded)", key: "d1", width: 14 },
    { header: "Merchant", key: "m", width: 32 },
    { header: "Amount ($)", key: "amt", width: 14, style: { numFmt: '"$"#,##0.00' } },
    { header: "Department", key: "dept", width: 30 },
    { header: "Work location", key: "wl", width: 24 },
    { header: "Kept partner date", key: "d2", width: 16 },
    { header: "Kept partner ID", key: "id2", width: 26 },
    { header: "Days apart", key: "days", width: 10 },
    { header: "Partner in report", key: "inrep", width: 18 },
    { header: "Decision", key: "dec", width: 30 },
    { header: "Excluded parent ID", key: "idx", width: 26 },
  ];
  const sortableExcluded = authPairSummary
    .filter(s => s.excludedParent)   // decision keep_later / earlier_in_report_later_excluded
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 600);
  for (const s of sortableExcluded) {
    const isEarlierExcluded = s.excludedParent === s.earlier_parent;
    const excludedDate = isEarlierExcluded ? s.earlier_date : s.later_date;
    const keptDate = isEarlierExcluded ? s.later_date : s.earlier_date;
    const keptId = s.keptPartner?.parent || (isEarlierExcluded ? s.later_parent : s.earlier_parent);
    const partnerInReport = isEarlierExcluded ? s.later_in_report : s.earlier_in_report;
    ws2.addRow({
      d1: excludedDate, m: s.merchant, amt: s.amount, dept: s.department, wl: s.work_location,
      d2: keptDate, id2: keptId, days: s.days, inrep: partnerInReport ? "yes" : "no", dec: s.decision, idx: s.excludedParent,
    });
  }
  ws2.getRow(1).font = { bold: true };

  // Sheet 3 - Excluded zero amount
  const ws3 = wb.addWorksheet("Excluded - zero amount");
  ws3.columns = [
    { header: "Date", key: "d", width: 14 },
    { header: "Transaction ID", key: "id", width: 26 },
    { header: "Merchant", key: "m", width: 32 },
    { header: "Department", key: "dept", width: 30 },
    { header: "Work location", key: "wl", width: 24 },
    { header: "In report", key: "inrep", width: 12 },
  ];
  zeroList.sort((a, b) => (a.txn_date || "").localeCompare(b.txn_date || ""));
  for (const z of zeroList) {
    ws3.addRow({ d: z.txn_date, id: z.parent, m: z.merchant, dept: z.department, wl: z.work_location, inrep: z.in_report ? "yes" : "no" });
  }
  ws3.getRow(1).font = { bold: true };

  // Sheet 4 - Kept but unpaired (cap 300)
  const ws4 = wb.addWorksheet("Kept but unpaired");
  ws4.columns = [
    { header: "Date", key: "d", width: 14 },
    { header: "Transaction ID", key: "id", width: 26 },
    { header: "Merchant", key: "m", width: 32 },
    { header: "Amount ($)", key: "amt", width: 14, style: { numFmt: '"$"#,##0.00' } },
    { header: "Department", key: "dept", width: 30 },
  ];
  const unpairedCap = unpaired.slice(0, 300);
  for (const u of unpairedCap) {
    ws4.addRow({ d: u.txn_date, id: u.parent, m: u.merchant, amt: u.amount, dept: u.department });
  }
  ws4.getRow(1).font = { bold: true };

  // Sheet 5 - Read me
  const ws5 = wb.addWorksheet("Read me");
  ws5.columns = [{ header: "auth_pair_exclusions review workbook", key: "line", width: 100 }];
  const rulingLines = [
    `Ruling 4 (2026-08-20): same-merchant same-amount within ${WINDOW_DAYS} days -> keep later, exclude earlier. Report arbitrates - both-in-report -> keep both; earlier-in-report only -> keep earlier.`,
    `Ruling 5 (2026-08-20): in-window zero-amount parents excluded regardless of pairing.`,
    `What this changed: ${authPairEarlierParents.size + authPairLaterParentExcluded.size} auth-pair parents excluded; ${zeroAmountParents.size} zero-amount parents excluded. ${authPairKeptEarlierParents.size} pair earlier-halves KEPT by report arbitration (both-in-report).`,
    `Portfolio card FYTD: before $${beforeCardTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} -> after $${afterCardTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} (delta $${totalDelta.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}).`,
    `Unpaired parents (survived Ruling 4/5, no in-window partner): ${unpaired.length} totalling $${unpaired.reduce((s,u)=>s+u.amount,0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}. These remain unexplained - Cut+Dry-at-$11,412.92 is the example.`,
    `Do the new bucket totals on Sheet 1 look right to you?`,
  ];
  for (const line of rulingLines) ws5.addRow([line]);

  await wb.xlsx.writeFile(args.out);
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nworkbook written: ${args.out}  duration=${dur}s`);
  console.log(`sheet 1 buckets:`);
  for (const bkt of BUCKET_ORDER) {
    const b = beforeByBucket.get(bkt) || 0;
    const a = afterByBucket.get(bkt) || 0;
    if (b === 0 && a === 0) continue;
    console.log(`  ${bkt.padEnd(24)} before=$${b.toFixed(2).padStart(14)}  after=$${a.toFixed(2).padStart(14)}  delta=$${(a-b).toFixed(2)}`);
  }
  console.log(`  ${"PORTFOLIO".padEnd(24)} before=$${beforeCardTotal.toFixed(2).padStart(14)}  after=$${afterCardTotal.toFixed(2).padStart(14)}  delta=$${totalDelta.toFixed(2)}`);
  console.log("");
  console.log(`ruling counts: auth_pair_parents=${authPairEarlierParents.size + authPairLaterParentExcluded.size}  zero_amount_parents=${zeroAmountParents.size}  both_in_report_kept=${authPairKeptEarlierParents.size}  unpaired=${unpaired.length}`);
  console.log(`unpaired total: $${unpaired.reduce((s,u)=>s+u.amount,0).toFixed(2)}`);
  // Also emit in-window parents projection
  let inWindowParentsAfter = 0;
  const FY_START = "2025-12-29";
  const FY_END = "2026-08-19";
  for (const p of parentAgg.values()) {
    if (p.alreadyExcluded) continue;
    if (authPairEarlierParents.has(p.parent) || authPairLaterParentExcluded.has(p.parent)) continue;
    if (zeroAmountParents.has(p.parent)) continue;
    if (!p.txn_date) continue;
    if (p.txn_date < FY_START || p.txn_date > FY_END) continue;
    inWindowParentsAfter++;
  }
  console.log(`in-window parents after Ruling 4/5 (projected): ${inWindowParentsAfter}  vs report's 4838`);
}

main().catch(e => { console.error(e); process.exit(1); });
