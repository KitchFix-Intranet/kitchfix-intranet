import {
  readSheetSA,
  appendRowSA,
  appendRowsSA,
  updateCellSA,
  updateRangeSA,
  batchUpdateRangesSA,
  findRowByValueSA,
  safeRead,
  SHEET_IDS,
} from "@/lib/sheets";
import { isDualWrite, isReadFromPostgres } from "@/lib/cutover";
import { getServiceClient } from "@/lib/supabase";

// ═══════════════════════════════════════════════════════════════
// INVOICE MODULE (Stage 1 module 6 PR 6.1 - DORMANT)
// ═══════════════════════════════════════════════════════════════
//
// Source: COLLECTION / invoice_submissions_26 + AI_LINE_ITEMS per-account
// tabs + GL_CODES per-account tabs. PG schema: 4 tables
// (invoice_submissions, invoice_rejections, ai_line_items, gl_codes)
// per docs/migrations/pr-6-1-invoice-schema.sql.
//
// DORMANT INFRASTRUCTURE: with cutover flags off (the default state on
// merge), nothing in this file is called. invoiceActions.js still hits
// Sheets directly. PR 6.2 rewires ~22 invoice data-access sites to call
// these orchestrators. PR 6.3 backfills the 4 tables.
//
// PRESERVATION-FIRST DESIGN (per docs/MODULE_6_DATA_AUDIT.md Section 8)
//
// PG schema uses is_historical + data_provenance columns. Strict
// integrity constraints (status enum, F24 partial UNIQUE INDEX,
// ai_line_items NOT NULL FK + UNIQUE (invoice_uuid, line_num)) apply
// only on is_historical=FALSE rows. Backfilled historical rows pass
// through. Adapters in this file do NOT touch is_historical on
// inserts; PG default (FALSE) fires. Backfill (PR 6.3) sets TRUE
// explicitly.
//
// SCOPE PARAMETER (per Kevin's decision #6): orchestrators do NOT
// default-filter by is_historical. Historical invoices ARE real
// invoices and must appear in invoice history, admin queues, F24
// dedup checks, etc. Read orchestrators accept opts.scope = 'all'
// (default) | 'historical' | 'current' for callers that need a
// specific slice.
//
// MODULE ARG (per Module 5 lesson #1 / PR #92): every read
// orchestrator accepts opts.module and passes to isReadFromPostgres.
// PR 6.2 handlers MUST pass module: "ops" at every call site for
// READ_FROM_POSTGRES_OPS to take effect.
//
// Public API (11 orchestrators):
//
//   Reads (6):
//     getInvoiceSubmissions(opts)              - paginated list (history + admin-list)
//     getInvoiceSubmissionByUuid(uuid, opts)   - single row by client_uuid
//     findDuplicateSubmission(input, opts)     - F24 dedup check
//     getInvoiceRejectionsForSubmission(submissionId, opts)
//     getAILineItemsForInvoice(invoiceUuid, opts)
//     getGLCodes(opts)                         - per-account active+purchasing list
//
//   Writes (5):
//     upsertInvoiceSubmission(input)           - insert with F25 client_uuid idempotency
//     updateInvoiceFields(uuid, fields, opts)  - generalized partial update
//     insertInvoiceRejection(input)            - new rejection
//     unrejectInvoice(submissionId, by, opts)  - update most-recent row's unrejected_at/by
//     insertAILineItems(invoiceUuid, lineItems[]) - bulk insert from AI scan

// ───────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────

const INVOICE_SUBMISSIONS_TAB = "invoice_submissions_26";
const INVOICE_REJECTIONS_TAB  = "invoice_rejections";   // PG-only; embedded in cols R-U of submissions on Sheets path
const AI_LINE_ITEMS_TAB       = "ai_line_items";        // PG-only; per-account tabs in AI_LINE_ITEMS spreadsheet
const GL_CODES_TAB            = "gl_codes";             // PG-only; per-account tabs in GL_CODES spreadsheet

// Sheet positional indices for invoice_submissions_26 (0-indexed).
// Matches parseSubmissionRow in invoiceActions.js. The Sheet header
// documents only cols A-O (15 cols) but cols P-W are in active use;
// see docs/MODULE_6_DATA_AUDIT.md Section 2.1 + Section 8 (the
// extension is deferred per Q7).
const SUB_IDX = {
  uuid:              0,   // A
  timestamp:         1,   // B
  submitterEmail:    2,   // C
  account:           3,   // D
  vendor:            4,   // E
  vendorId:          5,   // F
  invoiceNumber:     6,   // G
  invoiceDate:       7,   // H
  totalAmount:       8,   // I
  glBreakdown:       9,   // J
  driveUrls:         10,  // K
  pageCount:         11,  // L
  emailSent:         12,  // M
  status:            13,  // N  (mixed AI-scan + workflow historically; workflow-only going forward)
  statusUpdatedAt:   14,  // O
  type:              15,  // P (hidden past header)
  rawDriveUrl:       16,  // Q
  rejectionReason:   17,  // R
  rejectionNote:     18,  // S
  rejectedBy:        19,  // T
  rejectedAt:        20,  // U
  correctedFromUuid: 21,  // V
  dupeOverride:      22,  // W
};

// AI_LINE_ITEMS per-account tab columns (0-indexed). Matches
// LINE_ITEM_HEADERS in invoiceActions.js.
const LINE_IDX = {
  invoiceUuid:    0,
  timestamp:      1,
  account:        2,
  vendor:         3,
  invoiceNumber:  4,
  invoiceDate:    5,
  lineNum:        6,
  description:    7,
  quantity:       8,
  unit:           9,
  unitPrice:      10,
  extendedPrice:  11,
  category:       12,
  confidence:     13,
  rawJson:        14,
};

