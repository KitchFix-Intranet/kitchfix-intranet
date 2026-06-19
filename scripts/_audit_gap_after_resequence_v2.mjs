// ════════════════════════════════════════════════════════════════════════════
// v2 - Full gap-cause audit AFTER PR #139's re-sequence, NOW with Stage A
// fields parsed from raw_json so the payload matches what the original
// extraction sent to PG (not a stripped-down legacy payload).
// ════════════════════════════════════════════════════════════════════════════

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
const sheetsApi = google.sheets({ version: "v4", auth: sheetsAuth });
const AI_LINE_ITEMS_SHEET = "18mTWaeodOpFVmDSNRkGpNZvCrNWqHxVv3qN8r1b2REo";
const ACCOUNT_TABS = ["STL - FL","STL - MO","CIN - OH","TXR - TX - H","TXR - TX - V","TXR - AZ","CIN - AZ","TBR - FL","TBJ - FL"];
const PAGE = 1000;

console.log("Building PG line-count map + vendor map...");
const pgLineCountBySubId = new Map();
for (let off = 0; ; off += PAGE) {
  const { data, error } = await supa.from("ai_line_items").select("invoice_uuid").range(off, off + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) break;
  for (const r of data) pgLineCountBySubId.set(r.invoice_uuid, (pgLineCountBySubId.get(r.invoice_uuid) || 0) + 1);
  if (data.length < PAGE) break;
}
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
function parseDateOrNull(s) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

console.log("Reading all Sheets tabs...");
const tabRowsByName = new Map();
for (const tab of ACCOUNT_TABS) {
  try {
    const res = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: AI_LINE_ITEMS_SHEET,
      range: `'${tab}'!A:O`,
    });
    tabRowsByName.set(tab, res.data.values || []);
  } catch { tabRowsByName.set(tab, []); }
}

console.log("Identifying gap invoices...");
let subs = [];
for (let off = 0; ; off += PAGE) {
  const { data, error } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, account_key, vendor_name, invoice_number, invoice_date, submitted_at, ai_scan_status, is_historical")
    .eq("is_historical", false)
    .or("ai_scan_status.eq.failed,ai_scan_status.is.null,ai_scan_status.eq.pg_failed")
    .range(off, off + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) break;
  subs = subs.concat(data);
  if (data.length < PAGE) break;
}

const gapSet = [];
for (const s of subs) {
  if ((pgLineCountBySubId.get(s.id) || 0) > 0) continue;
  const tabRows = tabRowsByName.get(s.account_key) || [];
  const sheetsRows = tabRows.filter((r, i) => i > 0 && String(r[0] || "").trim() === s.client_uuid);
  if (sheetsRows.length === 0) continue;
  gapSet.push({ sub: s, sheetsRows });
}
console.log(`Gap set (live, PG=0, Sheets>0): ${gapSet.length}`);
console.log("");

// ── Per-invoice replay with FULL Stage A payload ──────────────────────────
const outcomes = [];
let orphanedRowIds = [];

