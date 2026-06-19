// ════════════════════════════════════════════════════════════════════════════
// Full gap-cause audit AFTER PR #139's re-sequence fix.
//
// Replays every PG=0 Sheets>0 live gap invoice through the NEW production
// logic (re-sequence line_num to 1..N) + the PG insert. Reports:
//   - how many #139 clears
//   - what other causes remain, grouped by error code/reason
//
// SAFETY
//   - Each insert is rolled back regardless of outcome
//   - ai_scan_status / ai_scan_error never touched - this is a pure write test,
//     not the visibility-fix test
//   - No Claude calls, no Sheets writes
//   - On rollback failure: hard stop + report orphaned rows
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

// ── Build PG line count + vendor maps ─────────────────────────────────────
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

// ── Read all Sheets tabs once ─────────────────────────────────────────────
console.log("Reading all Sheets tabs...");
const tabRowsByName = new Map();
for (const tab of ACCOUNT_TABS) {
  try {
    const res = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: AI_LINE_ITEMS_SHEET,
      range: `'${tab}'!A:O`,
    });
    tabRowsByName.set(tab, res.data.values || []);
  } catch (e) {
    console.log(`  tab "${tab}" read failed: ${e.message}`);
    tabRowsByName.set(tab, []);
  }
}

// ── Find the gap set: live, status failed or null, PG=0, Sheets>0 ─────────
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
  if (sheetsRows.length === 0) continue;  // PG=0 Sheets=0 - different bug class, skip
  gapSet.push({ sub: s, sheetsRows });
}
console.log(`Gap set (live, PG=0, Sheets>0): ${gapSet.length}`);
console.log("");

// ── Per-invoice replay ────────────────────────────────────────────────────
const outcomes = [];   // { sub, sheetsCount, hadCollision, result: "LANDED"|"THROW", err? }
let orphanedRowIds = [];  // track in case rollback ever fails

for (const { sub, sheetsRows } of gapSet) {
  // Convert Sheets rows -> Claude-shaped items
  const items = sheetsRows.map((r) => ({
    lineNum:       parseInt(r[6], 10) || 0,
    description:   r[7] || "",
    quantity:      r[8] ? parseFloat(r[8]) : 0,
    unit:          r[9] || "",
    unitPrice:     r[10] ? parseFloat(r[10]) : 0,
    extendedPrice: r[11] ? parseFloat(r[11]) : 0,
    category:      r[12] || "other",
  }));

  // Collision diagnostic on original (= would've broken pre-#139)
  const origLineNums = items.map((it) => it.lineNum);
  const hadCollision = new Set(origLineNums).size < origLineNums.length;

  // Apply #139 fix: re-sequence 1..N
  const lineItems = items.map((item, idx) => ({
    lineNum:       idx + 1,
    description:   item.description || "",
    quantity:      item.quantity || 0,
    unit:          item.unit || "",
    unitPrice:     item.unitPrice || 0,
    extendedPrice: item.extendedPrice || 0,
    category:      item.category || "other",
    confidence:    "high",
    rawJson:       JSON.stringify(item),
    vendorName:    sub.vendor_name,
    invoiceNumber: sub.invoice_number,
    invoiceDate:   sub.invoice_date,
  }));

  // Vendor resolution (mirrors insertAILineItemsPostgres at invoice.js:1023)
  let perLineFailure = null;
  for (const it of lineItems) {
    const vid = resolveVendorId(it.vendorName);
    if (!vid) {
      perLineFailure = {
        code: "vendor_unresolved",
        message: `[dataStore.invoice.pg] insertAILineItems: vendor "${it.vendorName}" did not resolve to a vendor_id (exact + alias lookup both failed).`,
        details: null,
        hint: null,
      };
      break;
    }
  }

  if (perLineFailure) {
    outcomes.push({ sub, sheetsCount: sheetsRows.length, hadCollision, result: "THROW", err: perLineFailure });
    continue;
  }

  const vendorId = resolveVendorId(sub.vendor_name);
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
    confidence:     item.confidence || null,
    raw_json:       null,
  }));

  const { data: insData, error: insErr } = await supa.from("ai_line_items").insert(rows).select("id");
  if (insErr) {
    outcomes.push({
      sub, sheetsCount: sheetsRows.length, hadCollision,
      result: "THROW",
      err: { code: insErr.code, message: insErr.message, details: insErr.details, hint: insErr.hint },
    });
    process.stdout.write(`  ${sub.client_uuid.slice(0,8)} ${sub.vendor_name.slice(0,12).padEnd(12)} THROW ${insErr.code || "?"}\n`);
    continue;
  }

  // Landed - roll back immediately
  const ids = insData.map((r) => r.id);
  const { error: delErr } = await supa.from("ai_line_items").delete().in("id", ids);
  if (delErr) {
    orphanedRowIds = orphanedRowIds.concat(ids);
    console.log(`  ROLLBACK FAILED for ${sub.client_uuid.slice(0,8)}: ${delErr.message}`);
    console.log(`  -> ${ids.length} rows left in PG: ${ids.slice(0, 5).join(", ")}...`);
    console.log(`  STOPPING audit to avoid more orphans.`);
    break;
  }
  outcomes.push({ sub, sheetsCount: sheetsRows.length, hadCollision, result: "LANDED", landedRowCount: ids.length });
  process.stdout.write(`  ${sub.client_uuid.slice(0,8)} ${sub.vendor_name.slice(0,12).padEnd(12)} LANDED ${ids.length}\n`);
}

