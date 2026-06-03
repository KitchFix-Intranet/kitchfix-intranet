// ════════════════════════════════════════════════════════════════════════════
// ONE-TIME TOP-UP: rescue invoice_submissions missed by the dual-write bug
// during the PR 6.3 -> PR 6.4 broken window.
//
// THE BUG
//   PR 6.3 cutover flipped DUAL_WRITE_TABLES to include the 4 invoice tabs
//   on 2026-06-01 ~14:25 UTC. The orchestrator constant
//   INVOICE_SUBMISSIONS_TAB carried the literal Sheets tab name
//   'invoice_submissions_26' which did not match the env var token
//   'invoice_submissions'. isDualWrite() returned false for every
//   invoice-submit. PG branch was skipped. New submissions went to
//   Sheets only.
//
//   PR 6.4 hotfix (#103) introduced INVOICE_SUBMISSIONS_FLAG =
//   'invoice_submissions' and routed the 5 dispatch sites through it.
//   First successfully dual-written submission landed 2026-06-02
//   16:50:43 UTC (m.richards@kitchfix.com).
//
//   The broken window is the gap between the env var save and the
//   hotfix deploy. Invoices submitted in that window live in Sheets
//   but not in PG. This script catches them up.
//
// USAGE
//   Dry run (default; prints pre-flight report, no writes):
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/topup-invoice-broken-window.mjs
//   Live:
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/topup-invoice-broken-window.mjs --execute
//
// SCOPE
//   ONLY invoice_submissions. The other 3 invoice tab constants
//   (invoice_rejections, ai_line_items, gl_codes) matched their env
//   var tokens correctly even before PR 6.4; any of their dual-writes
//   either worked or failed at FK time on the missing parent. They
//   are not touched here.
//
// KEY DIFFERENCE FROM scripts/backfill-invoice.mjs
//   That script wrote historical rows: is_historical=TRUE,
//   data_provenance='app_scan'.
//   This script writes what dual-write WOULD have written:
//   is_historical=FALSE, data_provenance='app_scan'. The rows are
//   live production submissions that happened to land during the
//   broken window; they are not historical artifacts.
//
// CONFLICT SEMANTICS
//   upsert ON CONFLICT (client_uuid) DO NOTHING. If a row landed in
//   PG since the script's pre-flight read (e.g., the same row was
//   manually inserted by Kevin in Supabase Studio), the existing row
//   is preserved.
//
// VENDOR_ID FK PRE-VALIDATION
//   Same as PR 6.3 backfill: pre-flight reads PG vendors table into a
//   Set; rows referencing vendor_ids not in PG vendors are skipped
//   with a per-row warn + final skip log at
//   scripts/topup-invoice-skipped-rows.log. Expected to surface the
//   same SYS-388 / FRE-898 / COZ-* / SAM-956 vendor_ids as PR 6.3
//   plus any new soft-deletes since.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { readSheetSA, SHEET_IDS } from "../src/lib/sheets.js";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");

// ─────────────────────────────────────────────────────────────
// BROKEN WINDOW BOUNDARIES (UTC)
//   Start: when DUAL_WRITE_TABLES env var was saved on Vercel.
//          18 hours before Kevin's 8:25 AM ET Vercel screenshot on
//          2026-06-02 -> approximately 2026-06-01 14:25 UTC.
//   End:   just before the first successfully dual-written submission
//          (m.richards@kitchfix.com at 2026-06-02 16:50:43 UTC).
//   Edges padded slightly for safety; the precision-limit is the
//   submitted_at column in Sheets which is ISO-millisecond.
// ─────────────────────────────────────────────────────────────
const BROKEN_WINDOW_START_UTC = "2026-06-01T14:25:00.000Z";
const BROKEN_WINDOW_END_UTC   = "2026-06-02T16:48:00.000Z";

const SKIP_LOG_PATH = "scripts/topup-invoice-skipped-rows.log";