// Maps account_key to GL_CODES Sheet tab name. Mirrors GL_TAB_MAP
// in invoiceActions.js. Used by Sheets adapters only; PG adapters
// use the canonical account_key.
const GL_TAB_MAP = {
  "CORP":         "CORP",
  "CIN - AZ":     "CIN - AZ (REDS)",
  "CIN - KY":     "CIN - KY (LBATS)",
  "CIN - OH":     "CIN - OH (CINN)",
  "STL - FL":     "STL - FL",
  "STL - MO":     "STL - MO",
  "TBJ - FL":     "TBJ - FL",
  "TBJ - BUF":    "TBJ - BUF",
  "TBR - FL":     "TBR - FL",
  "TXR - AZ":     "TXR - AZ",
  "TXR - HOME":   "TXR - Home",
  "TXR - TX - H": "TXR - Home",
  "TXR - VISTOR": "TXR - Vistor",
  "TXR - TX - V": "TXR - Vistor",
};

// Sentinel categories + section markers + excluded items used by
// parseGLCodes (the Sheets-side parser). Mirrors invoiceActions.js
// L42-60. PG-side gl_codes is_purchasing column replaces this filter.
const GL_EXCLUDED_CATEGORIES = new Set([
  "income", "kitchen labor costs", "meal service", "wages",
]);
const GL_SECTION_MARKERS = new Set([
  "cost of goods sold", "expenses",
]);
const GL_EXCLUDED_ITEMS = new Set([
  "telephone expense", "paid time off",
  "medical/dental/vision", "charitable contributions",
]);

const DEFAULT_PAGE_SIZE = 50;

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

function strToBool(s) {
  return String(s || "").trim().toUpperCase() === "TRUE";
}

function boolToStr(b) {
  return b ? "TRUE" : "FALSE";
}

function pgTimestampToCanonical(t) {
  return t ? new Date(t).toISOString() : "";
}

function canonicalTimestampToPg(s) {
  return s ? s : null;
}

function parseNumOrNull(s) {
  if (s === null || s === undefined || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDateOrNull(s) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return s; // pass through; PG will parse DATE
}

function parseDriveUrls(s) {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch {
    /* fall through to legacy comma-separated parse */
  }
  return String(s).split(",").map((u) => u.trim()).filter(Boolean);
}

function parseGlBreakdown(s) {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* historical rows may have legacy formats; return empty + log */
    console.warn(`[invoice] glBreakdown parse failed: ${String(s).slice(0, 60)}`);
  }
  return [];
}

// Canonical record builder from Sheets row (positional). All 23 cols
// captured even though the Sheet header documents only 15.
function canonicalFromSheetsRow(r) {
  return {
    uuid:              String(r[SUB_IDX.uuid] || "").trim(),
    submittedAt:       String(r[SUB_IDX.timestamp] || "").trim(),
    submitterEmail:    String(r[SUB_IDX.submitterEmail] || "").trim(),
    accountKey:        String(r[SUB_IDX.account] || "").trim(),
    vendorName:        String(r[SUB_IDX.vendor] || "").trim(),
    vendorId:          String(r[SUB_IDX.vendorId] || "").trim(),
    invoiceNumber:     String(r[SUB_IDX.invoiceNumber] || "").trim(),
    invoiceDate:       String(r[SUB_IDX.invoiceDate] || "").trim(),
    totalAmount:       parseNumOrNull(r[SUB_IDX.totalAmount]) || 0,
    glBreakdown:       parseGlBreakdown(r[SUB_IDX.glBreakdown]),
    driveUrls:         parseDriveUrls(r[SUB_IDX.driveUrls]),
    pageCount:         parseNumOrNull(r[SUB_IDX.pageCount]) || 1,
    emailSent:         strToBool(r[SUB_IDX.emailSent]),
    status:            String(r[SUB_IDX.status] || "sent").trim(),
    statusUpdatedAt:   String(r[SUB_IDX.statusUpdatedAt] || "").trim(),
    type:              String(r[SUB_IDX.type] || "invoice").trim(),
    rawDriveUrl:       String(r[SUB_IDX.rawDriveUrl] || "").trim(),
    rejectionReason:   String(r[SUB_IDX.rejectionReason] || "").trim(),
    rejectionNote:     String(r[SUB_IDX.rejectionNote] || "").trim(),
    rejectedBy:        String(r[SUB_IDX.rejectedBy] || "").trim(),
    rejectedAt:        String(r[SUB_IDX.rejectedAt] || "").trim(),
    correctedFromUuid: String(r[SUB_IDX.correctedFromUuid] || "").trim(),
    dupeOverride:      String(r[SUB_IDX.dupeOverride] || "").trim(),
  };
}

function canonicalFromPgRow(row) {
  return {
    uuid:              row.client_uuid || row.id,
    submittedAt:       pgTimestampToCanonical(row.submitted_at),
    submitterEmail:    row.submitter_email || "",
    accountKey:        row.account_key || "",
    vendorName:        row.vendor_name || "",
    vendorId:          row.vendor_id || "",
    invoiceNumber:     row.invoice_number || "",
    invoiceDate:       row.invoice_date || "",
    totalAmount:       row.total_amount != null ? Number(row.total_amount) : 0,
    glBreakdown:       row.gl_breakdown || [],
    driveUrls:         row.drive_urls || [],
    pageCount:         row.page_count || 1,
    emailSent:         !!row.email_sent,
    status:            row.status || "sent",
    statusUpdatedAt:   pgTimestampToCanonical(row.status_updated_at),
    type:              row.type || "invoice",
    rawDriveUrl:       row.raw_drive_url || "",
    rejectionReason:   "",  // sourced from invoice_rejections separately
    rejectionNote:     "",
    rejectedBy:        "",
    rejectedAt:        "",
    correctedFromUuid: row.corrected_from_uuid || "",
    dupeOverride:      row.dupe_override ? "not_duplicate" : "",
    aiScanStatus:      row.ai_scan_status || null,
    aiScanComplete:    !!row.ai_scan_complete,
    isHistorical:      !!row.is_historical,
    dataProvenance:    row.data_provenance || "app_scan",
  };
}

