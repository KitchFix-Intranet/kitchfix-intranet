// ════════════════════════════════════════════════════════════════════════════
// PROBE: Inventory/Invoice pipeline audit (read-only).
//
// Tables in scope: review_queue, ai_line_items, price_history, item_catalog
// (inventory_items in PG), item_aliases, invoice_submissions, vendor_master
// (vendors in PG), vendor_accounts, vendor_aliases. Plus a single cheap
// sanity query on gl_codes.
//
// READ-ONLY. NO writes, NO deletes. The output is a structured findings
// dump for the audit deliverable.
// ════════════════════════════════════════════════════════════════════════════

import { safeRead, SHEET_IDS } from "../src/lib/sheets.js";
import { createClient } from "@supabase/supabase-js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function pgCount(table) {
  const { count } = await supa.from(table).select("*", { count: "exact", head: true });
  return count || 0;
}
async function pgAll(table, cols) {
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await supa.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}
function pad(s, n) { return String(s).padEnd(n); }
function section(title) { console.log("\n" + "=".repeat(100) + "\n" + title + "\n" + "=".repeat(100)); }

// ─────────────────────────────────────────────────────────────────────────────
section("PART 1: COUNTS BY TABLE (Sheets vs PG)");
// ─────────────────────────────────────────────────────────────────────────────

// Sheets reads
const [
  { rows: sheets_invoice_submissions },
  { rows: sheets_review_queue },
  { rows: sheets_item_catalog },
  { rows: sheets_item_aliases },
  { rows: sheets_price_history },
  { rows: sheets_vendor_master },
  { rows: sheets_vendor_accounts },
  // ai_line_items is per-account; we read tabs separately below
] = await Promise.all([
  safeRead(SHEET_IDS.COLLECTION,  "invoice_submissions_26"),
  safeRead(SHEET_IDS.INVENTORY,   "review_queue"),
  safeRead(SHEET_IDS.INVENTORY,   "item_catalog"),
  safeRead(SHEET_IDS.INVENTORY,   "item_aliases"),
  safeRead(SHEET_IDS.INVENTORY,   "price_history"),
  safeRead(SHEET_IDS.HUB,         "vendor_master"),
  safeRead(SHEET_IDS.HUB,         "vendor_accounts"),
]);

// ai_line_items per-account
const accountTabs = ["TBR - FL", "TBJ - FL", "STL - MO", "STL - FL", "TXR - TX - H", "TXR - TX - V", "TXR - AZ", "CIN - AZ", "CIN - OH"];
const ali_perAccount = {};
let ali_sheetsTotal = 0;
for (const tab of accountTabs) {
  const { rows } = await safeRead(SHEET_IDS.AI_LINE_ITEMS, tab);
  ali_perAccount[tab] = rows;
  ali_sheetsTotal += rows.length;
}

// PG counts
const pg = {};
for (const t of ["review_queue", "ai_line_items", "price_history", "inventory_items", "item_aliases", "invoice_submissions", "vendors", "vendor_accounts", "vendor_aliases", "gl_codes"]) {
  pg[t] = await pgCount(t);
}

console.log(`${pad("table", 26)} ${pad("Sheets", 10)} ${pad("PG", 10)} drift`);
console.log("-".repeat(60));
console.log(`${pad("invoice_submissions", 26)} ${pad(sheets_invoice_submissions.length, 10)} ${pad(pg.invoice_submissions, 10)} ${sheets_invoice_submissions.length - pg.invoice_submissions}`);
console.log(`${pad("review_queue", 26)} ${pad(sheets_review_queue.length, 10)} ${pad(pg.review_queue, 10)} ${sheets_review_queue.length - pg.review_queue}`);
console.log(`${pad("ai_line_items (sum tabs)", 26)} ${pad(ali_sheetsTotal, 10)} ${pad(pg.ai_line_items, 10)} ${ali_sheetsTotal - pg.ai_line_items}`);
console.log(`${pad("item_catalog/inventory_items", 26)} ${pad(sheets_item_catalog.length, 10)} ${pad(pg.inventory_items, 10)} ${sheets_item_catalog.length - pg.inventory_items}`);
console.log(`${pad("item_aliases", 26)} ${pad(sheets_item_aliases.length, 10)} ${pad(pg.item_aliases, 10)} ${sheets_item_aliases.length - pg.item_aliases}`);
console.log(`${pad("price_history", 26)} ${pad(sheets_price_history.length, 10)} ${pad(pg.price_history, 10)} ${sheets_price_history.length - pg.price_history}`);
console.log(`${pad("vendor_master/vendors", 26)} ${pad(sheets_vendor_master.length, 10)} ${pad(pg.vendors, 10)} ${sheets_vendor_master.length - pg.vendors}`);
console.log(`${pad("vendor_accounts", 26)} ${pad(sheets_vendor_accounts.length, 10)} ${pad(pg.vendor_accounts, 10)} ${sheets_vendor_accounts.length - pg.vendor_accounts}`);
console.log(`${pad("vendor_aliases (PG-only)", 26)} ${pad("-", 10)} ${pad(pg.vendor_aliases, 10)}  -`);
console.log(`${pad("gl_codes", 26)} ${pad("(per-acct fan-out)", 10)} ${pad(pg.gl_codes, 10)}  structural`);

