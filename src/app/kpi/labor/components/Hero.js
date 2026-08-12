"use client";
// src/app/kpi/labor/components/Hero.js
//
// D2 P5 (hero half) - "Total labor · {resolved preset}" + big money +
// sub-line (account · worker-weeks), plus a variance pill vs the
// illustrative budget (K9 label at every occurrence, +b pace rule:
// warn when pace exceeds elapsed by > 2pts).

import { fmt$ } from "../lib/formatting";
import { budgetForRange, elapsedPct, presetSuffix } from "../lib/budgets";

export function Hero({
  account,
  totals,             // { amount, hours_regular, hours_overtime, hours_double_time, hours_without_dollars }
  weekCount,
  workerWeekCount,
  lastPreset,
  start,
  end,
  today,
  currentPeriodNo,
}) {
  const totalLabor = Number(totals?.amount || 0);
  const budget = budgetForRange(account, weekCount);
  const elapsed = elapsedPct(start, end, today);
  const pace = budget > 0 ? (totalLabor / budget) * 100 : 0;
  const paceBad = budget > 0 && pace > elapsed + 2;

  const suffix = presetSuffix(lastPreset, start, end, currentPeriodNo);

  return (
    <div className="kpi-hero">
      <div className="kpi-hero-l">
        <div className="kpi-hero-lab">Total labor{suffix}</div>
        <div className="kpi-hero-n kpi-mono">{fmt$(totalLabor)}</div>
        <div className="kpi-hero-sub">
          {account} · <span className="kpi-mono">{workerWeekCount}</span> worker-weeks
        </div>
      </div>
      {budget > 0 && (
        <div>
          <div
            className={`kpi-varpill ${paceBad ? "bad" : "good"}`}
            title="Pace: budget consumed vs range elapsed · budget illustrative"
          >
            {pace.toFixed(0)}% of budget · {elapsed.toFixed(0)}% elapsed
            <small>illustrative</small>
          </div>
          <div className="kpi-hero-sub">
            budget {fmt$(budget)} over {weekCount} weeks
          </div>
        </div>
      )}
    </div>
  );
}
