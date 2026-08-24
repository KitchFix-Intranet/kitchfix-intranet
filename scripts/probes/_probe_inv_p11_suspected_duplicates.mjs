#!/usr/bin/env node
/*
 * INV-P11: suspected duplicate bills sweep. REPORT ONLY. No writes.
 *
 * Sweep purchasing_actuals rows where source='billcom' AND excluded=false,
 * FYTD (>= 2025-12-29). Find candidate pairs by (same account_key,
 * same amount to cent, txn_date within 7 days). Score into four tiers
 * on vendor-name similarity. Compute recurrence per (vendor_id, amount).
 * Chase the two Kevin-flagged pairs (Beau Davis, IN SOUTHWEST) with full
 * detail from billcom_raw_bills_latest.
 *
 * Deliverable: XLSX at ~/Downloads/suspected_duplicates_<today>.xlsx
 *
 * Change nothing. No exclusions applied. No PR. No commit.
 */

import ExcelJS from "exceljs";
import path from "node:path";
import os from "node:os";
import { createClient } from "@supabase/supabase-js";

// ---- env preflight (process.env only; never read .env*) ----
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("=== env preflight ===");
console.log(`SUPABASE_URL present: ${SB_URL ? "yes" : "NO"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY present: ${SB_KEY ? "yes" : "NO"}`);
if (!SB_URL || !SB_KEY) {
  console.error("BLOCKED: service-role env vars not present in process.env.");
  console.error("Reporting block per HARD RULE 6. Not working around; not sourcing .env*.");
  process.exit(2);
}

const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ---- config ----
const FYTD_START = "2025-12-29";
const today = new Date().toISOString().slice(0, 10);
const OUT_PATH = path.join(os.homedir(), "Downloads", `suspected_duplicates_${today}.xlsx`);

// ---- helpers ----
async function fetchAllBillcomActuals() {
  // Paginate over 1000-row cap
  const rows = [];
  let from = 0;
  const size = 1000;
  while (true) {
    const { data, error } = await supa
      .from("purchasing_actuals")
      .select(
        "id, source, source_bill_id, source_line_id, account_key, excluded, gl_line_code, gl_bucket, txn_date, posting_date, amount, vendor_or_merchant, paid, approx_date, derived_at"
      )
      .eq("source", "billcom")
      .eq("excluded", false)
      .gte("txn_date", FYTD_START)
      .order("txn_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + size - 1);
    if (error) throw new Error(`purchasing_actuals fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < size) break;
    from += size;
  }
  return rows;
}

async function fetchAllVendors() {
  const map = new Map();
  let from = 0;
  const size = 1000;
  while (true) {
    const { data, error } = await supa
      .from("billcom_ref_vendors")
      .select("id, name, archived")
      .range(from, from + size - 1);
    if (error) throw new Error(`billcom_ref_vendors fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const v of data) map.set(v.id, v);
    if (data.length < size) break;
    from += size;
  }
  return map;
}

async function fetchRawBillsByIds(billIds) {
  // billcom_raw_bills_latest is a view. Chunk in on() filter.
  const map = new Map();
  const unique = [...new Set(billIds.filter(Boolean))];
  const chunk = 100;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    const { data, error } = await supa
      .from("billcom_raw_bills_latest")
      .select(
        "bill_id, vendor_id, invoice_number, invoice_date, gl_posting_date, amount, paid_amount, due_amount, approval_status, payment_status, is_active, raw"
      )
      .in("bill_id", slice);
    if (error) throw new Error(`billcom_raw_bills_latest fetch failed: ${error.message}`);
    for (const r of data || []) map.set(r.bill_id, r);
  }
  return map;
}

async function fetchRawLinesByBillIds(billIds) {
  // billcom_raw_bill_lines_latest carries description/memo per line
  const map = new Map(); // bill_id -> array of lines
  const unique = [...new Set(billIds.filter(Boolean))];
  const chunk = 100;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    const { data, error } = await supa
      .from("billcom_raw_bill_lines_latest")
      .select("line_id, bill_id, amount, chart_of_account_id, actg_class_id, description, raw")
      .in("bill_id", slice);
    if (error) throw new Error(`billcom_raw_bill_lines_latest fetch failed: ${error.message}`);
    for (const l of data || []) {
      if (!map.has(l.bill_id)) map.set(l.bill_id, []);
      map.get(l.bill_id).push(l);
    }
  }
  return map;
}