// Normalize invoice_number per the PG GENERATED expression so the
// Sheets-side F24 lookup matches the PG-side partial UNIQUE INDEX.
function normalizeInvoiceNumber(raw) {
  return String(raw || "").replace(/^#?0*/, "");
}

// ═══════════════════════════════════════════════════════════════
// SHEETS ADAPTERS
// ═══════════════════════════════════════════════════════════════
//
// All Sheets adapters mirror current invoiceActions.js behavior 1:1
// so the PR 6.2 rewire is byte-identical. Adapters speak the Sheets-
// native shape; orchestrators expose the canonical shape.

// ── Reads ──

async function readInvoiceSubmissionsSheets(opts = {}) {
  const { accountKey, status, period, page = 1, pageSize = DEFAULT_PAGE_SIZE } = opts;
  const { rows } = await safeRead(SHEET_IDS.COLLECTION, INVOICE_SUBMISSIONS_TAB);
  let canonical = rows.map(canonicalFromSheetsRow);

  if (accountKey) canonical = canonical.filter((r) => r.accountKey === accountKey);
  if (status) canonical = canonical.filter((r) => r.status === status);
  if (period === "week") {
    const cutoff = Date.now() - 7 * 86400000;
    canonical = canonical.filter((r) => new Date(r.submittedAt).getTime() >= cutoff);
  } else if (period === "month") {
    const cutoff = Date.now() - 30 * 86400000;
    canonical = canonical.filter((r) => new Date(r.submittedAt).getTime() >= cutoff);
  }

  // Newest-first for history / admin views
  canonical.reverse();

  const total = canonical.length;
  const start = (page - 1) * pageSize;
  const paged = canonical.slice(start, start + pageSize);
  return { rows: paged, total, page, pageSize, hasMore: start + pageSize < total };
}

async function readInvoiceSubmissionByUuidSheets(uuid) {
  const { rows } = await safeRead(SHEET_IDS.COLLECTION, INVOICE_SUBMISSIONS_TAB);
  const row = rows.find((r) => String(r[SUB_IDX.uuid] || "").trim() === uuid);
  if (!row) return null;
  return canonicalFromSheetsRow(row);
}

async function findDuplicateSubmissionSheets(input) {
  const { vendorId, invoiceNumber, invoiceDate, totalAmount, accountKey } = input;
  const normalized = normalizeInvoiceNumber(invoiceNumber);
  if (!vendorId || !normalized || !invoiceDate || totalAmount == null) return null;

  const { rows } = await safeRead(SHEET_IDS.COLLECTION, INVOICE_SUBMISSIONS_TAB);
  for (const r of rows) {
    const status = String(r[SUB_IDX.status] || "sent").trim().toLowerCase();
    if (["corrected", "deleted"].includes(status)) continue;
    if (String(r[SUB_IDX.correctedFromUuid] || "").trim()) continue;
    if (String(r[SUB_IDX.dupeOverride] || "").trim().toLowerCase() === "not_duplicate") continue;

    const rVendorId = String(r[SUB_IDX.vendorId] || "").trim();
    if (rVendorId !== vendorId) continue;

    const rInvoiceNumber = normalizeInvoiceNumber(r[SUB_IDX.invoiceNumber]);
    if (rInvoiceNumber !== normalized) continue;

    const rInvoiceDate = String(r[SUB_IDX.invoiceDate] || "").trim();
    if (rInvoiceDate !== invoiceDate) continue;

    const rTotal = parseNumOrNull(r[SUB_IDX.totalAmount]);
    if (rTotal == null || Number(rTotal).toFixed(2) !== Number(totalAmount).toFixed(2)) continue;

    if (accountKey) {
      const rAccount = String(r[SUB_IDX.account] || "").trim();
      if (rAccount !== accountKey) continue;
    }

    return canonicalFromSheetsRow(r);
  }
  return null;
}

async function readInvoiceRejectionsForSubmissionSheets(uuid) {
  // Sheets path: rejections are embedded in cols R-U of the submission row itself.
  // Returns an array (0 or 1 element) to match PG-side history shape.
  const row = await readInvoiceSubmissionByUuidSheets(uuid);
  if (!row || !row.rejectionReason && !row.rejectedBy && !row.rejectedAt) return [];
  return [{
    submissionUuid: row.uuid,
    rejectedAt:     row.rejectedAt,
    rejectedBy:     row.rejectedBy,
    reason:         row.rejectionReason,
    note:           row.rejectionNote,
    unrejectedAt:   "",  // not separately tracked on Sheets path
    unrejectedBy:   "",
  }];
}

async function readAILineItemsForInvoiceSheets(invoiceUuid, accountKey) {
  // Sheets adapter requires the accountKey to locate the per-account tab.
  // PG adapter does not (account_key column is in row).
  if (!invoiceUuid) return [];
  const tabName = accountKey || "Invoice Uploads";
  let rows;
  try {
    const result = await safeRead(SHEET_IDS.AI_LINE_ITEMS, tabName);
    rows = result.rows;
  } catch {
    return [];
  }
  return rows
    .filter((r) => String(r[LINE_IDX.invoiceUuid] || "").trim() === invoiceUuid)
    .map((r) => ({
      invoiceUuid:   String(r[LINE_IDX.invoiceUuid] || "").trim(),
      accountKey:    String(r[LINE_IDX.account] || "").trim(),
      vendorName:    String(r[LINE_IDX.vendor] || "").trim(),
      invoiceNumber: String(r[LINE_IDX.invoiceNumber] || "").trim(),
      invoiceDate:   String(r[LINE_IDX.invoiceDate] || "").trim(),
      lineNum:       parseNumOrNull(r[LINE_IDX.lineNum]) || 0,
      description:   String(r[LINE_IDX.description] || "").trim(),
      quantity:      parseNumOrNull(r[LINE_IDX.quantity]),
      unit:          String(r[LINE_IDX.unit] || "").trim(),
      unitPrice:     parseNumOrNull(r[LINE_IDX.unitPrice]),
      extendedPrice: parseNumOrNull(r[LINE_IDX.extendedPrice]),
      category:      String(r[LINE_IDX.category] || "").trim(),
      confidence:    String(r[LINE_IDX.confidence] || "").trim(),
      rawJson:       String(r[LINE_IDX.rawJson] || "").trim(),
    }));
}

async function readGLCodesSheets(opts = {}) {
  const { accountKey } = opts;
  if (!accountKey) return [];
  const tabName = GL_TAB_MAP[accountKey];
  if (!tabName) return [];

  const { rows } = await readSheetSA(SHEET_IDS.GL_CODES, tabName);
  // Mirror parseGLCodes: walk rows, track current category, emit leaf
  // code rows. Skip header rows (no code), excluded category sections,
  // and excluded items.
  const codes = [];
  let currentCategory = null;
  let skipUntilNextHeader = false;

  for (const row of rows) {
    const colA = String(row[0] || "").trim();
    const colB = row[1] != null ? String(row[1]).trim() : "";
    const hasCode = colB.length > 0 && colB !== "Account #";

    if (!colA || colA === "Account Name/Type") continue;

    if (!hasCode) {
      const lower = colA.toLowerCase();
      if (GL_SECTION_MARKERS.has(lower)) { skipUntilNextHeader = false; continue; }
      if (GL_EXCLUDED_CATEGORIES.has(lower)) { skipUntilNextHeader = true; continue; }
      skipUntilNextHeader = false;
      currentCategory = colA;
      continue;
    }

    if (skipUntilNextHeader) continue;
    if (GL_EXCLUDED_ITEMS.has(colA.toLowerCase())) continue;

    codes.push({
      accountKey,
      category: currentCategory || null,
      code:     colB,
      name:     colA,
      isPurchasing: true,    // Sheets-side parseGLCodes already filtered
      active:   true,
    });
  }
  return codes;
}

// ── Writes ──

function buildSheetsRow(input, now) {
  // 23-col row matching invoiceActions.js invoice-submit append at L1003.
  return [
    input.uuid,
    (now || new Date()).toISOString(),
    input.submitterEmail || "",
    input.accountKey || "",
    input.vendorName || "",
    input.vendorId || "",
    input.invoiceNumber || "",
    input.invoiceDate || "",
    input.totalAmount != null ? String(input.totalAmount) : "",
    JSON.stringify(input.glBreakdown || []),
    JSON.stringify(input.driveUrls || []),
    String(input.pageCount || 1),
    "",                                  // M emailSent default FALSE on insert
    input.status || "sent",              // N
    input.statusUpdatedAt || "",         // O
    input.type || "invoice",             // P
    input.rawDriveUrl || "",             // Q
    "",                                  // R rejectionReason
    "",                                  // S rejectionNote
    "",                                  // T rejectedBy
    "",                                  // U rejectedAt
    input.correctedFromUuid || "",       // V
    "",                                  // W dupeOverride
  ];
}

async function upsertInvoiceSubmissionSheets(input) {
  const now = new Date();
  const row = buildSheetsRow(input, now);
  const result = await appendRowSA(SHEET_IDS.COLLECTION, INVOICE_SUBMISSIONS_TAB, row);
  if (!result?.success) {
    throw new Error(`[dataStore.invoice] upsertInvoiceSubmissionSheets append failed: ${result?.error || "unknown"}`);
  }
}

// Map canonical field name -> {column letter, transform-to-sheet-cell-value}.
// Used by updateInvoiceFields to write only the fields in the partial.
const FIELD_TO_COL = {
  emailSent:         { col: "M", toSheet: (v) => boolToStr(v) },
  status:            { col: "N", toSheet: (v) => String(v) },
  statusUpdatedAt:   { col: "O", toSheet: (v) => String(v || "") },
  type:              { col: "P", toSheet: (v) => String(v) },
  rawDriveUrl:       { col: "Q", toSheet: (v) => String(v || "") },
  rejectionReason:   { col: "R", toSheet: (v) => String(v || "") },
  rejectionNote:     { col: "S", toSheet: (v) => String(v || "") },
  rejectedBy:        { col: "T", toSheet: (v) => String(v || "") },
  rejectedAt:        { col: "U", toSheet: (v) => String(v || "") },
  correctedFromUuid: { col: "V", toSheet: (v) => String(v || "") },
  dupeOverride:      { col: "W", toSheet: (v) => String(v || "") },
};

async function updateInvoiceFieldsSheets(uuid, fields) {
  const rowNum = await findRowByValueSA(SHEET_IDS.COLLECTION, INVOICE_SUBMISSIONS_TAB, 0, uuid);
  if (!rowNum) {
    throw new Error(`[dataStore.invoice] updateInvoiceFieldsSheets: uuid ${uuid} not found`);
  }
  const updates = [];
  for (const [field, value] of Object.entries(fields)) {
    const mapping = FIELD_TO_COL[field];
    if (!mapping) continue;
    updates.push({
      range:  `${INVOICE_SUBMISSIONS_TAB}!${mapping.col}${rowNum}`,
      values: [[mapping.toSheet(value)]],
    });
  }
  if (updates.length === 0) return;
  await batchUpdateRangesSA(SHEET_IDS.COLLECTION, updates);
}

async function insertInvoiceRejectionSheets(input) {
  // Sheets path: write rejection metadata directly into the submission row's
  // cols R-U (rejection_reason, rejection_note, rejected_by, rejected_at)
  // plus flip cols N-O to (returned, rejectedAt). Mirrors invoice-reject
  // handler in invoiceActions.js L1131-1133.
  const { submissionUuid, rejectedBy, reason, note } = input;
  const rejectedAt = input.rejectedAt || new Date().toISOString();
  const rowNum = await findRowByValueSA(
    SHEET_IDS.COLLECTION, INVOICE_SUBMISSIONS_TAB, 0, submissionUuid
  );
  if (!rowNum) {
    throw new Error(`[dataStore.invoice] insertInvoiceRejectionSheets: submission ${submissionUuid} not found`);
  }
  await batchUpdateRangesSA(SHEET_IDS.COLLECTION, [
    { range: `${INVOICE_SUBMISSIONS_TAB}!N${rowNum}:O${rowNum}`, values: [["returned", rejectedAt]] },
    { range: `${INVOICE_SUBMISSIONS_TAB}!R${rowNum}:U${rowNum}`, values: [[
      reason || "", note || "", rejectedBy, rejectedAt,
    ]] },
  ]);
  return { submissionUuid, rejectedAt, rejectedBy, reason: reason || "", note: note || "" };
}

async function unrejectInvoiceSheets(submissionUuid, _by) {
  // Sheets path: revert col N to 'sent' + clear cols R-U. Mirrors
  // invoice-unreject handler at L1191.
  const rowNum = await findRowByValueSA(
    SHEET_IDS.COLLECTION, INVOICE_SUBMISSIONS_TAB, 0, submissionUuid
  );
  if (!rowNum) {
    throw new Error(`[dataStore.invoice] unrejectInvoiceSheets: submission ${submissionUuid} not found`);
  }
  await batchUpdateRangesSA(SHEET_IDS.COLLECTION, [
    { range: `${INVOICE_SUBMISSIONS_TAB}!N${rowNum}:O${rowNum}`, values: [["sent", ""]] },
    { range: `${INVOICE_SUBMISSIONS_TAB}!R${rowNum}:U${rowNum}`, values: [["", "", "", ""]] },
  ]);
}

async function insertAILineItemsSheets(invoiceUuid, lineItems, opts = {}) {
  const accountKey = opts.accountKey || "Invoice Uploads";
  if (!lineItems || lineItems.length === 0) return;
  const now = new Date().toISOString();
  const rows = lineItems.map((item) => [
    invoiceUuid,
    now,
    accountKey,
    item.vendorName || "",
    item.invoiceNumber || "",
    item.invoiceDate || "",
    item.lineNum || 0,
    item.description || "",
    item.quantity != null ? String(item.quantity) : "",
    item.unit || "",
    item.unitPrice != null ? String(item.unitPrice) : "",
    item.extendedPrice != null ? String(item.extendedPrice) : "",
    item.category || "other",
    item.confidence || "high",
    item.rawJson || JSON.stringify(item),
  ]);
  // PR 6.1 keeps the per-account tab structure on the Sheets side.
  // PR 6.2 handler rewire removes the "Invoice Uploads" fallback path
  // since PG collapses per-account tabs into a single table.
  await appendRowsSA(SHEET_IDS.AI_LINE_ITEMS, accountKey, rows);
}

// ═══════════════════════════════════════════════════════════════
// POSTGRES ADAPTERS
// ═══════════════════════════════════════════════════════════════

// ── Reads ──

async function readInvoiceSubmissionsPostgres(opts = {}) {
  const { accountKey, status, period, page = 1, pageSize = DEFAULT_PAGE_SIZE, scope = "all" } = opts;
  const supabase = getServiceClient();
  let q = supabase.from("invoice_submissions").select("*", { count: "exact" });
  if (accountKey) q = q.eq("account_key", accountKey);
  if (status) q = q.eq("status", status);
  if (period === "week") {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    q = q.gte("submitted_at", cutoff);
  } else if (period === "month") {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    q = q.gte("submitted_at", cutoff);
  }
  if (scope === "historical") q = q.eq("is_historical", true);
  else if (scope === "current") q = q.eq("is_historical", false);
  q = q.order("submitted_at", { ascending: false });
  q = q.range((page - 1) * pageSize, (page - 1) * pageSize + pageSize - 1);

  const { data, error, count } = await q;
  if (error) throw new Error(`[dataStore.invoice.pg] getInvoiceSubmissions: ${error.message}`);
  return {
    rows:     (data || []).map(canonicalFromPgRow),
    total:    count ?? 0,
    page,
    pageSize,
    hasMore:  page * pageSize < (count ?? 0),
  };
}

async function readInvoiceSubmissionByUuidPostgres(uuid) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("invoice_submissions")
    .select("*")
    .eq("client_uuid", uuid)
    .maybeSingle();
  if (error) throw new Error(`[dataStore.invoice.pg] getInvoiceSubmissionByUuid: ${error.message}`);
  return data ? canonicalFromPgRow(data) : null;
}

