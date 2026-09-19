// Load meals denominator - sc_daily_actuals and sc_daily_projections for the
// window. Per rule E: STL-FL Jun 2026 gap -> fall back to projections, LABEL
// in-cell as "projected". Never silently mix.

import fs from "node:fs";
import { supa, ACCOUNTS, ACCOUNT_LABEL, WINDOW_START, WINDOW_END } from "./_common.mjs";

const OUT_JSON = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_meals.json";

const monthsInWindow = ["2026-05", "2026-06", "2026-07"];

const result = {
  window: `${WINDOW_START} to ${WINDOW_END}`,
  per_account: {},
};

for (const acct of ACCOUNTS) {
  const label = ACCOUNT_LABEL[acct];
  const { data: actuals, error: aErr } = await supa
    .from("sc_daily_actuals")
    .select("service_date, actual_count")
    .eq("account_key", acct)
    .gte("service_date", WINDOW_START)
    .lte("service_date", WINDOW_END);
  if (aErr) throw aErr;

  const { data: projections, error: pErr } = await supa
    .from("sc_daily_projections")
    .select("service_date, projected_count")
    .eq("account_key", acct)
    .gte("service_date", WINDOW_START)
    .lte("service_date", WINDOW_END);
  if (pErr) throw pErr;

  const monthAgg = {};
  for (const m of monthsInWindow) {
    monthAgg[m] = { actual_rows: 0, actual_meals: 0, projected_rows: 0, projected_meals: 0 };
  }
  for (const r of actuals) {
    const m = r.service_date.slice(0, 7);
    if (!monthAgg[m]) continue;
    monthAgg[m].actual_rows += 1;
    monthAgg[m].actual_meals += Number(r.actual_count) || 0;
  }
  for (const r of projections) {
    const m = r.service_date.slice(0, 7);
    if (!monthAgg[m]) continue;
    monthAgg[m].projected_rows += 1;
    monthAgg[m].projected_meals += Number(r.projected_count) || 0;
  }

  // Days-in-month helper for coverage % (informational only).
  const DAYS = { "2026-05": 31, "2026-06": 30, "2026-07": 31 };
  // Resolve per-month meal denominator with substitution labeling.
  // Rule (per prompt): STL-FL Jun 2026 gap (0 rows) -> fall back to projections
  // WITH labeling. If projections also unavailable, UNAVAILABLE.
  // Actuals used whenever present (any actual_rows > 0). Sparseness flagged
  // for downstream awareness but not silently substituted.
  for (const m of monthsInWindow) {
    const bucket = monthAgg[m];
    const daysInMonth = DAYS[m];
    bucket.coverage_days_pct = daysInMonth ? Math.round((bucket.actual_rows / daysInMonth) * 100) : 0;
    bucket.sparse_actual = bucket.actual_rows > 0 && bucket.actual_rows < daysInMonth * 0.5;
    if (bucket.actual_rows === 0 && bucket.actual_meals === 0) {
      // True gap - fall back to projection per prompt STL-Jun rule.
      if (bucket.projected_meals > 0) {
        bucket.used = bucket.projected_meals;
        bucket.source = "projected";
      } else {
        bucket.used = null;
        bucket.source = "UNAVAILABLE";
      }
    } else if (bucket.sparse_actual) {
      // Actuals present but sparse (STL/TBJ July 2026 pattern). Use actuals for
      // the per-month cell (with sparse label). Also record a projected-substitute
      // fallback so the window total does not blow up.
      bucket.used = bucket.actual_meals;
      bucket.source = "actual_sparse";
      bucket.projected_substitute = bucket.projected_meals || null;
    } else {
      bucket.used = bucket.actual_meals;
      bucket.source = "actual";
    }
  }
  // Window totals
  const total_actual = monthsInWindow.reduce((s, m) => s + (monthAgg[m].actual_meals || 0), 0);
  const total_projected = monthsInWindow.reduce((s, m) => s + (monthAgg[m].projected_meals || 0), 0);
  const total_used = monthsInWindow.reduce((s, m) => s + (monthAgg[m].used || 0), 0);
  // "Filled" window total: substitutes projections into sparse-actual months so
  // downstream per-meal figures do not blow up on 5-day-of-31 actuals.
  const total_used_filled = monthsInWindow.reduce((s, m) => {
    const b = monthAgg[m];
    if (b.source === "actual") return s + b.used;
    if (b.source === "projected") return s + b.used;
    if (b.source === "actual_sparse") return s + (b.projected_substitute || b.used);
    return s;
  }, 0);
  const sources = monthsInWindow.map((m) => monthAgg[m].source);
  const window_source = sources.every((x) => x === "actual")
    ? "actual"
    : sources.every((x) => x === "actual" || x === "actual_sparse")
      ? "actual_with_sparse"
      : sources.some((x) => x === "projected")
        ? "mixed"
        : sources.some((x) => x === "UNAVAILABLE")
          ? "partial_unavailable"
          : "actual";

  result.per_account[label] = {
    account_key: acct,
    monthly: monthAgg,
    total_actual,
    total_projected,
    total_used,
    total_used_filled,
    window_source,
  };

  console.log(`\n[${label}]`);
  for (const m of monthsInWindow) {
    const b = monthAgg[m];
    console.log(
      `  ${m}: actual=${b.actual_meals} (${b.actual_rows} rows), projected=${b.projected_meals} (${b.projected_rows} rows), USED=${b.used} (${b.source})`
    );
  }
  console.log(`  WINDOW total: actual=${total_actual}, projected=${total_projected}, USED=${total_used} (${window_source})`);
}

fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));
console.log("\nwrote", OUT_JSON);
