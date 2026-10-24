// Common helpers for Phase 3 analysis scripts.
// - Supabase client (service role, read-only usage patterns)
// - Anthropic client
// - Date-normalization helper mirroring the SQL CASE (see rule 4)

import dotenv from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/dotenv/lib/main.js";
import { createClient } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/@supabase/supabase-js/dist/index.mjs";

dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });

// account_key values in ai_line_items are stored with spaces around the dash.
// Kevin's prompt uses "TBR-FL" style; DB uses "TBR - FL". Map both.
export const ACCOUNTS = ["TBR - FL", "TBJ - FL", "STL - FL"];
// Display label (no spaces) for output.
export const ACCOUNT_LABEL = {
  "TBR - FL": "TBR-FL",
  "TBJ - FL": "TBJ-FL",
  "STL - FL": "STL-FL",
};
export const WINDOW_START = "2026-05-01";
export const WINDOW_END = "2026-07-31";
export const WINDOW_LABEL = "2026-05-01 to 2026-07-31 (three months, off-season + MiLB-season)";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase env");
export const supa = createClient(url, key, { auth: { persistSession: false } });

// Date-drift normalizer. Mirrors SQL CASE expression per rule 4.
// Returns ISO date string, or null if unparseable.
export function normalizeInvoiceDate(raw) {
  if (!raw) return null;
  const s = String(raw);
  let fixed = s;
  if (s.startsWith("0026-")) fixed = "2026-" + s.slice(5);
  else if (s.startsWith("0206-")) fixed = "2026-" + s.slice(5);
  else if (s.startsWith("23026-")) fixed = s.slice(1);
  else if (s.startsWith("72026-")) fixed = s.slice(1);
  // Standard YYYY-MM-DD kept as-is.
  return fixed;
}

// Detects if a raw date was date-drift and got recovered by normalization.
export function isRecoveredDrift(raw) {
  if (!raw) return false;
  const s = String(raw);
  return s.startsWith("0026-") || s.startsWith("0206-") || s.startsWith("23026-") || s.startsWith("72026-");
}

// Fetches all ai_line_items rows for accounts + broad date range, then normalizes
// invoice_date in-memory and filters to the analysis window.
// Returns { rows, driftRecovered: n } where rows have `_invoice_date_norm` set.
export async function fetchLineItemsInWindow({
  accounts = ACCOUNTS,
  windowStart = WINDOW_START,
  windowEnd = WINDOW_END,
  select = "*",
} = {}) {
  // We must include drift rows. Since drift rows have raw dates like '0026-06-19'
  // (which parse as year 26), we cannot use invoice_date filters in the query.
  // So we fetch by account_key + a broad date OR clause. Use two queries:
  // (a) rows whose raw date is in the window
  // (b) rows whose raw date starts with '0026', '0206', '23026', '72026'
  const out = [];
  let driftRecovered = 0;

  // (a) In-window rows via normal range filter.
  for (const acct of accounts) {
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supa
        .from("ai_line_items")
        .select(select)
        .eq("account_key", acct)
        .gte("invoice_date", windowStart)
        .lte("invoice_date", windowEnd)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) {
        r._invoice_date_norm = normalizeInvoiceDate(r.invoice_date);
        r._drift_recovered = false;
      }
      out.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
  }

  // (b) Drift-shaped rows. Since PostgREST cannot LIKE on a date, we cast via a
  //     helper by using .in on raw string prefixes is impossible. Approach: query
  //     small ranges of the drift-year (year 26 = 0026, year 206 = 0206, etc).
  //     Simpler: fetch all rows for the accounts with invoice_date < '2015-01-01'
  //     OR > '2027-12-31' (drift signature per pr-10-1 post-check).
  for (const acct of accounts) {
    const { data: driftLow, error: dErr1 } = await supa
      .from("ai_line_items")
      .select(select)
      .eq("account_key", acct)
      .lt("invoice_date", "2015-01-01");
    if (dErr1) throw dErr1;
    const { data: driftHigh, error: dErr2 } = await supa
      .from("ai_line_items")
      .select(select)
      .eq("account_key", acct)
      .gt("invoice_date", "2027-12-31");
    if (dErr2) throw dErr2;
    for (const r of [...(driftLow || []), ...(driftHigh || [])]) {
      const norm = normalizeInvoiceDate(r.invoice_date);
      if (!norm) continue;
      if (norm >= windowStart && norm <= windowEnd) {
        r._invoice_date_norm = norm;
        r._drift_recovered = true;
        out.push(r);
        driftRecovered += 1;
      }
    }
  }

  return { rows: out, driftRecovered };
}

// Applies the two-tier quality filter (per rule 3).
// - dollarSet excludes review_reason = 'invoice_over_extracted' only
// - weightSet excludes review_reason IN ('invoice_over_extracted', 'ep_qty_up_mismatch')
//   AND resolved-weight-source is 'unresolved' or 'volume_excluded'
//
// NOTE: rule 3 references `parsed_weight_source` which is a DB column added by
// pr-10-2. That column has NOT been backfilled yet. We instead compute the
// resolution live in-memory via packSizeParser.resolveWeightForRow and stash
// it on the row as `_wt_resolution`. `isInWeightSet` reads that field.
export function isInDollarSet(row) {
  return row.review_reason !== "invoice_over_extracted";
}
export function isInWeightSet(row) {
  if (row.review_reason === "invoice_over_extracted") return false;
  if (row.review_reason === "ep_qty_up_mismatch") return false;
  const src = row._wt_resolution?.resolution_method || row.parsed_weight_source;
  if (src === "unresolved") return false;
  if (src === "volume_excluded") return false;
  if (!src) return false; // unresolved by absence
  return true;
}

// Convenience: extract yyyy-mm from a normalized date.
export function monthOf(iso) {
  return iso ? iso.slice(0, 7) : null;
}

// Sum helper.
export function sum(arr, fn) {
  let s = 0;
  for (const x of arr) s += Number(fn(x)) || 0;
  return s;
}

// Round for display without touching underlying number precision.
export function round(n, dp = 2) {
  return Math.round(n * 10 ** dp) / 10 ** dp;
}