async function findDuplicateSubmissionPostgres(input) {
  const { vendorId, invoiceNumber, invoiceDate, totalAmount, accountKey } = input;
  const normalized = normalizeInvoiceNumber(invoiceNumber);
  if (!vendorId || !normalized || !invoiceDate || totalAmount == null) return null;
  const supabase = getServiceClient();
  let q = supabase
    .from("invoice_submissions")
    .select("*")
    .eq("vendor_id", vendorId)
    .eq("invoice_number_normalized", normalized)
    .eq("invoice_date", invoiceDate)
    .eq("total_amount", Number(totalAmount).toFixed(2))
    .eq("dupe_override", false)
    .is("corrected_from_uuid", null)
    .not("status", "in", "(corrected,deleted)");
  if (accountKey) q = q.eq("account_key", accountKey);

  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw new Error(`[dataStore.invoice.pg] findDuplicateSubmission: ${error.message}`);
  return data ? canonicalFromPgRow(data) : null;
}

async function readInvoiceRejectionsForSubmissionPostgres(submissionUuid) {
  const supabase = getServiceClient();
  // Resolve uuid -> id (client_uuid is the user-facing key; rejections FK on id)
  const { data: sub, error: subErr } = await supabase
    .from("invoice_submissions")
    .select("id")
    .eq("client_uuid", submissionUuid)
    .maybeSingle();
  if (subErr) throw new Error(`[dataStore.invoice.pg] getInvoiceRejections submission lookup: ${subErr.message}`);
  if (!sub) return [];
  const { data, error } = await supabase
    .from("invoice_rejections")
    .select("*")
    .eq("submission_id", sub.id)
    .order("rejected_at", { ascending: false });
  if (error) throw new Error(`[dataStore.invoice.pg] getInvoiceRejections: ${error.message}`);
  return (data || []).map((r) => ({
    submissionUuid,
    rejectedAt:   pgTimestampToCanonical(r.rejected_at),
    rejectedBy:   r.rejected_by || "",
    reason:       r.reason || "",
    note:         r.note || "",
    unrejectedAt: pgTimestampToCanonical(r.unrejected_at),
    unrejectedBy: r.unrejected_by || "",
  }));
}

