// ════════════════════════════════════════════════════════════════════════════
// READ-ONLY: detect ANY orphan uuid in the AI_LINE_ITEMS per-account tabs.
//
// An "orphan" is a col-A value that does NOT match a real
// invoice_submissions.client_uuid. Used to detect:
//   - Contamination from the aborted sweep (the 9 known PG IDs)
//   - Contamination from earlier _rescan_silent_gap.mjs runs that may have
//     hit the same bug (it also passes sub.id to extractAndStoreLineItems)
//   - Other historical anomalies (e.g., REBUILD-* synthetic IDs, deleted
//     invoice rows whose Sheets line items linger)
//
// Output classifies each orphan group by likely origin so it's easy to tell
// the deliberate ones (REBUILD-*, historical) from the contamination ones
// (UUID-shaped values that look like PG row ids).
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

const PAGE = 1000;

// The 9 known PG IDs from the aborted sweep (so we can tag those distinctly)
const SWEEP_CONTAMINATION_PG_IDS = new Set([
  "1b7c0799-b42c-4dc6-bc7e-983ad22ef6b9",
  "9714e1ba-e373-4916-8c26-e7272b0f1204",
  "62827688-1e33-4b0a-9f33-11ba7e03a4ad",
  "28897118-5eb3-4bbc-8a97-68bbafcb8691",
  "af62aa76-c87c-4e68-800f-e2d2d578e3a5",
  "beb39c29-2c61-4df3-839c-50152c62a6bd",
  "89bad712-df5c-486f-8ebb-b0ac8f9b5458",
  "a08563df-5801-4f95-80b6-ebdda9a2f057",
  "124558b3-cef9-4b7b-b3c5-af213e3cbe45",
]);

// ── Step 1: Build the set of legitimate client_uuids ──────────────────────
console.log("Loading invoice_submissions.client_uuid set + .id set (live + historical)...");
const legitClientUuids = new Set();
const allPgIds = new Set();
const pgIdToRow = new Map();
for (let off = 0; ; off += PAGE) {
  const { data, error } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, account_key, vendor_name, is_historical")
    .range(off, off + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) break;
  for (const r of data) {
    if (r.client_uuid) legitClientUuids.add(r.client_uuid);
    if (r.id) {
      allPgIds.add(r.id);
      pgIdToRow.set(r.id, r);
    }
  }
  if (data.length < PAGE) break;
}
console.log(`  legitimate client_uuids: ${legitClientUuids.size}`);
console.log(`  PG row ids (id field):   ${allPgIds.size}`);
console.log("");

// ── Step 2: Scan every per-account tab ─────────────────────────────────────
async function listTabs() {
  const res = await sheetsApi.spreadsheets.get({
    spreadsheetId: AI_LINE_ITEMS_SHEET,
    fields: "sheets.properties.title",
  });
  return (res.data.sheets || []).map((s) => s.properties.title);
}
const tabs = await listTabs();
console.log(`Scanning ${tabs.length} tabs...`);
console.log("");

const orphansByTab = new Map(); // tab -> Map(orphanUuid -> { rowNumbers, sampleRow })
for (const tab of tabs) {
  let rows;
  try {
    const res = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: AI_LINE_ITEMS_SHEET,
      range: `'${tab}'!A:O`,
    });
    rows = res.data.values || [];
  } catch (e) {
    console.log(`  tab "${tab}" read failed: ${e.message}`);
    continue;
  }

  const tabOrphans = new Map();
  for (let i = 1; i < rows.length; i++) {
    const colA = String(rows[i][0] || "").trim();
    if (!colA) continue;
    if (legitClientUuids.has(colA)) continue;
    // Orphan
    if (!tabOrphans.has(colA)) tabOrphans.set(colA, { rowNumbers: [], sampleRow: rows[i] });
    tabOrphans.get(colA).rowNumbers.push(i + 1);
  }
  orphansByTab.set(tab, tabOrphans);
}

// ── Step 3: Classify each orphan group ─────────────────────────────────────
function classify(orphanUuid) {
  if (SWEEP_CONTAMINATION_PG_IDS.has(orphanUuid)) return "SWEEP_CONTAMINATION (aborted run, known)";
  if (allPgIds.has(orphanUuid)) return "OTHER_PG_ID (sub.id passed instead of client_uuid - possible earlier canary run)";
  if (orphanUuid.startsWith("REBUILD-")) return "REBUILD_SYNTHETIC (historical, intentional)";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orphanUuid)) return "UNKNOWN_UUID_SHAPE (uuid not in invoice_submissions - check)";
  return "NON_UUID_SHAPE";
}

// ── Report ────────────────────────────────────────────────────────────────
console.log("════════════════════════════════════════════════════════════════════");
console.log("  ORPHAN UUIDs PER TAB (col A values not in legit client_uuids)");
console.log("════════════════════════════════════════════════════════════════════");

let totalOrphanUuids = 0;
let totalOrphanRows = 0;
const classCounts = new Map();
const otherPgIds = [];

for (const [tab, orphans] of orphansByTab.entries()) {
  if (orphans.size === 0) continue;
  console.log("");
  console.log(`  TAB "${tab}" - ${orphans.size} distinct orphan uuid(s)`);

  // Sort by class for readability
  const sorted = [...orphans.entries()].sort((a, b) => b[1].rowNumbers.length - a[1].rowNumbers.length);
  for (const [uuid, info] of sorted) {
    const cls = classify(uuid);
    classCounts.set(cls, (classCounts.get(cls) || 0) + info.rowNumbers.length);
    totalOrphanUuids++;
    totalOrphanRows += info.rowNumbers.length;
    if (cls.startsWith("OTHER_PG_ID")) otherPgIds.push({ uuid, tab, count: info.rowNumbers.length });
    const cleanUuid = uuid.slice(0, 8) + (uuid.length > 8 ? ".." : "");
    console.log(`    ${cleanUuid.padEnd(12)}  rows=${String(info.rowNumbers.length).padStart(3)}  [${cls}]`);
  }
}

console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  SUMMARY");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`  Total orphan uuids across all tabs: ${totalOrphanUuids}`);
console.log(`  Total orphan ROWS across all tabs:  ${totalOrphanRows}`);
console.log("");
console.log("  By class:");
for (const [c, count] of [...classCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${c.padEnd(60)} rows=${count}`);
}

if (otherPgIds.length > 0) {
  console.log("");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  OTHER PG IDs found in Sheets (NOT from the aborted sweep)");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  These are PG row ids (sub.id) in Sheets col A, NOT in our");
  console.log("  known sweep contamination list. Most likely from earlier");
  console.log("  _rescan_silent_gap.mjs --execute runs that hit the same bug.");
  console.log("");
  for (const { uuid, tab, count } of otherPgIds) {
    const submission = pgIdToRow.get(uuid);
    console.log(`  ${uuid}  tab="${tab}"  rows=${count}`);
    if (submission) {
      console.log(`    -> invoice_submissions.client_uuid=${submission.client_uuid}  account=${submission.account_key}  vendor="${submission.vendor_name}"  is_historical=${submission.is_historical}`);
    }
  }
}
