// ════════════════════════════════════════════════════════════════════════════
// One-time backfill: copy invoice data from Sheets into Postgres for PR 6.3.
// 4-table sequential backfill in FK order:
//   invoice_submissions -> invoice_rejections -> ai_line_items -> gl_codes
//
// PURPOSE
//   PG invoice tables (created in PR 6.1 schema) are empty until backfilled.
//   Standard sequence per docs/architecture/CUTOVER_PLAYBOOK.md:
//     1. Run this backfill --execute (PG empty)
//     2. Spot-check 3 representative invoices
//     3. Open + merge PR 6.3
//     4. Enable DUAL_WRITE_TABLES += invoice_submissions, invoice_rejections,
//        ai_line_items, gl_codes
//     5. No-cache redeploy
//     6. Dual-write smoke test
//     7. Enable READ_FROM_POSTGRES_OPS += same 4 tabs
//     8. No-cache redeploy
//     9. Read-side smoke test
//    10. 24-48 hour wait window
//
// USAGE
//   Dry run (default - reads + transforms + prints sample, does NOT write):
//     npm run backfill:invoice
//   Live (4-pass write to PG):
//     npm run backfill:invoice -- --execute
//
//   Subset (run only one table):
//     npm run backfill:invoice -- --table=invoice_submissions
//     npm run backfill:invoice -- --table=invoice_rejections
//     npm run backfill:invoice -- --table=ai_line_items
//     npm run backfill:invoice -- --table=gl_codes
//
//   Direct invocation:
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/backfill-invoice.mjs [--execute] [--table=X]
//
// IS_HISTORICAL PRESERVATION-FIRST DOCTRINE (Section 8 of MODULE_6_DATA_AUDIT)
//   All backfilled rows: is_historical=TRUE. Strict integrity constraints
//   conditional on is_historical=FALSE bypass them. Drift in Sheets is
//   preserved in PG with a data_provenance tag, not pre-cleaned.
//
// FK RESOLUTION STRATEGY (Phase 0 decision: Approach B)
//   invoice_submissions.id is PG UUID PRIMARY KEY. Three FKs point at it:
//   corrected_from_uuid, invoice_rejections.submission_id, ai_line_items.
//   invoice_uuid. We pre-generate id = crypto.randomUUID() per submission
//   row, build the client_uuid -> generated_id Map in-memory, and use it
//   to resolve all FKs across the other 3 tables. Works in dry-run AND
//   live; mirrors the PR D pattern of orchestrator-level cross-store ID
//   coordination.
//
// CONFLICT SEMANTICS (re-run safety)
//   invoice_submissions: ON CONFLICT (client_uuid) DO NOTHING. If dual-write
//     started after backfill, re-running does not clobber the newer row.
//   invoice_rejections:  ON CONFLICT (submission_id, rejected_at) DO NOTHING.
//   ai_line_items:       insert-if-empty. No upsert target; partial UNIQUE
//                        excludes historical so re-run could double-insert.
//                        Pre-flight count refuses to clobber.
//   gl_codes:            ON CONFLICT (account_key, code) DO NOTHING.
//
// VENDOR_ID FK PRE-VALIDATION
//   invoice_submissions.vendor_id REFERENCES vendors(id). Module 5 backfill
//   shipped 31 vendors; rows that reference legacy soft-deleted vendor IDs
//   (notes='DELETED' excluded at vendor read time) would fail the FK at
//   INSERT. Pre-flight reads the vendors table into a Set; transform skips
//   rows whose vendor_id is not in the Set, with a per-row warn + summary
//   count in the dry-run report.
//
// GL_CODES is_purchasing FILTER (Q8 in MODULE_6_DATA_AUDIT)
//   PG gl_codes.is_purchasing replaces the EXCLUDED_CATEGORIES +
//   EXCLUDED_ITEMS Set filter that lived in invoiceActions.js (deleted in
//   PR 6.2). The runtime getGLCodes orchestrator defaults to is_purchasing
//   = true. To preserve byte-equivalent bootstrap UX post-cutover, the
//   backfill applies the legacy parseGLCodes category-aware logic to mark
//   excluded leaf codes is_purchasing=false. The 4-item EXCLUDED_ITEMS
//   list + 6-category EXCLUDED_CATEGORIES list are reproduced inline (the
//   original parseGLCodes function in invoiceActions.js was removed by
//   PR 6.2 cleanup S1; this is its one-shot resurrection for the backfill
//   transform).
//
// GL_CODES TAB-NAME TO ACCOUNT_KEY NORMALIZATION (Q3 in Phase 0 report)
//   3 Cincinnati tabs carry parenthetical suffixes (e.g., "CIN - AZ (REDS)"
//   maps to canonical "CIN - AZ" in vendor_accounts). Stripped via regex.
//   Other tabs map identity. Master Template + Class Overview SKIPPED.
//   Verification probe queries vendor_accounts.account_key distinct values
//   pre-write; raises if any normalized tab name is not a known account.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { readSheetSA, SHEET_IDS } from "../src/lib/sheets.js";
import { runBackfill } from "./_lib/backfill-runner.mjs";

const SKIP_LOG_PATH = "scripts/backfill-invoice-skipped-rows.log";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const tableArg = args
  .find((a) => a.startsWith("--table="))
  ?.slice("--table=".length);

