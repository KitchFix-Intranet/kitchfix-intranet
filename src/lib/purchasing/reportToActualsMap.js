// ─── Cutover floor ───────────────────────────────────────────────────
//
// The dead API walk owned card spend up to 2026-10-05 (P11 start).
// Starting with that date, the report-based ingest is the source of
// truth. Pre-floor rows in purchasing_actuals (source='rippling_spend')
// stay exactly as the API walk left them - Finance-signed closed
// periods are not restated. Any report-based writer applies this
// floor; the dry-run also surfaces totals above vs below it.
export const CARD_REPORT_SOURCE_FLOOR = "2026-10-05";

// src/lib/purchasing/reportToActualsMap.js
//
// Pure mapping functions - report CSV row (projected shape as it lives
// in rippling_report_txns) -> purchasing_actuals row shape. No I/O, no
// DB client, no side effects. Used by:
//
//   - scripts/purchasing_report_to_actuals_dry_run.mjs  (this stage)
//   - scripts/purchasing_report_to_actuals_load.mjs     (follow-up PR,
//     after dry-run approval + Stage 1 migration applied)
//
// Keep the hardcoded maps aligned with:
//   - spend_work_location_site_map (migration purchasing-2)
//   - spend_category_map (populated server-side, labelled by owner)
//
// Hardcoding exists so the ingest can produce a result WITHOUT a DB
// round-trip when the caller already loaded the maps once at startup.
// The dry-run compares the hardcoded map against the DB map and fails
// loud on divergence.

// ─── Work location label -> account_key / excluded ──────────────────
//
// Keys are the exact label strings the Rippling custom report ships in
// the Work location column (as of 2026-10-22). Each entry is either:
//   { account_key: "<SITE>" }      <- maps to a real site
//   { excluded: true }             <- CORP / Remote; excluded from KPI
//
// Stop and report if the report ships a label not in this map; a new
// site opening would need a map entry here AND in the migration seed.

export const WORK_LOCATION_MAP = Object.freeze({
  "Remote":                                    { excluded: true },
  "Corporate (CORP)":                          { excluded: true },
  "Englewood, FL/Port Charlotte, FL (TBR-FL)": { account_key: "TBR - FL" },
  "Goodyear, AZ (CIN-AZ)":                     { account_key: "CIN - AZ" },
  "Surprise, AZ (TXR-AZ)":                     { account_key: "TXR - AZ" },
  "St. Louis, MO (STL-MO)":                    { account_key: "STL - MO" },
  "Cincinnati, OH (CIN-OH)":                   { account_key: "CIN - OH" },
  "Dunedin, FL (TBJ-FL)":                      { account_key: "TBJ - FL" },
  "Arlington, TX (TXR-HOME)":                  { account_key: "TXR - TX - H" },
  "Jupiter, FL (STL-FL)":                      { account_key: "STL - FL" },
  "Arlington, TX Visitor (TXR-VISITOR)":       { account_key: "TXR - TX - V" },
  "Buffalo, NY (TBJ-BUF)":                     { account_key: "TBJ - NY" },
  // Live report also ships this one; migration seed carries it. Brief's
  // enumerated list omitted it, present in current data.
  "Louisville, KY (CIN-KY)":                   { account_key: "CIN - KY" },
});

// ─── GL overrides on category label (owner rulings) ─────────────────
//
// Three deterministic rulings beyond whatever the server-side
// spend_category_map carries:
//
//   - "Equipment Lease" -> 5002.5                    (owner ruling)
//   - "1381 TBR Reimbursable" -> excluded            (off-KPI)
//   - "5004.9 Employer Payroll Taxes" -> excluded    (off-KPI)
//
// "**Please Select A Category**" is NOT in the overrides; it is the
// uncoded sentinel and the Food fallback is applied by resolveGl().

export const GL_OVERRIDES = Object.freeze({
  "Equipment Lease":                { gl_line_code: "5002.5" },
  "1381 TBR Reimbursable":          { excluded: true },
  "5004.9 Employer Payroll Taxes":  { excluded: true },
});

// ─── GL Sync Status normalization ───────────────────────────────────
//
// Report ships human-readable strings; downstream reconcile_status
// column uses a stable enum. The brief enumerates 4 known values; the
// live report also ships "Sync Failed" which we normalize to a 5th
// enum and surface in the dry-run report for the owner's ruling.
//
// For the "uncoded -> Food until Synced" rule, every value except
// "synced" and "do_not_sync" is treated as "not yet reconciled" (the
// row counts toward Food). "do_not_sync" is a positive owner decision
// to leave the row off reconciliation; it is NOT routed to Food.

const RECONCILE_STATUS_MAP = Object.freeze({
  "Synced":            "synced",
  "Needs Review":      "needs_review",
  "Not Finalized Yet": "not_finalized",
  "Do Not Sync":       "do_not_sync",
  "Sync Failed":       "sync_failed",
});

export function normalizeReconcileStatus(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  return RECONCILE_STATUS_MAP[s] || null;
}