for (const { sub, sheetsRows } of gapSet) {
  // Parse Sheets row to FULL OCR item shape (including Stage A from raw_json)
  const items = sheetsRows.map((r) => {
    let raw = {};
    try { raw = JSON.parse(r[14] || "{}"); } catch { raw = {}; }
    return {
      lineNum:       parseInt(r[6], 10) || 0,
      description:   r[7] || "",
      quantity:      r[8] ? parseFloat(r[8]) : 0,
      unit:          r[9] || "",
      unitPrice:     r[10] ? parseFloat(r[10]) : 0,
      extendedPrice: r[11] ? parseFloat(r[11]) : 0,
      category:      r[12] || "other",
      // Stage A from raw_json (matches what production passes to PG)
      itemNumber:        raw.itemNumber ?? null,
      packSize:          raw.packSize ?? null,
      orderedCount:      raw.orderedCount ?? null,
      shippedCount:      raw.shippedCount ?? null,
      uomRaw:            raw.uomRaw ?? null,
      amount:            raw.amount ?? null,
      weightLineValue:   raw.weightLineValue ?? null,
      catchWeightMarker: raw.catchWeightMarker ?? null,
    };
  });

  const origLineNums = items.map((it) => it.lineNum);
  const hadCollision = new Set(origLineNums).size < origLineNums.length;
  const hasStageA = items.some((it) => it.itemNumber !== null || it.packSize !== null || it.orderedCount !== null || it.shippedCount !== null || it.uomRaw !== null || it.amount !== null || it.weightLineValue !== null || it.catchWeightMarker !== null);

  // Apply #139 re-sequence
  const lineItems = items.map((item, idx) => ({
    lineNum:       idx + 1,
    description:   item.description || "",
    quantity:      item.quantity || 0,
    unit:          item.unit || "",
    unitPrice:     item.unitPrice || 0,
    extendedPrice: item.extendedPrice || 0,
    category:      item.category || "other",
    vendorName:    sub.vendor_name,
    invoiceNumber: sub.invoice_number,
    invoiceDate:   sub.invoice_date,
    itemNumber:        item.itemNumber || null,
    packSize:          item.packSize || null,
    orderedCount:      item.orderedCount != null ? item.orderedCount : null,
    shippedCount:      item.shippedCount != null ? item.shippedCount : null,
    uomRaw:            item.uomRaw || null,
    amount:            item.amount != null ? item.amount : null,
    weightLineValue:   item.weightLineValue != null ? item.weightLineValue : null,
    catchWeightMarker: item.catchWeightMarker || null,
  }));

  const vendorId = resolveVendorId(sub.vendor_name);
  if (!vendorId) {
    outcomes.push({ sub, sheetsCount: sheetsRows.length, hadCollision, hasStageA, result: "THROW", err: { code: "vendor_unresolved", message: `vendor "${sub.vendor_name}" did not resolve`, details: null, hint: null } });
    process.stdout.write(`  ${sub.client_uuid.slice(0,8)} ${sub.vendor_name.slice(0,12).padEnd(12)} THROW vendor_unresolved\n`);
    continue;
  }

  const rows = lineItems.map((item) => ({
    invoice_uuid:   sub.id,
    account_key:    sub.account_key,
    vendor_name:    sub.vendor_name,
    vendor_id:      vendorId,
    invoice_number: item.invoiceNumber || sub.invoice_number,
    invoice_date:   parseDateOrNull(item.invoiceDate) || sub.invoice_date,
    line_num:       item.lineNum,
    description:    item.description || "",
    quantity:       item.quantity != null ? item.quantity : null,
    unit:           item.unit || null,
    unit_price:     item.unitPrice != null ? item.unitPrice : null,
    extended_price: item.extendedPrice != null ? item.extendedPrice : null,
    category:       item.category || null,
    confidence:     "high",
    raw_json:       null,
    item_number:          item.itemNumber || null,
    pack_size:            item.packSize || null,
    ordered_count:        item.orderedCount != null ? item.orderedCount : null,
    shipped_count:        item.shippedCount != null ? item.shippedCount : null,
    uom_raw:              item.uomRaw || null,
    amount:               item.amount != null ? item.amount : null,
    weight_line_value:    item.weightLineValue != null ? item.weightLineValue : null,
    catch_weight_marker:  item.catchWeightMarker || null,
    raw_columns:          null,
  }));

  const { data: insData, error: insErr } = await supa.from("ai_line_items").insert(rows).select("id");
  if (insErr) {
    outcomes.push({
      sub, sheetsCount: sheetsRows.length, hadCollision, hasStageA,
      result: "THROW",
      err: { code: insErr.code, message: insErr.message, details: insErr.details, hint: insErr.hint },
    });
    process.stdout.write(`  ${sub.client_uuid.slice(0,8)} ${sub.vendor_name.slice(0,12).padEnd(12)} THROW ${insErr.code || "?"} stageA=${hasStageA ? "Y" : "n"}\n`);
    continue;
  }

  const ids = insData.map((r) => r.id);
  const { error: delErr } = await supa.from("ai_line_items").delete().in("id", ids);
  if (delErr) {
    orphanedRowIds = orphanedRowIds.concat(ids);
    console.log(`  ROLLBACK FAILED for ${sub.client_uuid.slice(0,8)}: ${delErr.message}`);
    console.log(`  STOPPING audit.`);
    break;
  }
  outcomes.push({ sub, sheetsCount: sheetsRows.length, hadCollision, hasStageA, result: "LANDED", landedRowCount: ids.length });
  process.stdout.write(`  ${sub.client_uuid.slice(0,8)} ${sub.vendor_name.slice(0,12).padEnd(12)} LANDED ${ids.length} stageA=${hasStageA ? "Y" : "n"}\n`);
}

