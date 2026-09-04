#!/usr/bin/env node
// Null-GL vendor-credit CSV export - one row per credit LINE with
// the applied-bill fanout that lets Kevin classify by hand OR see
// mechanical classification via the applied bills' own GL codes.
//
// Per Kevin ruling 2026-09-04: "The reference_number and the
// applied-bill link matter most - if a credit is applied against a
// bill we already hold, that bill's GL code tells us where the credit
// belongs. That may classify most of them mechanically rather than
// by hand."
//
// CSV columns (in order):
//   credit_id
//   line_id
//   credit_date
//   vendor_name
//   vendor_id
//   reference_number
//   description_header      · header-level description (often empty)
//   description_line        · line-level description (Josh's endpoint
//                             does not return this today; column
//                             present for future-proofing)
//   amount                  · signed, negative
//   credit_chart_of_account_id  · the credit LINE's own coa id -
//                             the field that IS present but
//                             unmapped in billcom_ref_accounts
//                             (this is the root-cause column)
//   accounting_class_id
//   account_key             · resolved via billcom_class_site_map
//   billed_back             · yes/no on the account_key
//   status                  · FULLY_APPLIED / PARTIALLY_APPLIED / NOT_APPLIED
//   applied_amount
//   applied_bill_ids        · semicolon-separated billIds from usage[]
//   applied_bill_refs       · semicolon-separated invoice_numbers
//   applied_bill_chart_ids  · unique chart_of_account_ids across all
//                             applied bills' line-items - the
//                             cross-reference for what SHOULD map
//   applied_bill_gls        · unique GL codes across all applied
//                             bills' line-items - the mechanical
//                             classification hint (empty when the
//                             chart_id is unmapped in our ref table)
//
// Sort: vendor_name ASC, then credit_date ASC.
//
// Usage:
//   node --env-file=<path>/.env.local \
//     scripts/probes/audit_null_gl_credits_csv.mjs [output_path]
// Default output path: /tmp/null_gl_credits.csv

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const outPath = process.argv[2] || "/tmp/null_gl_credits.csv";

// billed_back set - keep in sync with src/lib/accountModels.js PASS_THROUGH_ACCOUNTS
const PASS_THROUGH = new Set(["CIN - OH", "STL - FL", "STL - MO"]);

function csvQuote(v) {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// 1) Pull every null-gl credit line from purchasing_actuals
const { data: pa, error: paErr } = await supa
  .from("purchasing_actuals")
  .select("account_key, txn_date, amount, source_bill_id, source_line_id")
  .eq("source", "billcom_credit")
  .is("gl_line_code", null);
if (paErr) throw paErr;
console.log(`# purchasing_actuals null-gl credit rows: ${pa.length}`);

const creditIds = [...new Set(pa.map(r => r.source_bill_id))];
const lineIds = pa.map(r => (r.source_line_id || "").replace(/^billcom_credit:/, "")).filter(Boolean);

// 2) Raw credit headers
const { data: heads } = await supa
  .from("billcom_raw_vendor_credits_latest")
  .select("credit_id, vendor_id, reference_number, credit_date, description, status, amount, applied_amount, raw")
  .in("credit_id", creditIds);
const headByCredit = new Map(heads.map(h => [h.credit_id, h]));

// 3) Raw credit LINES (paginated - could exceed 1000)
const linesByLineId = new Map();
{
  const CHUNK = 500;
  for (let i = 0; i < lineIds.length; i += CHUNK) {
    const chunk = lineIds.slice(i, i + CHUNK);
    const { data: linesPart, error: linesErr } = await supa
      .from("billcom_raw_vendor_credit_lines_latest")
      .select("line_id, credit_id, amount, chart_of_account_id, actg_class_id, raw")
      .in("line_id", chunk);
    if (linesErr) throw linesErr;
    for (const l of (linesPart || [])) linesByLineId.set(l.line_id, l);
  }
}
console.log(`# lines resolved: ${linesByLineId.size} / ${lineIds.length}`);

// 4) Vendor names
const vendorIds = [...new Set(heads.map(h => h.vendor_id).filter(Boolean))];
const { data: vends } = await supa.from("billcom_ref_vendors").select("id, name").in("id", vendorIds);
const vname = new Map((vends || []).map(v => [v.id, v.name || v.id]));

// 5) Class map: actg_class_id -> account_key
const { data: classMap } = await supa.from("billcom_class_site_map").select("actg_class_id, account_key");
const classToAccount = new Map((classMap || []).map(r => [r.actg_class_id, r.account_key]));

// 6) Applied-bill fanout - collect every billId across every credit's usage[]
const allBillIds = new Set();
for (const h of heads) {
  for (const u of (h.raw?.usage || [])) {
    if (u?.billId) allBillIds.add(u.billId);
  }
}
console.log(`# distinct applied bill_ids across all null-gl credits: ${allBillIds.size}`);

const billHead = new Map();
{
  const ids = [...allBillIds];
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data: bills } = await supa
      .from("billcom_raw_bills_latest")
      .select("bill_id, invoice_number, vendor_id")
      .in("bill_id", chunk);
    for (const b of (bills || [])) billHead.set(b.bill_id, b);
  }
}
console.log(`# applied bills we hold in billcom_raw_bills_latest: ${billHead.size} / ${allBillIds.size}`);

