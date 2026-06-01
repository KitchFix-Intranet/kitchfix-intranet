// ════════════════════════════════════════════════════════════════════════════
// PR 6.3 Phase 4 spot-check verification.
//
// Picks 3 representative invoices and does field-by-field comparison of
// Sheets source vs PG backfill result, including FK'd children.
//
// SELECTION
//   Sample 1: most recent rejected invoice (validates rejections FK +
//             cols R-U preservation + multi-line note preservation)
//   Sample 2: most recent invoice with 5+ ai_line_items (validates
//             line item resolution path)
//   Sample 3: most recent correction (validates corrected_from_uuid
//             resolution + verifies the parent has status='corrected')
//
// USAGE
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local scripts/verify-pr-6-3-spot-check.mjs
//
// OUTPUT
//   Per-sample side-by-side comparison + match/mismatch markers.
//   Final verdict: PASS / FAIL.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { readSheetSA, SHEET_IDS } from "../src/lib/sheets.js";

const SUB_IDX = {
  uuid: 0, timestamp: 1, submitterEmail: 2, account: 3, vendor: 4, vendorId: 5,
  invoiceNumber: 6, invoiceDate: 7, totalAmount: 8, glBreakdown: 9, driveUrls: 10,
  pageCount: 11, emailSent: 12, status: 13, statusUpdatedAt: 14, type: 15,
  rawDriveUrl: 16, rejectionReason: 17, rejectionNote: 18, rejectedBy: 19,
  rejectedAt: 20, correctedFromUuid: 21, dupeOverride: 22,
};

const LINE_IDX = {
  invoiceUuid: 0, timestamp: 1, account: 2, vendor: 3, invoiceNumber: 4,
  invoiceDate: 5, lineNum: 6, description: 7, quantity: 8, unit: 9,
  unitPrice: 10, extendedPrice: 11, category: 12, confidence: 13, rawJson: 14,
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ─────────────────────────────────────────────────────────────
// Compare helpers
// ─────────────────────────────────────────────────────────────
function pad(s, w) { return String(s).padEnd(w); }
function truncate(s, n) {
  const str = String(s);
  if (str.length <= n) return str;
  return str.slice(0, n - 3) + "...";
}

function showRow(field, sheetsVal, pgVal, match) {
  const marker = match ? "OK" : "FAIL";
  console.log(`  ${pad(field, 22)} | ${pad(truncate(sheetsVal, 32), 32)} | ${pad(truncate(pgVal, 32), 32)} | ${marker}`);
}

function numEq(a, b, tol = 0.005) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < tol;
}

function strEq(a, b) {
  if (a == null && b == null) return true;
  if (a == null && b === "") return true;
  if (b == null && a === "") return true;
  return String(a || "").trim() === String(b || "").trim();
}

function dateEq(a, b) {
  // PG returns YYYY-MM-DD; Sheets stores YYYY-MM-DD. Trim.
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return String(a).slice(0, 10) === String(b).slice(0, 10);
}

function tsEq(a, b, tolMs = 100) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return Math.abs(da.getTime() - db.getTime()) < tolMs;
}

// Deep-equal that is INSENSITIVE to JSON object key order (PG JSONB
// normalizes key order on insert, so stringify comparison produces
// false positives even when content is identical).
function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEq(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => deepEq(a[k], b[k]));
  }
  return false;
}

function arrayEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return deepEq(a, b);
}

// Parse glBreakdown from Sheets JSON string into array.
function parseGlBreakdown(s) {
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}

function parseDriveUrls(s) {
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    if (Array.isArray(p)) return p.filter(Boolean);
  } catch {}
  return String(s).split(",").map((u) => u.trim()).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────
// Per-sample compare
// ─────────────────────────────────────────────────────────────

let totalChecks = 0;
let totalFailures = 0;