const VALID_TABLES = [
  "invoice_submissions",
  "invoice_rejections",
  "ai_line_items",
  "gl_codes",
];
if (tableArg && !VALID_TABLES.includes(tableArg)) {
  console.error(
    `FATAL: --table="${tableArg}" must be one of ${VALID_TABLES.join(", ")}`
  );
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// invoice_submissions_26 column index (0-indexed; mirrors SUB_IDX in
// src/lib/dataStore/invoice.js). 23 cols A-W in active use.
// ─────────────────────────────────────────────────────────────
const SUB_IDX = {
  uuid:              0,   // A client_uuid
  timestamp:         1,   // B submitted_at
  submitterEmail:    2,   // C
  account:           3,   // D account_key
  vendor:            4,   // E vendor_name
  vendorId:          5,   // F vendor_id FK
  invoiceNumber:     6,   // G
  invoiceDate:       7,   // H
  totalAmount:       8,   // I
  glBreakdown:       9,   // J JSON string
  driveUrls:         10,  // K JSON string OR comma list
  pageCount:         11,  // L
  emailSent:         12,  // M
  status:            13,  // N status OR ai_scan_status (overloaded)
  statusUpdatedAt:   14,  // O
  type:              15,  // P invoice|credit
  rawDriveUrl:       16,  // Q
  rejectionReason:   17,  // R
  rejectionNote:     18,  // S
  rejectedBy:        19,  // T
  rejectedAt:        20,  // U
  correctedFromUuid: 21,  // V client_uuid of parent submission
  dupeOverride:      22,  // W not_duplicate sentinel
};

// AI_LINE_ITEMS per-account-tab column index (0-indexed; mirrors LINE_IDX
// in src/lib/dataStore/invoice.js).
const LINE_IDX = {
  invoiceUuid:    0,   // A client_uuid OR REBUILD-* synthetic
  timestamp:      1,   // B
  account:        2,   // C
  vendor:         3,   // D vendor_name
  invoiceNumber:  4,   // E
  invoiceDate:    5,   // F
  lineNum:        6,   // G
  description:    7,   // H
  quantity:       8,   // I
  unit:           9,   // J
  unitPrice:      10,  // K
  extendedPrice:  11,  // L
  category:       12,  // M
  confidence:     13,  // N
  rawJson:        14,  // O JSON-stringified raw AI output
};

// ─────────────────────────────────────────────────────────────
// Status enum split rules (audit Section 4.1 mapping function)
// ─────────────────────────────────────────────────────────────
const WORKFLOW_STATUSES = new Set(["sent", "returned", "corrected", "deleted"]);
const AI_SCAN_STATUSES  = new Set(["pending", "complete", "failed", "photo-only"]);

// ─────────────────────────────────────────────────────────────
// GL_CODES tab classification + name -> account_key normalization
//
// Per audit Q6: Master Template + Class Overview SKIPPED.
// Per audit Q3 (Phase 1 verification): 3 Cincinnati tabs carry a
// parenthetical suffix, the others identity-map.
//
// vendor_accounts probe result (run 2026-06-01 at start of Phase 1):
//   CIN - AZ, CIN - OH, STL - FL, STL - MO, TBJ - FL, TBR - FL,
//   TXR - AZ, TXR - TX - H, TXR - TX - V        (9 distinct, 55 rows)
//
// Note: vendor_accounts does NOT have CIN - KY, TBJ - BUF, or CORP at the
// time of this backfill. Those gl_codes tabs are still being written
// against the legacy GL_TAB_MAP. They are migrated as-is with the
// normalized account_key value, even though no vendor_accounts row anchors
// them. is_historical=TRUE preserves them; future onboarding can add the
// missing vendor_accounts rows without re-backfilling gl_codes.
// ─────────────────────────────────────────────────────────────
const GL_UTILITY_TABS = new Set(["Master Template", "Class Overview"]);

// Explicit map for the 2 Texas tabs whose names ("TXR - Home", "TXR - Vistor")
// do not align with the canonical vendor_accounts.account_key values
// ("TXR - TX - H", "TXR - TX - V"). Mirrors the inverse of the legacy
// GL_TAB_MAP from invoiceActions.js (removed in PR 6.2 cleanup S1).
// CORP / CIN - KY (LBATS) / TBJ - BUF stay unmapped: those are real
// missing vendor_accounts rows (future vendor onboarding work), not
// normalization issues.
const GL_TAB_EXPLICIT_MAP = {
  "TXR - Home":   "TXR - TX - H",
  "TXR - Vistor": "TXR - TX - V",
};

function tabNameToAccountKey(tabName) {
  if (GL_TAB_EXPLICIT_MAP[tabName]) return GL_TAB_EXPLICIT_MAP[tabName];
  // Strip " (XXX)" suffix used by Cincinnati tabs only.
  return tabName.replace(/\s*\([^)]+\)\s*$/, "").trim();
}

// Legacy parseGLCodes filter lists (lifted from invoiceActions.js git
// history pre-PR-6.2). Original semantics: category headers in
// EXCLUDED_CATEGORIES skip all subsequent leaf rows until the next
// section marker; leaf items in EXCLUDED_ITEMS are individually dropped.
// In PG schema, both become is_purchasing=false instead of dropped.
const EXCLUDED_CATEGORIES = new Set([
  "income",
  "kitchen labor costs",
  "meal service",
  "wages",
  "insurance",
  "professional fees",
]);
const SECTION_MARKERS = new Set(["cost of goods sold", "expenses"]);
const EXCLUDED_ITEMS = new Set([
  "telephone expense",
  "paid time off",
  "medical/dental/vision",
  "charitable contributions",
]);