async function readAILineItemsForInvoicePostgres(invoiceUuid) {
  if (!invoiceUuid) return [];
  const supabase = getServiceClient();
  const { data: sub, error: subErr } = await supabase
    .from("invoice_submissions")
    .select("id, account_key")
    .eq("client_uuid", invoiceUuid)
    .maybeSingle();
  if (subErr) throw new Error(`[dataStore.invoice.pg] getAILineItems submission lookup: ${subErr.message}`);
  if (!sub) return [];
  const { data, error } = await supabase
    .from("ai_line_items")
    .select("*")
    .eq("invoice_uuid", sub.id)
    .order("line_num", { ascending: true });
  if (error) throw new Error(`[dataStore.invoice.pg] getAILineItems: ${error.message}`);
  return (data || []).map((r) => ({
    invoiceUuid:   invoiceUuid,
    accountKey:    r.account_key || "",
    vendorName:    r.vendor_name || "",
    invoiceNumber: r.invoice_number || "",
    invoiceDate:   r.invoice_date || "",
    lineNum:       r.line_num,
    description:   r.description || "",
    quantity:      r.quantity != null ? Number(r.quantity) : null,
    unit:          r.unit || "",
    unitPrice:     r.unit_price != null ? Number(r.unit_price) : null,
    extendedPrice: r.extended_price != null ? Number(r.extended_price) : null,
    category:      r.category || "",
    confidence:    r.confidence || "",
    rawJson:       r.raw_json != null ? JSON.stringify(r.raw_json) : "",
    isHistorical:  !!r.is_historical,
  }));
}

