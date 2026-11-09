// Shared derivation: uncoded card charges inside a purchasing.actuals pool.
//
// 2026-11-09, Kevin ruling. The "Needs review today" purchasing item and
// the Cards purchasing fold must describe the same set, so both read from
// one function off the same purchasing_actuals pool the fold is already
// consuming. Previously the review item read `purchasing.card_charges`
// (loadCardCharges: uncoded api + report-only) and the fold banner read
// its own fold-local count, which diverged.
//
// The function is intentionally narrow: count and sum rippling_spend rows
// with no gl_line_code, from whatever row set the caller passes. Callers:
//
//   PurchasingFold (Cards variant) - pool is actuals filtered to the 5
//     in-scope sources (invoice_submissions, rippling_spend, billcom,
//     billcom_credit, upload).
//   CurrentPeriodReview              - pool is purchasing.actuals as-is.
//
// Both land on the same count because the only rows that can satisfy
// source === "rippling_spend" && !gl_line_code are a subset of either
// pool.

export function uncodedCardCount(rows) {
  let n = 0;
  let total = 0;
  for (const r of rows || []) {
    if (r?.source !== "rippling_spend") continue;
    if (r.gl_line_code) continue;
    n += 1;
    total += Number(r.amount || 0);
  }
  return { n, total: Math.round(total * 100) / 100 };
}
