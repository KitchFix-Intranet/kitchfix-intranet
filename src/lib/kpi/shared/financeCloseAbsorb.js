// src/lib/kpi/shared/financeCloseAbsorb.js
//
// Kevin R-126 (2026-09-18) · pure helpers for the finance-close
// adjustment display path. Kept separate from
// financeCloseAdjustment.js so probes can import these functions
// under plain Node without pulling the full `@/` alias chain (the
// sibling file imports pnl-loader.js which imports the app root).
//
// buildFinanceCloseRow: emits the R-123 synthetic .FIN_CLOSE row.
//   Retained for the R-126 rule 5 backstop (no absorbable candidate)
//   and for any legacy caller. Guard J probe fires if this ever
//   surfaces on a real payload today.
//
// absorbFinanceCloseIntoSubLines: R-126 post-pass. Given the pushed
//   statement_rows and the resolveFinanceCloseAdjustment result,
//   folds each parent's adjustment onto the largest existing sub-line.

export const FINANCE_CLOSE_PARENT_LINES = ["3100", "3200", "3400", "3500"];

// Build the emitted `.FIN_CLOSE` statement_row for a parent. Returns null
// when adjustment is effectively zero.
export function buildFinanceCloseRow({ parent, adjustment, byPeriod, section = "cogs" }) {
  if (adjustment == null || Math.abs(adjustment) < 0.005) return null;
  const periodsList = (byPeriod || [])
    .filter(b => Math.abs(b.amount) >= 0.005)
    .map(b => b.period_no)
    .sort((a, b) => a - b);
  const periodLabel = periodsList.length === 0
    ? "verified"
    : periodsList.length === 1
      ? `P${periodsList[0]} verified`
      : `P${periodsList[0]}-P${periodsList[periodsList.length - 1]} verified`;
  return {
    line_code: `${parent}.FIN_CLOSE`,
    section,
    parent_line_code: parent,
    label: "Finance close adjustment",
    reported: true,
    actual: adjustment,
    budget_to_date: null,
    period_budget: null,
    variance: null,
    variance_pct: null,
    actual_pct: null,
    target_pct: null,
    budget_at_this_revenue: null,
    envelope_delta: null,
    sources: ["pnl_actuals"],
    flags: ["synthetic", "finance_close_adjustment"],
    finance_close: {
      periods_verified: periodsList,
      period_label: periodLabel,
    },
  };
}