// ── Summary classification ────────────────────────────────────────────────
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  SUMMARY");
console.log("════════════════════════════════════════════════════════════════════");
const landed = outcomes.filter((o) => o.result === "LANDED");
const stillThrow = outcomes.filter((o) => o.result === "THROW");
console.log(`  Gap set audited: ${outcomes.length}`);
console.log(`  LANDED cleanly (#139 re-sequence clears these): ${landed.length}`);
console.log(`  STILL THROW (need additional fix):              ${stillThrow.length}`);
console.log("");

const landedDueToResequence = landed.filter((o) => o.hadCollision);
const landedUnrelated = landed.filter((o) => !o.hadCollision);
console.log(`  Of the LANDED:`);
console.log(`    Had dup line_num originally (= #139 was load-bearing): ${landedDueToResequence.length}`);
console.log(`    No dup line_num originally (= would've landed without #139 - transient/other-now-resolved): ${landedUnrelated.length}`);
console.log("");

if (landedUnrelated.length > 0) {
  console.log(`  LANDED without needing #139:`);
  for (const o of landedUnrelated) {
    console.log(`    ${o.sub.client_uuid.slice(0,8)}  ${o.sub.account_key}  "${o.sub.vendor_name}"  rows=${o.sheetsCount}`);
  }
  console.log("");
}

if (stillThrow.length > 0) {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  STILL-THROWING - grouped by cause");
  console.log("════════════════════════════════════════════════════════════════════");

  // Group by PG code + message-signature
  const byCause = new Map();
  for (const o of stillThrow) {
    // signature: code + first 100 chars of message (collapses similar errors)
    const sig = `${o.err.code}::${(o.err.message || "").slice(0, 100)}`;
    if (!byCause.has(sig)) byCause.set(sig, { code: o.err.code, message: o.err.message, details: o.err.details, samples: [] });
    byCause.get(sig).samples.push(o);
  }
  // Sort by frequency
  const sorted = [...byCause.values()].sort((a, b) => b.samples.length - a.samples.length);
  for (const group of sorted) {
    console.log("");
    console.log(`  ── Cause: PG ${group.code} (${group.samples.length} invoice${group.samples.length === 1 ? "" : "s"}) ──`);
    console.log(`     message:  ${group.message}`);
    if (group.details) console.log(`     details:  ${group.details}`);
    // Account/vendor breakdown
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
      console.log(`       ${o.sub.client_uuid.slice(0,8)}  ${o.sub.account_key}  "${o.sub.vendor_name}"  inv#=${o.sub.invoice_number}  rows=${o.sheetsCount}`);
    }
  }
}

if (orphanedRowIds.length > 0) {
  console.log("");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  WARNING: ${orphanedRowIds.length} orphaned rows left in ai_line_items`);
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  IDs: ${orphanedRowIds.join(", ")}`);
}

console.log("");
console.log("Done.");