// ─────────────────────────────────────────────────────────────
// invoice_submissions_26 column index (0-indexed; mirrors SUB_IDX in
// src/lib/dataStore/invoice.js + scripts/backfill-invoice.mjs)
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

// Status enum split rules per MODULE_6_DATA_AUDIT Section 4.1
const WORKFLOW_STATUSES = new Set(["sent", "returned", "corrected", "deleted"]);
const AI_SCAN_STATUSES  = new Set(["pending", "complete", "failed", "photo-only"]);

// ─────────────────────────────────────────────────────────────
// Parsing helpers (mirror scripts/backfill-invoice.mjs)
// ─────────────────────────────────────────────────────────────
function parseDateOrNull(s) {
  if (s == null || s === "") return null;
  const str = String(s).trim();
  if (!str) return null;
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
    const p = JSON.parse(s);
    if (Array.isArray(p)) return p;
  } catch {}
  return [];
}

function parseDriveUrlsJson(s) {
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    if (Array.isArray(p)) return p.filter(Boolean);
  } catch {}
  return String(s).split(",").map((u) => u.trim()).filter(Boolean);
}

// Loose UUID format check.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function looksLikeUuid(s) {
  return UUID_RE.test(String(s || "").trim());
}

// ─────────────────────────────────────────────────────────────
// Supabase service-role client
// ─────────────────────────────────────────────────────────────
function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("FATAL: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
    process.exit(1);
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─────────────────────────────────────────────────────────────
// Pre-flight reads
// ─────────────────────────────────────────────────────────────
async function readSheetsRows() {
  const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, "invoice_submissions_26");
  return rows.filter((r) => String(r[SUB_IDX.uuid] || "").trim());
}

