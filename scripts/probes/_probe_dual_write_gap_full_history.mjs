// READ-ONLY full-history dual-write gap probe.
//
// Mechanism under test (from existing audit):
//   1. Sheets write succeeds unconditionally
//   2. PG write throws (vendor unresolvable / FK / submission-not-in-PG / etc.)
//   3. Caller catches throw, marks ai_scan_status='failed'
//   4. End state: Sheets has line items, PG empty, scan marked failed
//
// Gap definition (full history, not just 7 days):
//   - invoice_submissions row exists in PG
//   - Sheets per-account tab has >=1 line item for that submission's client_uuid
//   - PG ai_line_items has 0 rows for that submission's id
//
// We also flag the inverse case (PG has rows, Sheets empty) but that's not
// the bug being investigated - the current orchestrator writes Sheets first
// so the inverse should be ~zero.

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
const LINE_ITEM_HEADER_INVOICE_UUID_COL = 0; // col A = "Invoice UUID" (= client_uuid)

async function listTabs() {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: AI_LINE_ITEMS,
    fields: "sheets.properties.title",
  });
  return (res.data.sheets || []).map((s) => s.properties.title);
}
async function readTabUuids(name) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: AI_LINE_ITEMS,
    range: `'${name}'!A:A`,
  });
  const rows = res.data.values || [];
  // first row is header
  const map = new Map(); // client_uuid -> count
  for (let i = 1; i < rows.length; i++) {
    const u = String(rows[i][LINE_ITEM_HEADER_INVOICE_UUID_COL] || "").trim();
    if (!u) continue;
    map.set(u, (map.get(u) || 0) + 1);
  }
  return map;
}

console.log("════════════════════════════════════════════════════════════════════");
console.log("  Module 6 dual-write silent gap - FULL HISTORY probe");
console.log("════════════════════════════════════════════════════════════════════");
console.log("");

// ── Step 1: Sheets side - all per-account tabs - distinct invoice_uuid counts ──
console.log("Step 1: Reading Sheets per-account tabs...");
const tabs = await listTabs();
console.log(`  Tabs found: ${tabs.length}`);
const sheetsByUuid = new Map(); // client_uuid -> { tab, count }
let sheetsLineRowsTotal = 0;
let sheetsDistinctUuids = 0;
for (const t of tabs) {
  try {
    const m = await readTabUuids(t);
    for (const [u, c] of m.entries()) {
      sheetsLineRowsTotal += c;
      if (!sheetsByUuid.has(u)) {
        sheetsDistinctUuids++;
        sheetsByUuid.set(u, { tab: t, count: c });
      } else {
        // duplicate uuid across tabs - keep first, add count
        const prev = sheetsByUuid.get(u);
        prev.count += c;
      }
    }
  } catch (e) {
    console.log(`    tab "${t}" read failed: ${e.message.slice(0, 80)}`);
  }
}
console.log(`  Distinct invoice_uuid in Sheets: ${sheetsDistinctUuids}`);
console.log(`  Total line-item rows in Sheets:  ${sheetsLineRowsTotal}`);
console.log("");

// ── Step 2: PG side - all invoice_submissions + their line-item count ──
console.log("Step 2: Reading PG invoice_submissions + ai_line_items...");
const PAGE = 1000;
let subs = [];
for (let off = 0; ; off += PAGE) {
  const { data, error } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, account_key, vendor_name, invoice_number, submitted_at, ai_scan_status, ai_scan_complete, is_historical, status")
    .range(off, off + PAGE - 1);
  if (error) throw new Error(`invoice_submissions: ${error.message}`);
  if (!data || data.length === 0) break;
  subs = subs.concat(data);
  if (data.length < PAGE) break;
}
console.log(`  invoice_submissions in PG: ${subs.length}`);

const subById = new Map();        // sub.id -> sub
const subByClientUuid = new Map(); // client_uuid -> sub
for (const s of subs) {
  subById.set(s.id, s);
  if (s.client_uuid) subByClientUuid.set(s.client_uuid, s);
}

// Build PG line-item-count map (group by invoice_uuid which = sub.id)
const pgCountBySubId = new Map();
let pgLineRowsTotal = 0;
for (let off = 0; ; off += PAGE) {
  const { data, error } = await supa
    .from("ai_line_items")
    .select("invoice_uuid")
    .range(off, off + PAGE - 1);
  if (error) throw new Error(`ai_line_items: ${error.message}`);
  if (!data || data.length === 0) break;
  for (const r of data) {
    pgLineRowsTotal++;
    pgCountBySubId.set(r.invoice_uuid, (pgCountBySubId.get(r.invoice_uuid) || 0) + 1);
  }
  if (data.length < PAGE) break;
}
console.log(`  ai_line_items rows in PG:   ${pgLineRowsTotal}`);
console.log(`  Distinct invoice_uuid in PG ai_line_items: ${pgCountBySubId.size}`);
console.log("");

// ── Step 3: Compute the gap ──
console.log("════════════════════════════════════════════════════════════════════");
console.log("  Step 3: Gap classification");
console.log("════════════════════════════════════════════════════════════════════");

// Gap A (the bug): client_uuid in Sheets, NO rows in PG
// Gap B (inverse): in PG, NOT in Sheets (Sheets-first should make this ~0)
// Both: in both stores
const sheetsOnly = []; // gap A - the bug
const pgOnly = [];     // gap B - inverse (anomalous)
const both = [];