// A row is "uncoded" (should route to Food fallback) when its gl line
// is unresolved AND its reconcile_status is unsettled. do_not_sync is
// a deliberate opt-out and NEVER routes to Food.
export function isUncodedToFood(gl_line_code, reconcile_status) {
  if (gl_line_code != null) return false;
  if (reconcile_status === "synced") return false;
  if (reconcile_status === "do_not_sync") return false;
  return true;
}

// ─── gl_bucket derivation (same prefix rule as existing derive) ─────
//
// Mirrors the pattern used across the purchasing resolver + the dead
// API walk. Codes starting with 32/34/35 are COGS buckets. 13 is
// reimbursable (off-KPI). 5 is SG&A (off-KPI unless explicitly routed
// via a GL override). Anything else is "other".

export function glBucketFor(gl_line_code) {
  if (gl_line_code == null) return null;
  const s = String(gl_line_code).trim();
  if (s.startsWith("3200") || s.startsWith("3400") || s.startsWith("3500")) return "pl_cogs";
  if (s.startsWith("13")) return "reimbursable";
  if (s.startsWith("5")) return "sga";
  return "other";
}

// ─── Resolve the account_key for a report row ────────────────────────
//
// Returns one of:
//   { account_key: "<SITE>", excluded: false }       known site
//   { account_key: null, excluded: true }            Remote / Corporate
//   { account_key: null, excluded: false, unmapped: true }
//     when the label is not in WORK_LOCATION_MAP (dry-run reports; the
//     final load path refuses to insert these without an owner ruling).

export function resolveAccountKey(workLocationLabel) {
  const label = (workLocationLabel == null ? "" : String(workLocationLabel)).trim();
  if (label === "") return { account_key: null, excluded: false, unmapped: true };
  const entry = WORK_LOCATION_MAP[label];
  if (!entry) return { account_key: null, excluded: false, unmapped: true };
  if (entry.excluded) return { account_key: null, excluded: true };
  return { account_key: entry.account_key, excluded: false };
}

// ─── Resolve the gl_line_code for a report row ────────────────────────
//
// Precedence:
//   1. GL_OVERRIDES hit (deterministic owner rulings; may set excluded=true)
//   2. spend_category_map label hit (dbMap passed in from caller)
//   3. Fallback: gl_line_code = null (uncoded -> Food routing happens
//      downstream via isUncodedToFood, NOT by setting gl_line_code to
//      "3200" here - the fact table carries the honest NULL).

export function resolveGl(categoryName, dbCategoryMap) {
  const label = (categoryName == null ? "" : String(categoryName)).trim();
  if (label === "") {
    return { gl_line_code: null, gl_bucket: null, excluded: false, override: false, unmapped: true };
  }
  // 1. owner overrides
  const ov = GL_OVERRIDES[label];
  if (ov) {
    if (ov.excluded) return { gl_line_code: null, gl_bucket: null, excluded: true, override: true };
    const g = ov.gl_line_code;
    return { gl_line_code: g, gl_bucket: glBucketFor(g), excluded: false, override: true };
  }
  // 2. spend_category_map by label (case-insensitive trim)
  if (dbCategoryMap) {
    const hit = dbCategoryMap.get(label);
    if (hit != null) {
      return { gl_line_code: hit, gl_bucket: glBucketFor(hit), excluded: false, override: false };
    }
  }
  // 3. unmapped (uncoded)
  return { gl_line_code: null, gl_bucket: null, excluded: false, override: false, unmapped: true };
}

// ─── Build a dbCategoryMap from spend_category_map rows ─────────────
//
// Caller shape: Array<{ category_label, gl_line_code }>. Only rows with
// a non-null gl_line_code are usable (owner-labelled). Case-sensitive
// exact-match on trimmed label.

export function buildDbCategoryMap(rows) {
  const m = new Map();
  for (const r of (rows || [])) {
    const label = (r.category_label == null ? "" : String(r.category_label)).trim();
    if (!label) continue;
    if (r.gl_line_code == null) continue;
    m.set(label, String(r.gl_line_code).trim());
  }
  return m;
}

// ─── Boolean parser for Has Receipt (CSV ships "Yes" / "No") ────────

export function parseHasReceipt(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "yes" || s === "true" || s === "1") return true;
  if (s === "no"  || s === "false" || s === "0") return false;
  return null;
}

// ─── Compose a single purchasing_actuals shape from a report row ────
//
// Returns the shape ready to insert into purchasing_actuals, or a
// shape with `_unmapped: true` / `_dropped: true` metadata when the
// row cannot be inserted. The caller decides what to do with those
// (dry-run counts them; the real load path refuses to proceed if any
// unmapped rows are present).
//
// source_line_id is deliberately NOT set here. Report rows that share
// a Transaction ID (one txn with multiple category rows) MUST land as
// distinct purchasing_actuals rows under the UNIQUE (source,
// source_line_id) constraint. A composite key is assigned by
// `assignSourceLineIds` (below) across the full result set so an
// ordinal can disambiguate the rare (txn, category) duplicate case
// deterministically.