async function readGLCodesPostgres(opts = {}) {
  const { accountKey, includeInactive = false, includeNonPurchasing = false } = opts;
  if (!accountKey) return [];
  const supabase = getServiceClient();
  let q = supabase
    .from("gl_codes")
    .select("*")
    .eq("account_key", accountKey)
    .order("category", { ascending: true })
    .order("code", { ascending: true });
  if (!includeInactive) q = q.eq("active", true);
  if (!includeNonPurchasing) q = q.eq("is_purchasing", true);
  const { data, error } = await q;
  if (error) throw new Error(`[dataStore.invoice.pg] getGLCodes: ${error.message}`);
  return (data || []).map((r) => ({
    accountKey:    r.account_key,
    category:      r.category || null,
    code:          r.code,
    name:          r.name || "",
    isPurchasing:  !!r.is_purchasing,
    active:        !!r.active,
    isHistorical:  !!r.is_historical,
  }));
}

// ── Writes ──

async function upsertInvoiceSubmissionPostgres(input) {
  const supabase = getServiceClient();
  // F25: client_uuid UNIQUE handles dedup at DB level. Use upsert with
  // ON CONFLICT (client_uuid) DO NOTHING (ignoreDuplicates) so retries
  // are idempotent.
  const payload = {
    client_uuid:         input.uuid,
    submitter_email:     input.submitterEmail || "",
    account_key:         input.accountKey || "",
    vendor_name:         input.vendorName || "",
    vendor_id:           input.vendorId,
    invoice_number:      input.invoiceNumber || null,
    invoice_date:        parseDateOrNull(input.invoiceDate),
    total_amount:        Number(input.totalAmount || 0).toFixed(2),
    gl_breakdown:        input.glBreakdown || [],
    drive_urls:          input.driveUrls || [],
    page_count:          input.pageCount || 1,
    email_sent:          !!input.emailSent,
    status:              input.status || "sent",
    status_updated_at:   canonicalTimestampToPg(input.statusUpdatedAt),
    type:                input.type || "invoice",
    raw_drive_url:       input.rawDriveUrl || null,
    corrected_from_uuid: input.correctedFromUuid || null,
    dupe_override:       input.dupeOverride === "not_duplicate",
    // is_historical + data_provenance: PG defaults FALSE + 'app_scan' fire automatically
  };
  const { error } = await supabase
    .from("invoice_submissions")
    .upsert(payload, { onConflict: "client_uuid", ignoreDuplicates: true });
  if (error) throw new Error(`[dataStore.invoice.pg] upsertInvoiceSubmission: ${error.message}`);
}

async function updateInvoiceFieldsPostgres(uuid, fields) {
  const supabase = getServiceClient();
  const payload = {};
  if ("emailSent" in fields) payload.email_sent = !!fields.emailSent;
  if ("status" in fields) payload.status = fields.status;
  if ("statusUpdatedAt" in fields) payload.status_updated_at = canonicalTimestampToPg(fields.statusUpdatedAt);
  if ("type" in fields) payload.type = fields.type;
  if ("rawDriveUrl" in fields) payload.raw_drive_url = fields.rawDriveUrl || null;
  if ("correctedFromUuid" in fields) payload.corrected_from_uuid = fields.correctedFromUuid || null;
  if ("dupeOverride" in fields) {
    payload.dupe_override = fields.dupeOverride === "not_duplicate" || fields.dupeOverride === true;
  }
  if ("aiScanStatus" in fields) payload.ai_scan_status = fields.aiScanStatus || null;
  if (Object.keys(payload).length === 0) return;
  const { error } = await supabase
    .from("invoice_submissions")
    .update(payload)
    .eq("client_uuid", uuid);
  if (error) throw new Error(`[dataStore.invoice.pg] updateInvoiceFields: ${error.message}`);
}

async function insertInvoiceRejectionPostgres(input) {
  const supabase = getServiceClient();
  const { data: sub, error: subErr } = await supabase
    .from("invoice_submissions")
    .select("id")
    .eq("client_uuid", input.submissionUuid)
    .maybeSingle();
  if (subErr) throw new Error(`[dataStore.invoice.pg] insertInvoiceRejection submission lookup: ${subErr.message}`);
  if (!sub) {
    throw new Error(`[dataStore.invoice.pg] insertInvoiceRejection: submission ${input.submissionUuid} not in PG`);
  }
  const rejectedAt = input.rejectedAt || new Date().toISOString();
  const { error } = await supabase.from("invoice_rejections").insert({
    submission_id: sub.id,
    rejected_at:   rejectedAt,
    rejected_by:   input.rejectedBy,
    reason:        input.reason || null,
    note:          input.note || null,
    // is_historical defaults FALSE, data_provenance defaults 'app_scan'
  });
  if (error) throw new Error(`[dataStore.invoice.pg] insertInvoiceRejection: ${error.message}`);
  return { ...input, rejectedAt };
}

