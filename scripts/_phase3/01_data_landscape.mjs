// Phase 3 Step 1: baseline data landscape for the analysis window.
// - Row counts per account
// - Date-drift recovery count
// - DOLLAR SET vs WEIGHT SET row counts
// - Distinct-description count (drives classification volume)
// - Coverage rates

import {
  ACCOUNTS,
  WINDOW_START,
  WINDOW_END,
  WINDOW_LABEL,
  fetchLineItemsInWindow,
  isInDollarSet,
  isInWeightSet,
  supa,
  sum,
  round,
} from "./_common.mjs";

console.log("[landscape] window:", WINDOW_LABEL);
console.log("[landscape] accounts:", ACCOUNTS.join(", "));

const select =
  "id, account_key, invoice_uuid, invoice_date, vendor_id, vendor_name, description, item_number, category, quantity, unit, unit_price, extended_price, pack_size, parsed_weight_lb, parsed_weight_source, is_food, food_verdict, needs_review, review_reason";

const { rows, driftRecovered } = await fetchLineItemsInWindow({ select });
console.log("[landscape] fetched rows total:", rows.length);
console.log("[landscape] drift-recovered rows in window:", driftRecovered);

// Also strip out orphan-corrected rows (lines attached to corrected/deleted invoices).
// Look up invoice_uuid -> status via invoice_submissions.
const invoiceUuids = [...new Set(rows.map((r) => r.invoice_uuid).filter(Boolean))];
console.log("[landscape] distinct invoice_uuids:", invoiceUuids.length);

// Batch invoice_submissions lookup for status
const invStatusMap = new Map();
const CHUNK = 100;
for (let i = 0; i < invoiceUuids.length; i += CHUNK) {
  const batch = invoiceUuids.slice(i, i + CHUNK);
  const { data, error } = await supa
    .from("invoice_submissions")
    .select("id, status, total_amount, gl_breakdown, invoice_date")
    .in("id", batch);
  if (error) throw error;
  for (const r of data) invStatusMap.set(r.id, r);
}
console.log("[landscape] resolved invoice statuses:", invStatusMap.size);

// Filter out orphan-corrected
let orphanRows = 0;
const liveRows = [];
for (const r of rows) {
  const s = invStatusMap.get(r.invoice_uuid);
  if (s && (s.status === "corrected" || s.status === "deleted")) {
    orphanRows += 1;
    continue;
  }
  liveRows.push(r);
}
console.log("[landscape] orphan (corrected/deleted parent) rows excluded:", orphanRows);
console.log("[landscape] live rows:", liveRows.length);

// Per account slices
for (const acct of ACCOUNTS) {
  const acctRows = liveRows.filter((r) => r.account_key === acct);
  const dollar = acctRows.filter(isInDollarSet);
  const weight = acctRows.filter(isInWeightSet);
  const food = dollar.filter((r) => r.is_food === true);
  const nonfood = dollar.filter((r) => r.is_food === false);
  const unknown = dollar.filter((r) => r.is_food === null || r.is_food === undefined);
  console.log(`\n[${acct}]`);
  console.log("  live rows       :", acctRows.length);
  console.log("  DOLLAR SET rows :", dollar.length, `(${round((dollar.length / acctRows.length) * 100, 1)}%)`);
  console.log("  WEIGHT SET rows :", weight.length, `(${round((weight.length / acctRows.length) * 100, 1)}%)`);
  console.log("  DOLLAR SET spend:", round(sum(dollar, (r) => r.extended_price), 2));
  console.log("    food $        :", round(sum(food, (r) => r.extended_price), 2));
  console.log("    non-food $    :", round(sum(nonfood, (r) => r.extended_price), 2));
  console.log("    unknown $     :", round(sum(unknown, (r) => r.extended_price), 2));
  console.log("  WEIGHT SET lbs  :", round(sum(weight, (r) => r.parsed_weight_lb), 1));
  const distinctDesc = new Set(dollar.map((r) => r.description?.trim()).filter(Boolean));
  console.log("  distinct descriptions (DOLLAR SET):", distinctDesc.size);
  const distinctDescVendor = new Set(
    dollar.map((r) => `${r.vendor_id || "NO-VENDOR"}::${r.description?.trim()}`).filter((k) => k.includes("::") && !k.endsWith("::"))
  );
  console.log("  distinct (vendor,description) pairs:", distinctDescVendor.size);
}

// Global distinct-description count
const allDollarLive = liveRows.filter(isInDollarSet);
const distinctGlobal = new Set(allDollarLive.map((r) => r.description?.trim()).filter(Boolean));
console.log("\n[GLOBAL DOLLAR SET]");
console.log("  distinct descriptions:", distinctGlobal.size);
const distinctPairs = new Set(
  allDollarLive.map((r) => `${r.vendor_id || "NO-VENDOR"}::${r.description?.trim()}`).filter((k) => !k.endsWith("::"))
);
console.log("  distinct (vendor,description) pairs:", distinctPairs.size);

// Persist landscape summary
const fs = await import("fs");
fs.writeFileSync(
  "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_landscape.json",
  JSON.stringify(
    {
      window: WINDOW_LABEL,
      total_rows_in_window: rows.length,
      drift_recovered_rows: driftRecovered,
      orphan_rows_excluded: orphanRows,
      live_rows: liveRows.length,
      distinct_desc_global: distinctGlobal.size,
      distinct_pairs_global: distinctPairs.size,
      per_account: ACCOUNTS.reduce((acc, a) => {
        const ar = liveRows.filter((r) => r.account_key === a);
        acc[a] = {
          live_rows: ar.length,
          dollar_set_rows: ar.filter(isInDollarSet).length,
          weight_set_rows: ar.filter(isInWeightSet).length,
        };
        return acc;
      }, {}),
    },
    null,
    2
  )
);
console.log("\n[landscape] summary written to _landscape.json");