export function mapReportRowToActualsShape(reportRow, dbCategoryMap) {
  // reportRow is the shape from rippling_report_txns (or the live CSV
  // parsed into the same column set).
  const wlRes = resolveAccountKey(reportRow.work_location);
  const glRes = resolveGl(reportRow.category_name, dbCategoryMap);
  const reconcileStatus = normalizeReconcileStatus(reportRow.gl_sync_status);

  // Excluded shape rule from purchasing_actuals: excluded=TRUE -> account_key must be NULL.
  // When either workLocation or category routes to excluded, the row
  // is excluded and account_key stays NULL.
  const excluded = Boolean(wlRes.excluded || glRes.excluded);
  const account_key = excluded ? null : wlRes.account_key;

  // Memo concatenation: Memo + Line item memo, when both present.
  const memoParts = [];
  if (reportRow.memo) memoParts.push(String(reportRow.memo).trim());
  if (reportRow.line_item_memo) memoParts.push(String(reportRow.line_item_memo).trim());
  const memo = memoParts.length > 0 ? memoParts.join(" | ") : null;

  const shape = {
    source: "rippling_spend",
    source_bill_id: null, // parent reference stays in source_line_id scheme
    source_line_id: null, // assigned by assignSourceLineIds
    account_key,
    excluded,
    gl_line_code: glRes.gl_line_code,
    gl_bucket: glRes.gl_bucket,
    txn_date: reportRow.purchased_at || null,
    posting_date: reportRow.posted_date || null,
    amount: reportRow.amount == null ? 0 : Number(reportRow.amount),
    vendor_or_merchant: reportRow.vendor_name || reportRow.vendor || null,
    paid: false,
    approx_date: false,
    // Stage 1 migration columns (ignored by writer until migration applied).
    reconcile_status: reconcileStatus,
    employee_name: reportRow.employee || null,
    employee_id: reportRow.employee_id || null,
    has_receipt: reportRow.has_receipt == null ? null : Boolean(reportRow.has_receipt),
    memo,
  };

  // Diagnostic metadata (not written to DB; used by the dry-run report).
  shape._unmapped_work_location = Boolean(wlRes.unmapped);
  shape._unmapped_category     = Boolean(glRes.unmapped);
  shape._uncoded_to_food       = isUncodedToFood(shape.gl_line_code, reconcileStatus);
  shape._reconcile_status_known = reconcileStatus != null;
  // Carry the originating report row's keys so assignSourceLineIds
  // can compose a stable composite key without the loader having to
  // pass both arrays.
  shape._parent_txn_id = reportRow.parent_txn_id || null;
  shape._category_name = reportRow.category_name || null;
  shape._content_hash  = reportRow.content_hash  || null;

  return shape;
}

// ─── Category slug for source_line_id composition ───────────────────
//
// Deterministic: lowercase + non-alphanumeric -> underscore + run-of-
// underscores collapsed + trimmed. Empty category -> "uncoded".
// Length capped at 48 chars so the composite source_line_id does not
// run away on an unusually long category label.
export function categorySlug(categoryName) {
  const raw = (categoryName == null ? "" : String(categoryName)).trim();
  if (!raw) return "uncoded";
  let s = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!s) return "uncoded";
  if (s.length > 48) s = s.slice(0, 48);
  return s;
}

// ─── Assign source_line_id to a set of mapped shapes ────────────────
//
// Composite key: `${parent_txn_id}::${category_slug}::${ordinal}`.
//
// - parent_txn_id: the report's Transaction ID (parent).
// - category_slug: deterministic slug of Category Name.
// - ordinal: 0 for singleton (parent, category) groups; 0..N-1
//   assigned by a stable sort within duplicate groups so re-runs on
//   the same CSV produce the same source_line_id for each row.
//
// Stable sort inside each group: amount DESC, then content_hash ASC
// (content_hash is unique per row, so this is a total order on each
// group's rows).
//
// Returns { shapes, stats } where stats carries counts of duplicate
// groups and the max ordinal observed (for the loader to log). The
// shapes array is the same list with source_line_id populated.
export function assignSourceLineIds(shapes) {
  const groups = new Map(); // key -> indexes[]
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    const parent = s._parent_txn_id || "";
    const slug = categorySlug(s._category_name);
    const key = `${parent}::${slug}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  let duplicateGroups = 0;
  let maxOrdinal = 0;
  for (const [key, idxs] of groups) {
    if (idxs.length > 1) duplicateGroups += 1;
    idxs.sort((ia, ib) => {
      const a = shapes[ia];
      const b = shapes[ib];
      const d = Number(b.amount || 0) - Number(a.amount || 0);
      if (d !== 0) return d;
      return String(a._content_hash || "").localeCompare(String(b._content_hash || ""));
    });
    idxs.forEach((shapeIdx, ordinal) => {
      shapes[shapeIdx].source_line_id = `${key}::${ordinal}`;
      if (ordinal > maxOrdinal) maxOrdinal = ordinal;
    });
  }
  return { shapes, stats: { duplicateGroups, maxOrdinal } };
}
