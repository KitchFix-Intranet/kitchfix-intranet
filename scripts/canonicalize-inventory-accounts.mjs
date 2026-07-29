// ════════════════════════════════════════════════════════════════════════════
// Canonicalize inventory Sheets accounts to short form (close the D6 fix)
// ════════════════════════════════════════════════════════════════════════════
//
// The INV-3 backfill canonicalized account values on the PG side (per the
// inv-1 CHECK constraint requiring ^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$),
// but left the Sheets side untouched. 97 Sheets rows across 5 tabs still
// carry the legacy long form (e.g. "STL - MO - St Louis Cardinals"), which
// breaks the storage_locations dual-write because the intranet's Sheets-
// side accountMatch is asymmetric and fails on a short-query + long-row
// combination (confirmed via the recon test write 2026-06-04).
//
// This script updates the account column on the 5 affected tabs using the
// two confirmed mappings:
//   "STL - MO - St Louis Cardinals"  →  "STL - MO"
//   "CIN - OH - Cincinnati Reds"     →  "CIN - OH"
//
// Cron safety: the cron (kitchfix-inventory-cron/index.js) writes only
// canonical short (verified empirically — review_queue is 253/253 short)
// and matches via a symmetric accountMatch (line 47-51) that handles
// either direction. Tonight's cron run cannot re-introduce long-form
// rows and cannot fail to find canonicalized rows.
//
// Scope (97 total rows, audited 2026-06-04):
//   storage_locations  32 (27 STL + 5 CIN)
//   merge_history      58 (47 STL + 11 CIN)
//   count_sessions      5  (4 STL + 1 CIN)
//   item_catalog        1  (1 STL)
//   price_history       1  (1 STL)
//   count_items         (no account col - implicit via session FK)
//
// USAGE
//   Dry-run (default; no writes):
//     node --env-file=.env.local scripts/canonicalize-inventory-accounts.mjs
//
//   Real run (writes Sheets cells):
//     node --env-file=.env.local scripts/canonicalize-inventory-accounts.mjs --dry-run=false
//
//   Both runs end with a re-scan verification ("0 long-form remaining").
//
// SAFETY
//   - Idempotent: re-running after a successful write is a no-op
//     (canonical values don't match the MAPPINGS table).
//   - Only writes col B (idx 1) per row. No other cells touched.
//   - Does not touch the SAM-956 corruption row in vendor_master (that's
//     a separate documented Path-3 artifact, not inventory).
//   - Does not touch invoice_submissions_26 or vendor_accounts (already
//     canonical per audit).
//   - Uses RAW valueInputOption so Sheets doesn't re-interpret the cell.
// ════════════════════════════════════════════════════════════════════════════

import { google } from "googleapis";

// ── Args ──
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=", 2)[1];
  if (args.includes(`--${name}`)) return "true";
  return fallback;
}
const DRY_RUN = getArg("dry-run", "true").toLowerCase() !== "false";

// ── Env / Sheets client ──
const GOOGLE_SA_EMAIL    = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
if (!GOOGLE_SA_EMAIL || !GOOGLE_PRIVATE_KEY) {
  console.error("[canonicalize] FATAL: missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY");
  process.exit(2);
}
const auth = new google.auth.GoogleAuth({
  credentials: { client_email: GOOGLE_SA_EMAIL, private_key: GOOGLE_PRIVATE_KEY },
  // NB: write scope (not read-only). This script is the only one in the
  // repo today that needs write access against the INVENTORY spreadsheet.
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheetsApi = google.sheets({ version: "v4", auth });

// Inventory spreadsheet id. Fail-loud on absent env var - this script
// runs against the operator's Sheets, and a silent fall-through to the
// production id from a laptop with no .env would touch prod data
// unexpectedly (2026-07-29 hardening).
const INVENTORY_SHEET_ID = process.env.SHEET_INVENTORY;
if (!INVENTORY_SHEET_ID) {
  console.error("[canonicalize-inventory-accounts] SHEET_INVENTORY is not set - refusing to fall back to the production id. Set the env var (e.g. via --env-file) and re-run.");
  process.exit(1);
}

// ── Mappings ──
const MAPPINGS = {
  "STL - MO - St Louis Cardinals": "STL - MO",
  "CIN - OH - Cincinnati Reds":    "CIN - OH",
};

// ── Per-tab account column ──
const TARGETS = [
  { tab: "storage_locations", acctIdx: 1 },
  { tab: "item_catalog",      acctIdx: 1 },
  { tab: "count_sessions",    acctIdx: 1 },
  { tab: "price_history",     acctIdx: 1 },
  { tab: "merge_history",     acctIdx: 1 },
];

function colLetter(idx) {
  // 0..25 → A..Z (sufficient for all current inventory tab widths)
  if (idx < 0 || idx > 25) throw new Error(`colLetter: idx ${idx} out of range`);
  return String.fromCharCode(65 + idx);
}

async function readTab(tabName) {
  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: INVENTORY_SHEET_ID, range: tabName,
  });
  const data = res.data.values || [];
  if (data.length === 0) return { headers: [], rows: [] };
  return { headers: data[0], rows: data.slice(1) };
}