// ─────────────────────────────────────────────────────────────────────────────
section("PART 2: ORPHAN / FK INTEGRITY CHECKS");
// ─────────────────────────────────────────────────────────────────────────────

// 2a. PG.ai_line_items.invoice_uuid -> PG.invoice_submissions.id  (orphan = invoice_uuid not in submissions)
console.log("\n2a. PG.ai_line_items.invoice_uuid orphans (no parent in invoice_submissions)");
const aliInvoiceUuids = await pgAll("ai_line_items", "invoice_uuid");
const aliInvoiceUuidSet = new Set(aliInvoiceUuids.map((r) => r.invoice_uuid).filter(Boolean));
const subIds = await pgAll("invoice_submissions", "id");
const subIdSet = new Set(subIds.map((r) => r.id));
const aliOrphans = [...aliInvoiceUuidSet].filter((u) => !subIdSet.has(u));
console.log(`   ai_line_items distinct invoice_uuid:        ${aliInvoiceUuidSet.size}`);
console.log(`   not in invoice_submissions (orphans):       ${aliOrphans.length}`);

// 2b. PG.price_history.invoice_id orphans
console.log("\n2b. PG.price_history.invoice_id orphans");
const phRows = await pgAll("price_history", "invoice_id");
const phInvIds = [...new Set(phRows.map((r) => r.invoice_id).filter(Boolean))];
const phOrphans = phInvIds.filter((id) => !subIdSet.has(id));
console.log(`   price_history distinct invoice_id:          ${phInvIds.length}`);
console.log(`   not in invoice_submissions (orphans):       ${phOrphans.length}`);

// 2c. PG.review_queue.invoice_id orphans
console.log("\n2c. PG.review_queue.invoice_id orphans");
const rqRows = await pgAll("review_queue", "invoice_id");
const rqInvIds = [...new Set(rqRows.map((r) => r.invoice_id).filter(Boolean))];
const rqOrphans = rqInvIds.filter((id) => !subIdSet.has(id));
console.log(`   review_queue distinct invoice_id:           ${rqInvIds.length}`);
console.log(`   not in invoice_submissions (orphans):       ${rqOrphans.length}`);

// 2d. PG.item_aliases -> PG.inventory_items
console.log("\n2d. PG.item_aliases.item_id orphans");
const aliasRows = await pgAll("item_aliases", "item_id");
const aliasItemIds = [...new Set(aliasRows.map((r) => r.item_id).filter(Boolean))];
const invItemRows = await pgAll("inventory_items", "id");
const invItemIdSet = new Set(invItemRows.map((r) => r.id));
const aliasOrphans = aliasItemIds.filter((id) => !invItemIdSet.has(id));
console.log(`   item_aliases distinct item_id:              ${aliasItemIds.length}`);
console.log(`   not in inventory_items (orphans):           ${aliasOrphans.length}`);

// 2e. Sheets-side parallel check: ai_line_items.invoiceUuid -> invoice_submissions.uuid
console.log("\n2e. Sheets-side: ai_line_items.invoiceUuid -> invoice_submissions.uuid");
const sheetsSubUuids = new Set(sheets_invoice_submissions.map((r) => String(r[0] || "").trim()).filter(Boolean));
const sheetsAliInvUuids = new Set();
for (const rows of Object.values(ali_perAccount)) {
  for (const r of rows) {
    const u = String(r[0] || "").trim();
    if (u) sheetsAliInvUuids.add(u);
  }
}
const sheetsAliOrphans = [...sheetsAliInvUuids].filter((u) => !sheetsSubUuids.has(u));
console.log(`   Sheets ai_line_items distinct invoiceUuid:  ${sheetsAliInvUuids.size}`);
console.log(`   not in Sheets invoice_submissions:          ${sheetsAliOrphans.length}`);

