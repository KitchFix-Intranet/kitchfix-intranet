// READ-ONLY static trace of the 34 dual-write gap invoices.
// No writes, no insert attempts.
//
// Tests two hypotheses against Sheets-side data, per-gap-invoice:
//   H1: line_num collisions within a single invoice's Sheets rows
//       (would 23505 the partial UNIQUE INDEX
//        ai_line_items_new_dedup_idx on (invoice_uuid, line_num)
//        WHERE is_historical = FALSE)
//   H2: per-line vendor_name mismatches against canonical vendors.name
//       (would throw the orchestrator's resolveVendorId throw at line 1036
//        of src/lib/dataStore/invoice.js)
//
// Also looks at H3: empty / NULL descriptions or zero line_nums that would
// fail NOT NULL constraints.

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const sheetsAuth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth: sheetsAuth });
const AI_LINE_ITEMS = "18mTWaeodOpFVmDSNRkGpNZvCrNWqHxVv3qN8r1b2REo";

// Sheets column order (LINE_ITEM_HEADERS in src/lib/dataStore/invoice.js):
//   0=Invoice UUID 1=Timestamp 2=Account 3=Vendor 4=Invoice # 5=Invoice Date
//   6=Line # 7=Item Description 8=Quantity 9=Unit 10=Unit Price
//   11=Extended Price 12=Category 13=Confidence 14=Raw JSON

async function listTabs() {
  const res = await sheets.spreadsheets.get({ spreadsheetId: AI_LINE_ITEMS, fields: "sheets.properties.title" });
  return (res.data.sheets || []).map((s) => s.properties.title);
}
async function readTab(name) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: AI_LINE_ITEMS, range: `'${name}'!A:O` });
  return res.data.values || [];
}

// 1) Find all 34 gap invoices = sub rows whose client_uuid is in Sheets but
//    have 0 rows in PG ai_line_items
const PAGE = 1000;
let subs = [];
for (let off = 0; ; off += PAGE) {
  const { data, error } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, account_key, vendor_name, invoice_number, submitted_at, ai_scan_status")
    .range(off, off + PAGE - 1);
  if (error) throw new Error(`invoice_submissions: ${error.message}`);
  if (!data || data.length === 0) break;
  subs = subs.concat(data);
  if (data.length < PAGE) break;
}
const subByClientUuid = new Map();
for (const s of subs) subByClientUuid.set(s.client_uuid, s);

const pgCountBySubId = new Map();
for (let off = 0; ; off += PAGE) {
  const { data, error } = await supa.from("ai_line_items").select("invoice_uuid").range(off, off + PAGE - 1);
  if (error) throw new Error(`ai_line_items: ${error.message}`);
  if (!data || data.length === 0) break;
  for (const r of data) pgCountBySubId.set(r.invoice_uuid, (pgCountBySubId.get(r.invoice_uuid) || 0) + 1);
  if (data.length < PAGE) break;
}

// 2) Pull vendors for resolution check
const { data: vendors } = await supa.from("vendors").select("id, name").is("deleted_at", null);
const { data: aliases } = await supa.from("vendor_aliases").select("vendor_id, alias_normalized");
const nameToVendorId = new Map();
for (const v of vendors || []) nameToVendorId.set((v.name || "").toLowerCase(), v.id);
const aliasNormToVendorId = new Map();
for (const a of aliases || []) aliasNormToVendorId.set((a.alias_normalized || "").toLowerCase(), a.vendor_id);
function normalizeAlias(s) { return String(s || "").toLowerCase().replace(/[^a-zA-Z0-9 ]/g, ""); }
function resolveVendorId(vn) {
  const lower = String(vn || "").trim().toLowerCase();
  if (!lower) return null;
  return nameToVendorId.get(lower) || aliasNormToVendorId.get(normalizeAlias(vn)) || null;
}

// 3) Read all 9 tabs once
const tabs = await listTabs();
const sheetsRowsByTab = new Map();
for (const t of tabs) sheetsRowsByTab.set(t, await readTab(t));

// 4) For each gap invoice with a PG submission, run the static trace
const gapInvoices = [];
for (const [uuid, sub] of subByClientUuid.entries()) {
  // is this invoice in Sheets?
  for (const [, rows] of sheetsRowsByTab.entries()) {
    const hit = rows.findIndex((r, i) => i > 0 && String(r[0] || "").trim() === uuid);
    if (hit > 0) {
      // gap if 0 PG rows
      const pgCount = pgCountBySubId.get(sub.id) || 0;
      if (pgCount === 0) gapInvoices.push({ uuid, sub });
      break;
    }
  }
}
console.log(`Gap invoices with PG submission row: ${gapInvoices.length}`);
console.log("");