// Kevin R-126 (2026-09-18) · Joe (Finance) does not want a visible
// Finance close adjustment row on the P&L. The R-123 calculation is
// unchanged - the parent's actual still switches to finance on
// verified periods upstream. This helper takes the adjustment (which
// R-123 would have emitted as `.FIN_CLOSE`) and folds it onto ONE
// existing sub-line's actual, so the group still sums to parent
// (Guard J) without a synthetic row on screen.
//
// Absorbing sub-line pick:
//   1. Candidates have parent_line_code === parent, reported === true,
//      actual != null, and are NOT synthetic (flag `inventory_adjustment`
//      excludes 3200.INVJE / 3400.INVJE; `finance_close_adjustment`
//      is not emitted at all under R-126 but excluded defensively).
//   2. Rank by Math.abs(actual) descending, tie-break line_code
//      ascending (deterministic).
//   3. Negative guard: if the top candidate's actual + adjustment < 0,
//      walk down the ranked list and take the first that stays >= 0.
//      If none stays non-negative, use the top and let it go negative -
//      arithmetic correctness beats cosmetics.
//   4. No candidate at all (unreported-only parent, or no sub-rows):
//      the R-126 backstop is to emit the `.FIN_CLOSE` row as R-123 did.
//      Not expected to occur in production; probe asserts zero.
//
// Derived fields on the mutated row recompute against the new actual:
//   actual_pct, variance, variance_pct. Budget-side fields are
//   untouched (period_budget, budget_to_date, budget_at_this_revenue,
//   target_pct, envelope_delta).
//
// Back-end breadcrumbs on the mutated row (invisible to operators):
//   flags += "finance_close_absorbed"
//   sources += "pnl_actuals" (if not already present)
//   finance_close_absorbed = { amount, periods_verified, period_label }
//
// Returns { applied: [{parent, absorber_line_code, amount, periods_verified,
// went_negative}], fallbackRows: [.FIN_CLOSE rows built for parents with
// no candidate] } for probe inspection.
export function absorbFinanceCloseIntoSubLines(statementRows, financeClose, ctx = {}) {
  const r2 = ctx.r2 || ((n) => Math.round(Number(n) * 100) / 100);
  const pctOf = ctx.pctOf || ((num, den) => (num == null || den == null || Number(den) === 0) ? null : r2((Number(num) / Number(den)) * 100));
  const totalRevenue = ctx.totalRevenue ?? null;
  const applied = [];
  const fallbackRows = [];
  if (!financeClose || !financeClose.has_any_verified) return { applied, fallbackRows };

  for (const parent of FINANCE_CLOSE_PARENT_LINES) {
    const info = financeClose.per_parent?.get?.(parent);
    if (!info) continue;
    const adjustment = Number(info.adjustment || 0);
    if (Math.abs(adjustment) < 0.005) continue;

    const kids = statementRows.filter(r =>
      r.parent_line_code === parent &&
      r.reported === true &&
      r.actual != null &&
      !(Array.isArray(r.flags) && (r.flags.includes("inventory_adjustment") || r.flags.includes("finance_close_adjustment")))
    );

    if (kids.length === 0) {
      const row = buildFinanceCloseRow({
        parent,
        adjustment,
        byPeriod: info.by_period,
      });
      if (row) {
        statementRows.push(row);
        fallbackRows.push(row);
      }
      continue;
    }

    kids.sort((a, b) => {
      const magDiff = Math.abs(Number(b.actual)) - Math.abs(Number(a.actual));
      if (magDiff !== 0) return magDiff;
      return String(a.line_code).localeCompare(String(b.line_code));
    });

    let picked = kids[0];
    let wentNegative = false;
    for (const cand of kids) {
      const newActual = Number(cand.actual) + adjustment;
      if (newActual >= -0.005) {
        picked = cand;
        break;
      }
    }
    if (Number(picked.actual) + adjustment < -0.005) {
      wentNegative = true;
    }

    const newActual = r2(Number(picked.actual) + adjustment);
    picked.actual = newActual;

    picked.actual_pct = pctOf(newActual, totalRevenue);
    if (picked.budget_at_this_revenue != null) {
      picked.variance = r2(newActual - Number(picked.budget_at_this_revenue));
      if (picked.target_pct != null && picked.actual_pct != null) {
        picked.variance_pct = r2(Number(picked.actual_pct) - Number(picked.target_pct));
      }
    }

    if (!Array.isArray(picked.sources)) picked.sources = [];
    if (!picked.sources.includes("pnl_actuals")) picked.sources = [...picked.sources, "pnl_actuals"];
    if (!Array.isArray(picked.flags)) picked.flags = [];
    if (!picked.flags.includes("finance_close_absorbed")) picked.flags = [...picked.flags, "finance_close_absorbed"];
    const periodsList = (info.by_period || [])
      .filter(b => Math.abs(b.amount) >= 0.005)
      .map(b => b.period_no)
      .sort((a, b) => a - b);
    const periodLabel = periodsList.length === 0
      ? "verified"
      : periodsList.length === 1
        ? `P${periodsList[0]} verified`
        : `P${periodsList[0]}-P${periodsList[periodsList.length - 1]} verified`;
    picked.finance_close_absorbed = {
      amount: r2(adjustment),
      periods_verified: periodsList,
      period_label: periodLabel,
    };

    applied.push({
      parent,
      absorber_line_code: picked.line_code,
      amount: r2(adjustment),
      periods_verified: periodsList,
      went_negative: wentNegative,
    });
  }
  return { applied, fallbackRows };
}