// ─────────────────────────────────────────────────────────────────────────────
section("PART 3: DUPLICATE / NULL-KEY ROWS");
// ─────────────────────────────────────────────────────────────────────────────

// 3a. review_queue duplicates (already confirmed; restate)
console.log("\n3a. review_queue duplicates");
{
  const sgroups = new Map();
  for (const r of sheets_review_queue) {
    const k = (r[3]||"") + "::" + (r[1]||"");
    sgroups.set(k, (sgroups.get(k)||0)+1);
  }
  const sdups = [...sgroups.values()].filter((n) => n > 1);
  console.log(`   Sheets: ${sheets_review_queue.length} total, ${sgroups.size} distinct, ${sdups.length} dup groups, ${sdups.reduce((s,n)=>s+n-1,0)} excess`);
  const pgRows = await pgAll("review_queue", "invoice_id, line_item_text");
  const pgroups = new Map();
  for (const r of pgRows) {
    const k = (r.invoice_id||"") + "::" + (r.line_item_text||"");
    pgroups.set(k, (pgroups.get(k)||0)+1);
  }
  const pdups = [...pgroups.values()].filter((n) => n > 1);
  console.log(`   PG:     ${pgRows.length} total, ${pgroups.size} distinct, ${pdups.length} dup groups, ${pdups.reduce((s,n)=>s+n-1,0)} excess`);
}

// 3b. ai_line_items duplicates (by invoice_uuid + line_num)
console.log("\n3b. ai_line_items duplicates (PG; key = invoice_uuid + line_num)");
{
  const rows = await pgAll("ai_line_items", "invoice_uuid, line_num");
  const groups = new Map();
  for (const r of rows) {
    const k = (r.invoice_uuid||"") + "::" + (r.line_num??"");
    groups.set(k, (groups.get(k)||0)+1);
  }
  const dups = [...groups.values()].filter((n) => n > 1);
  console.log(`   total ${rows.length}, distinct keys ${groups.size}, dup groups ${dups.length}, excess ${dups.reduce((s,n)=>s+n-1,0)}`);
}

// 3c. price_history duplicates (by item_id + invoice_id; should be 1 per invoice line)
console.log("\n3c. price_history duplicates (PG; key = item_id + invoice_id)");
{
  const rows = await pgAll("price_history", "item_id, invoice_id");
  const groups = new Map();
  for (const r of rows) {
    if (!r.item_id || !r.invoice_id) continue;
    const k = r.item_id + "::" + r.invoice_id;
    groups.set(k, (groups.get(k)||0)+1);
  }
  const dups = [...groups.values()].filter((n) => n > 1);
  console.log(`   total non-null ${[...groups.keys()].length}, dup groups ${dups.length}, excess ${dups.reduce((s,n)=>s+n-1,0)}`);
}

