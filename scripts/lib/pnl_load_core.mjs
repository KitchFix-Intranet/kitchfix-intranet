// scripts/lib/pnl_load_core.mjs
//
// FIN-2027 W1 Stage 2 · shared load-core for the P&L workbook
// loaders. Extracted from scripts/derive_pnl_actuals.mjs so both the
// FY2026 loader and scripts/load_pnl_history.mjs (FY2024/FY2025) share
// the same helpers, upsert, and post-load verification.
//
// Behavior-preserving extraction: derive_pnl_actuals.mjs P9 dry-run
// output is byte-identical before/after this refactor (Stage 2
// parity gate). Reconciliation logic remains INLINE in each loader
// because the reconciliation shape differs (FY2026 uses a single
// YTD-Pn Actual anchor; FY2024/2025 use dual anchors: Year total
// column AND YTD-P13 band, plus Year budget).
//
// Public surface:
//   Pure helpers:
//     readNumeric(cell)
//     round2(n)
//     parseLineCode(rawLabel, rowNo)         -- returns {code, label} or null
//     classifySkippedLabel(rawLabel, rowNo)  -- returns {kind, reason, label}
//   Constants:
//     SGA_ROW_RANGE = { first: 60, last: 97 }  -- FY2024/2025/2026 workbook shape
//   Async:
//     loadKpiLinesCatalog(supa)                                -- Set<line_code>
//     upsertPnlActualsInBatches(supa, rows, batch, onProgress) -- writes N rows
//     updateKpiPeriodStatusVerified(supa, opts)                -- verified_* only
//     verifyPostLoadRowCount(supa, fiscalYear, first, last)    -- returns {count}
//     readKpiPeriodStatusVerified(supa, fiscalYear, first, last)

// SG&A row range is the workbook contract, not a fiscal year choice.
// Every FY2024..FY2027 portfolio tab uses r60..r97 for the SG&A block
// per the W0 report §11 shape probe.
export const SGA_ROW_RANGE = { first: 60, last: 97 };

// ─── Pure helpers ────────────────────────────────────────────────────

export function readNumeric(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object") {
    if (v.result != null) return typeof v.result === "number" ? v.result : Number(v.result) || 0;
    if (v.formula) return null;                         // formula without cached result - treat as no value
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function round2(n) { return Math.round(n * 100) / 100; }

// Parse a numbered line code out of a row-1 label. Returns {code, label}
// or null if the label is not a numbered line.
//
// Numbered lines:      "2200 Catering Revenue", "    3200.1 General Food"
// Group headers:       "5002 Repair & Maintenance", "3200 Food Costs"
// Aggregation rows:    "Total Revenue", "  Total 3200 Food Costs"
//
// Rule (matches Kevin's spec "parse code from label prefix"):
//   - Skip if trimmed label starts with "total" (case-insensitive).
//   - Match leading 4-digit code, optionally with .digit suffix.
//   - Additionally: SG&A group headers (5002, 5004, 5006, 5012, 5013,
//     5016, 5017) look like "5002 Repair & Maintenance" - no dot -
//     and we skip these. Revenue lines 2200/2300/2600 also have no
//     dot but are legitimate numbered lines; we distinguish by row
//     range (the SG&A block starts at row 60).
export function parseLineCode(rawLabel, rowNo) {
  if (typeof rawLabel !== "string") return null;
  const trimmed = rawLabel.trim();
  if (trimmed.length === 0) return null;
  if (/^total\b/i.test(trimmed)) return null;
  const m = trimmed.match(/^(\d{4}(?:\.\d+)?)\s+/);
  if (!m) return null;
  const code = m[1];
  // In the SG&A block (row >= 60), a plain 4-digit code is a group
  // header (e.g. row 60 "5002 Repair & Maintenance") - skip it.
  // Numbered SG&A lines always carry a dot suffix.
  if (rowNo >= SGA_ROW_RANGE.first && !code.includes(".")) return null;
  return { code, label: trimmed };
}

// Classify a skipped row so the report distinguishes:
//   - empty_row          truly blank cell in the SG&A range fill
//   - total_row          "Total ..." aggregator
//   - group_header_row   4-digit-no-dot SG&A group header (e.g. "5002 Repair & Maintenance")
//   - unnumbered_row     any label with no leading numbered-code prefix
export function classifySkippedLabel(rawLabel, rowNo) {
  const stringForm = typeof rawLabel === "string"
    ? rawLabel.trim()
    : (rawLabel == null ? "" : String(rawLabel));
  if (stringForm.length === 0) return { kind: "empty_row", reason: "blank cell", label: "" };
  if (/^total\b/i.test(stringForm)) return { kind: "total_row", reason: "Total aggregator (label starts 'Total')", label: stringForm };
  if (rowNo >= SGA_ROW_RANGE.first && /^\d{4}\s+/.test(stringForm)) {
    return { kind: "group_header_row", reason: "SG&A group header (4-digit no dot)", label: stringForm };
  }
  return { kind: "unnumbered_row", reason: "no leading numbered-code prefix", label: stringForm };
}

// ─── Async DB helpers ────────────────────────────────────────────────

// Load the kpi_lines catalog as a Set<line_code>. Loud stop on error.
export async function loadKpiLinesCatalog(supa) {
  const { data, error } = await supa.from("kpi_lines").select("line_code");
  if (error) {
    const e = new Error(`kpi_lines read failed: ${error.message}`);
    e.exitCode = 1;
    throw e;
  }
  return new Set(data.map((r) => r.line_code));
}

// Upsert pnl_actuals rows in batches. Yields progress via onProgress
// callback (called with (written, total) after each batch). Throws on
// error with e.exitCode = 3 so the caller can process.exit(3).
export async function upsertPnlActualsInBatches(supa, rows, batchSize, onProgress) {
  let written = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error, count } = await supa
      .from("pnl_actuals")
      .upsert(chunk, {
        onConflict: "account_key,fiscal_year,period_no,line_code",
        count: "exact",
      });
    if (error) {
      const e = new Error(`pnl_actuals upsert failed at offset ${i}: ${error.message}`);
      e.exitCode = 3;
      throw e;
    }
    written += (count ?? chunk.length);
    if (typeof onProgress === "function") onProgress(written, rows.length);
  }
  return { written };
}

