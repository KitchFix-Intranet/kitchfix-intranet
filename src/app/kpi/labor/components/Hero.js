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

import { fmt$, fmtDate } from "../lib/formatting";
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
  budgetNotes,        // { envelope_excluded?: [...] } on aggregate requests when V is in scope
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
  // V6-20 - aggregate paths include member_detail per period; the
  // marker title lists which member accounts drove the supersede
  // (account_keys only - never worker names).
  const memberDetailByPeriod = new Map();
  if (Array.isArray(budgetPeriods)) {
    for (const bp of budgetPeriods) {
      if (bp?.superseded && Array.isArray(bp.member_detail)) {
        memberDetailByPeriod.set(Number(bp.period_no), bp.member_detail.filter(m => m.superseded));
      }
    }
  }
  const superTitle = superLines.map(s => {
    const members = memberDetailByPeriod.get(s.period_no);
    if (members && members.length > 0) {
      return `P${s.period_no}: ${members.map(m => `${m.account_key}${m.reason ? ` (${m.reason})` : ""}`).join(", ")}`;
    }
    return `P${s.period_no}: live ${fmt$(s.amount)}` +
      (s.pnl_amount != null ? ` (P&L ${fmt$(s.pnl_amount)})` : "") +
      (s.reason ? ` - ${s.reason}` : "");
  }).join(" · ");

  return (
    <div className="kpi-hero">
      <div className="kpi-hero-l">
        {/* V6-9 - the resolved date range echoes beside the hero
            label for EVERY selection (preset, PERIOD n, MONTH year,
            CUSTOM RANGE). Reads the same start/end that drives the
            money, so the two grains cannot diverge. */}
        <div className="kpi-hero-lab-row">
          <span className="kpi-hero-lab">Total labor{suffix}</span>
          <span className="kpi-hero-dates">{fmtDate(start)} – {fmtDate(end)}</span>
        </div>
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
            {/* V6-20 - aggregate envelope-exclusion marker. Renders
                only when the labor route ships budget_notes.envelope_
                excluded (aggregate mode with V in the member set). */}
            {Array.isArray(budgetNotes?.envelope_excluded) && budgetNotes.envelope_excluded.length > 0 && (
              <span
                className="kpi-super-mark"
                title={`Excluded from aggregate budget: ${budgetNotes.envelope_excluded.join(", ")} (playbook 4.6 envelope)`}
              > · excludes {budgetNotes.envelope_excluded.join(", ")} (envelope)</span>
            )}
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