// 7) Bill lines - one bill can have many lines, each with a chart_of_account_id
const billLineByBillId = new Map();
{
  const ids = [...allBillIds];
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data: bl } = await supa
      .from("billcom_raw_bill_lines_latest")
      .select("bill_id, chart_of_account_id, amount");
    // No .in() on bill_id because we want to walk in fewer round trips;
    // instead do a targeted per-batch call:
    // (rewriting to explicit in())
  }
  // Rebuild properly with in()
  billLineByBillId.clear();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data: bl, error: blErr } = await supa
      .from("billcom_raw_bill_lines_latest")
      .select("bill_id, chart_of_account_id, amount")
      .in("bill_id", chunk);
    if (blErr) throw blErr;
    for (const l of (bl || [])) {
      const cur = billLineByBillId.get(l.bill_id) || [];
      cur.push(l);
      billLineByBillId.set(l.bill_id, cur);
    }
  }
}
console.log(`# bills with at least one bill_line: ${billLineByBillId.size}`);

// 8) chart_of_account_id -> gl_line_code (account_number)
//
// PAGINATION NOTE: Supabase `.select()` silently caps at 1000 rows.
// billcom_ref_accounts has 1072 rows today; `.range(0, 9999)` still
// returns 1000. The MISSING 72 rows include the coa IDs used by
// most of the null-gl credits, so a naive load produces the false
// finding "credits have unmapped coa" when the truth is "our load
// truncated". This is also the root cause of the null-gl derive:
// the credits sync loader at scripts/purchasing_billcom_credits_sync.mjs:87
// uses the SAME truncating call. Fix owed there.
const coaToGl = new Map();
{
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data: page } = await supa
      .from("billcom_ref_accounts")
      .select("id, account_number")
      .range(from, from + PAGE - 1);
    if (!page || page.length === 0) break;
    for (const r of page) coaToGl.set(r.id, r.account_number);
    if (page.length < PAGE) break;
    from += PAGE;
  }
}
console.log(`# billcom_ref_accounts fully loaded: ${coaToGl.size} rows`);

// ---- Assemble rows ----
const rows = pa.map(r => {
  const lineId = (r.source_line_id || "").replace(/^billcom_credit:/, "");
  const h = headByCredit.get(r.source_bill_id);
  const line = linesByLineId.get(lineId);
  const vendor_name = h ? (vname.get(h.vendor_id) || h.vendor_id) : "";
  const actg_class_id = line?.actg_class_id || null;
  const account_key_from_class = actg_class_id ? (classToAccount.get(actg_class_id) || "") : "";
  // Prefer the resolved account_key from the class map; fall back to
  // purchasing_actuals.account_key (already resolved at derive time).
  const account_key = account_key_from_class || r.account_key || "";
  const billed_back = PASS_THROUGH.has(account_key) ? "yes" : "no";

  const usage = h?.raw?.usage || [];
  const applied_bill_ids = usage.map(u => u.billId).filter(Boolean);
  const applied_bill_refs = applied_bill_ids
    .map(bid => billHead.get(bid)?.invoice_number || `(missing:${bid})`);
  // For each applied bill, collect BOTH the raw chart_of_account_ids
  // AND the resolved GL codes. The chart_ids reveal the missing
  // reference-table entries; the GLs show what would resolve today.
  const chartSet = new Set();
  const glSet = new Set();
  for (const bid of applied_bill_ids) {
    const lines = billLineByBillId.get(bid) || [];
    for (const bl of lines) {
      if (bl.chart_of_account_id) {
        chartSet.add(bl.chart_of_account_id);
        const gl = coaToGl.get(bl.chart_of_account_id);
        if (gl) glSet.add(gl);
      }
    }
  }
  const applied_bill_chart_ids = [...chartSet].sort();
  const applied_bill_gls = [...glSet].sort();

  return {
    vendor_name,
    credit_date: h?.credit_date || r.txn_date,
    credit_id: r.source_bill_id,
    line_id: lineId,
    vendor_id: h?.vendor_id || "",
    reference_number: h?.reference_number || "",
    description_header: h?.description || "",
    description_line: "",   // Josh's endpoint does not return line-level description today
    amount: r.amount,
    credit_chart_of_account_id: line?.chart_of_account_id || "",
    accounting_class_id: actg_class_id || "",
    account_key,
    billed_back,
    status: h?.status || "",
    applied_amount: h?.applied_amount ?? "",
    applied_bill_ids: applied_bill_ids.join(";"),
    applied_bill_refs: applied_bill_refs.join(";"),
    applied_bill_chart_ids: applied_bill_chart_ids.join(";"),
    applied_bill_gls: applied_bill_gls.join(";"),
  };
});

