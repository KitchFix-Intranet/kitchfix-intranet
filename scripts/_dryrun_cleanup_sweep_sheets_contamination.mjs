// ════════════════════════════════════════════════════════════════════════════
// DRY-RUN: identify Sheets-side contamination from the aborted sweep run.
//
// CONTEXT
// The aborted sweep at bo68osf5k passed sub.id (PG row UUID) to
// extractAndStoreLineItems, which expects client_uuid. The orchestrator's
// Sheets adapter writes col A = whatever uuid was passed, then the PG
// adapter looks up by client_uuid and throws "submission X not in PG".
// Result: 9 invoices have Sheets line items appended with the WRONG uuid in
// col A. PG side is clean (insert threw before any write).
//
// WHAT THIS SCRIPT DOES
// For each of the 9 known PG IDs:
//   1. Confirms the row in invoice_submissions (gets account_key + client_uuid)
//   2. Reads the per-account Sheets tab
//   3. Finds rows where col A === the PG id
//   4. PRINTS exactly which tab + row + contents would be deleted
//
// DELETES NOTHING. Pure read + print. User reviews + signs off the deletion
// plan, THEN a separate --execute script does the actual delete.
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

// The 9 PG IDs (sub.id values) the aborted sweep wrote to Sheets with
// (extracted verbatim from /private/tmp/.../bo68osf5k.output).
const CONTAMINATION_PG_IDS = [
  "1b7c0799-b42c-4dc6-bc7e-983ad22ef6b9",
  "9714e1ba-e373-4916-8c26-e7272b0f1204",
  "62827688-1e33-4b0a-9f33-11ba7e03a4ad",
  "28897118-5eb3-4bbc-8a97-68bbafcb8691",
  "af62aa76-c87c-4e68-800f-e2d2d578e3a5",
  "beb39c29-2c61-4df3-839c-50152c62a6bd",
  "89bad712-df5c-486f-8ebb-b0ac8f9b5458",
  "a08563df-5801-4f95-80b6-ebdda9a2f057",
  "124558b3-cef9-4b7b-b3c5-af213e3cbe45",
];

console.log("════════════════════════════════════════════════════════════════════");
console.log("  DRY-RUN: Sweep contamination scan");
console.log("  9 known PG IDs from the aborted sweep at task bo68osf5k");
console.log("  DELETES NOTHING - this is a read-only dry-run.");
console.log("════════════════════════════════════════════════════════════════════");
console.log("");

// ── Step 1: Resolve each PG id to its account_key + client_uuid ────────────
console.log("Resolving each PG id to account_key + client_uuid...");
const targets = [];
for (const pgId of CONTAMINATION_PG_IDS) {
  const { data, error } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, account_key, vendor_name, invoice_number, submitted_at")
    .eq("id", pgId)
    .maybeSingle();
  if (error || !data) {
    console.log(`  ${pgId.slice(0,8)}: ABORT - row lookup failed: ${error?.message || "no row"}`);
    continue;
  }
  targets.push({
    pgId: data.id,
    clientUuid: data.client_uuid,
    accountKey: data.account_key,
    vendor: data.vendor_name,
    inv: data.invoice_number,
    submitted: data.submitted_at,
  });
  console.log(`  ${pgId.slice(0,8)}  client_uuid=${data.client_uuid.slice(0,8)}  account=${data.account_key.padEnd(14)}  "${data.vendor_name}"  inv#=${data.invoice_number}`);
}
console.log("");

// ── Step 2: For each unique tab, read it once + find contaminated rows ────
const tabsToCheck = [...new Set(targets.map((t) => t.accountKey))];
console.log(`Tabs to scan: ${tabsToCheck.join(", ")}`);
console.log("");

let totalContaminatedRows = 0;
let totalUuidsConfirmed = 0;
for (const tab of tabsToCheck) {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  TAB: "${tab}"`);
  console.log("════════════════════════════════════════════════════════════════════");

  let allRows;
  try {
    const res = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: AI_LINE_ITEMS_SHEET,
      range: `'${tab}'!A:O`,
    });
    allRows = res.data.values || [];
  } catch (e) {
    console.log(`  Could not read tab: ${e.message}`);
    continue;
  }
  console.log(`  Total rows in tab (incl. header): ${allRows.length}`);

  const tabTargets = targets.filter((t) => t.accountKey === tab);
  for (const target of tabTargets) {
    console.log("");
    console.log(`  ── Looking for PG id ${target.pgId.slice(0,8)} (client_uuid ${target.clientUuid.slice(0,8)}) ──`);

    // 1-indexed sheet row numbers; row 1 = header; row 2 = first data row
    const matchingSheetRows = [];
    for (let i = 1; i < allRows.length; i++) {
      const colA = String(allRows[i][0] || "").trim();
      if (colA === target.pgId) {
        matchingSheetRows.push({ sheetRowNumber: i + 1, contents: allRows[i] });
      }
    }

    // Also check whether the LEGITIMATE client_uuid is in this tab (would be the
    // expected/desired state from earlier successful extraction, OR the pre-fix
    // gap rows from the original failed-write story)
    const matchingClientUuid = [];
    for (let i = 1; i < allRows.length; i++) {
      const colA = String(allRows[i][0] || "").trim();
      if (colA === target.clientUuid) {
        matchingClientUuid.push({ sheetRowNumber: i + 1, contents: allRows[i] });
      }
    }

    console.log(`    Sheets rows with WRONG uuid (the PG id) = ${matchingSheetRows.length}`);
    console.log(`    Sheets rows with RIGHT uuid (client_uuid) = ${matchingClientUuid.length} (informational; leave alone)`);

    if (matchingSheetRows.length === 0) {
      console.log(`    ⚠ NOTE: 0 contaminated rows found for this PG id. Either the sweep didn't reach Sheets-write before the PG throw, or there's a mismatch.`);
      continue;
    }
    totalUuidsConfirmed++;
    totalContaminatedRows += matchingSheetRows.length;

    console.log(`    DRY-RUN: would delete the following ${matchingSheetRows.length} rows:`);
    for (const m of matchingSheetRows) {
      // Print the full row content for review
      // Cols: 0 Invoice UUID, 1 Timestamp, 2 Account, 3 Vendor, 4 Invoice #,
      //       5 Invoice Date, 6 Line #, 7 Item Description, 8 Qty, 9 Unit,
      //       10 Unit Price, 11 Extended Price, 12 Category, 13 Confidence, 14 Raw JSON
      const r = m.contents;
      console.log(`      row ${m.sheetRowNumber}: uuid=${(r[0]||"").slice(0,8)}.. ts=${(r[1]||"").slice(0,16)} vendor="${(r[3]||"").slice(0,20)}" inv#=${(r[4]||"").slice(0,12)} line=${r[6]||"?"} desc="${(r[7]||"").slice(0,40)}" qty=${r[8]||"?"} $${r[10]||"?"}`);
    }
  }
  console.log("");
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log("════════════════════════════════════════════════════════════════════");
console.log("  DRY-RUN SUMMARY");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`  PG IDs targeted:            ${CONTAMINATION_PG_IDS.length}`);
console.log(`  Targets resolved in PG:     ${targets.length}`);
console.log(`  PG IDs with rows in Sheets: ${totalUuidsConfirmed}`);
console.log(`  Total contaminated rows:    ${totalContaminatedRows}`);
console.log("");
console.log("If this looks right, an execute-mode script will perform deletion");
console.log("targeting EXACTLY these (tab, row, expected col A) tuples. Until then,");
console.log("no rows have been touched.");
