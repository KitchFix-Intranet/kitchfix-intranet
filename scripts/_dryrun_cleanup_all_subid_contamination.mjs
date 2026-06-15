// ════════════════════════════════════════════════════════════════════════════
// DRY-RUN: full cleanup plan for the sub.id-vs-client_uuid contamination
// bug, covering BOTH:
//   - The aborted sweep at task bo68osf5k (9 PG IDs)
//   - Earlier _rescan_silent_gap.mjs --execute runs (3 PG IDs)
//
// Total: 12 PG IDs to clean. Per the orphan probe: 81 rows expected.
//
// DELETES NOTHING. Prints exactly what an --execute script would delete.
// Same shape as the sweep-only dry-run, just broader scope.
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

// SOURCE 1: aborted sweep at task bo68osf5k (9 PG IDs)
const SWEEP_PG_IDS = [
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

// SOURCE 2: earlier _rescan_silent_gap.mjs --execute runs (3 PG IDs found by orphan probe)
const CANARY_PG_IDS = [
  "52cfe1be-1f7c-4a3b-b242-64a352946dcd",
  "8e78f4d9-8870-4a21-b9ae-5262b7f6cd5c",
  "c7f59548-995e-4757-905b-7501858eedff",
];

const TARGETS = [
  ...SWEEP_PG_IDS.map((pgId) => ({ pgId, source: "sweep" })),
  ...CANARY_PG_IDS.map((pgId) => ({ pgId, source: "canary" })),
];

console.log("════════════════════════════════════════════════════════════════════");
console.log("  UNIFIED DRY-RUN: all sub.id-vs-client_uuid contamination");
console.log(`  ${SWEEP_PG_IDS.length} from aborted sweep + ${CANARY_PG_IDS.length} from earlier canary runs`);
console.log("  DELETES NOTHING - this is a read-only dry-run.");
console.log("════════════════════════════════════════════════════════════════════");
console.log("");

// ── Step 1: Resolve each PG id ────────────────────────────────────────────
console.log("Resolving each PG id to account_key + client_uuid + invoice metadata...");
const resolved = [];
for (const target of TARGETS) {
  const { data, error } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, account_key, vendor_name, invoice_number, submitted_at, ai_scan_status")
    .eq("id", target.pgId)
    .maybeSingle();
  if (error || !data) {
    console.log(`  ${target.pgId.slice(0,8)} (${target.source}): ABORT - row lookup failed`);
    continue;
  }
  resolved.push({
    ...target,
    clientUuid: data.client_uuid,
    accountKey: data.account_key,
    vendor: data.vendor_name,
    inv: data.invoice_number,
    submitted: data.submitted_at,
    aiScanStatus: data.ai_scan_status,
  });
  console.log(`  ${target.pgId.slice(0,8)} [${target.source.padEnd(6)}]  client_uuid=${data.client_uuid.slice(0,8)}  account=${data.account_key.padEnd(14)}  "${data.vendor_name}"  inv#=${data.invoice_number}  ai_scan_status=${data.ai_scan_status || "(null)"}`);
}
console.log("");

const tabsToCheck = [...new Set(resolved.map((t) => t.accountKey))];
console.log(`Tabs to scan: ${tabsToCheck.join(", ")}`);
console.log("");

// ── Step 2: Per-tab scan ──────────────────────────────────────────────────
const allDeletions = []; // collected (tab, rowNumber, pgId, source) tuples
let summaryByTab = new Map();

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

  const tabTargets = resolved.filter((t) => t.accountKey === tab);
  for (const target of tabTargets) {
    console.log("");
    console.log(`  ── PG id ${target.pgId.slice(0,8)} [${target.source}] (client_uuid ${target.clientUuid.slice(0,8)} "${target.vendor}") ──`);

    const matchingWrongUuid = [];
    const matchingRightUuid = [];
    for (let i = 1; i < allRows.length; i++) {
      const colA = String(allRows[i][0] || "").trim();
      if (colA === target.pgId) matchingWrongUuid.push({ sheetRowNumber: i + 1, contents: allRows[i] });
      if (colA === target.clientUuid) matchingRightUuid.push({ sheetRowNumber: i + 1, contents: allRows[i] });
    }

    console.log(`    Sheets rows with WRONG uuid (PG id):       ${matchingWrongUuid.length}`);
    console.log(`    Sheets rows with RIGHT uuid (client_uuid): ${matchingRightUuid.length} (informational; LEAVE ALONE)`);

    if (matchingWrongUuid.length === 0) {
      console.log(`    ⚠ NOTE: 0 contaminated rows for this PG id - no cleanup needed.`);
      continue;
    }

    const summary = summaryByTab.get(tab) || { sweep: 0, canary: 0, rows: 0 };
    summary[target.source] += matchingWrongUuid.length;
    summary.rows += matchingWrongUuid.length;
    summaryByTab.set(tab, summary);

    console.log(`    DRY-RUN: would delete the following ${matchingWrongUuid.length} rows:`);
    for (const m of matchingWrongUuid) {
      const r = m.contents;
      allDeletions.push({ tab, sheetRowNumber: m.sheetRowNumber, pgId: target.pgId, source: target.source });
      // Cols: 0 UUID 1 ts 2 acct 3 vendor 4 inv# 5 inv date 6 line# 7 desc 8 qty 9 unit 10 unitPx 11 ext 12 cat 13 conf 14 raw
      console.log(`      row ${String(m.sheetRowNumber).padStart(4)}: uuid=${(r[0]||"").slice(0,8)}.. ts=${(r[1]||"").slice(0,16)} vendor="${(r[3]||"").slice(0,18)}" inv#=${(r[4]||"").slice(0,12)} line=${r[6]||"?"} desc="${(r[7]||"").slice(0,40)}" qty=${r[8]||"?"} $${r[10]||"?"}`);
    }
  }
  console.log("");
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log("════════════════════════════════════════════════════════════════════");
console.log("  UNIFIED DRY-RUN SUMMARY");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`  Total target PG IDs:      ${TARGETS.length}`);
console.log(`  Resolved against PG:      ${resolved.length}`);
console.log(`  Total rows to delete:     ${allDeletions.length}`);
console.log("");
console.log("  By tab:");
for (const [tab, summary] of [...summaryByTab.entries()].sort()) {
  console.log(`    ${tab.padEnd(16)}  sweep=${summary.sweep}  canary=${summary.canary}  total=${summary.rows}`);
}
console.log("");
console.log("  By source:");
const bySrc = new Map();
for (const d of allDeletions) bySrc.set(d.source, (bySrc.get(d.source) || 0) + 1);
for (const [src, c] of bySrc.entries()) console.log(`    ${src.padEnd(8)} ${c}`);
console.log("");
console.log("Deletion plan saved to script-internal allDeletions[] - execute-mode script will");
console.log("operate on EXACTLY this list (tab, row number, expected col A = PG id).");
console.log("No rows have been touched.");