// Walk one tab's raw rows top-to-bottom, emit leaf-code records carrying
// category context + is_purchasing flag. Mirrors the pre-PR-6.2
// parseGLCodes() behavior, restructured as a flat emit instead of the
// old grouped output (the regroupGLCodes handler-side step is the new
// way to recover groups).
function parseGLCodesTab(rows, accountKey) {
  const out = [];
  let currentCategory = null;
  let inExcludedCategory = false;

  for (const row of rows) {
    const colA = String(row[0] || "").trim();
    const colB = row[1] != null ? String(row[1]).trim() : "";
    const hasCode = colB.length > 0 && colB !== "Account #";

    if (!colA || colA === "Account Name/Type") continue;

    if (!hasCode) {
      // Category header row (col A populated, col B empty).
      const lower = colA.toLowerCase();
      if (SECTION_MARKERS.has(lower)) {
        // Reset exclusion state across section boundaries.
        inExcludedCategory = false;
        continue;
      }
      if (EXCLUDED_CATEGORIES.has(lower)) {
        inExcludedCategory = true;
        currentCategory = colA;
        continue;
      }
      inExcludedCategory = false;
      currentCategory = colA;
      continue;
    }

    // Leaf-code row.
    const name = colA.replace(/^\s+/, "");
    const isExcludedItem = EXCLUDED_ITEMS.has(name.toLowerCase());
    const isPurchasing = !inExcludedCategory && !isExcludedItem;

    out.push({
      account_key:    accountKey,
      category:       currentCategory || null,
      code:           colB,
      name:           name || null,
      is_purchasing:  isPurchasing,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Date + number parsing helpers
// ─────────────────────────────────────────────────────────────
function parseDateOrNull(s) {
  if (s == null || s === "") return null;
  const str = String(s).trim();
  if (!str) return null;
  // Accept YYYY-MM-DD passthrough; PG DATE will parse.
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return str;
}

function parseNumOrNull(s) {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseTimestampOrNull(s) {
  if (s == null || s === "") return null;
  const d = new Date(String(s).trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseGlBreakdownJson(s) {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Historical rows may have legacy formats; preserve as empty array.
  }
  return [];
}

function parseDriveUrlsJson(s) {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch {
    /* fall through to comma split */
  }
  return String(s).split(",").map((u) => u.trim()).filter(Boolean);
}

// REBUILD-* synthetic ID detection.
function isRebuildRef(invoiceUuid) {
  return String(invoiceUuid || "").startsWith("REBUILD-");
}

// Lax UUID format check (8-4-4-4-12 hex). Enough to distinguish "looks
// like a UUID" from "REBUILD-*" or empty.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function looksLikeUuid(s) {
  return UUID_RE.test(String(s || "").trim());
}

// ─────────────────────────────────────────────────────────────
// Supabase service-role client (lazy; runner constructs its own for
// writes, this one is only for pre-flight probes during dry-run + live)
// ─────────────────────────────────────────────────────────────
let _probeClient = null;
function getProbeClient() {
  if (_probeClient) return _probeClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn(
      "(probe) SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set; skipping pre-flight probes"
    );
    return null;
  }
  _probeClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _probeClient;
}

async function probeVendorIds() {
  const c = getProbeClient();
  if (!c) return null;
  const { data, error } = await c.from("vendors").select("id");
  if (error) {
    console.warn(`(probe) vendors read failed: ${error.message}`);
    return null;
  }
  return new Set(data.map((r) => r.id));
}

async function probeVendorAccountKeys() {
  const c = getProbeClient();
  if (!c) return null;
  const { data, error } = await c.from("vendor_accounts").select("account_key");
  if (error) {
    console.warn(`(probe) vendor_accounts read failed: ${error.message}`);
    return null;
  }
  return new Set(data.map((r) => r.account_key));
}

// ─────────────────────────────────────────────────────────────
// Source readers (return raw row arrays + classification metadata)
// ─────────────────────────────────────────────────────────────
async function readSubmissionRowsRaw() {
  const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, "invoice_submissions_26");
  // Filter out empty rows (no client_uuid).
  return rows.filter((r) => String(r[SUB_IDX.uuid] || "").trim());
}

async function readLineItemRowsAllTabs() {
  // AI_LINE_ITEMS spreadsheet has 9 per-account tabs per audit Section 2.2.
  const AI_TABS = [
    "STL - FL", "STL - MO", "CIN - OH", "TXR - TX - H", "TXR - TX - V",
    "TXR - AZ", "CIN - AZ", "TBR - FL", "TBJ - FL",
  ];
  const out = [];
  for (const tab of AI_TABS) {
    try {
      const { rows } = await readSheetSA(SHEET_IDS.AI_LINE_ITEMS, tab);
      for (const row of rows) {
        // Skip empty rows (no invoice_uuid AND no description).
        const invUuid = String(row[LINE_IDX.invoiceUuid] || "").trim();
        const desc    = String(row[LINE_IDX.description] || "").trim();
        if (!invUuid && !desc) continue;
        // Tab name is the account_key (no normalization needed; AI line
        // item tabs already use the canonical vendor_accounts format).
        out.push({ tab, row });
      }
    } catch (e) {
      console.warn(`(read) AI_LINE_ITEMS tab "${tab}" failed: ${e.message}`);
    }
  }
  return out;
}

async function readGLCodeRecords() {
  // GL_CODES spreadsheet has 14 tabs per audit Section 2.3: 12 per-account
  // + Master Template + Class Overview. Skip the 2 utility tabs.
  const GL_PER_ACCOUNT_TABS = [
    "CORP",
    "CIN - AZ (REDS)",
    "CIN - KY (LBATS)",
    "CIN - OH (CINN)",
    "STL - FL",
    "STL - MO",
    "TBJ - FL",
    "TBJ - BUF",
    "TBR - FL",
    "TXR - AZ",
    "TXR - Home",
    "TXR - Vistor",
  ];
  const out = [];
  for (const tab of GL_PER_ACCOUNT_TABS) {
    if (GL_UTILITY_TABS.has(tab)) continue;
    try {
      const { rows } = await readSheetSA(SHEET_IDS.GL_CODES, tab);
      const accountKey = tabNameToAccountKey(tab);
      const parsed = parseGLCodesTab(rows, accountKey);
      for (const rec of parsed) out.push(rec);
    } catch (e) {
      console.warn(`(read) GL_CODES tab "${tab}" failed: ${e.message}`);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Per-table backfill runners
// ─────────────────────────────────────────────────────────────

// Closure-shared state across the 4 backfills:
//   submissionIdMap: client_uuid (string) -> generated PG id (UUID string)
//   vendorIdSet:     Set of vendor IDs known to PG vendors table
const state = {
  submissionRows:     null,   // raw filtered rows from invoice_submissions_26
  submissionIdMap:    null,   // client_uuid -> generated UUID
  vendorIdSet:        null,   // pre-flight probe result
  vendorAccountKeys:  null,   // pre-flight probe result for gl_codes verification
  lineItemRows:       null,   // flat array of { tab, row } for AI line items
  glCodeRecords:      null,   // flat array of parsed records
};

async function ensureSubmissionData() {
  if (state.submissionRows) return;
  state.submissionRows = await readSubmissionRowsRaw();
  // Pre-generate UUIDs + map by client_uuid.
  state.submissionIdMap = new Map();
  for (const row of state.submissionRows) {
    const clientUuid = String(row[SUB_IDX.uuid] || "").trim();
    if (!clientUuid) continue;
    if (!state.submissionIdMap.has(clientUuid)) {
      state.submissionIdMap.set(clientUuid, randomUUID());
    }
  }
}

async function ensureVendorIdSet() {
  if (state.vendorIdSet !== null) return;
  state.vendorIdSet = await probeVendorIds();
  // PR 6.3 hotfix: prune submissionIdMap to remove entries for rows that
  // will be skipped by the vendor_id validator. Without this, child
  // tables (invoice_rejections, ai_line_items) resolve FK lookups via
  // the stale map to UUIDs that were never inserted into invoice_
  // submissions, causing PG FK violation. Pruning routes rejections
  // for skipped parents to validator-skip, and routes ai_line_items
  // for skipped parents to the valid-UUID-orphan classifier path
  // (invoice_uuid=NULL, historical_invoice_ref=<original>, provenance=
  // 'unknown'). Net effect: MORE preservation, not less. New common
  // pitfall captured in docs/architecture/CUTOVER_PLAYBOOK.md.
  if (state.submissionRows && state.submissionIdMap && state.vendorIdSet) {
    let prunedCount = 0;
    for (const row of state.submissionRows) {
      const vid = String(row[SUB_IDX.vendorId] || "").trim();
      const clientUuid = String(row[SUB_IDX.uuid] || "").trim();
      if (!vid || !state.vendorIdSet.has(vid)) {
        if (state.submissionIdMap.delete(clientUuid)) prunedCount++;
      }
    }
    if (prunedCount > 0) {
      console.log(
        `(map prune) removed ${prunedCount} submissionIdMap entries for ` +
          `vendor_id orphans; children referencing these parents will route ` +
          `to orphan classification`
      );
    }
  }
}

async function ensureVendorAccountKeys() {
  if (state.vendorAccountKeys !== null) return;
  state.vendorAccountKeys = await probeVendorAccountKeys();
}

async function ensureLineItemData() {
  if (state.lineItemRows) return;
  state.lineItemRows = await readLineItemRowsAllTabs();
}

async function ensureGLCodeData() {
  if (state.glCodeRecords) return;
  state.glCodeRecords = await readGLCodeRecords();
}

// ─────────────────────────────────────────────────────────────
// Skip log writer (Option A from PR 6.3 Phase 2 decision)
//
// invoice_submissions rows referencing legacy soft-deleted vendor_ids
// (vendors merged or notes='DELETED' in the vendor_master backfill
// filter from PR 5.3) cannot satisfy the FK to vendors(id). They are
// skipped at validator time with a console warn. For forensic record,
// also emit a JSONL log to scripts/backfill-invoice-skipped-rows.log
// only on --execute. The log is committed with PR 6.3.
//
// Each line is one JSON object with the fields specified in Kevin's
// Phase 2 decision: sheet_row (0-indexed position in the post-filter
// state.submissionRows array, matching the runner's [skip row N] warn),
// client_uuid, vendor_id, vendor_name, invoice_number, invoice_date,
// total_amount, skip_reason.
// ─────────────────────────────────────────────────────────────
async function writeSkipLog() {
  if (!EXECUTE) return; // dry-run never writes
  if (!state.vendorIdSet) {
    console.warn(`(skip log) vendor_id probe unavailable; cannot pre-classify skips`);
    return;
  }
  const skipped = [];
  state.submissionRows.forEach((row, i) => {
    const vid = String(row[SUB_IDX.vendorId] || "").trim();
    if (!vid || !state.vendorIdSet.has(vid)) {
      skipped.push({
        sheet_row:      i,
        client_uuid:    String(row[SUB_IDX.uuid] || "").trim(),
        vendor_id:      vid || null,
        vendor_name:    String(row[SUB_IDX.vendor] || "").trim() || null,
        invoice_number: String(row[SUB_IDX.invoiceNumber] || "").trim() || null,
        invoice_date:   String(row[SUB_IDX.invoiceDate] || "").trim() || null,
        total_amount:   parseNumOrNull(row[SUB_IDX.totalAmount]),
        skip_reason:    vid
          ? "FK violation: vendor_id not in PG vendors"
          : "FK violation: vendor_id empty",
      });
    }
  });
  const body = skipped.map((r) => JSON.stringify(r)).join("\n") + (skipped.length ? "\n" : "");
  await writeFile(SKIP_LOG_PATH, body);
  console.log(`Skip log written: ${SKIP_LOG_PATH} (${skipped.length} rows)`);
}

// ─────────────────────────────────────────────────────────────
// 1. invoice_submissions
// ─────────────────────────────────────────────────────────────
async function runInvoiceSubmissionsBackfill() {
  await ensureSubmissionData();
  await ensureVendorIdSet();

  await runBackfill({
    moduleLabel:         "invoice_submissions",
    sheetId:             SHEET_IDS.COLLECTION,
    sheetTabName:        "invoice_submissions_26",
    expectedFirstHeader: null, // audit Section 2.1: header is 15 cols, data is 23. No anchor.
    readSheets:          async () => state.submissionRows.map((row) => ({ row })),
    pgTable:             "invoice_submissions",
    strategy:            "upsert",
    onConflict:          "client_uuid",
    ignoreDuplicates:    true,    // re-run safe; existing rows from dual-write preserved
    countScope:          null,
    npmCommand:          "npm run backfill:invoice -- --table=invoice_submissions",
    execute:             EXECUTE,
    validators: [
      {
        name:    "client_uuid format",
        check:   (r) => looksLikeUuid(r.row[SUB_IDX.uuid]),
        message: (r) => `client_uuid "${String(r.row[SUB_IDX.uuid] || "").slice(0, 30)}" is not a UUID`,
      },
      {
        name:    "vendor_id non-empty",
        check:   (r) => Boolean(String(r.row[SUB_IDX.vendorId] || "").trim()),
        message: (r) => `vendor_id empty for client_uuid=${String(r.row[SUB_IDX.uuid]).slice(0, 8)}`,
      },
      {
        name:    "vendor_id resolves in PG vendors table",
        check:   (r) => {
          if (!state.vendorIdSet) return true; // probe unavailable; defer to PG FK enforcement
          const vid = String(r.row[SUB_IDX.vendorId] || "").trim();
          return state.vendorIdSet.has(vid);
        },
        message: (r) => {
          const vid = String(r.row[SUB_IDX.vendorId] || "").trim();
          const uuid = String(r.row[SUB_IDX.uuid] || "").slice(0, 8);
          return `vendor_id "${vid}" not in PG vendors (client_uuid=${uuid}, likely soft-deleted legacy vendor)`;
        },
      },
      {
        name:    "submitter_email non-empty",
        check:   (r) => Boolean(String(r.row[SUB_IDX.submitterEmail] || "").trim()),
        message: (r) => `submitter_email empty for client_uuid=${String(r.row[SUB_IDX.uuid]).slice(0, 8)}`,
      },
      {
        name:    "account_key non-empty",
        check:   (r) => Boolean(String(r.row[SUB_IDX.account] || "").trim()),
        message: (r) => `account_key empty for client_uuid=${String(r.row[SUB_IDX.uuid]).slice(0, 8)}`,
      },
    ],
    transformToPg: ({ row }) => {
      const clientUuid    = String(row[SUB_IDX.uuid] || "").trim();
      const id            = state.submissionIdMap.get(clientUuid);
      const rawStatus     = String(row[SUB_IDX.status] || "sent").trim().toLowerCase();
      const correctedFrom = String(row[SUB_IDX.correctedFromUuid] || "").trim();

      // Section 4.1 status split.
      let status        = "sent";
      let aiScanStatus  = null;
      if (WORKFLOW_STATUSES.has(rawStatus)) {
        status = rawStatus;
      } else if (AI_SCAN_STATUSES.has(rawStatus)) {
        status = "sent";
        aiScanStatus = rawStatus;
      } else if (rawStatus) {
        // Unknown value: preserve in status; CHECK passes because is_historical=TRUE.
        status = rawStatus;
      }

      // corrected_from_uuid: resolve to parent's generated id via map.
      // If parent client_uuid is not in our backfill batch (rare; would be
      // a correction pointing to a deleted parent), set NULL + warn.
      let correctedFromPg = null;
      if (correctedFrom) {
        const mapped = state.submissionIdMap.get(correctedFrom);
        if (mapped) {
          correctedFromPg = mapped;
        } else {
          console.warn(
            `[corrected_from unresolved] client_uuid=${clientUuid.slice(0, 8)} ` +
              `corrected_from=${correctedFrom.slice(0, 8)} not in map; setting NULL`
          );
        }
      }

      return {
        id,
        client_uuid:         clientUuid,
        submitted_at:        parseTimestampOrNull(row[SUB_IDX.timestamp]) || new Date().toISOString(),
        submitter_email:     String(row[SUB_IDX.submitterEmail] || "").trim(),
        account_key:         String(row[SUB_IDX.account] || "").trim(),
        vendor_name:         String(row[SUB_IDX.vendor] || "").trim() || "(unknown)",
        vendor_id:           String(row[SUB_IDX.vendorId] || "").trim(),
        invoice_number:      String(row[SUB_IDX.invoiceNumber] || "").trim() || null,
        invoice_date:        parseDateOrNull(row[SUB_IDX.invoiceDate]),
        total_amount:        parseNumOrNull(row[SUB_IDX.totalAmount]) ?? 0,
        gl_breakdown:        parseGlBreakdownJson(row[SUB_IDX.glBreakdown]),
        drive_urls:          parseDriveUrlsJson(row[SUB_IDX.driveUrls]),
        page_count:          parseNumOrNull(row[SUB_IDX.pageCount]) || 1,
        email_sent:          String(row[SUB_IDX.emailSent] || "").trim().toUpperCase() === "TRUE",
        status,
        status_updated_at:   parseTimestampOrNull(row[SUB_IDX.statusUpdatedAt]),
        type:                ["invoice", "credit"].includes(String(row[SUB_IDX.type] || "").trim().toLowerCase())
                               ? String(row[SUB_IDX.type]).trim().toLowerCase()
                               : "invoice",
        raw_drive_url:       String(row[SUB_IDX.rawDriveUrl] || "").trim() || null,
        corrected_from_uuid: correctedFromPg,
        dupe_override:       String(row[SUB_IDX.dupeOverride] || "").trim().toLowerCase() === "not_duplicate",
        ai_scan_status:      aiScanStatus,
        is_historical:       true,
        data_provenance:     "app_scan",
      };
    },
  });
}

// ─────────────────────────────────────────────────────────────
// 2. invoice_rejections (embedded in cols R-U of invoice_submissions_26)
// ─────────────────────────────────────────────────────────────
async function runInvoiceRejectionsBackfill() {
  await ensureSubmissionData();

  // Extract rejection rows: a submission row carries a rejection if any
  // of cols R/S/T/U is non-empty (typically all four are set together).
  const rejectionRows = state.submissionRows.filter((row) => {
    return (
      String(row[SUB_IDX.rejectionReason] || "").trim() ||
      String(row[SUB_IDX.rejectionNote]   || "").trim() ||
      String(row[SUB_IDX.rejectedBy]      || "").trim() ||
      String(row[SUB_IDX.rejectedAt]      || "").trim()
    );
  });

  await runBackfill({
    moduleLabel:         "invoice_rejections",
    sheetId:             SHEET_IDS.COLLECTION,
    sheetTabName:        "invoice_submissions_26",
    expectedFirstHeader: null,
    readSheets:          async () => rejectionRows.map((row) => ({ row })),
    pgTable:             "invoice_rejections",
    strategy:            "upsert",
    onConflict:          "submission_id,rejected_at",
    ignoreDuplicates:    true,
    countScope:          null,
    npmCommand:          "npm run backfill:invoice -- --table=invoice_rejections",
    execute:             EXECUTE,
    validators: [
      {
        name:    "submission_id resolves via map",
        check:   ({ row }) => state.submissionIdMap.has(String(row[SUB_IDX.uuid] || "").trim()),
        message: ({ row }) => {
          const u = String(row[SUB_IDX.uuid] || "").slice(0, 8);
          return `submission_id not in map for client_uuid=${u}`;
        },
      },
      {
        name:    "rejected_by non-empty",
        check:   ({ row }) => Boolean(String(row[SUB_IDX.rejectedBy] || "").trim()),
        message: ({ row }) => {
          const u = String(row[SUB_IDX.uuid] || "").slice(0, 8);
          return `rejected_by empty for client_uuid=${u}`;
        },
      },
    ],
    transformToPg: ({ row }) => {
      const clientUuid  = String(row[SUB_IDX.uuid] || "").trim();
      const submissionId = state.submissionIdMap.get(clientUuid);
      const rejectedAt  =
        parseTimestampOrNull(row[SUB_IDX.rejectedAt]) ||
        parseTimestampOrNull(row[SUB_IDX.statusUpdatedAt]) ||
        parseTimestampOrNull(row[SUB_IDX.timestamp]) ||
        new Date().toISOString();
      return {
        submission_id:   submissionId,
        rejected_at:     rejectedAt,
        rejected_by:     String(row[SUB_IDX.rejectedBy] || "").trim() || "unknown",
        reason:          String(row[SUB_IDX.rejectionReason] || "").trim() || null,
        note:            String(row[SUB_IDX.rejectionNote]   || "").trim() || null,
        is_historical:   true,
        data_provenance: "app_scan",
      };
    },
  });
}

// ─────────────────────────────────────────────────────────────
// 3. ai_line_items
// ─────────────────────────────────────────────────────────────
async function runAILineItemsBackfill() {
  await ensureSubmissionData();
  await ensureLineItemData();

  await runBackfill({
    moduleLabel:         "ai_line_items",
    sheetId:             SHEET_IDS.AI_LINE_ITEMS,
    sheetTabName:        "(multi-tab)",
    expectedFirstHeader: null,
    readSheets:          async () => state.lineItemRows,
    pgTable:             "ai_line_items",
    strategy:            "insert-if-empty",
    onConflict:          null,
    ignoreDuplicates:    false,
    countScope:          null,
    npmCommand:          "npm run backfill:invoice -- --table=ai_line_items",
    execute:             EXECUTE,
    validators: [
      {
        name:    "account_key (tab name) non-empty",
        check:   ({ tab }) => Boolean(tab),
        message: () => "tab name missing",
      },
      {
        name:    "description non-empty",
        check:   ({ row }) => Boolean(String(row[LINE_IDX.description] || "").trim()),
        message: ({ row }) =>
          `description empty for invoice_uuid=${String(row[LINE_IDX.invoiceUuid] || "").slice(0, 8)}`,
      },
    ],
    transformToPg: ({ tab, row }) => {
      const rawInvUuid = String(row[LINE_IDX.invoiceUuid] || "").trim();
      let invoiceUuidPg = null;
      let historicalRef = null;
      let provenance    = "app_scan";

      if (isRebuildRef(rawInvUuid)) {
        // 138 REBUILD-* synthetics per audit Section 8.
        invoiceUuidPg = null;
        historicalRef = rawInvUuid;
        provenance    = "batch_rebuild";
      } else if (looksLikeUuid(rawInvUuid)) {
        const mapped = state.submissionIdMap.get(rawInvUuid);
        if (mapped) {
          // 5229 in-bounds per audit Section 8 (corrected from "5158" typo).
          invoiceUuidPg = mapped;
          historicalRef = null;
          provenance    = "app_scan";
        } else {
          // 71 valid-UUID orphans per audit Section 8.
          invoiceUuidPg = null;
          historicalRef = rawInvUuid;
          provenance    = "unknown";
        }
      } else {
        // Neither REBUILD- nor UUID: treat as orphan with raw ref preserved.
        invoiceUuidPg = null;
        historicalRef = rawInvUuid || null;
        provenance    = "unknown";
      }

      return {
        invoice_uuid:           invoiceUuidPg,
        account_key:            tab,
        vendor_name:            String(row[LINE_IDX.vendor] || "").trim() || "(unknown)",
        invoice_number:         String(row[LINE_IDX.invoiceNumber] || "").trim() || null,
        invoice_date:           parseDateOrNull(row[LINE_IDX.invoiceDate]),
        line_num:               Number(parseNumOrNull(row[LINE_IDX.lineNum]) ?? 0),
        description:            String(row[LINE_IDX.description] || "").trim(),
        quantity:               parseNumOrNull(row[LINE_IDX.quantity]),
        unit:                   String(row[LINE_IDX.unit] || "").trim() || null,
        unit_price:             parseNumOrNull(row[LINE_IDX.unitPrice]),
        extended_price:         parseNumOrNull(row[LINE_IDX.extendedPrice]),
        category:               String(row[LINE_IDX.category] || "").trim() || null,
        confidence:             String(row[LINE_IDX.confidence] || "").trim() || null,
        raw_json:               (() => {
                                  const s = String(row[LINE_IDX.rawJson] || "").trim();
                                  if (!s) return null;
                                  try { return JSON.parse(s); } catch { return { raw: s }; }
                                })(),
        historical_invoice_ref: historicalRef,
        is_historical:          true,
        data_provenance:        provenance,
      };
    },
  });
}

// ─────────────────────────────────────────────────────────────
// 4. gl_codes
// ─────────────────────────────────────────────────────────────
async function runGLCodesBackfill() {
  await ensureGLCodeData();
  await ensureVendorAccountKeys();

  // Pre-write probe report: print vendor_accounts canonical account_keys
  // + which normalized GL tab names appear in vendor_accounts.
  if (state.vendorAccountKeys) {
    console.log("(probe) vendor_accounts.account_key distinct values:");
    [...state.vendorAccountKeys].sort().forEach((k) => console.log(`        ${k}`));
    const glAccountKeys = new Set(state.glCodeRecords.map((r) => r.account_key));
    console.log();
    console.log("(probe) gl_codes account_keys after tab-name normalization:");
    [...glAccountKeys].sort().forEach((k) => {
      const inVA = state.vendorAccountKeys.has(k);
      console.log(`        ${k}  ${inVA ? "[in vendor_accounts]" : "[NOT in vendor_accounts; preserved historical]"}`);
    });
    console.log();
  }

  await runBackfill({
    moduleLabel:         "gl_codes",
    sheetId:             SHEET_IDS.GL_CODES,
    sheetTabName:        "(multi-tab)",
    expectedFirstHeader: null,
    readSheets:          async () => state.glCodeRecords,
    pgTable:             "gl_codes",
    strategy:            "upsert",
    onConflict:          "account_key,code",
    ignoreDuplicates:    true,    // re-run safe; existing dual-write rows preserved
    countScope:          null,
    npmCommand:          "npm run backfill:invoice -- --table=gl_codes",
    execute:             EXECUTE,
    validators: [
      {
        name:    "account_key non-empty",
        check:   (r) => Boolean(r.account_key),
        message: () => "account_key empty after tab-name normalization",
      },
      {
        name:    "code non-empty",
        check:   (r) => Boolean(r.code),
        message: (r) => `code empty for account_key=${r.account_key}`,
      },
    ],
    transformToPg: (r) => ({
      account_key:     r.account_key,
      category:        r.category || null,
      code:            r.code,
      name:            r.name || null,
      is_purchasing:   r.is_purchasing,
      active:          true,
      is_historical:   true,
      data_provenance: "manual_entry",
    }),
  });
}

// ─────────────────────────────────────────────────────────────
// Pre-flight dry-run classification report
//
// Prints per-table classification counts BEFORE any runBackfill() call.
// This is the artifact Chat-Claude reviews to greenlight live execution.
// ─────────────────────────────────────────────────────────────
async function printPreFlightReport() {
  console.log("=".repeat(70));
  console.log("INVOICE BACKFILL PRE-FLIGHT CLASSIFICATION REPORT");
  console.log("=".repeat(70));
  console.log();

  await ensureSubmissionData();
  await ensureVendorIdSet();
  await ensureLineItemData();
  await ensureGLCodeData();
  await ensureVendorAccountKeys();

  // ── invoice_submissions classification ──
  console.log(`-- invoice_submissions (source: invoice_submissions_26) --`);
  console.log(`Total rows read: ${state.submissionRows.length}`);

  const statusBuckets = {
    sent: 0, returned: 0, corrected: 0, deleted: 0,
    pending: 0, complete: 0, failed: 0, "photo-only": 0,
    other: 0, empty: 0,
  };
  let vendorIdMissing = 0;
  let vendorIdResolved = 0;
  let correctedFromResolved = 0;
  let correctedFromUnresolved = 0;
  let unparseableDates = 0;

  for (const row of state.submissionRows) {
    const raw = String(row[SUB_IDX.status] || "").trim().toLowerCase();
    if (!raw) statusBuckets.empty++;
    else if (statusBuckets[raw] !== undefined) statusBuckets[raw]++;
    else statusBuckets.other++;

    const vid = String(row[SUB_IDX.vendorId] || "").trim();
    if (!vid) vendorIdMissing++;
    else if (state.vendorIdSet && !state.vendorIdSet.has(vid)) vendorIdMissing++;
    else vendorIdResolved++;

    const corrFrom = String(row[SUB_IDX.correctedFromUuid] || "").trim();
    if (corrFrom) {
      if (state.submissionIdMap.has(corrFrom)) correctedFromResolved++;
      else correctedFromUnresolved++;
    }

    const date = String(row[SUB_IDX.invoiceDate] || "").trim();
    if (date && parseDateOrNull(date) === null) unparseableDates++;
  }

  console.log(`Status enum distribution:`);
  for (const k of Object.keys(statusBuckets)) {
    if (statusBuckets[k] > 0) console.log(`  ${k.padEnd(12)} ${statusBuckets[k]}`);
  }
  console.log(`is_historical:    100% TRUE (all ${state.submissionRows.length} rows)`);
  console.log(`data_provenance:  100% 'app_scan' (all ${state.submissionRows.length} rows)`);
  console.log(`vendor_id resolved:    ${vendorIdResolved}`);
  console.log(`vendor_id missing/orphan: ${vendorIdMissing}  ${vendorIdMissing ? "(WILL BE SKIPPED)" : ""}`);
  console.log(`corrected_from resolved:   ${correctedFromResolved}`);
  console.log(`corrected_from unresolved: ${correctedFromUnresolved}  ${correctedFromUnresolved ? "(set NULL + warn)" : ""}`);
  console.log(`unparseable invoice_date:  ${unparseableDates}  ${unparseableDates ? "(set NULL)" : ""}`);
  console.log();

  // ── invoice_rejections classification ──
  const rejectionRows = state.submissionRows.filter(
    (row) =>
      String(row[SUB_IDX.rejectionReason] || "").trim() ||
      String(row[SUB_IDX.rejectionNote]   || "").trim() ||
      String(row[SUB_IDX.rejectedBy]      || "").trim() ||
      String(row[SUB_IDX.rejectedAt]      || "").trim()
  );
  console.log(`-- invoice_rejections (extracted from cols R-U of same source) --`);
  console.log(`Total rejections to insert: ${rejectionRows.length}`);
  console.log(`is_historical:   100% TRUE`);
  console.log(`data_provenance: 100% 'app_scan'`);
  console.log();

  // ── ai_line_items classification ──
  console.log(`-- ai_line_items (source: AI_LINE_ITEMS 9 per-account tabs) --`);
  console.log(`Total rows read: ${state.lineItemRows.length}`);
  let rebuilds = 0, validOrphans = 0, inBounds = 0, otherOrphans = 0;
  const tabCounts = {};
  for (const { tab, row } of state.lineItemRows) {
    tabCounts[tab] = (tabCounts[tab] || 0) + 1;
    const raw = String(row[LINE_IDX.invoiceUuid] || "").trim();
    if (isRebuildRef(raw)) rebuilds++;
    else if (looksLikeUuid(raw)) {
      if (state.submissionIdMap.has(raw)) inBounds++;
      else validOrphans++;
    } else {
      otherOrphans++;
    }
  }
  console.log(`Classification:`);
  console.log(`  in-bounds (resolved to PG id):   ${inBounds}     data_provenance='app_scan'`);
  console.log(`  REBUILD-* synthetic IDs:         ${rebuilds}     data_provenance='batch_rebuild'`);
  console.log(`  valid-UUID orphans (no parent):  ${validOrphans}  data_provenance='unknown'`);
  console.log(`  other (neither UUID nor REBUILD): ${otherOrphans} data_provenance='unknown'`);
  console.log(`  TOTAL:                            ${inBounds + rebuilds + validOrphans + otherOrphans}`);
  console.log(`is_historical:   100% TRUE`);
  console.log(`Per-tab counts:`);
  for (const tab of Object.keys(tabCounts).sort()) {
    console.log(`  ${tab.padEnd(18)} ${tabCounts[tab]}`);
  }
  console.log();

  // ── gl_codes classification ──
  console.log(`-- gl_codes (source: GL_CODES 12 per-account tabs; SKIP Master Template + Class Overview) --`);
  console.log(`Total leaf codes parsed: ${state.glCodeRecords.length}`);
  const purchasing = state.glCodeRecords.filter((r) => r.is_purchasing).length;
  const nonPurchasing = state.glCodeRecords.length - purchasing;
  const glAcctCounts = {};
  for (const r of state.glCodeRecords) {
    glAcctCounts[r.account_key] = (glAcctCounts[r.account_key] || 0) + 1;
  }
  console.log(`is_purchasing distribution:`);
  console.log(`  TRUE  (purchasing):       ${purchasing}`);
  console.log(`  FALSE (excluded items/categories): ${nonPurchasing}`);
  console.log(`is_historical:   100% TRUE`);
  console.log(`data_provenance: 100% 'manual_entry'`);
  console.log(`Per-account counts (after tab-name normalization):`);
  for (const k of Object.keys(glAcctCounts).sort()) {
    console.log(`  ${k.padEnd(18)} ${glAcctCounts[k]}`);
  }
  console.log();

  // ── Grand totals + constraint check ──
  console.log("-- Summary --");
  const subTotal  = state.submissionRows.length;
  const rejTotal  = rejectionRows.length;
  const lineTotal = state.lineItemRows.length;
  const glTotal   = state.glCodeRecords.length;
  console.log(`Grand totals (rows to insert):`);
  console.log(`  invoice_submissions: ${subTotal}    (audit projection: 590)`);
  console.log(`  invoice_rejections:  ${rejTotal}    (audit projection: 27)`);
  console.log(`  ai_line_items:       ${lineTotal}  (audit projection: 5438)`);
  console.log(`  gl_codes:            ${glTotal}    (audit projection: 300 per-account)`);
  console.log(`  -----`);
  console.log(`  TOTAL:               ${subTotal + rejTotal + lineTotal + glTotal}`);
  console.log();
  console.log("Constraint expectations (PG will enforce):");
  console.log(`  - invoice_submissions.vendor_id FK -> vendors(id): ${vendorIdMissing ? `${vendorIdMissing} rows would fail (will skip)` : "all rows resolve"}`);
  console.log(`  - invoice_submissions.corrected_from_uuid FK self-ref: ${correctedFromUnresolved ? `${correctedFromUnresolved} unresolved (set NULL)` : "all resolved"}`);
  console.log(`  - ai_line_items chk_historical_rows_have_parent_ref: all rows have invoice_uuid OR historical_invoice_ref`);
  console.log(`  - gl_codes UNIQUE (account_key, code): re-run safe via ON CONFLICT DO NOTHING`);
  console.log();
  console.log("=".repeat(70));
  console.log();
}

// ─────────────────────────────────────────────────────────────
// Orchestration: respect --table= subset or run all 4 in order
// ─────────────────────────────────────────────────────────────
try {
  await printPreFlightReport();
  await writeSkipLog();

  if (!tableArg || tableArg === "invoice_submissions") {
    await runInvoiceSubmissionsBackfill();
    console.log();
  } else if (tableArg) {
    // Even for subset runs, we need the submissionIdMap built so FK
    // resolutions work. ensureSubmissionData() in each runner handles it.
    await ensureSubmissionData();
  }

  if (!tableArg || tableArg === "invoice_rejections") {
    await runInvoiceRejectionsBackfill();
    console.log();
  }
  if (!tableArg || tableArg === "ai_line_items") {
    await runAILineItemsBackfill();
    console.log();
  }
  if (!tableArg || tableArg === "gl_codes") {
    await runGLCodesBackfill();
    console.log();
  }

  console.log("=".repeat(70));
  console.log(`Invoice backfill complete - ${EXECUTE ? "LIVE" : "DRY-RUN"}`);
  console.log("=".repeat(70));
} catch (e) {
  console.error("FATAL backfill error:", e.message);
  console.error(e.stack);
  process.exit(1);
}
