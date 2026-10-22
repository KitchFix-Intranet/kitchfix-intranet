// src/lib/purchasing/reportCsvParser.js
//
// Shared CSV parser + column spec for the nightly Rippling report.
// Semantics-identical to the inline parser in
// scripts/purchasing_report_txns_load.mjs - lifted here so a second
// loader can share it without duplicating the two-pass header match
// or the content-hash discipline.
//
// Pure functions only; no I/O, no DB client. Importable from any
// loader that consumes the same CSV.

import { createHash } from "node:crypto";

// RFC-4180 CSV parser. Byte-identical to the inline version in
// purchasing_report_txns_load.mjs: handles quoted fields, escaped
// double-quotes, embedded newlines, CRLF or LF line endings.
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") { field += "\""; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++;
    } else {
      if (ch === "\"") { inQuotes = true; i++; }
      else if (ch === ",") { row.push(field); field = ""; i++; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
      else if (ch === "\r") { i++; }
      else { field += ch; i++; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Normalise header strings for the two-pass column match.
export function normalise(h) {
  return String(h || "").trim().toLowerCase();
}

// Second-pass helper: strip a trailing ` (group-label)` suffix that
// Rippling appends to grouped columns.
export function stripTrailingParenGroup(h) {
  return String(h || "").trim().replace(/\s+\([^()]*\)\s*$/, "").trim();
}

// Field parsers.
export function parseBool(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "yes" || s === "1")  return true;
  if (s === "false" || s === "no" || s === "0") return false;
  return null;
}
export function parseDate(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}
export function parseTimestamp(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  const d = parseDate(s);
  return d ? `${d}T00:00:00Z` : null;
}
export function parseAmount(v) {
  if (v == null || v === "") return null;
  const s = String(v).replace(/[$,\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
export function trim(v) { if (v == null) return null; const s = String(v).trim(); return s === "" ? null : s; }

// Projected columns from the Rippling report CSV. Keys are the shape
// landed in rippling_report_txns (and consumed by reportToActualsMap).
// Matching is two-pass against normalise(csv) and then
// normalise(stripTrailingParenGroup(csv)) so a grouped-report regroup
// does not silently NULL a column.
export const COL_SPEC = Object.freeze([
  { csv: "Transaction ID",       col: "parent_txn_id",   parse: trim },
  { csv: "Purchased at",         col: "purchased_at",    parse: parseDate },
  { csv: "Posted Date",          col: "posted_date",     parse: parseDate },
  { csv: "Submission Date",      col: "submission_date", parse: parseDate },
  { csv: "Approved At",          col: "approved_at",     parse: parseTimestamp },
  { csv: "Approval State",       col: "approval_state",  parse: trim },
  { csv: "Has Receipt",          col: "has_receipt",     parse: parseBool },
  { csv: "Amount (by category)", col: "amount",          parse: parseAmount },
  { csv: "Currency",             col: "currency",        parse: trim },
  { csv: "Vendor name",          col: "vendor_name",     parse: trim },
  { csv: "Vendor",               col: "vendor",          parse: trim },
  { csv: "Category",             col: "category",        parse: trim },
  { csv: "Category Name",        col: "category_name",   parse: trim },
  { csv: "Department Name",      col: "department_name", parse: trim },
  { csv: "Work location",        col: "work_location",   parse: trim },
  { csv: "Employee",             col: "employee",        parse: trim },   // PII - never log
  { csv: "Employee - ID",        col: "employee_id",     parse: trim },   // PII - never log
  { csv: "Memo",                 col: "memo",            parse: trim },
  { csv: "Line item memo",       col: "line_item_memo",  parse: trim },
  { csv: "GL Sync Status",       col: "gl_sync_status",  parse: trim },
  { csv: "GL Vendor Name",       col: "gl_vendor_name",  parse: trim },
  { csv: "Is Manually Paid",     col: "is_manually_paid",parse: parseBool },
  { csv: "Repayment Status",     col: "repayment_status",parse: trim },
  { csv: "Is user edited",       col: "is_user_edited",  parse: parseBool },
]);

// Content hash: deterministic sorted-keys SHA-256 over the projected
// values. Byte-identical to the inline hash in the txns loader.
export function contentHash(projected) {
  const keys = Object.keys(projected).sort();
  const canonical = keys.map(k => `${k}=${JSON.stringify(projected[k])}`).join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

// Full parse: read CSV text + header-match spec columns + project each
// data row + compute content_hash. Returns an array of row objects with
// projected fields + `content_hash` + `_raw` (all header/value pairs
// preserved for future column additions, same as the txns loader).
//
// Throws on REQUIRED column absence. `requiredCols` is a set of
// projected column names (default: parent_txn_id + purchased_at +
// amount + currency + work_location).
export function readReportCsv(text, { requiredCols = DEFAULT_REQUIRED } = {}) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("csv is empty or header-only");
  const header = rows[0].map(h => h.trim());

  const specByKey = new Map();
  for (const s of COL_SPEC) specByKey.set(normalise(s.csv), s);

  const specToCsvIdx = new Map();
  for (let i = 0; i < header.length; i++) {
    const raw = header[i];
    if (!raw) continue;
    const keyA = normalise(raw);
    let spec = specByKey.get(keyA);
    if (!spec) {
      const stripped = normalise(stripTrailingParenGroup(raw));
      if (stripped !== keyA) spec = specByKey.get(stripped);
    }
    if (!spec) continue;
    if (specToCsvIdx.has(spec.col)) continue; // first-wins on duplicate headers
    specToCsvIdx.set(spec.col, i);
  }

  const missing = [];
  for (const spec of COL_SPEC) {
    if (!specToCsvIdx.has(spec.col)) missing.push(spec);
  }
  const requiredMissing = missing.filter(s => requiredCols.has(s.col));
  if (requiredMissing.length > 0) {
    const names = requiredMissing.map(s => `${s.col} ("${s.csv}")`).join(", ");
    throw new Error(`REQUIRED column(s) missing from CSV: ${names}`);
  }

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const rowArr = rows[i];
    const projected = {};
    for (const spec of COL_SPEC) {
      const idx = specToCsvIdx.get(spec.col);
      projected[spec.col] = idx == null ? null : spec.parse(rowArr[idx]);
    }
    if (!projected.parent_txn_id) continue;
    const _raw = {};
    for (let c = 0; c < header.length; c++) {
      if (header[c]) _raw[header[c]] = rowArr[c] ?? null;
    }
    out.push({ ...projected, content_hash: contentHash(projected), _raw });
  }
  return out;
}

const DEFAULT_REQUIRED = new Set([
  "parent_txn_id",
  "purchased_at",
  "amount",
  "currency",
  "work_location",
  "approval_state",
]);