async function compareSubmission(label, pgRow, sheetsRow) {
  console.log(`\n${label}`);
  console.log("-".repeat(108));
  console.log(`  ${pad("FIELD", 22)} | ${pad("SHEETS", 32)} | ${pad("PG", 32)} | RESULT`);
  console.log("  " + "-".repeat(104));

  const checks = [
    ["client_uuid",       sheetsRow[SUB_IDX.uuid],           pgRow.client_uuid,     strEq],
    ["submitter_email",   sheetsRow[SUB_IDX.submitterEmail], pgRow.submitter_email, strEq],
    ["account_key",       sheetsRow[SUB_IDX.account],        pgRow.account_key,     strEq],
    ["vendor_name",       sheetsRow[SUB_IDX.vendor],         pgRow.vendor_name,     strEq],
    ["vendor_id",         sheetsRow[SUB_IDX.vendorId],       pgRow.vendor_id,       strEq],
    ["invoice_number",    sheetsRow[SUB_IDX.invoiceNumber],  pgRow.invoice_number,  strEq],
    ["invoice_date",      sheetsRow[SUB_IDX.invoiceDate],    pgRow.invoice_date,    dateEq],
    ["total_amount",      sheetsRow[SUB_IDX.totalAmount],    pgRow.total_amount,    numEq],
    ["page_count",        sheetsRow[SUB_IDX.pageCount],      pgRow.page_count,      numEq],
    ["status",            sheetsRow[SUB_IDX.status],         null,                  null],   // special; below
    ["type",              sheetsRow[SUB_IDX.type] || "invoice", pgRow.type,         strEq],
    ["raw_drive_url",     sheetsRow[SUB_IDX.rawDriveUrl] || null, pgRow.raw_drive_url, strEq],
    ["submitted_at",      sheetsRow[SUB_IDX.timestamp],      pgRow.submitted_at,    tsEq],
    ["status_updated_at", sheetsRow[SUB_IDX.statusUpdatedAt] || null, pgRow.status_updated_at, tsEq],
    ["email_sent",        String(sheetsRow[SUB_IDX.emailSent] || "").toUpperCase() === "TRUE",
                          pgRow.email_sent, (a, b) => a === b],
    ["dupe_override",     String(sheetsRow[SUB_IDX.dupeOverride] || "").toLowerCase() === "not_duplicate",
                          pgRow.dupe_override, (a, b) => a === b],
    ["is_historical",     true, pgRow.is_historical, (a, b) => a === b],
    ["data_provenance",   "app_scan", pgRow.data_provenance, strEq],
  ];

  for (const [field, sVal, pVal, eq] of checks) {
    if (field === "status") {
      // Status enum split: Sheets value may be a workflow status (kept)
      // or an AI scan status (mapped to status='sent' + ai_scan_status=<value>).
      const rawStatus = String(sVal || "sent").trim().toLowerCase();
      const WORKFLOW = new Set(["sent", "returned", "corrected", "deleted"]);
      const AI       = new Set(["pending", "complete", "failed", "photo-only"]);
      let expectedStatus = rawStatus;
      let expectedAi = null;
      if (AI.has(rawStatus)) {
        expectedStatus = "sent";
        expectedAi = rawStatus;
      } else if (!WORKFLOW.has(rawStatus) && rawStatus) {
        expectedStatus = rawStatus; // preserved verbatim per is_historical CHECK
      }
      const statusMatch = pgRow.status === expectedStatus;
      const aiMatch = pgRow.ai_scan_status === expectedAi;
      totalChecks += 2;
      if (!statusMatch) totalFailures++;
      if (!aiMatch) totalFailures++;
      showRow("status (split: status)",      expectedStatus,  pgRow.status,         statusMatch);
      showRow("status (split: ai_scan_status)", expectedAi,   pgRow.ai_scan_status, aiMatch);
      continue;
    }
    const match = eq(sVal, pVal);
    totalChecks++;
    if (!match) totalFailures++;
    showRow(field, sVal, pVal, match);
  }

  // JSON arrays: glBreakdown + drive_urls
  const glS = parseGlBreakdown(sheetsRow[SUB_IDX.glBreakdown]);
  const glP = pgRow.gl_breakdown || [];
  const glMatch = arrayEq(glS, glP);
  totalChecks++;
  if (!glMatch) totalFailures++;
  showRow("gl_breakdown",      `[${glS.length} items]`, `[${glP.length} items]`, glMatch);

  const duS = parseDriveUrls(sheetsRow[SUB_IDX.driveUrls]);
  const duP = pgRow.drive_urls || [];
  const duMatch = arrayEq(duS, duP);
  totalChecks++;
  if (!duMatch) totalFailures++;
  showRow("drive_urls",        `[${duS.length} urls]`,  `[${duP.length} urls]`,  duMatch);
}