async function unrejectInvoicePostgres(submissionUuid, by) {
  const supabase = getServiceClient();
  const { data: sub, error: subErr } = await supabase
    .from("invoice_submissions")
    .select("id")
    .eq("client_uuid", submissionUuid)
    .maybeSingle();
  if (subErr) throw new Error(`[dataStore.invoice.pg] unrejectInvoice submission lookup: ${subErr.message}`);
  if (!sub) {
    throw new Error(`[dataStore.invoice.pg] unrejectInvoice: submission ${submissionUuid} not in PG`);
  }
  // Update most-recent rejection row (highest rejected_at) to record the unreject.
  const { data: latest, error: latestErr } = await supabase
    .from("invoice_rejections")
    .select("id")
    .eq("submission_id", sub.id)
    .is("unrejected_at", null)
    .order("rejected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) throw new Error(`[dataStore.invoice.pg] unrejectInvoice latest lookup: ${latestErr.message}`);
  if (!latest) return; // no active rejection to unreject
  const { error } = await supabase
    .from("invoice_rejections")
    .update({ unrejected_at: new Date().toISOString(), unrejected_by: by })
    .eq("id", latest.id);
  if (error) throw new Error(`[dataStore.invoice.pg] unrejectInvoice: ${error.message}`);
}

async function insertAILineItemsPostgres(invoiceUuid, lineItems) {
  if (!lineItems || lineItems.length === 0) return;
  const supabase = getServiceClient();
  const { data: sub, error: subErr } = await supabase
    .from("invoice_submissions")
    .select("id, account_key, vendor_name, invoice_number, invoice_date")
    .eq("client_uuid", invoiceUuid)
    .maybeSingle();
  if (subErr) throw new Error(`[dataStore.invoice.pg] insertAILineItems submission lookup: ${subErr.message}`);
  if (!sub) {
    throw new Error(`[dataStore.invoice.pg] insertAILineItems: submission ${invoiceUuid} not in PG`);
  }
  const rows = lineItems.map((item) => ({
    invoice_uuid:   sub.id,
    account_key:    sub.account_key,
    vendor_name:    item.vendorName || sub.vendor_name,
    invoice_number: item.invoiceNumber || sub.invoice_number,
    invoice_date:   parseDateOrNull(item.invoiceDate) || sub.invoice_date,
    line_num:       item.lineNum || 0,
    description:    item.description || "",
    quantity:       item.quantity != null ? item.quantity : null,
    unit:           item.unit || null,
    unit_price:     item.unitPrice != null ? item.unitPrice : null,
    extended_price: item.extendedPrice != null ? item.extendedPrice : null,
    category:       item.category || null,
    confidence:     item.confidence || null,
    raw_json:       item.rawJson ? safeParseJson(item.rawJson) : null,
    // is_historical + data_provenance default FALSE + 'app_scan'
  }));
  const { error } = await supabase.from("ai_line_items").insert(rows);
  if (error) throw new Error(`[dataStore.invoice.pg] insertAILineItems: ${error.message}`);
}

function safeParseJson(s) {
  try {
    return typeof s === "string" ? JSON.parse(s) : s;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API ORCHESTRATORS (dispatched by cutover flags)
// ═══════════════════════════════════════════════════════════════

// ── Reads ──

/**
 * Paginated list of invoice submissions.
 *   opts: { accountKey?, status?, period?, page?, pageSize?, scope?, module? }
 *     scope = 'all' (default) | 'historical' | 'current'
 * Returns: { rows, total, page, pageSize, hasMore }
 *
 * PR 5.1+PR 5-fix lesson: orchestrators accept opts.module for per-
 * module read flag. PR 6.2 handlers MUST pass module: "ops".
 */
export async function getInvoiceSubmissions(opts = {}) {
  if (isReadFromPostgres(INVOICE_SUBMISSIONS_TAB, opts.module)) {
    return readInvoiceSubmissionsPostgres(opts);
  }
  return readInvoiceSubmissionsSheets(opts);
}

/**
 * Single submission by client_uuid. Returns canonical record or null.
 *   opts: { module? }
 *
 * PR 5.1+PR 5-fix lesson: orchestrators accept opts.module for per-
 * module read flag.
 */
export async function getInvoiceSubmissionByUuid(uuid, opts = {}) {
  if (isReadFromPostgres(INVOICE_SUBMISSIONS_TAB, opts.module)) {
    return readInvoiceSubmissionByUuidPostgres(uuid);
  }
  return readInvoiceSubmissionByUuidSheets(uuid);
}

/**
 * F24 duplicate check. Returns the duplicate's canonical record or null.
 *   input: { vendorId, invoiceNumber, invoiceDate, totalAmount, accountKey? }
 *   opts:  { module? }
 *
 * PR 5.1+PR 5-fix lesson: orchestrators accept opts.module for per-
 * module read flag.
 */
export async function findDuplicateSubmission(input, opts = {}) {
  if (isReadFromPostgres(INVOICE_SUBMISSIONS_TAB, opts.module)) {
    return findDuplicateSubmissionPostgres(input);
  }
  return findDuplicateSubmissionSheets(input);
}

/**
 * Read rejection history for a submission. Returns array (0+ rows).
 *   opts: { module? }
 *
 * PR 5.1+PR 5-fix lesson: orchestrators accept opts.module for per-
 * module read flag.
 */
export async function getInvoiceRejectionsForSubmission(submissionUuid, opts = {}) {
  if (isReadFromPostgres(INVOICE_REJECTIONS_TAB, opts.module)) {
    return readInvoiceRejectionsForSubmissionPostgres(submissionUuid);
  }
  return readInvoiceRejectionsForSubmissionSheets(submissionUuid);
}

/**
 * AI line items for a single invoice. Returns array.
 *   opts: { module?, accountKey? }
 *     accountKey is REQUIRED on Sheets path (locates per-account tab).
 *
 * PR 5.1+PR 5-fix lesson: orchestrators accept opts.module for per-
 * module read flag.
 */
export async function getAILineItemsForInvoice(invoiceUuid, opts = {}) {
  if (isReadFromPostgres(AI_LINE_ITEMS_TAB, opts.module)) {
    return readAILineItemsForInvoicePostgres(invoiceUuid);
  }
  return readAILineItemsForInvoiceSheets(invoiceUuid, opts.accountKey);
}

/**
 * GL codes for an account. Returns array.
 *   opts: { accountKey, includeInactive?, includeNonPurchasing?, module? }
 *
 * PR 5.1+PR 5-fix lesson: orchestrators accept opts.module for per-
 * module read flag.
 */
export async function getGLCodes(opts = {}) {
  if (isReadFromPostgres(GL_CODES_TAB, opts.module)) {
    return readGLCodesPostgres(opts);
  }
  return readGLCodesSheets(opts);
}

// ── Writes ──

/**
 * Insert a new invoice submission with F25 client_uuid idempotency.
 *   input: {
 *     uuid (required - F25 idempotency key),
 *     submitterEmail, accountKey, vendorName, vendorId,
 *     invoiceNumber, invoiceDate, totalAmount, glBreakdown,
 *     driveUrls, pageCount, type, rawDriveUrl, correctedFromUuid?,
 *   }
 *
 * Sheets first (rollback target). PG conditional on isDualWrite.
 * Note: uuid here is what the frontend supplies as F25 idempotency
 * key. PG stores it as client_uuid (UNIQUE); the PG row's id is a
 * separate UUID. Reads dispatch by client_uuid.
 */
export async function upsertInvoiceSubmission(input) {
  if (!input.uuid) {
    throw new Error("[dataStore.invoice] upsertInvoiceSubmission: uuid required for F25 idempotency");
  }
  await upsertInvoiceSubmissionSheets(input);
  if (isDualWrite(INVOICE_SUBMISSIONS_TAB)) {
    await upsertInvoiceSubmissionPostgres(input);
  }
}

/**
 * Partial update of invoice submission fields.
 *   uuid:   client_uuid of the row
 *   fields: any subset of {
 *     emailSent, status, statusUpdatedAt, type, rawDriveUrl,
 *     correctedFromUuid, dupeOverride, aiScanStatus
 *   }
 *   opts: reserved (none today)
 *
 * Replaces what would have been separate markEmailSent +
 * updateInvoiceStatus + setDupeOverride orchestrators. Sheets path
 * writes only the cells corresponding to provided fields.
 */
export async function updateInvoiceFields(uuid, fields, _opts = {}) {
  if (!uuid) throw new Error("[dataStore.invoice] updateInvoiceFields: uuid required");
  if (!fields || Object.keys(fields).length === 0) return;
  await updateInvoiceFieldsSheets(uuid, fields);
  if (isDualWrite(INVOICE_SUBMISSIONS_TAB)) {
    await updateInvoiceFieldsPostgres(uuid, fields);
  }
}

/**
 * Insert a new rejection record for a submission.
 *   input: { submissionUuid, rejectedBy, reason?, note?, rejectedAt? }
 *
 * Sheets path writes cols R-U on the submission row + flips col N
 * (status) to 'returned'. PG path inserts into invoice_rejections.
 * Returns the inserted record.
 */
export async function insertInvoiceRejection(input) {
  if (!input.submissionUuid) {
    throw new Error("[dataStore.invoice] insertInvoiceRejection: submissionUuid required");
  }
  if (!input.rejectedBy) {
    throw new Error("[dataStore.invoice] insertInvoiceRejection: rejectedBy required");
  }
  const sheetsResult = await insertInvoiceRejectionSheets(input);
  if (isDualWrite(INVOICE_REJECTIONS_TAB)) {
    await insertInvoiceRejectionPostgres({ ...input, rejectedAt: sheetsResult.rejectedAt });
  }
  return sheetsResult;
}

/**
 * Mark the most recent rejection as unrejected + revert workflow status.
 *   submissionUuid: client_uuid
 *   by:             email of the unrejecting admin
 */
export async function unrejectInvoice(submissionUuid, by, _opts = {}) {
  if (!submissionUuid) {
    throw new Error("[dataStore.invoice] unrejectInvoice: submissionUuid required");
  }
  await unrejectInvoiceSheets(submissionUuid, by);
  if (isDualWrite(INVOICE_REJECTIONS_TAB)) {
    await unrejectInvoicePostgres(submissionUuid, by);
  }
}

/**
 * Bulk insert AI-extracted line items for an invoice.
 *   invoiceUuid: client_uuid of the parent submission
 *   lineItems: [{ lineNum, description, quantity, unit, unitPrice,
 *                 extendedPrice, category, confidence, rawJson,
 *                 vendorName?, invoiceNumber?, invoiceDate? }]
 *   opts: { accountKey } (REQUIRED on Sheets path to locate per-account tab)
 *
 * Note: PR 6.1's Sheets adapter preserves the "Invoice Uploads"
 * fallback tab when accountKey is missing. PR 6.2 handler rewire
 * removes the fallback (PG schema collapses per-account tabs into
 * single ai_line_items table with account_key column).
 */
export async function insertAILineItems(invoiceUuid, lineItems, opts = {}) {
  if (!invoiceUuid) {
    throw new Error("[dataStore.invoice] insertAILineItems: invoiceUuid required");
  }
  if (!lineItems || lineItems.length === 0) return;
  await insertAILineItemsSheets(invoiceUuid, lineItems, opts);
  if (isDualWrite(AI_LINE_ITEMS_TAB)) {
    await insertAILineItemsPostgres(invoiceUuid, lineItems);
  }
}
