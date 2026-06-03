// Verify Stage 1 outcomes: actual stored totals + PG ai_line_items
// counts + ai_scan_status for the 5 just-processed UUIDs, plus locate
// City Seafood INV25406 in the cohort order.

import { createClient } from "@supabase/supabase-js";
import { safeRead, SHEET_IDS } from "../src/lib/sheets.js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const PROCESSED = [
  "9f009084-98c1-4d10-99b8-92111941366a", // City Seafood INV23661
  "1e43b586-0cbe-45e5-8216-09b88c2a4ab1", // Grey Eagle 604008
  "dc10f95e-c86a-4919-b06a-0ee4300703e8", // Grey Eagle 609400
  "512cda63-2de5-4b15-9f75-1bb7688c38bc", // What Chefs Want 12538734
  "7ea1ef30-a409-4726-ab7c-743e71cf5e7a", // What Chefs Want 12534477
];

async function main() {
  console.log(`[verify] Stage 1 post-write check`);
  const { data, error } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, submitted_at, vendor_name, invoice_number, total_amount, ai_scan_status, page_count")
    .in("client_uuid", PROCESSED)
    .order("submitted_at", { ascending: true });
  if (error) throw new Error(error.message);

  const idMap = {};
  for (const r of data) idMap[r.client_uuid] = r;

  const { data: lines, error: lineErr } = await supa
    .from("ai_line_items")
    .select("invoice_uuid, extended_price")
    .in("invoice_uuid", data.map((r) => r.id));
  if (lineErr) throw new Error(lineErr.message);

  const pgCountByPgId = {};
  const pgSumByPgId = {};
  for (const l of lines) {
    pgCountByPgId[l.invoice_uuid] = (pgCountByPgId[l.invoice_uuid] || 0) + 1;
    pgSumByPgId[l.invoice_uuid] = (pgSumByPgId[l.invoice_uuid] || 0) + Number(l.extended_price || 0);
  }

  console.log(``);
  for (const uuid of PROCESSED) {
    const r = idMap[uuid];
    if (!r) { console.log(`  ${uuid} : NOT FOUND IN PG`); continue; }
    const pgCount = pgCountByPgId[r.id] || 0;
    const pgSum = pgSumByPgId[r.id] || 0;
    console.log(`  ${uuid}`);
    console.log(`     ${r.vendor_name} #${r.invoice_number}  submitted=${r.submitted_at}`);
    console.log(`     stored total_amount     : $${Number(r.total_amount || 0).toFixed(2)}`);
    console.log(`     ai_scan_status (post)   : ${r.ai_scan_status}`);
    console.log(`     page_count stored       : ${r.page_count}`);
    console.log(`     PG ai_line_items rows   : ${pgCount}`);
    console.log(`     PG sum(extended_price)  : $${pgSum.toFixed(2)}`);
  }

  // City Seafood INV25406 lookup
  console.log(``);
  console.log(`[verify] City Seafood INV25406 location in cohort:`);
  const { data: cs } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, submitted_at, total_amount, ai_scan_status")
    .eq("account_key", "STL - MO")
    .eq("vendor_name", "City Seafood")
    .ilike("invoice_number", "%25406%")
    .limit(5);
  for (const r of cs || []) {
    console.log(`  uuid=${r.client_uuid}  submitted=${r.submitted_at}  total=$${Number(r.total_amount).toFixed(2)}  status=${r.ai_scan_status}`);
  }

  // Get cohort position of INV25406
  const { data: cohort } = await supa
    .from("invoice_submissions")
    .select("client_uuid, vendor_name, invoice_number, submitted_at")
    .eq("account_key", "STL - MO")
    .gte("submitted_at", "2026-04-15T00:00:00.000Z")
    .or("ai_scan_status.is.null,ai_scan_status.eq.photo-only")
    .order("submitted_at", { ascending: true });
  console.log(``);
  console.log(`[verify] First 10 cohort rows by submitted_at ascending:`);
  for (let i = 0; i < Math.min(10, cohort?.length || 0); i++) {
    const r = cohort[i];
    const tag = r.invoice_number?.includes("25406") ? "  <-- INV25406" : "";
    console.log(`  ${i + 1}. ${r.client_uuid}  ${r.submitted_at}  ${r.vendor_name} #${r.invoice_number}${tag}`);
  }
  const idx25406 = (cohort || []).findIndex((r) => r.invoice_number?.includes("25406") && r.vendor_name === "City Seafood");
  console.log(`  INV25406 cohort index (0-based): ${idx25406}`);

  // ── Sheet-side line items + arithmetic check (PG is empty per the
  // dual-write gap; Sheet is the only source for these lines right now) ──
  console.log(``);
  console.log(`[verify] AI_LINE_ITEMS Sheet "STL - MO" tab: per-line arithmetic`);
  const { rows: sheetRows } = await safeRead(SHEET_IDS.AI_LINE_ITEMS, "STL - MO");
  // Schema (per LINE_IDX in dataStore/invoice.js):
  //   0 invoiceUuid, 1 ts, 2 account, 3 vendor, 4 invoice#, 5 date,
  //   6 lineNum, 7 description, 8 quantity, 9 unit, 10 unitPrice,
  //   11 extendedPrice, 12 category, 13 confidence, 14 rawJson
  for (const uuid of PROCESSED) {
    const r = idMap[uuid];
    const storedTotal = Number(r?.total_amount || 0);
    const lines = sheetRows.filter((row) => String(row[0] || "").trim() === uuid);
    if (lines.length === 0) {
      console.log(`  ${uuid}: NO SHEET ROWS`);
      continue;
    }
    let extendedSum = 0, clean = 0, hold = 0;
    const holdDetails = [];
    for (const line of lines) {
      const lineNum = line[6];
      const desc = String(line[7] || "").slice(0, 40);
      const qty = Number(line[8] || 0);
      const unit = Number(line[10] || 0);
      const ext = Number(line[11] || 0);
      const calc = qty * unit;
      const tol = 0.02 * Math.abs(ext) + 0.01;
      const ok = Math.abs(calc - ext) <= tol;
      extendedSum += ext;
      if (ok) clean++;
      else {
        hold++;
        holdDetails.push(`L${lineNum} "${desc}" qty=${qty} unit=${unit} ext=${ext.toFixed(2)} calc=${calc.toFixed(2)}`);
      }
    }
    const sumVsTotal = extendedSum - storedTotal;
    const totalOk = Math.abs(sumVsTotal) <= Math.max(0.5, 0.01 * Math.abs(storedTotal));
    console.log(`  ${uuid} (${r?.vendor_name} #${r?.invoice_number})`);
    console.log(`     stored total=$${storedTotal.toFixed(2)}  sum(ext)=$${extendedSum.toFixed(2)}  diff=$${sumVsTotal.toFixed(2)}  ${totalOk ? "MATCH" : "MISMATCH"}`);
    console.log(`     lines=${lines.length}  arithmetic PASS=${clean}  HOLD=${hold}`);
    for (const h of holdDetails) console.log(`       HOLD: ${h}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