// ─────────────────────────────────────────────────────────────
// Sample picker + driver
// ─────────────────────────────────────────────────────────────

async function pickSample1RejectedInvoice() {
  const { data: rej, error } = await supabase
    .from("invoice_rejections")
    .select("submission_id, rejected_at, reason, note, rejected_by")
    .order("rejected_at", { ascending: false })
    .limit(1);
  if (error || !rej || !rej.length) throw new Error(`pick S1: ${error?.message || "no rejections"}`);
  const { data: sub, error: e2 } = await supabase
    .from("invoice_submissions")
    .select("*")
    .eq("id", rej[0].submission_id)
    .single();
  if (e2) throw new Error(`pick S1 sub: ${e2.message}`);
  return { rejection: rej[0], submission: sub };
}

async function pickSample2InvoiceWithLines() {
  // Find an invoice with 5+ in-bounds line items.
  const { data, error } = await supabase
    .from("ai_line_items")
    .select("invoice_uuid")
    .not("invoice_uuid", "is", null)
    .eq("is_historical", true);
  if (error) throw new Error(`pick S2: ${error.message}`);
  const counts = {};
  for (const r of data) counts[r.invoice_uuid] = (counts[r.invoice_uuid] || 0) + 1;
  const candidate = Object.entries(counts)
    .filter(([, n]) => n >= 5 && n <= 12)
    .sort(([, a], [, b]) => a - b)[0];
  if (!candidate) throw new Error("pick S2: no invoice with 5-12 line items");
  const [invoiceUuid, lineCount] = candidate;
  const { data: sub, error: e2 } = await supabase
    .from("invoice_submissions")
    .select("*")
    .eq("id", invoiceUuid)
    .single();
  if (e2) throw new Error(`pick S2 sub: ${e2.message}`);
  const { data: lines, error: e3 } = await supabase
    .from("ai_line_items")
    .select("*")
    .eq("invoice_uuid", invoiceUuid)
    .order("line_num", { ascending: true });
  if (e3) throw new Error(`pick S2 lines: ${e3.message}`);
  return { submission: sub, lines, lineCount };
}