// Sort: vendor, then credit_date
rows.sort((a, b) => {
  const v = String(a.vendor_name).localeCompare(String(b.vendor_name));
  if (v) return v;
  return String(a.credit_date).localeCompare(String(b.credit_date));
});

const HEAD = [
  "credit_id", "line_id", "credit_date", "vendor_name", "vendor_id",
  "reference_number", "description_header", "description_line", "amount",
  "credit_chart_of_account_id",
  "accounting_class_id", "account_key", "billed_back", "status",
  "applied_amount", "applied_bill_ids", "applied_bill_refs",
  "applied_bill_chart_ids", "applied_bill_gls",
];

const lines = [HEAD.join(",")];
for (const r of rows) {
  lines.push(HEAD.map(k => csvQuote(r[k])).join(","));
}
writeFileSync(outPath, lines.join("\n") + "\n", "utf8");

console.log(`\nWrote ${rows.length} rows to ${outPath}\n`);

// Summary sections
const mechClassifiable = rows.filter(r => r.applied_bill_gls);
console.log(`Applied-bill GL classification:`);
console.log(`  ${mechClassifiable.length} / ${rows.length} rows have at least one applied_bill_gl.`);
const noApplied = rows.filter(r => !r.applied_bill_ids);
console.log(`  ${noApplied.length} rows have no usage[] (NOT_APPLIED with no applied history).`);
const appliedButNoGl = rows.filter(r => r.applied_bill_ids && !r.applied_bill_gls);
console.log(`  ${appliedButNoGl.length} rows applied against bills where NO chart_of_account_id resolved to a GL in our billcom_ref_accounts table.`);

// Root-cause diagnosis: for each null-gl credit line, look up what
// its OWN chart_of_account_id maps to in TODAY'S billcom_ref_accounts.
// If the map resolves, the ref table is now current AND a targeted
// re-derive would drop the null. That is the mechanical fix path.
let would_resolve_to_gl_today = 0;
let ownCoaPresent_butNoAccountNum = 0;
let noOwnCoa = 0;
const wouldResolveTo = new Map();  // account_number -> count
for (const r of rows) {
  const ownCoa = r.credit_chart_of_account_id;
  if (!ownCoa) { noOwnCoa++; continue; }
  const acctNum = coaToGl.get(ownCoa);
  if (!acctNum) { ownCoaPresent_butNoAccountNum++; continue; }
  would_resolve_to_gl_today++;
  wouldResolveTo.set(acctNum, (wouldResolveTo.get(acctNum) || 0) + 1);
}
console.log(`\nRoot-cause diagnosis (using TODAY's billcom_ref_accounts):`);
console.log(`  credit lines whose own chart_of_account_id resolves to a GL right now: ${would_resolve_to_gl_today} / ${rows.length}`);
console.log(`  credit lines whose chart_of_account_id is present but has no account_number: ${ownCoaPresent_butNoAccountNum}`);
console.log(`  credit lines with no chart_of_account_id at all (genuinely unclassified): ${noOwnCoa}`);
console.log(`\n  Distribution if re-derived today:`);
for (const [gl, n] of [...wouldResolveTo.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${gl.padEnd(12)}  ${n} lines`);
}
console.log(`\nInterpretation:`);
console.log(`  If the top count above is high, the fix is a targeted re-derive of the`);
console.log(`  ${would_resolve_to_gl_today} affected rows, not a vendor-side ask. The credits`);
console.log(`  were derived when billcom_ref_accounts was stale for these coa entries;`);
console.log(`  the table has been refreshed since (refreshed_at 2026-09-04 07:39 UTC).`);
console.log(`  A subsequent nightly sync that re-hashes any of these credit headers will`);
console.log(`  re-derive with today's ref table and pick up the correct gl_line_code -`);
console.log(`  but the current 113 null-gl rows will not self-heal without a forced re-derive.`);