// UPDATE kpi_period_status verified_at / verified_by / source_ref /
// updated_at for each period in [first, last]. closed_at is NEVER
// touched. Throws e.exitCode = 3 on error or if a period row is
// missing (the migration seed owns the (fiscal_year, period_no) row).
export async function updateKpiPeriodStatusVerified(supa, {
  fiscalYear,
  first,
  last,
  verifiedAt,
  verifiedBy,
  sourceRef,
}) {
  const nowIso = new Date().toISOString();
  let updatedCount = 0;
  for (let p = first; p <= last; p += 1) {
    const { data, error } = await supa
      .from("kpi_period_status")
      .update({
        verified_at: verifiedAt,
        verified_by: verifiedBy,
        source_ref:  sourceRef,
        updated_at:  nowIso,
      })
      .eq("fiscal_year", fiscalYear)
      .eq("period_no", p)
      .select("period_no");
    if (error) {
      const e = new Error(`kpi_period_status update failed at P${p}: ${error.message}`);
      e.exitCode = 3;
      throw e;
    }
    if (!data || data.length === 0) {
      const e = new Error(`kpi_period_status has no row for FY${fiscalYear} P${p} - migration seed missing`);
      e.exitCode = 3;
      throw e;
    }
    updatedCount += data.length;
  }
  return { updatedCount };
}

// Post-load: exact-count query on pnl_actuals for (fiscal_year, P..P).
export async function verifyPostLoadRowCount(supa, fiscalYear, first, last) {
  const cnt = await supa
    .from("pnl_actuals")
    .select("*", { count: "exact", head: true })
    .eq("fiscal_year", fiscalYear)
    .gte("period_no", first)
    .lte("period_no", last);
  if (cnt.error) {
    const e = new Error(`post-load count failed: ${cnt.error.message}`);
    e.exitCode = 3;
    throw e;
  }
  return { count: cnt.count };
}

// Post-load: read kpi_period_status verified rows for (fiscal_year, P..P).
export async function readKpiPeriodStatusVerified(supa, fiscalYear, first, last) {
  const ver = await supa
    .from("kpi_period_status")
    .select("period_no, verified_at, verified_by, source_ref")
    .eq("fiscal_year", fiscalYear)
    .gte("period_no", first)
    .lte("period_no", last)
    .order("period_no");
  if (ver.error) {
    const e = new Error(`post-load status read failed: ${ver.error.message}`);
    e.exitCode = 3;
    throw e;
  }
  return { data: ver.data || [] };
}
