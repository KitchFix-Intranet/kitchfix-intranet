// READ-ONLY: inspect the two line-38 rows on fd004ff4 verbatim to classify
// distinct-mislabeled vs true-duplicate. Also check 8232e2b4's line-10 pair.
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

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
const AI_LINE_ITEMS = "18mTWaeodOpFVmDSNRkGpNZvCrNWqHxVv3qN8r1b2REo";

const targets = [
  { prefix: "fd004ff4", vendor: "Ben E Keith", tab: "TXR - TX - H", dupLine: 38 },
  { prefix: "8232e2b4", vendor: "Cheney Brothers", tab: "TBJ - FL", dupLine: 10 },
];

// Sheets columns:
//  0 Invoice UUID, 1 Timestamp, 2 Account, 3 Vendor, 4 Invoice #,
//  5 Invoice Date, 6 Line #, 7 Item Description, 8 Quantity, 9 Unit,
// 10 Unit Price, 11 Extended Price, 12 Category, 13 Confidence, 14 Raw JSON

for (const t of targets) {
  // Resolve full client_uuid
  const { data: candidates } = await supa
    .from("invoice_submissions")
    .select("client_uuid")
    .eq("vendor_name", t.vendor)
    .eq("is_historical", false);
  const match = (candidates || []).find((c) => String(c.client_uuid).startsWith(t.prefix));
  if (!match) { console.log(`No invoice found for ${t.prefix}`); continue; }
  const fullUuid = match.client_uuid;

  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  ${t.prefix}  (${t.vendor})  dup line ${t.dupLine}`);
  console.log("════════════════════════════════════════════════════════════════════");

  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: AI_LINE_ITEMS,
    range: `'${t.tab}'!A:O`,
  });
  const rows = res.data.values || [];
  const matching = rows.filter((r, i) => i > 0 && String(r[0] || "").trim() === fullUuid);
  console.log(`  total Sheets rows for this invoice: ${matching.length}`);
  console.log("");

  // Show all rows ordered by appearance; highlight the dup-line ones
  console.log("  ALL line_num values (in Sheets row order):");
  const lineNums = matching.map((r) => parseInt(r[6], 10));
  console.log(`    ${lineNums.join(", ")}`);
  console.log("");

  // Pull the two rows with the dup line_num
  const dupRows = matching.filter((r) => parseInt(r[6], 10) === t.dupLine);
  console.log(`  Rows with line_num=${t.dupLine}: ${dupRows.length}`);
  console.log("");
  for (let i = 0; i < dupRows.length; i++) {
    const r = dupRows[i];
    console.log(`  ── Row ${i + 1} of ${dupRows.length} (line_num=${t.dupLine}) ──`);
    console.log(`    description:    ${JSON.stringify(r[7] || "")}`);
    console.log(`    quantity:       ${JSON.stringify(r[8] || "")}`);
    console.log(`    unit:           ${JSON.stringify(r[9] || "")}`);
    console.log(`    unit_price:     ${JSON.stringify(r[10] || "")}`);
    console.log(`    extended_price: ${JSON.stringify(r[11] || "")}`);
    console.log(`    category:       ${JSON.stringify(r[12] || "")}`);
    // Look inside Raw JSON for item_number / pack_size / catch-weight marker etc
    try {
      const raw = JSON.parse(r[14] || "{}");
      console.log(`    raw_json keys:  ${Object.keys(raw).join(", ")}`);
      if (raw.itemNumber) console.log(`      itemNumber:     ${JSON.stringify(raw.itemNumber)}`);
      if (raw.packSize) console.log(`      packSize:       ${JSON.stringify(raw.packSize)}`);
      if (raw.orderedCount !== undefined) console.log(`      orderedCount:   ${JSON.stringify(raw.orderedCount)}`);
      if (raw.shippedCount !== undefined) console.log(`      shippedCount:   ${JSON.stringify(raw.shippedCount)}`);
      if (raw.uomRaw) console.log(`      uomRaw:         ${JSON.stringify(raw.uomRaw)}`);
      if (raw.amount !== undefined) console.log(`      amount:         ${JSON.stringify(raw.amount)}`);
      if (raw.weightLineValue !== undefined) console.log(`      weightLineValue:${JSON.stringify(raw.weightLineValue)}`);
      if (raw.catchWeightMarker) console.log(`      catchWeightMarker:${JSON.stringify(raw.catchWeightMarker)}`);
    } catch {
      console.log(`    raw_json:       (unparseable)`);
    }
    console.log("");
  }

  // Quick classification helper
  if (dupRows.length === 2) {
    const r1 = dupRows[0], r2 = dupRows[1];
    const sameDesc  = String(r1[7] || "").trim() === String(r2[7] || "").trim();
    const sameQty   = String(r1[8] || "").trim() === String(r2[8] || "").trim();
    const samePrice = String(r1[10] || "").trim() === String(r2[10] || "").trim();
    const sameExt   = String(r1[11] || "").trim() === String(r2[11] || "").trim();
    console.log(`  Classification signal:`);
    console.log(`    same description?    ${sameDesc}`);
    console.log(`    same quantity?       ${sameQty}`);
    console.log(`    same unit_price?     ${samePrice}`);
    console.log(`    same extended_price? ${sameExt}`);
    if (sameDesc && sameQty && samePrice && sameExt) {
      console.log(`  -> TRUE DUPLICATE (all material fields match) - dedup is correct`);
    } else if (!sameDesc) {
      console.log(`  -> DISTINCT MISLABELED (descriptions differ) - re-sequence is correct`);
    } else {
      console.log(`  -> AMBIGUOUS (same desc but different numerics) - lean re-sequence to preserve both`);
    }
  }
  console.log("");
}