// ── Main ──
console.log("════════════════════════════════════════════════════════════════════");
console.log(`  CANONICALIZE INVENTORY ACCOUNTS  ${DRY_RUN ? "(DRY-RUN — NO WRITES)" : "(REAL RUN — WRITES ENABLED)"}`);
console.log("════════════════════════════════════════════════════════════════════");
console.log("Mappings:");
for (const [from, to] of Object.entries(MAPPINGS)) {
  console.log(`  "${from}"  →  "${to}"`);
}
console.log("");

const perTabResults = [];
const grandMappingTotals = {};
for (const from of Object.keys(MAPPINGS)) grandMappingTotals[from] = 0;

for (const target of TARGETS) {
  const { rows } = await readTab(target.tab);
  const planned = [];
  for (let i = 0; i < rows.length; i++) {
    const current = String(rows[i][target.acctIdx] || "").trim();
    const newValue = MAPPINGS[current];
    if (!newValue) continue;
    planned.push({
      sheetsRow:  i + 2,    // +2 = 1-indexed Sheets row, accounting for header
      oldValue:   current,
      newValue,
      cellRange:  `${target.tab}!${colLetter(target.acctIdx)}${i + 2}`,
    });
    grandMappingTotals[current]++;
  }

  console.log(`── ${target.tab.padEnd(22)} ${planned.length} row(s) would update`);
  const sample = planned.slice(0, 5);
  for (const p of sample) {
    console.log(`     row ${String(p.sheetsRow).padStart(4)}  col ${colLetter(target.acctIdx)}  "${p.oldValue}"  →  "${p.newValue}"`);
  }
  if (planned.length > sample.length) {
    console.log(`     ... +${planned.length - sample.length} more`);
  }

  perTabResults.push({ tab: target.tab, planned, totalRows: rows.length });

  if (!DRY_RUN && planned.length > 0) {
    // Single batchUpdate per tab. RAW so Sheets doesn't interpret the
    // string. data[] is the canonical batch-update shape.
    const batch = planned.map((p) => ({
      range:  p.cellRange,
      values: [[p.newValue]],
    }));
    const resp = await sheetsApi.spreadsheets.values.batchUpdate({
      spreadsheetId: INVENTORY_SHEET_ID,
      requestBody: { valueInputOption: "RAW", data: batch },
    });
    const updated = resp.data.totalUpdatedCells ?? 0;
    console.log(`     wrote: ${updated} cell(s)`);
    if (updated !== planned.length) {
      console.error(`     WARN: expected ${planned.length} cells, wrote ${updated}`);
    }
  }
  console.log("");
}

// ── Summary ──
const grandPlanned = perTabResults.reduce((s, r) => s + r.planned.length, 0);
console.log("──────────────────────────────────────────────────────────────────");
console.log("SUMMARY");
console.log("──────────────────────────────────────────────────────────────────");
for (const r of perTabResults) {
  console.log(`  ${r.tab.padEnd(22)} ${r.planned.length.toString().padStart(4)} of ${r.totalRows} rows`);
}
console.log(`  ${"TOTAL".padEnd(22)} ${grandPlanned.toString().padStart(4)} rows`);
console.log("");
console.log("Per-mapping breakdown:");
for (const [from, to] of Object.entries(MAPPINGS)) {
  console.log(`  "${from}"  →  "${to}"   ${grandMappingTotals[from]} rows`);
}

// ── Post-write verification (only meaningful on a real run) ──
if (!DRY_RUN) {
  console.log("");
  console.log("──────────────────────────────────────────────────────────────────");
  console.log("POST-WRITE VERIFICATION");
  console.log("──────────────────────────────────────────────────────────────────");
  let anyResidual = 0;
  for (const target of TARGETS) {
    const { rows } = await readTab(target.tab);
    let stillLong = 0;
    for (const r of rows) {
      const v = String(r[target.acctIdx] || "").trim();
      if (MAPPINGS[v]) stillLong++;
    }
    console.log(`  ${target.tab.padEnd(22)} long-form remaining: ${stillLong}`);
    anyResidual += stillLong;
  }
  console.log(`  TOTAL long-form remaining: ${anyResidual}`);
  if (anyResidual === 0) {
    console.log("");
    console.log("✓ Canonicalization complete. Zero long-form rows remain in the 5 inventory tabs.");
    console.log("  Next: re-run scripts/_recon_test_dual_write.mjs to confirm sub-zone add now");
    console.log("        produces matching sort_order on both Sheets and PG sides.");
  } else {
    console.error("");
    console.error("✗ Residual long-form rows detected. Investigate before declaring the fix complete.");
    process.exit(3);
  }
} else {
  console.log("");
  console.log("(dry-run: no writes performed. Re-run with --dry-run=false to apply.)");
}