// 3d. inventory_items duplicates (by name + account; should be unique)
console.log("\n3d. inventory_items duplicates (PG; key = name normalized + account)");
{
  const rows = await pgAll("inventory_items", "id, name, account, status");
  const norm = (s) => String(s||"").toLowerCase().replace(/[^a-z0-9]/g, "");
  const groups = new Map();
  for (const r of rows) {
    if (r.status === "excluded") continue;
    const k = norm(r.name) + "::" + (r.account||"");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const dups = [...groups.values()].filter((g) => g.length > 1);
  console.log(`   active inventory_items: ${rows.filter(r => r.status !== "excluded").length}`);
  console.log(`   dup groups (same normalized name + account): ${dups.length}, excess: ${dups.reduce((s,g)=>s+g.length-1,0)}`);
}

// 3e. invoice_submissions duplicates (by account_key + vendor_id + invoice_number + type)
console.log("\n3e. invoice_submissions duplicates (PG; key = account_key+vendor_id+invoice_number+type)");
{
  const rows = await pgAll("invoice_submissions", "id, account_key, vendor_id, invoice_number, type, status, is_historical");
  const groups = new Map();
  for (const r of rows) {
    if (!r.account_key || !r.vendor_id || !r.invoice_number) continue;
    const k = `${r.account_key}::${r.vendor_id}::${r.invoice_number}::${r.type||"invoice"}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const dups = [...groups.values()].filter((g) => g.length > 1);
  console.log(`   distinct (account, vendor, invoice#, type) keys: ${groups.size}`);
  console.log(`   dup groups: ${dups.length}, excess rows: ${dups.reduce((s,g)=>s+g.length-1,0)}`);
}

// 3f. null/empty keys
console.log("\n3f. NULL or empty key audits");
{
  const aliRows = await pgAll("ai_line_items", "id, invoice_uuid, account_key, description");
  const nullUuid = aliRows.filter((r) => !r.invoice_uuid).length;
  const nullAccount = aliRows.filter((r) => !r.account_key).length;
  console.log(`   ai_line_items null invoice_uuid: ${nullUuid}`);
  console.log(`   ai_line_items null account_key:  ${nullAccount}`);

  const subAll = await pgAll("invoice_submissions", "id, account_key, vendor_id, invoice_number");
  console.log(`   invoice_submissions null account_key: ${subAll.filter(r=>!r.account_key).length}`);
  console.log(`   invoice_submissions null vendor_id:   ${subAll.filter(r=>!r.vendor_id).length}`);
  console.log(`   invoice_submissions null invoice_number: ${subAll.filter(r=>!r.invoice_number).length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
section("PART 4: VENDOR RESOLUTION CONSISTENCY");
// ─────────────────────────────────────────────────────────────────────────────

// Compare Sheets vendor_master vs PG vendors. Are vendor IDs the same?
console.log("\n4a. vendor_master vs PG vendors - ID consistency");
{
  // Sheets vendor_master col 0 = vendor_id, col 1 = vendor_name (based on convention)
  const sheetsVendors = new Map();
  for (const r of sheets_vendor_master) {
    const vid = String(r[0] || "").trim();
    const vname = String(r[1] || "").trim();
    if (vid) sheetsVendors.set(vid, vname);
  }
  const pgVendors = await pgAll("vendors", "id, name, client_uuid");
  const pgVendorMap = new Map();
  for (const v of pgVendors) {
    if (v.client_uuid) pgVendorMap.set(v.client_uuid, { id: v.id, name: v.name });
  }
  console.log(`   Sheets vendor_master rows: ${sheetsVendors.size}`);
  console.log(`   PG vendors rows: ${pgVendors.length} (with client_uuid: ${pgVendorMap.size})`);
  const inBoth = [...sheetsVendors.keys()].filter((vid) => pgVendorMap.has(vid));
  const sheetsOnly = [...sheetsVendors.keys()].filter((vid) => !pgVendorMap.has(vid));
  const pgOnly = [...pgVendorMap.keys()].filter((vid) => !sheetsVendors.has(vid));
  console.log(`   token in both stores: ${inBoth.length}`);
  console.log(`   token in Sheets only: ${sheetsOnly.length}`);
  console.log(`   token in PG only:     ${pgOnly.length}`);
  // Name mismatches
  let nameMismatches = 0;
  for (const vid of inBoth) {
    const sname = sheetsVendors.get(vid).toLowerCase().replace(/\s+/g," ").trim();
    const pname = pgVendorMap.get(vid).name.toLowerCase().replace(/\s+/g," ").trim();
    if (sname !== pname) nameMismatches++;
  }
  console.log(`   name mismatches (case/whitespace tolerant): ${nameMismatches}`);
}

// 4b. ai_line_items.vendor_id resolution: any line item with a vendor_id NOT in vendors?
console.log("\n4b. ai_line_items.vendor_id orphans (PG)");
{
  const rows = await pgAll("ai_line_items", "vendor_id");
  const vids = new Set(rows.map((r) => r.vendor_id).filter(Boolean));
  const pgV = await pgAll("vendors", "id");
  const vIdSet = new Set(pgV.map((r) => r.id));
  const orphans = [...vids].filter((vid) => !vIdSet.has(vid));
  console.log(`   distinct ai_line_items.vendor_id: ${vids.size}`);
  console.log(`   not in vendors: ${orphans.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
section("PART 5: GL_CODES SANITY (one cheap query)");
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n5a. PG gl_codes structure");
{
  const sample = await supa.from("gl_codes").select("*").limit(2);
  if (sample.data && sample.data[0]) console.log(`   sample row keys: ${Object.keys(sample.data[0]).join(", ")}`);
  const { count } = await supa.from("gl_codes").select("*", { count: "exact", head: true });
  console.log(`   PG count: ${count}`);
}
console.log("   (Structural difference vs Sheets is intentional per spec - PG is one-row-per-code, Sheets fans-out per-account)");

// ─────────────────────────────────────────────────────────────────────────────
section("PART 6: ASSUMPTIONS UNDER TEST");
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n6a. Assumption: cron's column-index reads for ai_line_items match writer schema");
{
  // Spot check: read one row from each per-account tab + dump first 24 cells
  // Cron reads cols 0-12 + (PR 3) 15-22. Sheets writer puts: ...,catchWeightMarker(22),rawColumns(23).
  for (const tab of accountTabs.slice(0, 1)) {
    const rows = ali_perAccount[tab];
    if (!rows.length) continue;
    const r = rows[rows.length - 1]; // most recent
    console.log(`   ${tab} last row col-by-col (first 24 cells):`);
    for (let i = 0; i < 24; i++) {
      const v = r[i] === undefined ? "" : String(r[i]).slice(0, 30);
      console.log(`     col[${String(i).padStart(2)}]: "${v}"`);
    }
  }
}

console.log("\n6b. Assumption: invoiceUuid is the dedup key and is stable across Sheets/PG");
{
  // Pull 5 ai_line_items from PG, check that their invoice_uuid matches a Sheets-side invoice_submissions row uuid
  const aliSample = await supa.from("ai_line_items").select("invoice_uuid, account_key, description").limit(5);
  console.log(`   sampled 5 PG ai_line_items invoice_uuids:`);
  for (const r of (aliSample.data||[])) {
    const inSheetsSubs = sheets_invoice_submissions.some((s) => String(s[0]||"").trim() === r.invoice_uuid);
    console.log(`     ${r.invoice_uuid?.slice(0,8)} (acct=${r.account_key}, desc="${(r.description||"").slice(0,20)}")  in_sheets_submissions=${inSheetsSubs}`);
  }
}

console.log("\n6c. Assumption: ai_scan_complete + 0 line items uniquely identifies bad upload");
{
  // Cross-check: are there rows with ai_scan_complete=TRUE but pg.ai_line_items count > 0?
  const subs = await pgAll("invoice_submissions", "id, ai_scan_complete, ai_scan_status, is_historical");
  const claimComplete = subs.filter((r) => r.ai_scan_complete === true && r.is_historical === false);
  console.log(`   PG invoice_submissions with ai_scan_complete=TRUE (non-historical): ${claimComplete.length}`);
  // Sample 5: how many have lines in PG.ai_line_items?
  const aliBy = new Map();
  for (const r of aliInvoiceUuids) aliBy.set(r.invoice_uuid, (aliBy.get(r.invoice_uuid)||0)+1);
  const withLines = claimComplete.filter((s) => aliBy.has(s.id)).length;
  console.log(`   of those, with at least 1 ai_line_items row in PG: ${withLines}`);
  console.log(`   without any ai_line_items row in PG (the EMPTY signal): ${claimComplete.length - withLines}`);
}

console.log("\n6d. Assumption: account_key uses the same canonical form across stores");
{
  const sheetsAccts = new Set();
  for (const r of sheets_invoice_submissions) sheetsAccts.add(String(r[3]||"").trim());
  const pgAccts = new Set();
  const pgSubsForAccts = await pgAll("invoice_submissions", "account_key");
  for (const r of pgSubsForAccts) pgAccts.add(r.account_key);
  console.log(`   Sheets distinct account values: ${[...sheetsAccts].filter(Boolean).join(", ")}`);
  console.log(`   PG     distinct account values: ${[...pgAccts].filter(Boolean).join(", ")}`);
  const sOnly = [...sheetsAccts].filter((a) => a && !pgAccts.has(a));
  const pOnly = [...pgAccts].filter((a) => a && !sheetsAccts.has(a));
  console.log(`   Sheets-only forms: ${JSON.stringify(sOnly)}`);
  console.log(`   PG-only forms:     ${JSON.stringify(pOnly)}`);
}

console.log("\n=== DONE ===");