async function readPgClientUuids(supabase) {
  // Paginate in case the result exceeds Supabase's default 1000 row cap.
  const out = new Set();
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("invoice_submissions")
      .select("client_uuid")
      .range(from, from + pageSize - 1);
    if (error) {
      console.error("PG read failed:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const r of data) if (r.client_uuid) out.add(r.client_uuid);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function readPgVendorIds(supabase) {
  const { data, error } = await supabase.from("vendors").select("id");
  if (error) {
    console.error("PG vendors read failed:", error.message);
    process.exit(1);
  }
  return new Set(data.map((r) => r.id));
}

async function readPgInvoiceIdMap(supabase) {
  // Build client_uuid -> id map for FK resolution of corrected_from_uuid.
  const out = new Map();
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("invoice_submissions")
      .select("client_uuid,id")
      .range(from, from + pageSize - 1);
    if (error) {
      console.error("PG read failed:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const r of data) if (r.client_uuid) out.set(r.client_uuid, r.id);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Driver
// ─────────────────────────────────────────────────────────────
const supabase = getClient();

console.log("=".repeat(70));
console.log(`INVOICE BROKEN-WINDOW TOP-UP - ${EXECUTE ? "LIVE" : "DRY-RUN"}`);
console.log("=".repeat(70));
console.log(`Window start: ${BROKEN_WINDOW_START_UTC}`);
console.log(`Window end:   ${BROKEN_WINDOW_END_UTC}`);
console.log();

const sheetsRows = await readSheetsRows();
console.log(`Sheets rows total:           ${sheetsRows.length}`);

const startMs = new Date(BROKEN_WINDOW_START_UTC).getTime();
const endMs   = new Date(BROKEN_WINDOW_END_UTC).getTime();

const windowRows = sheetsRows.filter((r) => {
  const ts = parseTimestampOrNull(r[SUB_IDX.timestamp]);
  if (!ts) return false;
  const t = new Date(ts).getTime();
  return t >= startMs && t <= endMs;
});
console.log(`Sheets rows in window:       ${windowRows.length}`);

const pgClientUuids = await readPgClientUuids(supabase);
console.log(`PG client_uuids total:       ${pgClientUuids.size}`);

const inPgWindow    = windowRows.filter((r) => pgClientUuids.has(String(r[SUB_IDX.uuid] || "").trim()));
const notInPgWindow = windowRows.filter((r) => !pgClientUuids.has(String(r[SUB_IDX.uuid] || "").trim()));
console.log(`Window rows ALREADY in PG:   ${inPgWindow.length}  (dual-write worked for these)`);
console.log(`Window rows MISSING from PG: ${notInPgWindow.length}  (need top-up)`);
console.log();

const vendorIdSet = await readPgVendorIds(supabase);
console.log(`PG vendors total:            ${vendorIdSet.size}`);
const pgInvoiceIdMap = await readPgInvoiceIdMap(supabase);
console.log(`PG client_uuid -> id map:    ${pgInvoiceIdMap.size}`);
console.log();

// Vendor_id orphan pre-check
const orphanRows = [];
const okRows     = [];
for (const r of notInPgWindow) {
  const vid = String(r[SUB_IDX.vendorId] || "").trim();
  if (!vid || !vendorIdSet.has(vid)) {
    orphanRows.push(r);
  } else {
    okRows.push(r);
  }
}

console.log("=".repeat(70));
console.log("PER-ROW LISTING (missing from PG)");
console.log("=".repeat(70));
if (notInPgWindow.length === 0) {
  console.log("(no missing rows)");
} else {
  for (const r of notInPgWindow) {
    const vid = String(r[SUB_IDX.vendorId] || "").trim();
    const orphan = !vid || !vendorIdSet.has(vid);
    const status = orphan ? "SKIP (vendor_id orphan)" : "OK";
    console.log(
      `  ${status.padEnd(26)} ` +
      `uuid=${String(r[SUB_IDX.uuid] || "").slice(0, 8)} ` +
      `submitter=${String(r[SUB_IDX.submitterEmail] || "").trim().padEnd(28)} ` +
      `account=${String(r[SUB_IDX.account] || "").trim().padEnd(12)} ` +
      `vendor=${String(r[SUB_IDX.vendor] || "").trim().padEnd(20)} ` +
      `vendor_id=${vid.padEnd(10)} ` +
      `inv#=${String(r[SUB_IDX.invoiceNumber] || "").trim().padEnd(14)} ` +
      `total=$${String(parseNumOrNull(r[SUB_IDX.totalAmount]) ?? 0).padStart(10)} ` +
      `at=${r[SUB_IDX.timestamp]}`
    );
  }
}
console.log();

console.log("=".repeat(70));
console.log("SUMMARY");
console.log("=".repeat(70));
console.log(`To insert:           ${okRows.length}`);
console.log(`To skip (vendor FK): ${orphanRows.length}`);
console.log(`Total to process:    ${notInPgWindow.length}`);
console.log(`Mode:                ${EXECUTE ? "LIVE" : "DRY-RUN"}`);
console.log();

if (!EXECUTE) {
  console.log("DRY-RUN: nothing written. Re-run with --execute to apply.");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────
// LIVE: write skip log + transform + upsert
// ─────────────────────────────────────────────────────────────

const skipLog = orphanRows.map((r) => ({
  client_uuid:    String(r[SUB_IDX.uuid] || "").trim(),
  vendor_id:      String(r[SUB_IDX.vendorId] || "").trim() || null,
  vendor_name:    String(r[SUB_IDX.vendor] || "").trim() || null,
  invoice_number: String(r[SUB_IDX.invoiceNumber] || "").trim() || null,
  invoice_date:   String(r[SUB_IDX.invoiceDate] || "").trim() || null,
  total_amount:   parseNumOrNull(r[SUB_IDX.totalAmount]),
  submitter_email: String(r[SUB_IDX.submitterEmail] || "").trim() || null,
  submitted_at:   String(r[SUB_IDX.timestamp] || "").trim() || null,
  skip_reason:    "FK violation: vendor_id not in PG vendors",
}));
const skipBody = skipLog.map((r) => JSON.stringify(r)).join("\n") + (skipLog.length ? "\n" : "");
await writeFile(SKIP_LOG_PATH, skipBody);
console.log(`Skip log written: ${SKIP_LOG_PATH} (${skipLog.length} rows)`);
console.log();

if (okRows.length === 0) {
  console.log("Nothing to insert. Exiting.");
  process.exit(0);
}

// Pre-generate UUIDs for this batch + build a same-batch client_uuid -> id
// map so a correction submitted in the broken window referencing a parent
// also in the broken window resolves correctly.
const batchIdMap = new Map();
for (const r of okRows) {
  const clientUuid = String(r[SUB_IDX.uuid] || "").trim();
  if (!batchIdMap.has(clientUuid)) batchIdMap.set(clientUuid, randomUUID());
}

// Transform each row to PG shape.
const pgRows = okRows.map((row) => {
  const clientUuid = String(row[SUB_IDX.uuid] || "").trim();
  const id = batchIdMap.get(clientUuid);
  const rawStatus = String(row[SUB_IDX.status] || "sent").trim().toLowerCase();

  // Status enum split (audit Section 4.1).
  let status       = "sent";
  let aiScanStatus = null;
  if (WORKFLOW_STATUSES.has(rawStatus)) {
    status = rawStatus;
  } else if (AI_SCAN_STATUSES.has(rawStatus)) {
    status = "sent";
    aiScanStatus = rawStatus;
  } else if (rawStatus) {
    // Unknown value preserved verbatim (per is_historical CHECK predicate).
    // For top-up rows is_historical=FALSE, so the CHECK enforces the enum;
    // any unknown value would error at INSERT. Defensive: warn.
    console.warn(`[unknown status] client_uuid=${clientUuid.slice(0, 8)} status="${rawStatus}" (will attempt insert as-is)`);
    status = rawStatus;
  }

  // corrected_from_uuid: try PG first, then same-batch map, else NULL.
  const correctedFrom = String(row[SUB_IDX.correctedFromUuid] || "").trim();
  let correctedFromPg = null;
  if (correctedFrom) {
    if (pgInvoiceIdMap.has(correctedFrom)) {
      correctedFromPg = pgInvoiceIdMap.get(correctedFrom);
    } else if (batchIdMap.has(correctedFrom)) {
      correctedFromPg = batchIdMap.get(correctedFrom);
    } else {
      console.warn(
        `[corrected_from unresolved] client_uuid=${clientUuid.slice(0, 8)} ` +
          `corrected_from=${correctedFrom.slice(0, 8)} not in PG and not in batch; setting NULL`
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
    is_historical:       false,                // KEY DIFFERENCE FROM backfill
    data_provenance:     "app_scan",
  };
});

console.log(`Transformed: ${pgRows.length} rows ready to insert.`);
console.log();
console.log("Sample (first 3):");
pgRows.slice(0, 3).forEach((r, i) => {
  console.log(`  [${i}] uuid=${r.client_uuid.slice(0, 8)} ${r.submitter_email} ${r.account_key} ${r.vendor_id} ${r.invoice_number} $${r.total_amount}`);
});
console.log();

console.log(`LIVE: upserting ${pgRows.length} rows to invoice_submissions...`);
const { error } = await supabase
  .from("invoice_submissions")
  .upsert(pgRows, { onConflict: "client_uuid", ignoreDuplicates: true });
if (error) {
  console.error("Upsert failed:", error);
  process.exit(1);
}
console.log(`Upsert OK: ${pgRows.length} rows attempted (existing rows preserved via ON CONFLICT DO NOTHING).`);

// Post-write count
const { count, error: countErr } = await supabase
  .from("invoice_submissions")
  .select("*", { count: "exact", head: true });
if (countErr) {
  console.warn("Post-write count failed:", countErr.message);
} else {
  console.log(`Postgres invoice_submissions now has ${count} total rows.`);
}

console.log();
console.log("=".repeat(70));
console.log("Top-up complete.");
console.log("=".repeat(70));