async function pickSample3Correction() {
  // Most recent correction (corrected_from_uuid not null).
  const { data, error } = await supabase
    .from("invoice_submissions")
    .select("*")
    .not("corrected_from_uuid", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(1);
  if (error || !data || !data.length) throw new Error(`pick S3: ${error?.message || "no corrections"}`);
  const correction = data[0];
  const { data: parent, error: e2 } = await supabase
    .from("invoice_submissions")
    .select("*")
    .eq("id", correction.corrected_from_uuid)
    .single();
  if (e2) throw new Error(`pick S3 parent: ${e2.message}`);
  return { correction, parent };
}

// Sheets row reader: scan invoice_submissions_26 by client_uuid.
let _sheetsRows = null;
async function findSheetsRow(clientUuid) {
  if (!_sheetsRows) {
    const { rows } = await readSheetSA(SHEET_IDS.COLLECTION, "invoice_submissions_26");
    _sheetsRows = rows;
  }
  return _sheetsRows.find((r) => String(r[SUB_IDX.uuid] || "").trim() === clientUuid);
}

// Sheets line item reader: scan all 9 AI tabs by invoice_uuid (client_uuid form).
let _sheetsLineItemRows = null;
async function findSheetsLineItems(clientUuid, accountKey) {
  if (!_sheetsLineItemRows) {
    const AI_TABS = ["STL - FL", "STL - MO", "CIN - OH", "TXR - TX - H", "TXR - TX - V",
                     "TXR - AZ", "CIN - AZ", "TBR - FL", "TBJ - FL"];
    _sheetsLineItemRows = [];
    for (const tab of AI_TABS) {
      try {
        const { rows } = await readSheetSA(SHEET_IDS.AI_LINE_ITEMS, tab);
        for (const r of rows) _sheetsLineItemRows.push({ tab, row: r });
      } catch (e) {
        console.warn(`(read) AI tab "${tab}" failed: ${e.message}`);
      }
    }
  }
  return _sheetsLineItemRows
    .filter(({ tab, row }) => {
      return String(row[LINE_IDX.invoiceUuid] || "").trim() === clientUuid &&
             (accountKey ? tab === accountKey : true);
    })
    .sort((a, b) =>
      Number(a.row[LINE_IDX.lineNum] || 0) - Number(b.row[LINE_IDX.lineNum] || 0)
    );
}

// ─────────────────────────────────────────────────────────────
// Driver
// ─────────────────────────────────────────────────────────────
console.log("=".repeat(108));
console.log("PR 6.3 PHASE 4 SPOT-CHECK VERIFICATION");
console.log("=".repeat(108));

// ── Sample 1: most recent rejected invoice ──
try {
  const { rejection, submission } = await pickSample1RejectedInvoice();
  console.log(`\n### SAMPLE 1: rejected invoice (client_uuid=${submission.client_uuid.slice(0, 8)})`);
  console.log(`Selection criteria: most recent rejection by rejected_at`);
  console.log(`PG submission id: ${submission.id}`);
  console.log(`PG rejection: rejected_at=${rejection.rejected_at}, by=${rejection.rejected_by}`);

  const sheetsRow = await findSheetsRow(submission.client_uuid);
  if (!sheetsRow) {
    console.log("FAIL: Sheets row not found for client_uuid");
    totalFailures++;
  } else {
    await compareSubmission("Submission fields", submission, sheetsRow);

    // Rejection-specific fields (cols R-U)
    console.log(`\n  Rejection embedded fields (cols R-U):`);
    console.log("  " + "-".repeat(104));
    const checks = [
      ["reason",      sheetsRow[SUB_IDX.rejectionReason], rejection.reason, strEq],
      ["note",        sheetsRow[SUB_IDX.rejectionNote],   rejection.note,   strEq],
      ["rejected_by", sheetsRow[SUB_IDX.rejectedBy],      rejection.rejected_by, strEq],
      ["rejected_at", sheetsRow[SUB_IDX.rejectedAt],      rejection.rejected_at, tsEq],
    ];
    for (const [f, s, p, eq] of checks) {
      const m = eq(s, p);
      totalChecks++;
      if (!m) totalFailures++;
      showRow(f, s, p, m);
    }
  }
} catch (e) {
  console.error(`SAMPLE 1 ERROR: ${e.message}`);
  totalFailures++;
}

// ── Sample 2: invoice with ai_line_items ──
try {
  const { submission, lines, lineCount } = await pickSample2InvoiceWithLines();
  console.log(`\n\n### SAMPLE 2: invoice with ${lineCount} line items (client_uuid=${submission.client_uuid.slice(0, 8)})`);
  console.log(`Selection criteria: in-bounds invoice with 5-12 ai_line_items rows`);
  console.log(`PG submission id: ${submission.id}`);
  console.log(`PG line count: ${lines.length}`);

  const sheetsRow = await findSheetsRow(submission.client_uuid);
  if (!sheetsRow) {
    console.log("FAIL: Sheets row not found");
    totalFailures++;
  } else {
    await compareSubmission("Submission fields", submission, sheetsRow);

    // Compare line counts + sample 3 line items
    const sheetsLines = await findSheetsLineItems(submission.client_uuid, submission.account_key);
    const lineCountMatch = sheetsLines.length === lines.length;
    totalChecks++;
    if (!lineCountMatch) totalFailures++;
    console.log(`\n  Line item count: Sheets=${sheetsLines.length} / PG=${lines.length} | ${lineCountMatch ? "OK" : "FAIL"}`);

    if (lineCountMatch && sheetsLines.length > 0) {
      console.log(`\n  Per-line comparison (first 3 lines):`);
      for (let i = 0; i < Math.min(3, sheetsLines.length); i++) {
        const sLine = sheetsLines[i].row;
        const pLine = lines[i];
        console.log(`\n  Line ${i + 1}:`);
        const chks = [
          ["line_num",       sLine[LINE_IDX.lineNum],       pLine.line_num,       numEq],
          ["description",    sLine[LINE_IDX.description],   pLine.description,    strEq],
          ["quantity",       sLine[LINE_IDX.quantity],      pLine.quantity,       numEq],
          ["unit",           sLine[LINE_IDX.unit],          pLine.unit,           strEq],
          ["unit_price",     sLine[LINE_IDX.unitPrice],     pLine.unit_price,     numEq],
          ["extended_price", sLine[LINE_IDX.extendedPrice], pLine.extended_price, numEq],
          ["category",       sLine[LINE_IDX.category],      pLine.category,       strEq],
          ["vendor_name",    sLine[LINE_IDX.vendor],        pLine.vendor_name,    strEq],
        ];
        for (const [f, s, p, eq] of chks) {
          const m = eq(s, p);
          totalChecks++;
          if (!m) totalFailures++;
          showRow(f, s, p, m);
        }
      }
    }
  }
} catch (e) {
  console.error(`SAMPLE 2 ERROR: ${e.message}`);
  totalFailures++;
}

// ── Sample 3: correction ──
try {
  const { correction, parent } = await pickSample3Correction();
  console.log(`\n\n### SAMPLE 3: correction (child client_uuid=${correction.client_uuid.slice(0, 8)} -> parent client_uuid=${parent.client_uuid.slice(0, 8)})`);
  console.log(`Selection criteria: most recent correction`);
  console.log(`PG correction id: ${correction.id}, parent id: ${parent.id}`);

  const sheetsCorrection = await findSheetsRow(correction.client_uuid);
  const sheetsParent     = await findSheetsRow(parent.client_uuid);

  if (!sheetsCorrection) {
    console.log("FAIL: Sheets row for correction not found");
    totalFailures++;
  } else {
    await compareSubmission("Correction submission fields", correction, sheetsCorrection);

    // Verify the corrected_from_uuid link
    const sheetsCorrFrom = String(sheetsCorrection[SUB_IDX.correctedFromUuid] || "").trim();
    const linkMatch = sheetsCorrFrom === parent.client_uuid;
    totalChecks++;
    if (!linkMatch) totalFailures++;
    console.log(`\n  corrected_from_uuid link:`);
    console.log("  " + "-".repeat(104));
    showRow("Sheets col V -> parent client_uuid", sheetsCorrFrom.slice(0, 16), parent.client_uuid.slice(0, 16), linkMatch);
    showRow("PG correction.corrected_from_uuid", correction.corrected_from_uuid?.slice(0, 16), parent.id?.slice(0, 16),
            correction.corrected_from_uuid === parent.id);
    totalChecks++;
    if (correction.corrected_from_uuid !== parent.id) totalFailures++;
  }

  if (!sheetsParent) {
    console.log("FAIL: Sheets row for parent not found");
    totalFailures++;
  } else {
    // Verify parent's status='corrected' in both Sheets + PG.
    const sheetsParentStatus = String(sheetsParent[SUB_IDX.status] || "sent").trim().toLowerCase();
    const pgParentStatus = parent.status;
    const sheetsParentIsCorrected = sheetsParentStatus === "corrected";
    const pgParentIsCorrected = pgParentStatus === "corrected";
    totalChecks += 2;
    if (!sheetsParentIsCorrected) totalFailures++;
    if (!pgParentIsCorrected) totalFailures++;
    console.log(`\n  Parent status flip check (the correction should have flipped the parent to 'corrected'):`);
    console.log("  " + "-".repeat(104));
    showRow("Sheets parent status", sheetsParentStatus, "'corrected' expected", sheetsParentIsCorrected);
    showRow("PG parent status",     pgParentStatus,     "'corrected' expected", pgParentIsCorrected);
  }
} catch (e) {
  console.error(`SAMPLE 3 ERROR: ${e.message}`);
  totalFailures++;
}

// ── Verdict ──
console.log(`\n${"=".repeat(108)}`);
console.log(`VERDICT: ${totalChecks} checks, ${totalFailures} failures`);
if (totalFailures === 0) {
  console.log("PASS - all field comparisons match. Ready for PR open.");
} else {
  console.log(`FAIL - ${totalFailures} discrepancies found. STOP and diagnose.`);
}
console.log("=".repeat(108));