// 5) Per-gap-invoice analysis
let h1Hits = 0; // line_num collisions
let h2Hits = 0; // per-line vendor mismatch (orchestrator-relevant)
let h3Hits = 0; // empty desc / line_num=0
const findings = [];

for (const g of gapInvoices) {
  // find the Sheets rows for this invoice
  let myTab = null;
  let myRows = null;
  for (const [tab, rows] of sheetsRowsByTab.entries()) {
    const filtered = rows.filter((r, i) => i > 0 && String(r[0] || "").trim() === g.uuid);
    if (filtered.length > 0) { myTab = tab; myRows = filtered; break; }
  }
  if (!myRows) continue;

  // H1: line_num collisions
  const lineNums = new Map();
  for (const r of myRows) {
    const ln = parseInt(r[6], 10);
    lineNums.set(ln, (lineNums.get(ln) || 0) + 1);
  }
  const dupLineNums = [...lineNums.entries()].filter(([, c]) => c > 1);

  // H2: per-line vendor resolution. orchestrator uses item.vendorName OR sub.vendor_name.
  // OCR-driven `item.vendorName` lives in col 3 of the Sheets row.
  // If col 3 differs from sub.vendor_name AND doesn't resolve, that's the throw.
  const vendorMismatches = new Map();
  let unresolvedPerLine = 0;
  for (const r of myRows) {
    const liVendor = String(r[3] || "").trim();
    const effectiveVendor = liVendor || g.sub.vendor_name;
    const vid = resolveVendorId(effectiveVendor);
    if (!vid) {
      unresolvedPerLine++;
      vendorMismatches.set(effectiveVendor, (vendorMismatches.get(effectiveVendor) || 0) + 1);
    }
  }

  // H3: empty desc / NULL line_num
  let emptyDesc = 0, zeroLine = 0;
  for (const r of myRows) {
    if (!String(r[7] || "").trim()) emptyDesc++;
    if (parseInt(r[6], 10) === 0 || isNaN(parseInt(r[6], 10))) zeroLine++;
  }

  const finding = {
    uuid: g.uuid,
    tab: myTab,
    sub_vendor: g.sub.vendor_name,
    sub_status: g.sub.ai_scan_status,
    rows: myRows.length,
    h1_dup_line_nums: dupLineNums,
    h2_unresolved_per_line: unresolvedPerLine,
    h2_unresolved_strings: [...vendorMismatches.entries()],
    h3_empty_desc: emptyDesc,
    h3_zero_line: zeroLine,
  };
  findings.push(finding);
  if (dupLineNums.length > 0) h1Hits++;
  if (unresolvedPerLine > 0) h2Hits++;
  if (emptyDesc > 0 || zeroLine > 0) h3Hits++;
}

// 6) Summary
console.log("════════════════════════════════════════════════════════════════════");
console.log("  Hypothesis summary");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`  H1 - line_num collisions (would 23505 on unique idx):  ${h1Hits} / ${findings.length} invoices`);
console.log(`  H2 - per-line vendor unresolvable:                     ${h2Hits} / ${findings.length} invoices`);
console.log(`  H3 - empty desc or zero line_num:                      ${h3Hits} / ${findings.length} invoices`);
console.log("");

console.log("════════════════════════════════════════════════════════════════════");
console.log("  Per-invoice detail");
console.log("════════════════════════════════════════════════════════════════════");
for (const f of findings) {
  console.log("");
  console.log(`  ${f.uuid.slice(0, 8)}  tab=${f.tab.padEnd(14)}  sub_vendor="${f.sub_vendor}"  status=${f.sub_status}  rows=${f.rows}`);
  if (f.h1_dup_line_nums.length > 0) {
    console.log(`    H1: DUP line_nums: ${f.h1_dup_line_nums.map(([n, c]) => `${n}x${c}`).join(", ")}`);
  }
  if (f.h2_unresolved_per_line > 0) {
    console.log(`    H2: ${f.h2_unresolved_per_line}/${f.rows} unresolved per-line vendor strings:`);
    for (const [vn, c] of f.h2_unresolved_strings) {
      console.log(`        "${vn}" x ${c}`);
    }
  }
  if (f.h3_empty_desc > 0) console.log(`    H3: ${f.h3_empty_desc} rows with empty description`);
  if (f.h3_zero_line > 0)  console.log(`    H3: ${f.h3_zero_line} rows with zero/NaN line_num`);
}