// Iterate Sheets-side: find any uuid not in PG
for (const [uuid, { tab, count }] of sheetsByUuid.entries()) {
  const sub = subByClientUuid.get(uuid);
  if (!sub) {
    // Sheets has the uuid but no submission row in PG - very strange,
    // would mean uuid was rotated. Flag separately.
    sheetsOnly.push({ uuid, tab, sheetsCount: count, pgCount: 0, sub: null, anomaly: "no_pg_submission_row" });
    continue;
  }
  const pgCount = pgCountBySubId.get(sub.id) || 0;
  if (pgCount === 0) {
    sheetsOnly.push({ uuid, tab, sheetsCount: count, pgCount: 0, sub, anomaly: null });
  } else {
    both.push({ uuid, sheetsCount: count, pgCount });
  }
}

// Iterate PG-side ai_line_items: find sub.ids with PG rows whose client_uuid is not in Sheets
for (const [subId, pgCount] of pgCountBySubId.entries()) {
  const sub = subById.get(subId);
  if (!sub) continue; // PG line item with no submission row - orphan
  if (sub.client_uuid && sheetsByUuid.has(sub.client_uuid)) continue; // already in `both`
  pgOnly.push({ sub, pgCount, sheetsCount: 0 });
}

console.log("");
console.log(`  Both stores (parity):  ${both.length} invoices`);
console.log(`  Sheets-only (the gap): ${sheetsOnly.length} invoices`);
console.log(`  PG-only (inverse):     ${pgOnly.length} invoices`);
console.log("");

// ── Step 4: Characterize the gap ──
console.log("════════════════════════════════════════════════════════════════════");
console.log("  Step 4: Gap (Sheets-only) characterization");
console.log("════════════════════════════════════════════════════════════════════");

// By ai_scan_status
const byStatus = new Map();
const byAccount = new Map();
const byDay = new Map();
const byHistorical = new Map();
const byVendor = new Map();
const noSubRow = sheetsOnly.filter((g) => g.anomaly === "no_pg_submission_row");
const withSub = sheetsOnly.filter((g) => g.sub);
for (const g of withSub) {
  const st = g.sub.ai_scan_status || "(null)";
  byStatus.set(st, (byStatus.get(st) || 0) + 1);
  const acct = g.sub.account_key || "(null)";
  byAccount.set(acct, (byAccount.get(acct) || 0) + 1);
  const d = String(g.sub.submitted_at || "").slice(0, 10) || "(null)";
  byDay.set(d, (byDay.get(d) || 0) + 1);
  const ih = g.sub.is_historical ? "historical" : "live";
  byHistorical.set(ih, (byHistorical.get(ih) || 0) + 1);
  const v = (g.sub.vendor_name || "(null)").toString().slice(0, 30);
  byVendor.set(v, (byVendor.get(v) || 0) + 1);
}

console.log("");
console.log(`  By ai_scan_status:`);
for (const [k, v] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(20)} ${v}`);
}
console.log("");
console.log(`  By is_historical:`);
for (const [k, v] of [...byHistorical.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(20)} ${v}`);
}
console.log("");
console.log(`  By account_key:`);
for (const [k, v] of [...byAccount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(20)} ${v}`);
}
console.log("");
console.log(`  By vendor_name (top 15):`);
for (const [k, v] of [...byVendor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`    ${k.padEnd(32)} ${v}`);
}
console.log("");
console.log(`  By submitted_at date (chronological):`);
for (const [k, v] of [...byDay.entries()].sort()) {
  console.log(`    ${k.padEnd(12)} ${v}`);
}
console.log("");
console.log(`  Anomaly: Sheets uuid with NO PG submission row: ${noSubRow.length}`);
if (noSubRow.length > 0) {
  for (const g of noSubRow.slice(0, 5)) {
    console.log(`    uuid=${g.uuid} tab="${g.tab}" sheetsCount=${g.sheetsCount}`);
  }
}

console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  Step 5: Sample of gap invoices (first 25)");
console.log("════════════════════════════════════════════════════════════════════");
const samples = withSub.slice(0, 25);
for (const g of samples) {
  const s = g.sub;
  console.log(
    `  acct=${(s.account_key || "").padEnd(14)}  ` +
    `vendor="${(s.vendor_name || "").slice(0, 24).padEnd(24)}"  ` +
    `inv#=${(s.invoice_number || "").slice(0, 14).padEnd(14)}  ` +
    `submitted=${String(s.submitted_at || "").slice(0, 10)}  ` +
    `scan=${(s.ai_scan_status || "(null)").padEnd(10)}  ` +
    `sheets_li=${g.sheetsCount}  ` +
    `uuid=${g.uuid.slice(0, 8)}`
  );
}

console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  Inverse (PG-only) inspection - should be ~0 if Sheets-first holds");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`  PG-only invoices: ${pgOnly.length}`);
for (const g of pgOnly.slice(0, 10)) {
  const s = g.sub;
  console.log(
    `  acct=${(s.account_key || "").padEnd(14)}  ` +
    `vendor="${(s.vendor_name || "").slice(0, 24).padEnd(24)}"  ` +
    `inv#=${(s.invoice_number || "").slice(0, 14).padEnd(14)}  ` +
    `submitted=${String(s.submitted_at || "").slice(0, 10)}  ` +
    `scan=${(s.ai_scan_status || "(null)").padEnd(10)}  ` +
    `pg_li=${g.pgCount}  ` +
    `client_uuid=${(s.client_uuid || "").slice(0, 8)}`
  );
}
console.log("");
console.log("Done.");
