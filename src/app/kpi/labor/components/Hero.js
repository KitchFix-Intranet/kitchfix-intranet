"use client";
// src/app/kpi/labor/components/Hero.js
//
// D2 P5 (hero half) - "Total labor · {resolved preset}" + big money +
// sub-line (account · worker-weeks) + variance pill vs the range
// budget from the labor route.
//
// kpi-2 · budget now consumes budget_periods (Playbook 4.5). When any
// in-range period is superseded (an owner ruling supersedes the P&L
// figure), a small marker on the sub-line carries the reason + the
// P&L number in its native title. Envelope mode (TXR - TX - V, per
// Playbook 4.6) hides the varpill entirely and points to the Service
// Calendar for the adjusted envelope.

import { fmt$ } from "../lib/formatting";
import {
  budgetForRange,
  elapsedPct,
  presetSuffix,
  hasSupersededInRange,
  supersededSummary,
} from "../lib/budgets";
import { spanLabelForRange } from "../lib/periods";

export function Hero({
  account,
  totals,             // { amount, hours_regular, hours_overtime, hours_double_time, hours_without_dollars }
  weekCount,          // canonical weeksInRange - calendar weeks in [start, end]
  workerWeekCount,
  lastPreset,
  start,
  end,
  today,
  currentPeriodNo,
  budgetPeriods,      // from labor route, per Playbook 4.5. Empty on envelope mode.
  budgetMode,         // 'static' | 'envelope'
}) {
  const totalLabor = Number(totals?.amount || 0);
  const isEnvelope = budgetMode === "envelope";
  const budget = isEnvelope ? 0 : budgetForRange(budgetPeriods, start, end);
  const elapsed = elapsedPct(start, end, today);
  const pace = budget > 0 ? (totalLabor / budget) * 100 : 0;
  const paceBad = budget > 0 && pace > elapsed + 2;

  const suffix = presetSuffix(lastPreset, start, end, currentPeriodNo);

  const superseded = !isEnvelope && hasSupersededInRange(budgetPeriods, start, end);
  const superLines = superseded ? supersededSummary(budgetPeriods, start, end) : [];
  const superTitle = superLines.map(s =>
    `P${s.period_no}: live ${fmt$(s.amount)}` +
    (s.pnl_amount != null ? ` (P&L ${fmt$(s.pnl_amount)})` : "") +
    (s.reason ? ` - ${s.reason}` : "")
  ).join(" · ");

  return (
    <div className="kpi-hero">
      <div className="kpi-hero-l">
        <div className="kpi-hero-lab">Total labor{suffix}</div>
        <div className="kpi-hero-n kpi-mono">{fmt$(totalLabor)}</div>
        <div className="kpi-hero-sub">
          {account} · <span className="kpi-mono">{workerWeekCount}</span> worker-weeks
        </div>
      </div>
      {isEnvelope ? (
        <div>
          <div className="kpi-hero-sub">budget: envelope-based (see Service Calendar)</div>
        </div>
      ) : budget > 0 ? (
        <div>
          <div
            className={`kpi-varpill ${paceBad ? "bad" : "good"}`}
            title="Pace: budget consumed vs range elapsed"
          >
            {pace.toFixed(0)}% of budget · {elapsed.toFixed(0)}% elapsed
          </div>
          <div className="kpi-hero-sub">
            {/* D2.3 Ruling C - name the fiscal span the RANGE touches
                rather than a week count. The label reads from the same
                week enumerator the dollars use, so the two grains
                cannot diverge. Zero-budget periods (pre-opening) still
                appear in the span - it names the date range, not the
                nonzero-budget subset. */}
            budget {fmt$(budget)}
            {(() => {
              const span = spanLabelForRange(start, end, today);
              return span ? <> · {span}</> : null;
            })()}
            {superseded && (
              <span
                className="kpi-super-mark"
                title={superTitle}
                aria-label="One or more periods in this range carry an owner-ruled supersede over the P&L figure"
              > · superseded</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