function daysBetween(a, b) {
  // a, b are YYYY-MM-DD
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.abs(db - da) / 86400000;
}

function normName(s) {
  if (!s) return "";
  return String(s)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Damerau-Levenshtein bounded
function editDist(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function similarityTier(vidA, vidB, nameA, nameB) {
  // returns "identical" | "prefix" | "similar" | "unrelated"
  const nA = normName(nameA);
  const nB = normName(nameB);

  if (vidA && vidB && vidA === vidB) return "identical";

  if (nA && nB) {
    if (nA === nB) return "identical";
    // prefix - one is a proper prefix of the other, min len >= 8
    const shorter = nA.length <= nB.length ? nA : nB;
    const longer  = nA.length <= nB.length ? nB : nA;
    if (shorter.length >= 8 && longer.startsWith(shorter)) return "prefix";

    // shared leading token(s), or normalised edit distance <= 0.25
    const ta = nA.split(" ");
    const tb = nB.split(" ");
    const sharedLead =
      ta[0] && tb[0] && ta[0] === tb[0] && ta[0].length >= 4;
    const maxLen = Math.max(nA.length, nB.length);
    const dist = editDist(nA, nB);
    const normDist = dist / maxLen;
    if (sharedLead && normDist <= 0.35) return "similar";
    if (normDist <= 0.25) return "similar";
  }

  return "unrelated";
}

function tierRank(t) {
  return { identical: 3, prefix: 2, similar: 1, unrelated: 0 }[t];
}

function money(n) {
  const v = Number(n || 0);
  return v.toFixed(2);
}

// ---- MAIN ----
(async () => {
  console.log("\n=== fetching purchasing_actuals (billcom, excluded=false, FYTD) ===");
  const actuals = await fetchAllBillcomActuals();
  console.log(`rows: ${actuals.length}`);

  console.log("\n=== fetching billcom_ref_vendors ===");
  const vendorMap = await fetchAllVendors();
  console.log(`vendors: ${vendorMap.size}`);

  // ---- Recurrence: (vendor_id, amount) -> count ----
  const recurrence = new Map();
  for (const r of actuals) {
    const key = `${r.vendor_or_merchant || ""}||${money(r.amount)}`;
    recurrence.set(key, (recurrence.get(key) || 0) + 1);
  }

  // ---- Find candidate pairs (self-join in memory) ----
  // group by (account_key, amount) then within group find pairs with |date| <= 7 days
  const groups = new Map();
  for (const r of actuals) {
    const k = `${r.account_key || ""}||${money(r.amount)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const candidates = [];
  for (const [, arr] of groups) {
    if (arr.length < 2) continue;
    // rows sorted by txn_date because fetch was ordered by txn_date asc
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        if (!a.txn_date || !b.txn_date) continue;
        const d = daysBetween(a.txn_date, b.txn_date);
        if (d > 7) continue;
        // exclude same source_line_id (shouldn't happen due to unique) and same id
        if (a.id === b.id) continue;
        candidates.push({ a, b, days: d });
      }
    }
  }
  console.log(`\ncandidate pairs (same account, same amount, <=7 days): ${candidates.length}`);

  // ---- Score tiers ----
  for (const c of candidates) {
    const vA = vendorMap.get(c.a.vendor_or_merchant);
    const vB = vendorMap.get(c.b.vendor_or_merchant);
    c.vendorNameA = vA?.name || null;
    c.vendorNameB = vB?.name || null;
    c.tier = similarityTier(
      c.a.vendor_or_merchant,
      c.b.vendor_or_merchant,
      c.vendorNameA,
      c.vendorNameB
    );
    // recurrence per side
    const kA = `${c.a.vendor_or_merchant || ""}||${money(c.a.amount)}`;
    const kB = `${c.b.vendor_or_merchant || ""}||${money(c.b.amount)}`;
    c.recurrenceA = recurrence.get(kA) || 0;
    c.recurrenceB = recurrence.get(kB) || 0;
    c.recurrenceMax = Math.max(c.recurrenceA, c.recurrenceB);
  }

  // ---- Tier totals ----
  const tierBuckets = { identical: [], prefix: [], similar: [], unrelated: [] };
  for (const c of candidates) tierBuckets[c.tier].push(c);

  const dollars = (arr) => arr.reduce((s, c) => s + Number(c.a.amount || 0), 0);

  console.log("\n=== TIER TOTALS (all candidates before recurrence filter) ===");
  for (const t of ["identical", "prefix", "similar", "unrelated"]) {
    console.log(
      `  ${t.padEnd(10)} pairs=${String(tierBuckets[t].length).padStart(5)}  dollars(one-side)=$${dollars(tierBuckets[t]).toFixed(2)}`
    );
  }

  // ---- Suspicious (tiers 1-3) after recurrence filter ----
  // A pair whose recurrenceMax == 2 is the strong signal (only this pair for that vendor/amount).
  // recurrenceMax > 2 -> likely recurring charge.
  const suspiciousAll = [
    ...tierBuckets.identical,
    ...tierBuckets.prefix,
    ...tierBuckets.similar,
  ];
  const strongIsolated = suspiciousAll.filter((c) => c.recurrenceMax <= 2);
  const suspiciousRecurring = suspiciousAll.filter((c) => c.recurrenceMax > 2);

  console.log("\n=== recurrence filter (max(recurrenceA, recurrenceB)) ===");
  console.log(`suspicious (identical+prefix+similar) total pairs: ${suspiciousAll.length}`);
  console.log(`  strong-isolated (recurrenceMax <= 2): ${strongIsolated.length}  dollars=$${dollars(strongIsolated).toFixed(2)}`);
  console.log(`  recurring (recurrenceMax > 2):        ${suspiciousRecurring.length}  dollars=$${dollars(suspiciousRecurring).toFixed(2)}`);

  // ---- Part C: chase Kevin's four rows + Beau Davis vendor_id + raw payload ----
  const targetBillIds = new Set();
  for (const c of suspiciousAll) {
    if (c.a.source_bill_id) targetBillIds.add(c.a.source_bill_id);
    if (c.b.source_bill_id) targetBillIds.add(c.b.source_bill_id);
  }
  // Also grab Kevin's flagged 4 - search purchasing_actuals for the two pair anchors.
  const flagged = actuals.filter(
    (r) =>
      (r.account_key === "TBR - FL" && money(r.amount) === "6600.00" && r.txn_date >= "2025-12-27" && r.txn_date <= "2026-01-05") ||
      (r.account_key === "CIN - AZ" && money(r.amount) === "1968.22" && r.txn_date >= "2026-01-18" && r.txn_date <= "2026-01-24")
  );
  for (const r of flagged) if (r.source_bill_id) targetBillIds.add(r.source_bill_id);

  console.log(`\n=== fetching raw bills + lines for ${targetBillIds.size} bill_ids (all pair sides + flagged) ===`);
  const rawBills = await fetchRawBillsByIds([...targetBillIds]);
  const rawLines = await fetchRawLinesByBillIds([...targetBillIds]);
  console.log(`raw bills fetched: ${rawBills.size}, bills with lines: ${rawLines.size}`);

  // ---- Part C dump ----
  console.log("\n=== PART C: the four flagged transactions ===");
  const partC = flagged.sort((x, y) => (x.txn_date < y.txn_date ? -1 : 1));
  for (const r of partC) {
    const rb = rawBills.get(r.source_bill_id);
    const vend = vendorMap.get(r.vendor_or_merchant);
    console.log(`\n  ${r.account_key} | ${r.txn_date} | $${money(r.amount)}`);
    console.log(`    source_bill_id   : ${r.source_bill_id}`);
    console.log(`    source_line_id   : ${r.source_line_id}`);
    console.log(`    vendor_id        : ${r.vendor_or_merchant}`);
    console.log(`    vendor_name      : ${vend?.name || "(unresolved)"}`);
    console.log(`    gl_line_code     : ${r.gl_line_code}`);
    console.log(`    posting_date     : ${r.posting_date}`);
    console.log(`    paid             : ${r.paid}`);
    console.log(`    derived_at       : ${r.derived_at}`);
    if (rb) {
      console.log(`    invoice_number   : ${rb.invoice_number || "(none)"}`);
      console.log(`    invoice_date     : ${rb.invoice_date}`);
      console.log(`    approval_status  : ${rb.approval_status}`);
      console.log(`    payment_status   : ${rb.payment_status}`);
      console.log(`    paid_amount      : $${money(rb.paid_amount)}`);
      console.log(`    due_amount       : $${money(rb.due_amount)}`);
    }
    const lines = rawLines.get(r.source_bill_id) || [];
    const matchLine = lines.find((l) => l.line_id === r.source_line_id);
    if (matchLine) {
      console.log(`    line description : ${matchLine.description || "(none)"}`);
    }
  }

  // Beau Davis vendor_id check
  const beaus = partC.filter((r) => r.account_key === "TBR - FL" && money(r.amount) === "6600.00");
  const beauIds = new Set(beaus.map((r) => r.vendor_or_merchant));
  console.log(`\n=== BEAU DAVIS vendor_id check ===`);
  console.log(`  distinct vendor_ids across the 2 Beau Davis rows: ${beauIds.size}`);
  for (const id of beauIds) {
    const v = vendorMap.get(id);
    console.log(`    ${id}  name="${v?.name || "(unresolved)"}"  archived=${v?.archived}`);
  }

  // ---- Pattern concentration ----
  const perAcct = new Map();
  const perGl = new Map();
  const perVendor = new Map();
  for (const c of strongIsolated) {
    perAcct.set(c.a.account_key, (perAcct.get(c.a.account_key) || 0) + 1);
    perGl.set(c.a.gl_line_code, (perGl.get(c.a.gl_line_code) || 0) + 1);
    perVendor.set(c.a.vendor_or_merchant, (perVendor.get(c.a.vendor_or_merchant) || 0) + 1);
  }
  const sortDesc = (m) => [...m.entries()].sort((x, y) => y[1] - x[1]);
  console.log("\n=== CONCENTRATION (strong-isolated only) ===");
  console.log("  by account:");
  for (const [k, v] of sortDesc(perAcct).slice(0, 8)) console.log(`    ${k}: ${v}`);
  console.log("  by gl_line_code:");
  for (const [k, v] of sortDesc(perGl).slice(0, 8)) console.log(`    ${k}: ${v}`);
  console.log("  by vendor_id (top 8):");
  for (const [k, v] of sortDesc(perVendor).slice(0, 8)) {
    const name = vendorMap.get(k)?.name || "(unresolved)";
    console.log(`    ${k} [${name}]: ${v}`);
  }

  // Date-range concentration (by month)
  const perMonth = new Map();
  for (const c of strongIsolated) {
    const m = (c.a.txn_date || "").slice(0, 7);
    perMonth.set(m, (perMonth.get(m) || 0) + 1);
  }
  console.log("  by month:");
  for (const [k, v] of sortDesc(perMonth).slice(0, 12)) console.log(`    ${k}: ${v}`);

  // ---- Build workbook ----
  console.log(`\n=== writing workbook to ${OUT_PATH} ===`);
  const wb = new ExcelJS.Workbook();

  const columnDefs = [
    { header: "tier",              key: "tier",              width: 10 },
    { header: "days_apart",        key: "days",              width: 10 },
    { header: "account_key",       key: "account_key",       width: 14 },
    { header: "gl_line_code",      key: "gl_line_code",      width: 14 },
    { header: "amount",            key: "amount",            width: 12 },
    { header: "recurrence_max",    key: "recurrence_max",    width: 14 },
    // A side
    { header: "A_bill_id",         key: "a_bill_id",         width: 26 },
    { header: "A_line_id",         key: "a_line_id",         width: 26 },
    { header: "A_txn_date",        key: "a_txn_date",        width: 12 },
    { header: "A_posting_date",    key: "a_posting_date",    width: 12 },
    { header: "A_vendor_id",       key: "a_vendor_id",       width: 26 },
    { header: "A_vendor_name",     key: "a_vendor_name",     width: 30 },
    { header: "A_invoice_number",  key: "a_invoice_number",  width: 20 },
    { header: "A_payment_status",  key: "a_payment_status",  width: 16 },
    { header: "A_paid",            key: "a_paid",            width: 8 },
    { header: "A_paid_amount",     key: "a_paid_amount",     width: 12 },
    { header: "A_due_amount",      key: "a_due_amount",      width: 12 },
    { header: "A_description",     key: "a_description",     width: 40 },
    { header: "A_derived_at",      key: "a_derived_at",      width: 24 },
    // B side
    { header: "B_bill_id",         key: "b_bill_id",         width: 26 },
    { header: "B_line_id",         key: "b_line_id",         width: 26 },
    { header: "B_txn_date",        key: "b_txn_date",        width: 12 },
    { header: "B_posting_date",    key: "b_posting_date",    width: 12 },
    { header: "B_vendor_id",       key: "b_vendor_id",       width: 26 },
    { header: "B_vendor_name",     key: "b_vendor_name",     width: 30 },
    { header: "B_invoice_number",  key: "b_invoice_number",  width: 20 },
    { header: "B_payment_status",  key: "b_payment_status",  width: 16 },
    { header: "B_paid",            key: "b_paid",            width: 8 },
    { header: "B_paid_amount",     key: "b_paid_amount",     width: 12 },
    { header: "B_due_amount",      key: "b_due_amount",      width: 12 },
    { header: "B_description",     key: "b_description",     width: 40 },
    { header: "B_derived_at",      key: "b_derived_at",      width: 24 },
  ];

  function rowFor(c) {
    const rbA = rawBills.get(c.a.source_bill_id);
    const rbB = rawBills.get(c.b.source_bill_id);
    const linesA = rawLines.get(c.a.source_bill_id) || [];
    const linesB = rawLines.get(c.b.source_bill_id) || [];
    const lA = linesA.find((l) => l.line_id === c.a.source_line_id);
    const lB = linesB.find((l) => l.line_id === c.b.source_line_id);
    return {
      tier: c.tier,
      days: c.days,
      account_key: c.a.account_key,
      gl_line_code: c.a.gl_line_code || "",
      amount: Number(c.a.amount),
      recurrence_max: c.recurrenceMax,
      a_bill_id: c.a.source_bill_id || "",
      a_line_id: c.a.source_line_id || "",
      a_txn_date: c.a.txn_date || "",
      a_posting_date: c.a.posting_date || "",
      a_vendor_id: c.a.vendor_or_merchant || "",
      a_vendor_name: c.vendorNameA || "",
      a_invoice_number: rbA?.invoice_number || "",
      a_payment_status: rbA?.payment_status || "",
      a_paid: c.a.paid,
      a_paid_amount: rbA?.paid_amount == null ? "" : Number(rbA.paid_amount),
      a_due_amount: rbA?.due_amount == null ? "" : Number(rbA.due_amount),
      a_description: lA?.description || "",
      a_derived_at: c.a.derived_at || "",
      b_bill_id: c.b.source_bill_id || "",
      b_line_id: c.b.source_line_id || "",
      b_txn_date: c.b.txn_date || "",
      b_posting_date: c.b.posting_date || "",
      b_vendor_id: c.b.vendor_or_merchant || "",
      b_vendor_name: c.vendorNameB || "",
      b_invoice_number: rbB?.invoice_number || "",
      b_payment_status: rbB?.payment_status || "",
      b_paid: c.b.paid,
      b_paid_amount: rbB?.paid_amount == null ? "" : Number(rbB.paid_amount),
      b_due_amount: rbB?.due_amount == null ? "" : Number(rbB.due_amount),
      b_description: lB?.description || "",
      b_derived_at: c.b.derived_at || "",
    };
  }

  // Sheet 1: Strong = identical + prefix, recurrenceMax <= 2
  const sh1 = wb.addWorksheet("Strong");
  sh1.columns = columnDefs;
  const strong = suspiciousAll.filter(
    (c) => (c.tier === "identical" || c.tier === "prefix") && c.recurrenceMax <= 2
  );
  strong.sort((x, y) => (tierRank(y.tier) - tierRank(x.tier)) || (Number(y.a.amount) - Number(x.a.amount)));
  for (const c of strong) sh1.addRow(rowFor(c));

  // Sheet 2: Possible = similar, or (identical/prefix with recurrenceMax > 2)
  const sh2 = wb.addWorksheet("Possible");
  sh2.columns = columnDefs;
  const possible = suspiciousAll.filter(
    (c) => c.tier === "similar" || ((c.tier === "identical" || c.tier === "prefix") && c.recurrenceMax > 2)
  );
  possible.sort((x, y) => Number(y.a.amount) - Number(x.a.amount));
  for (const c of possible) sh2.addRow(rowFor(c));

  // Sheet 3: Control = unrelated names
  const sh3 = wb.addWorksheet("Control");
  sh3.columns = columnDefs;
  // Cap to keep workbook usable, sorted by amount desc
  const control = tierBuckets.unrelated.slice().sort((x, y) => Number(y.a.amount) - Number(x.a.amount));
  // Fetch raw for control top slice
  const controlBillIds = new Set();
  for (const c of control) {
    if (c.a.source_bill_id) controlBillIds.add(c.a.source_bill_id);
    if (c.b.source_bill_id) controlBillIds.add(c.b.source_bill_id);
  }
  // Merge in bills not yet fetched
  const missingControlBillIds = [...controlBillIds].filter((id) => !rawBills.has(id));
  if (missingControlBillIds.length) {
    console.log(`fetching ${missingControlBillIds.length} additional bills for Control sheet...`);
    const extraBills = await fetchRawBillsByIds(missingControlBillIds);
    for (const [k, v] of extraBills) rawBills.set(k, v);
    const extraLines = await fetchRawLinesByBillIds(missingControlBillIds);
    for (const [k, v] of extraLines) rawLines.set(k, v);
  }
  for (const c of control) sh3.addRow(rowFor(c));

  // Sheet 4: Read me
  const sh4 = wb.addWorksheet("Read me");
  sh4.columns = [{ header: "note", key: "note", width: 120 }];
  const strongDollars = strong.reduce((s, c) => s + Number(c.a.amount || 0), 0);
  const possibleDollars = possible.reduce((s, c) => s + Number(c.a.amount || 0), 0);
  const controlDollars = control.reduce((s, c) => s + Number(c.a.amount || 0), 0);
  const isolatedSuspiciousDollars = strongIsolated.reduce((s, c) => s + Number(c.a.amount || 0), 0);
  const notes = [
    `INV-P11 sweep: purchasing_actuals source='billcom' excluded=false, txn_date >= ${FYTD_START} through today, generated ${today}.`,
    `Pair rule: same account_key, same amount to the cent, txn_date within 7 days. Tiered on vendor-name similarity.`,
    `Sheet 1 Strong: identical or prefix names AND recurrenceMax <= 2. Count=${strong.length}. One-side sum=$${strongDollars.toFixed(2)}.`,
    `Sheet 2 Possible: similar names, or identical/prefix pairs whose (vendor_id, amount) appears >2 times FYTD. Count=${possible.length}. One-side sum=$${possibleDollars.toFixed(2)}.`,
    `Sheet 3 Control: unrelated names, same account, same amount, same week. False-positive baseline. Count=${control.length}. One-side sum=$${controlDollars.toFixed(2)}.`,
    `Strong-isolated dollars at risk after removing recurring: $${isolatedSuspiciousDollars.toFixed(2)}. Question: which of these are real duplicates? No exclusion applied - Kevin + Sebastian decide.`,
  ];
  for (const n of notes) sh4.addRow({ note: n });

  await wb.xlsx.writeFile(OUT_PATH);
  console.log(`workbook written: ${OUT_PATH}`);

  // ---- final summary echo ----
  console.log("\n=== FINAL SUMMARY ===");
  console.log(`FYTD billcom non-excluded rows scanned: ${actuals.length}`);
  console.log(`Vendors resolved: ${vendorMap.size}`);
  console.log(`Candidate pairs total: ${candidates.length}`);
  console.log(`  identical: ${tierBuckets.identical.length}   one-side $${dollars(tierBuckets.identical).toFixed(2)}`);
  console.log(`  prefix:    ${tierBuckets.prefix.length}      one-side $${dollars(tierBuckets.prefix).toFixed(2)}`);
  console.log(`  similar:   ${tierBuckets.similar.length}     one-side $${dollars(tierBuckets.similar).toFixed(2)}`);
  console.log(`  unrelated: ${tierBuckets.unrelated.length}   one-side $${dollars(tierBuckets.unrelated).toFixed(2)}`);
  console.log(`Suspicious (identical+prefix+similar) strong-isolated: ${strongIsolated.length}, one-side dollars $${isolatedSuspiciousDollars.toFixed(2)}`);
  console.log(`Workbook: ${OUT_PATH}`);
})().catch((err) => {
  console.error("FATAL:", err.stack || err.message || err);
  process.exit(1);
});