console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  v2 SUMMARY (with Stage A payload reconstructed from raw_json)");
console.log("════════════════════════════════════════════════════════════════════");
const landed = outcomes.filter((o) => o.result === "LANDED");
const stillThrow = outcomes.filter((o) => o.result === "THROW");
console.log(`  Gap set audited: ${outcomes.length}`);
console.log(`  LANDED cleanly: ${landed.length}`);
console.log(`  STILL THROW:    ${stillThrow.length}`);
console.log("");

const landedDueToResequence = landed.filter((o) => o.hadCollision);
const landedUnrelated = landed.filter((o) => !o.hadCollision);
const landedWithStageA = landed.filter((o) => o.hasStageA);
console.log(`  Of the LANDED:`);
console.log(`    Had dup line_num originally (= #139 was load-bearing):     ${landedDueToResequence.length}`);
console.log(`    No dup line_num originally (cause was transient or other): ${landedUnrelated.length}`);
console.log(`    Had Stage A fields in raw_json (= post-2026-06-10 era):    ${landedWithStageA.length}`);
console.log("");

if (stillThrow.length > 0) {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  STILL-THROWING - grouped by cause");
  console.log("════════════════════════════════════════════════════════════════════");
  const byCause = new Map();
  for (const o of stillThrow) {
    const sig = `${o.err.code}::${(o.err.message || "").slice(0, 120)}`;
    if (!byCause.has(sig)) byCause.set(sig, { code: o.err.code, message: o.err.message, details: o.err.details, samples: [] });
    byCause.get(sig).samples.push(o);
  }
  const sorted = [...byCause.values()].sort((a, b) => b.samples.length - a.samples.length);
  for (const group of sorted) {
    console.log("");
    console.log(`  ── Cause: PG ${group.code} (${group.samples.length} invoice${group.samples.length === 1 ? "" : "s"}) ──`);
    console.log(`     message:  ${group.message}`);
    if (group.details) console.log(`     details:  ${group.details}`);
    const byAccount = new Map();
    const byVendor = new Map();
    for (const o of group.samples) {
      byAccount.set(o.sub.account_key, (byAccount.get(o.sub.account_key) || 0) + 1);
      byVendor.set(o.sub.vendor_name, (byVendor.get(o.sub.vendor_name) || 0) + 1);
    }
    console.log(`     accounts: ${[...byAccount.entries()].map(([k,v]) => `${k}=${v}`).join(", ")}`);
    console.log(`     vendors:  ${[...byVendor.entries()].map(([k,v]) => `${k}=${v}`).join(", ")}`);
    console.log(`     examples:`);
    for (const o of group.samples.slice(0, 3)) {
      console.log(`       ${o.sub.client_uuid.slice(0,8)}  ${o.sub.account_key}  "${o.sub.vendor_name}"  inv#=${o.sub.invoice_number}  rows=${o.sheetsCount}  stageA=${o.hasStageA ? "Y" : "n"}`);
    }
  }
}

if (orphanedRowIds.length > 0) {
  console.log("");
  console.log(`  WARNING: ${orphanedRowIds.length} orphaned rows: ${orphanedRowIds.join(", ")}`);
}
console.log("");
console.log("Done.");
